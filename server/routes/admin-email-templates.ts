/**
 * ADMIN-10 — Automated emails (staff-admin only, STAFF_ADMIN_ONLY_SURFACES
 * lockstep). Lists every automated email with its trigger and recipients in
 * plain words, lets a staff admin edit the free-text copy (subject, heading,
 * paragraphs) and enable/disable each template, and renders a sample
 * preview. The hardcoded template is always the fallback; saving refuses
 * loudly when a required placeholder is missing. The login-link email is
 * authentication infrastructure: listed, previewable, view-only.
 */
import type { Express, Request, Response } from "express";
import { requireStaffAdmin, staffContext, sendNotFound } from "../auth/guards";
import * as dal from "../dal";
import type { DbContext } from "../db/client";
import { PRODUCT_TEMPLATES, isProductTemplateKey, type ProductTemplateKey } from "../email/templates";
import { renderMagicLinkEmail } from "../email/templates/auth-magic-link";
import { copyPlaceholders, finalizeHtml, type TemplateCopy } from "../email/render";
import { absoluteUrl, EMAIL_HEADER_PATH } from "../email/send";
import { effectiveCopy, envStaffRecipients, parseRecipientOverride, validateCopy } from "../email/overrides";
import { templateDisplayName } from "../../shared/email-templates";

const SAVE_FAILURE = "That did not save. Nothing was changed.";

function staffCtx(req: Request): DbContext {
  return { kind: "staff", userId: staffContext(req).userId };
}

/** Parse a request-body copy block; null = clear the override. */
function parseCopyBody(raw: unknown): { ok: true; copy: TemplateCopy | null } | { ok: false } {
  if (raw === null) return { ok: true, copy: null };
  if (typeof raw !== "object" || raw === undefined) return { ok: false };
  const o = raw as Record<string, unknown>;
  if (typeof o.subject !== "string" || typeof o.heading !== "string" || !Array.isArray(o.paragraphs)) {
    return { ok: false };
  }
  if (o.paragraphs.some((p) => typeof p !== "string")) return { ok: false };
  return { ok: true, copy: { subject: o.subject, heading: o.heading, paragraphs: o.paragraphs as string[] } };
}

const EMAILISH_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function registerEmailTemplateAdminRoutes(app: Express): void {
  // ---- List every automated email with metadata + current override state.
  app.get("/api/admin/email-templates", requireStaffAdmin, async (req: Request, res: Response, next) => {
    try {
      const ctx = staffCtx(req);
      const overrides = new Map((await dal.emailTemplateOverrides.listOverrides(ctx)).map((o) => [o.templateKey, o]));
      const envStaff = envStaffRecipients().all;

      const templates = Object.entries(PRODUCT_TEMPLATES).map(([key, template]) => {
        const ov = overrides.get(key) ?? null;
        const hasCopyOverride = !!ov && ov.subject != null;
        return {
          key,
          name: templateDisplayName(key),
          trigger: template.trigger,
          recipients: template.recipients,
          recipientsConfigurable: template.recipientsConfigurable,
          /** Effective staff recipients shown only for configurable templates. */
          effectiveRecipients: template.recipientsConfigurable
            ? (parseRecipientOverride(ov?.recipients).length > 0 ? parseRecipientOverride(ov?.recipients) : envStaff)
            : null,
          recipientsOverride: template.recipientsConfigurable ? (ov?.recipients ?? null) : null,
          enabled: ov?.enabled ?? true,
          hasCopyOverride,
          defaultCopy: template.defaultCopy,
          copy: effectiveCopy(key as ProductTemplateKey, ov) ?? template.defaultCopy,
          placeholders: copyPlaceholders(template.defaultCopy),
          authInfrastructure: false,
        };
      });

      templates.push({
        key: "auth_magic_link",
        name: templateDisplayName("auth_magic_link"),
        trigger: "A member requests a sign-in link at the login page",
        recipients: "The member who requested the link",
        recipientsConfigurable: false,
        effectiveRecipients: null,
        recipientsOverride: null,
        enabled: true,
        hasCopyOverride: false,
        defaultCopy: { subject: "Your sign-in link for Love in Action", heading: "Sign in to Love in Action", paragraphs: [] },
        copy: { subject: "Your sign-in link for Love in Action", heading: "Sign in to Love in Action", paragraphs: [] },
        placeholders: [],
        authInfrastructure: true,
      });

      res.json({ templates });
    } catch (err) {
      next(err);
    }
  });

  // ---- Save copy/recipient overrides. Refuses (400, stated reason) when a
  // required placeholder is missing — editing never breaks variables.
  app.put("/api/admin/email-templates/:key", requireStaffAdmin, async (req: Request, res: Response) => {
    const key = req.params.key ?? "";
    if (!isProductTemplateKey(key)) {
      // auth_magic_link is view-only; unknown keys do not exist.
      sendNotFound(res);
      return;
    }
    const template = PRODUCT_TEMPLATES[key];

    const parsed = parseCopyBody(req.body?.copy);
    if (!parsed.ok) {
      res.status(400).json({ message: SAVE_FAILURE, errors: ["The copy payload is malformed."] });
      return;
    }
    if (parsed.copy) {
      const errors = validateCopy(key, parsed.copy);
      if (errors.length > 0) {
        res.status(400).json({ message: "The copy was not saved.", errors });
        return;
      }
    }

    let recipients: string | null = null;
    const rawRecipients = req.body?.recipients;
    if (rawRecipients != null && rawRecipients !== "") {
      if (!template.recipientsConfigurable || typeof rawRecipients !== "string") {
        res.status(400).json({
          message: "The recipients were not saved.",
          errors: ["This template's recipients are fixed and cannot be edited."],
        });
        return;
      }
      const addresses = parseRecipientOverride(rawRecipients);
      const bad = addresses.filter((a) => !EMAILISH_RE.test(a));
      if (addresses.length === 0 || bad.length > 0) {
        res.status(400).json({
          message: "The recipients were not saved.",
          errors: bad.length > 0 ? bad.map((a) => `"${a}" is not a valid email address.`) : ["At least one address is required."],
        });
        return;
      }
      recipients = addresses.join(", ");
    }

    try {
      const saved = await dal.emailTemplateOverrides.saveOverride(staffCtx(req), key, {
        copy: parsed.copy,
        recipients,
      });
      res.json({ ok: true, override: saved });
    } catch (err) {
      console.error(`[admin] email template save failed (${key}):`, err);
      res.status(500).json({ message: SAVE_FAILURE });
    }
  });

  // ---- Enable/disable. A disabled template writes visible skipped rows.
  app.post("/api/admin/email-templates/:key/enabled", requireStaffAdmin, async (req: Request, res: Response) => {
    const key = req.params.key ?? "";
    if (!isProductTemplateKey(key)) {
      sendNotFound(res);
      return;
    }
    const enabled = req.body?.enabled;
    if (typeof enabled !== "boolean") {
      res.status(400).json({ message: SAVE_FAILURE });
      return;
    }
    try {
      const saved = await dal.emailTemplateOverrides.setEnabled(staffCtx(req), key, enabled);
      res.json({ ok: true, enabled: saved.enabled });
    } catch (err) {
      console.error(`[admin] email template enable toggle failed (${key}):`, err);
      res.status(500).json({ message: SAVE_FAILURE });
    }
  });

  // ---- Rendered preview with sample data. Accepts optional draft copy so
  // edits can be previewed before saving; draft copy is validated first.
  app.post("/api/admin/email-templates/:key/preview", requireStaffAdmin, async (req: Request, res: Response, next) => {
    const key = req.params.key ?? "";
    try {
      if (key === "auth_magic_link") {
        const rendered = renderMagicLinkEmail({ firstName: "Maria", url: absoluteUrl("/login") });
        res.json({
          subject: rendered.subject,
          html: finalizeHtml(rendered.html, absoluteUrl(EMAIL_HEADER_PATH)),
          text: rendered.text,
        });
        return;
      }
      if (!isProductTemplateKey(key)) {
        sendNotFound(res);
        return;
      }
      const template = PRODUCT_TEMPLATES[key];

      let copy: TemplateCopy | undefined;
      if (req.body?.copy !== undefined) {
        const parsed = parseCopyBody(req.body.copy);
        if (!parsed.ok) {
          res.status(400).json({ message: "The preview could not be rendered.", errors: ["The copy payload is malformed."] });
          return;
        }
        if (parsed.copy) {
          const errors = validateCopy(key, parsed.copy);
          if (errors.length > 0) {
            res.status(400).json({ message: "The preview could not be rendered.", errors });
            return;
          }
          copy = parsed.copy;
        }
      } else {
        const ov = await dal.emailTemplateOverrides.getOverride(staffCtx(req), key);
        copy = effectiveCopy(key, ov);
      }

      const rendered = template.render(template.sample as never, copy);
      res.json({
        subject: rendered.subject,
        html: finalizeHtml(rendered.html, absoluteUrl(EMAIL_HEADER_PATH)),
        text: rendered.text,
      });
    } catch (err) {
      next(err);
    }
  });
}
