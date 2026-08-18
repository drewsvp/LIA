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
  /** users.id of the staff member who last saved (null for pre-migration rows). */
  updatedBy: string | null;
  /** Display name resolved from the users + people join; null when updatedBy is null. */
  updatedByName: string | null;
};

/**
 * Columns for admin-facing queries — includes a left-join to resolve the
 * updatedBy user to a display name.
 */
const ADMIN_COLS = `
  o.template_key   as "templateKey",
  o.subject,
  o.heading,
  o.paragraphs,
  o.recipients,
  o.enabled,
  o.updated_at     as "updatedAt",
  o.updated_by     as "updatedBy",
  case when p.id is not null
    then p.first_name || ' ' || p.last_name
    else null
  end              as "updatedByName"`;

/**
 * Lightweight columns for internal (dispatch/send) paths that only need the
 * copy/enabled state and don't require the actor join.
 */
const INTERNAL_COLS = `
  template_key as "templateKey", subject, heading, paragraphs, recipients, enabled,
  updated_at as "updatedAt", updated_by as "updatedBy", null::text as "updatedByName"`;

export async function listOverrides(ctx: DbContext): Promise<EmailTemplateOverride[]> {
  return withDbContext(ctx, (c) =>
    q<EmailTemplateOverride>(
      c,
      `select ${ADMIN_COLS}
       from email_template_overrides o
       left join users u  on u.id  = o.updated_by
       left join people p on p.id  = u.person_id`,
    ),
  );
}

export async function getOverride(ctx: DbContext, templateKey: string): Promise<EmailTemplateOverride | null> {
  const rows = await withDbContext(ctx, (c) =>
    q<EmailTemplateOverride>(
      c,
      `select ${ADMIN_COLS}
       from email_template_overrides o
       left join users u  on u.id  = o.updated_by
       left join people p on p.id  = u.person_id
       where o.template_key = $1`,
      [templateKey],
    ),
  );
  return rows[0] ?? null;
}

/** Transaction-composable read for the in-tx queue path. */
export async function getOverrideInTx(c: PoolClient, templateKey: string): Promise<EmailTemplateOverride | null> {
  const rows = await q<EmailTemplateOverride>(
    c,
    `select ${INTERNAL_COLS} from email_template_overrides where template_key = $1`,
    [templateKey],
  );
  return rows[0] ?? null;
}

export type SaveOverrideInput = {
  /** null clears the copy override (fall back to the hardcoded copy). */
  copy: { subject: string; heading: string; paragraphs: string[] } | null;
  /** null clears the recipient override. */
  recipients: string | null;
  /** users.id of the staff member performing the save; null for system operations. */
  updatedByUserId: string | null;
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
      `insert into email_template_overrides (template_key, subject, heading, paragraphs, recipients, updated_by)
       values ($1, $2, $3, $4::jsonb, $5, $6)
       on conflict (template_key) do update
         set subject    = excluded.subject,
             heading    = excluded.heading,
             paragraphs = excluded.paragraphs,
             recipients = excluded.recipients,
             updated_at = now(),
             updated_by = excluded.updated_by
       returning ${INTERNAL_COLS}`,
      [
        templateKey,
        input.copy?.subject ?? null,
        input.copy?.heading ?? null,
        input.copy ? JSON.stringify(input.copy.paragraphs) : null,
        input.recipients,
        input.updatedByUserId,
      ],
    ),
  );
  const row = rows[0];
  if (!row) throw new Error("emailTemplateOverrides.saveOverride returned no row");
  return row;
}

export type SetEnabledInput = {
  enabled: boolean;
  /** users.id of the staff member performing the toggle; null for system operations. */
  updatedByUserId: string | null;
};

/** Flip enabled, preserving any copy/recipient override. */
export async function setEnabled(
  ctx: DbContext,
  templateKey: string,
  input: SetEnabledInput,
): Promise<EmailTemplateOverride> {
  const rows = await withDbContext(ctx, (c) =>
    q<EmailTemplateOverride>(
      c,
      `insert into email_template_overrides (template_key, enabled, updated_by)
       values ($1, $2, $3)
       on conflict (template_key) do update
         set enabled    = excluded.enabled,
             updated_at = now(),
             updated_by = excluded.updated_by
       returning ${INTERNAL_COLS}`,
      [templateKey, input.enabled, input.updatedByUserId],
    ),
  );
  const row = rows[0];
  if (!row) throw new Error("emailTemplateOverrides.setEnabled returned no row");
  return row;
}
