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
import { absoluteUrl, headerImageDataUri } from "../email/send";
import { effectiveCopy, envStaffRecipients, parseRecipientOverride, validateCopy } from "../email/overrides";
import { templateDisplayName } from "../../shared/email-templates";
import { SCHEDULABLE_TEMPLATE_KEYS } from "../digest-schedule";
import type { EmailSchedule } from "../dal/email-schedules";

const SAVE_FAILURE = "That did not save. Nothing was changed.";

function staffCtx(req: Request): DbContext {
  return { kind: "staff", userId: staffContext(req).userId };
}

async function scheduleResponse(ctx: DbContext, schedule: EmailSchedule): Promise<EmailSchedule & { nextSendAt: string | null }> {
  return { ...schedule, nextSendAt: await dal.emailSchedules.nextSendAt(ctx, schedule) };
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
const CALENDAR_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isCalendarDate(value: string): boolean {
  if (!CALENDAR_DATE_RE.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year!, month! - 1, day!));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month! - 1 &&
    parsed.getUTCDate() === day
  );
}

export function registerEmailTemplateAdminRoutes(app: Express): void {
  // ---- List every automated email with metadata + current override state.
  app.get("/api/admin/email-templates", requireStaffAdmin, async (req: Request, res: Response, next) => {
    try {
      const ctx = staffCtx(req);
       const [overrideRows, scheduleRows] = await Promise.all([
         dal.emailTemplateOverrides.listOverrides(ctx),
         dal.emailSchedules.listSchedules(ctx),
       ]);
       const overrides = new Map(overrideRows.map((o) => [o.templateKey, o]));
       const schedules = new Map(
         await Promise.all(
           scheduleRows.map(async (schedule) => [schedule.templateKey, await scheduleResponse(ctx, schedule)] as const),
         ),
       );
      const envStaff = envStaffRecipients().all;

      const templates = Object.entries(PRODUCT_TEMPLATES).map(([key, template]) => {
        const ov = overrides.get(key) ?? null;
         const schedule = schedules.get(key) ?? null;
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
           deliveryType: schedule ? "scheduled" : "event_triggered",
           schedule,
          updatedAt: ov?.updatedAt ?? null,
          updatedByName: ov?.updatedByName ?? null,
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
         deliveryType: "event_triggered",
         schedule: null,
        updatedAt: null,
        updatedByName: null,
      });

      res.json({ templates });
    } catch (err) {
      next(err);
    }
  });

  // ---- Scheduled templates only. Event-triggered notifications have no
  // irrelevant timing fields and cannot be delayed through this endpoint.
  app.put("/api/admin/email-templates/:key/schedule", requireStaffAdmin, async (req: Request, res: Response) => {
    const key = req.params.key ?? "";
    if (!isProductTemplateKey(key)) {
      sendNotFound(res);
      return;
    }
    if (!SCHEDULABLE_TEMPLATE_KEYS.has(key)) {
      res.status(400).json({ message: "This is an event-triggered email and does not have a schedule." });
      return;
    }
    const active = req.body?.active;
    const weeklyWeekday = req.body?.weeklyWeekday;
    const weeklyMinutes = req.body?.weeklyMinutes;
    const oneTimeDate = req.body?.oneTimeDate;
    const oneTimeTime = req.body?.oneTimeTime;
    if (
      typeof active !== "boolean" ||
      !Number.isInteger(weeklyWeekday) ||
      weeklyWeekday < 0 ||
      weeklyWeekday > 6 ||
      !Number.isInteger(weeklyMinutes) ||
      weeklyMinutes < 0 ||
      weeklyMinutes > 1439
    ) {
      res.status(400).json({ message: "Choose a valid weekly day and time." });
      return;
    }

    try {
      let oneTimeAt: string | null = null;
      if (oneTimeDate !== null || oneTimeTime !== null) {
        if (
          typeof oneTimeDate !== "string" ||
          typeof oneTimeTime !== "string" ||
          !isCalendarDate(oneTimeDate) ||
          !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(oneTimeTime)
        ) {
          res.status(400).json({ message: "Enter a valid one-time Pacific date and time, or cancel it." });
          return;
        }
        oneTimeAt = await dal.emailSchedules.pacificLocalToInstant(staffCtx(req), oneTimeDate, oneTimeTime);
        if (oneTimeAt === null) {
          res.status(400).json({ message: "That Pacific time does not exist because of the daylight-saving change. Choose another time." });
          return;
        }
        if (new Date(oneTimeAt).getTime() <= Date.now()) {
          // Preserve an existing pending one-time send that became overdue
          // while paused. Resuming then runs it immediately instead of forcing
          // staff to silently replace or cancel it.
          const existing = await dal.emailSchedules.getSchedule(staffCtx(req), key);
          const samePending =
            existing?.oneTimeAt !== null &&
            existing?.oneTimeAt !== undefined &&
            new Date(existing.oneTimeAt).getTime() === new Date(oneTimeAt).getTime();
          if (!samePending) {
            res.status(400).json({ message: "The one-time send must be in the future (Pacific time)." });
            return;
          }
        }
      }
      const saved = await dal.emailSchedules.saveSchedule(staffCtx(req), key, {
        active,
        weeklyWeekday,
        weeklyMinutes,
        oneTimeAt,
        updatedByUserId: staffContext(req).userId,
      });
      res.json({ ok: true, schedule: await scheduleResponse(staffCtx(req), saved) });
    } catch (err) {
      console.error(`[admin] email schedule save failed (${key}):`, err);
      res.status(500).json({ message: SAVE_FAILURE });
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
        updatedByUserId: staffContext(req).userId,
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
      const saved = await dal.emailTemplateOverrides.setEnabled(staffCtx(req), key, {
        enabled,
        updatedByUserId: staffContext(req).userId,
      });
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
          // Preview: data URI so the logo renders in the browser regardless of APP_BASE_URL.
          html: finalizeHtml(rendered.html, headerImageDataUri()),
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
        // Preview: data URI so the logo renders in the browser regardless of APP_BASE_URL.
        html: finalizeHtml(rendered.html, headerImageDataUri()),
        text: rendered.text,
      });
    } catch (err) {
      next(err);
    }
  });
}
