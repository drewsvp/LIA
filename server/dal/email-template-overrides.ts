/**
 * email_template_overrides DAL (ADMIN-10). One row per template key holding
 * the staff-admin overrides: copy (subject/heading/paragraphs — all set
 * together, or all null = default copy), the enabled flag, and the recipient
 * override honored only for the staff-notification templates. The hardcoded
 * TypeScript template is always the fallback.
 */
import type { PoolClient } from "pg";
import { q, withDbContext, type DbContext } from "../db/client";

export type EmailTemplateOverride = {
  templateKey: string;
  subject: string | null;
  heading: string | null;
  paragraphs: string[] | null;
  recipients: string | null;
  enabled: boolean;
  updatedAt: string;
};

const COLS = `template_key as "templateKey", subject, heading, paragraphs, recipients, enabled,
  updated_at as "updatedAt"`;

export async function listOverrides(ctx: DbContext): Promise<EmailTemplateOverride[]> {
  return withDbContext(ctx, (c) => q<EmailTemplateOverride>(c, `select ${COLS} from email_template_overrides`));
}

export async function getOverride(ctx: DbContext, templateKey: string): Promise<EmailTemplateOverride | null> {
  const rows = await withDbContext(ctx, (c) =>
    q<EmailTemplateOverride>(c, `select ${COLS} from email_template_overrides where template_key = $1`, [templateKey]),
  );
  return rows[0] ?? null;
}

/** Transaction-composable read for the in-tx queue path. */
export async function getOverrideInTx(c: PoolClient, templateKey: string): Promise<EmailTemplateOverride | null> {
  const rows = await q<EmailTemplateOverride>(
    c,
    `select ${COLS} from email_template_overrides where template_key = $1`,
    [templateKey],
  );
  return rows[0] ?? null;
}

export type SaveOverrideInput = {
  /** null clears the copy override (fall back to the hardcoded copy). */
  copy: { subject: string; heading: string; paragraphs: string[] } | null;
  /** null clears the recipient override. */
  recipients: string | null;
};

/** Upsert copy/recipients, preserving the enabled flag. */
export async function saveOverride(
  ctx: DbContext,
  templateKey: string,
  input: SaveOverrideInput,
): Promise<EmailTemplateOverride> {
  const rows = await withDbContext(ctx, (c) =>
    q<EmailTemplateOverride>(
      c,
      `insert into email_template_overrides (template_key, subject, heading, paragraphs, recipients)
       values ($1, $2, $3, $4::jsonb, $5)
       on conflict (template_key) do update
         set subject = excluded.subject,
             heading = excluded.heading,
             paragraphs = excluded.paragraphs,
             recipients = excluded.recipients,
             updated_at = now()
       returning ${COLS}`,
      [
        templateKey,
        input.copy?.subject ?? null,
        input.copy?.heading ?? null,
        input.copy ? JSON.stringify(input.copy.paragraphs) : null,
        input.recipients,
      ],
    ),
  );
  const row = rows[0];
  if (!row) throw new Error("emailTemplateOverrides.saveOverride returned no row");
  return row;
}

/** Flip enabled, preserving any copy/recipient override. */
export async function setEnabled(ctx: DbContext, templateKey: string, enabled: boolean): Promise<EmailTemplateOverride> {
  const rows = await withDbContext(ctx, (c) =>
    q<EmailTemplateOverride>(
      c,
      `insert into email_template_overrides (template_key, enabled)
       values ($1, $2)
       on conflict (template_key) do update set enabled = excluded.enabled, updated_at = now()
       returning ${COLS}`,
      [templateKey, enabled],
    ),
  );
  const row = rows[0];
  if (!row) throw new Error("emailTemplateOverrides.setEnabled returned no row");
  return row;
}
