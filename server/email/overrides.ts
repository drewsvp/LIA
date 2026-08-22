/**
 * ADMIN-10 — staff-admin overrides for the automated emails.
 *
 * Bridges the override rows (email_template_overrides) and the hardcoded
 * templates: resolves the effective copy for a render, validates edited copy
 * against the template's placeholders (loud refusal, never silent), and
 * resolves the staff-notification recipient list (override wins over the
 * STAFF_NOTIFY_* env vars, but only for templates whose recipients are
 * genuinely configurable).
 */
import type { PoolClient } from "pg";
import type { DbContext } from "../db/client";
import * as dal from "../dal";
import type { EmailTemplateOverride } from "../dal/email-template-overrides";
import { copyPlaceholders, BRAND_TOKEN_NAMES, type BodyBlock, type TemplateCopy } from "./render";
import { PRODUCT_TEMPLATES, type ProductTemplateKey } from "./templates";

/**
 * Strict HTML allowlist for rich-body paragraph content.
 *
 * Reconstructs every permitted tag from scratch so no attributes survive
 * on anything other than <a href="...">. Permitted elements:
 *   <strong>, <em>       — no attributes, reconstructed as bare open/close tags
 *   <br>                 — canonicalised to <br /> regardless of original form
 *   <a href="...">       — only a safe href survives; href must start with
 *                          http://, https://, /, #, or mailto:
 * All other tags are stripped (inner text is preserved).
 *
 * Runs server-side before storage and rendering so hostile payloads (event
 * handlers, style attributes, script tags, …) never reach the preview iframe
 * or the live email HTML.
 */
export function sanitizeBodyHtml(raw: string): string {
  // Single-pass: match every HTML tag and reconstruct or discard it.
  return raw.replace(
    /<(\/?)([a-z][a-z0-9]*)(\b[^>]*)>/gi,
    (_match, close: string, tag: string, rest: string) => {
      switch (tag.toLowerCase()) {
        case "strong":
        case "em":
          // Reconstruct without any attributes.
          return close ? `</${tag.toLowerCase()}>` : `<${tag.toLowerCase()}>`;
        case "br":
          // Void element — ignore the close form; canonicalise open form.
          return close ? "" : "<br />";
        case "a": {
          if (close) return "</a>";
          // Parse href from the original attribute string.
          const m = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+))/i.exec(rest);
          const href = (m ? (m[1] ?? m[2] ?? m[3] ?? "") : "").trim();
          // Only http(s), root-relative, fragment, and mailto links are safe.
          if (!/^(https?:\/\/|\/(?!\/)|#|mailto:)/i.test(href)) return "";
          const escaped = href.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
          return `<a href="${escaped}">`;
        }
        default:
          // Strip the tag; inner text survives because we only replace the tag itself.
          return "";
      }
    },
  );
}

/**
 * Return a copy of `copy` with all bodyBlocks paragraph html values sanitized.
 * Call this at the API boundary before validateCopy and before saving.
 */
export function sanitizeCopy(copy: TemplateCopy): TemplateCopy {
  if (!copy.bodyBlocks?.length) return copy;
  return {
    ...copy,
    bodyBlocks: copy.bodyBlocks.map((block) =>
      block.kind === "paragraph" ? { ...block, html: sanitizeBodyHtml(block.html) } : block,
    ),
  };
}

/** The copy the render should use: the override when present, else the hardcoded default. */
export function effectiveCopy(key: ProductTemplateKey, ov: EmailTemplateOverride | null): TemplateCopy | undefined {
  if (!ov || ov.subject == null || ov.heading == null || ov.paragraphs == null) return undefined;
  return {
    subject: ov.subject,
    heading: ov.heading,
    paragraphs: ov.paragraphs,
    bodyBlocks: ov.bodyBlocks ?? undefined,
  };
}

/**
 * Validate edited copy against the template's default copy. Rules:
 *  - when bodyBlocks absent: same number of paragraphs, each non-empty;
 *  - when bodyBlocks present: skip paragraph-count check; validate each
 *    section block's name against the template's declared sections;
 *  - subject and heading non-empty in both modes;
 *  - every placeholder used by the default copy must remain present somewhere;
 *  - no placeholder outside the template's known variables may be introduced.
 * Returns readable error strings; empty array = valid.
 */
export function validateCopy(key: ProductTemplateKey, copy: TemplateCopy): string[] {
  const template = PRODUCT_TEMPLATES[key];
  const errors: string[] = [];

  if (copy.subject.trim() === "") errors.push("The subject cannot be empty.");
  if (copy.heading.trim() === "") errors.push("The heading cannot be empty.");

  if (copy.bodyBlocks && copy.bodyBlocks.length > 0) {
    // Rich-body mode: validate section names; skip paragraph-count check.
    const knownSectionNames = new Set((template.sections ?? []).map((s) => s.name));
    for (const block of copy.bodyBlocks) {
      if (block.kind === "section" && !knownSectionNames.has(block.name)) {
        errors.push(`"${block.name}" is not a section this template knows about.`);
      }
      if (block.kind === "paragraph" && block.html.trim() === "") {
        // Silently drop empty paragraphs — editors often emit trailing empties.
      }
    }
  } else {
    // Legacy paragraphs mode: exact count + non-empty check.
    const expected = template.defaultCopy.paragraphs.length;
    if (copy.paragraphs.length !== expected) {
      errors.push(`This template has ${expected} paragraph(s); ${copy.paragraphs.length} were provided.`);
    }
    copy.paragraphs.forEach((p, i) => {
      if (p.trim() === "") errors.push(`Paragraph ${i + 1} cannot be empty.`);
    });
  }

  // Placeholder rules apply in both modes (copyPlaceholders scans bodyBlocks).
  // Brand tokens ({orgName}, {programName}, {signature}, etc.) are global and
  // always valid — they resolve from brand settings at render time, not from
  // template-specific vars.
  const defaults = new Set(copyPlaceholders(template.defaultCopy));
  const used = new Set(copyPlaceholders(copy));
  const known = new Set<string>([...defaults, ...Object.keys(template.sample), ...BRAND_TOKEN_NAMES]);

  for (const name of defaults) {
    if (!used.has(name)) {
      errors.push(`The placeholder {${name}} is required by this template and must remain in the copy.`);
    }
  }
  for (const name of used) {
    if (!known.has(name)) {
      errors.push(`{${name}} is not a placeholder this template knows about.`);
    }
  }

  return errors;
}


/** Parse a stored comma-separated recipient override into addresses. */
export function parseRecipientOverride(recipients: string | null | undefined): string[] {
  if (!recipients) return [];
  return [...new Set(recipients.split(",").map((s) => s.trim()).filter((s) => s !== ""))];
}

/** Env-var staff addresses (D53). Missing values are the caller's loud-log concern. */
export function envStaffRecipients(): { primary: string; secondary: string; all: string[] } {
  const primary = (process.env.STAFF_NOTIFY_PRIMARY ?? "").trim();
  const secondary = (process.env.STAFF_NOTIFY_SECONDARY ?? "").trim();
  return { primary, secondary, all: [...new Set([primary, secondary].filter((e) => e !== ""))] };
}

/**
 * Effective staff-notification recipients for a configurable template:
 * the stored override when set, else both STAFF_NOTIFY_* addresses.
 */
export async function staffRecipientsInTx(c: PoolClient, key: ProductTemplateKey): Promise<string[]> {
  const ov = await dal.emailTemplateOverrides.getOverrideInTx(c, key);
  const overridden = parseRecipientOverride(ov?.recipients);
  return overridden.length > 0 ? overridden : envStaffRecipients().all;
}
