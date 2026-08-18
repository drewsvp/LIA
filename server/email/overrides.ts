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
import { copyPlaceholders, type TemplateCopy } from "./render";
import { PRODUCT_TEMPLATES, type ProductTemplateKey } from "./templates";

/** The copy the render should use: the override when present, else the hardcoded default. */
export function effectiveCopy(key: ProductTemplateKey, ov: EmailTemplateOverride | null): TemplateCopy | undefined {
  if (!ov || ov.subject == null || ov.heading == null || ov.paragraphs == null) return undefined;
  return { subject: ov.subject, heading: ov.heading, paragraphs: ov.paragraphs };
}

/**
 * Validate edited copy against the template's default copy. Rules:
 *  - same number of paragraphs, each non-empty; subject and heading non-empty;
 *  - every placeholder used by the default copy must remain present somewhere;
 *  - no placeholder outside the template's known variables may be introduced.
 * Returns readable error strings; empty array = valid.
 */
export function validateCopy(key: ProductTemplateKey, copy: TemplateCopy): string[] {
  const template = PRODUCT_TEMPLATES[key];
  const errors: string[] = [];
  if (copy.subject.trim() === "") errors.push("The subject cannot be empty.");
  if (copy.heading.trim() === "") errors.push("The heading cannot be empty.");
  const expected = template.defaultCopy.paragraphs.length;
  if (copy.paragraphs.length !== expected) {
    errors.push(`This template has ${expected} paragraph(s); ${copy.paragraphs.length} were provided.`);
  }
  copy.paragraphs.forEach((p, i) => {
    if (p.trim() === "") errors.push(`Paragraph ${i + 1} cannot be empty.`);
  });

  const defaults = new Set(copyPlaceholders(template.defaultCopy));
  const used = new Set(copyPlaceholders(copy));
  const known = new Set<string>([...defaults, ...Object.keys(template.sample)]);
  for (const name of defaults) {
    if (!used.has(name)) errors.push(`The placeholder {${name}} is required by this template and must remain in the copy.`);
  }
  for (const name of used) {
    if (!known.has(name)) errors.push(`{${name}} is not a placeholder this template knows about.`);
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

export async function staffRecipients(ctx: DbContext, key: ProductTemplateKey): Promise<string[]> {
  const ov = await dal.emailTemplateOverrides.getOverride(ctx, key);
  const overridden = parseRecipientOverride(ov?.recipients);
  return overridden.length > 0 ? overridden : envStaffRecipients().all;
}
