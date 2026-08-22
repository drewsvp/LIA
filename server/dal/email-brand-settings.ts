/**
 * email_brand_settings DAL (Task 241).
 *
 * Singleton table (id = 1); one row holds the platform-wide brand settings
 * used by every outbound email. An in-process cache (invalidated on write)
 * means the render path never hits the DB per send.
 *
 * The cache also pushes settings into render.ts via setBrand() so all email
 * helper functions (shell, para, etc.) pick up the live colour/font.
 */
import { q, withDbContext, SYSTEM, type DbContext } from "../db/client";
import { setBrand, BRAND_DEFAULTS, type BrandSettings } from "../email/render";

export type EmailBrandSettingsRow = {
  id: number;
  primaryColor: string;
  fontStack: string;
  orgName: string;
  programName: string;
  signatureName: string;
  directorName: string;
  directorEmail: string;
  directorTitle: string;
  headerImageUrl: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
  /** Display name resolved via the users + people join. */
  updatedByName: string | null;
};

const ADMIN_COLS = `
  s.id,
  s.primary_color    as "primaryColor",
  s.font_stack       as "fontStack",
  s.org_name         as "orgName",
  s.program_name     as "programName",
  s.signature_name   as "signatureName",
  s.director_name    as "directorName",
  s.director_email   as "directorEmail",
  s.director_title   as "directorTitle",
  s.header_image_url as "headerImageUrl",
  s.updated_at       as "updatedAt",
  s.updated_by       as "updatedBy",
  case when p.id is not null
    then p.first_name || ' ' || p.last_name
    else null
  end                as "updatedByName"`;

const INTERNAL_COLS = `
  id,
  primary_color    as "primaryColor",
  font_stack       as "fontStack",
  org_name         as "orgName",
  program_name     as "programName",
  signature_name   as "signatureName",
  director_name    as "directorName",
  director_email   as "directorEmail",
  director_title   as "directorTitle",
  header_image_url as "headerImageUrl",
  updated_at       as "updatedAt",
  updated_by       as "updatedBy",
  null::text       as "updatedByName"`;

/** Convert a DB row to the render.ts BrandSettings shape. */
function rowToBrand(row: EmailBrandSettingsRow): BrandSettings {
  return {
    primaryColor: row.primaryColor,
    fontStack: row.fontStack,
    orgName: row.orgName,
    programName: row.programName,
    signatureName: row.signatureName,
    directorName: row.directorName,
    directorEmail: row.directorEmail,
    directorTitle: row.directorTitle,
    headerImageUrl: row.headerImageUrl,
  };
}

// ---- In-process cache -------------------------------------------------------

let _cache: EmailBrandSettingsRow | null = null;

function setCache(row: EmailBrandSettingsRow): void {
  _cache = row;
  setBrand(rowToBrand(row));
}

// ---- Public API ------------------------------------------------------------

/**
 * Return the current brand settings, using the in-process cache.
 * Falls back to defaults if the row is absent (pre-migration safety).
 */
export async function getBrandSettings(ctx: DbContext): Promise<EmailBrandSettingsRow> {
  if (_cache) return _cache;
  return refreshBrandCache(ctx);
}

/**
 * Load brand settings from DB, populate the in-process cache, and push into
 * the render.ts module state. Safe to call at startup or after a write.
 */
export async function refreshBrandCache(ctx: DbContext): Promise<EmailBrandSettingsRow> {
  const rows = await withDbContext(ctx, (c) =>
    q<EmailBrandSettingsRow>(
      c,
      `select ${INTERNAL_COLS} from email_brand_settings where id = 1`,
    ),
  );
  const row = rows[0];
  if (row) {
    setCache(row);
    return row;
  }
  // Table exists but row absent — seed defaults into cache without DB round-trip.
  const fallback: EmailBrandSettingsRow = {
    id: 1,
    ...BRAND_DEFAULTS,
    updatedAt: null,
    updatedBy: null,
    updatedByName: null,
  };
  setCache(fallback);
  return fallback;
}

/** Admin-facing read: returns the row with the updatedByName join. */
export async function getBrandSettingsAdmin(ctx: DbContext): Promise<EmailBrandSettingsRow> {
  const rows = await withDbContext(ctx, (c) =>
    q<EmailBrandSettingsRow>(
      c,
      `select ${ADMIN_COLS}
       from email_brand_settings s
       left join users u  on u.id  = s.updated_by
       left join people p on p.id  = u.person_id
       where s.id = 1`,
    ),
  );
  const row = rows[0];
  if (row) {
    setCache(row);
    return row;
  }
  const fallback: EmailBrandSettingsRow = {
    id: 1,
    ...BRAND_DEFAULTS,
    updatedAt: null,
    updatedBy: null,
    updatedByName: null,
  };
  setCache(fallback);
  return fallback;
}

export type UpsertBrandInput = {
  primaryColor?: string;
  fontStack?: string;
  orgName?: string;
  programName?: string;
  signatureName?: string;
  directorName?: string;
  directorEmail?: string;
  directorTitle?: string;
  headerImageUrl?: string | null;
  updatedByUserId: string | null;
};

/** Save brand settings (upsert the singleton row) and invalidate the cache. */
export async function upsertBrandSettings(
  ctx: DbContext,
  input: UpsertBrandInput,
): Promise<EmailBrandSettingsRow> {
  const rows = await withDbContext(ctx, (c) =>
    q<EmailBrandSettingsRow>(
      c,
      `insert into email_brand_settings (
         id, primary_color, font_stack, org_name, program_name,
         signature_name, director_name, director_email, director_title,
         header_image_url, updated_at, updated_by
       )
       values (1, $1, $2, $3, $4, $5, $6, $7, $8, $9, now(), $10)
       on conflict (id) do update set
         primary_color    = coalesce($1,  email_brand_settings.primary_color),
         font_stack       = coalesce($2,  email_brand_settings.font_stack),
         org_name         = coalesce($3,  email_brand_settings.org_name),
         program_name     = coalesce($4,  email_brand_settings.program_name),
         signature_name   = coalesce($5,  email_brand_settings.signature_name),
         director_name    = coalesce($6,  email_brand_settings.director_name),
         director_email   = coalesce($7,  email_brand_settings.director_email),
         director_title   = coalesce($8,  email_brand_settings.director_title),
         header_image_url = case when $9::text is distinct from '___UNSET___' then $9::text
                                 else email_brand_settings.header_image_url end,
         updated_at       = now(),
         updated_by       = $10
       returning ${INTERNAL_COLS}`,
      [
        input.primaryColor ?? null,
        input.fontStack ?? null,
        input.orgName ?? null,
        input.programName ?? null,
        input.signatureName ?? null,
        input.directorName ?? null,
        input.directorEmail ?? null,
        input.directorTitle ?? null,
        "headerImageUrl" in input ? (input.headerImageUrl ?? null) : "___UNSET___",
        input.updatedByUserId,
      ],
    ),
  );
  const row = rows[0];
  if (!row) throw new Error("emailBrandSettings.upsertBrandSettings returned no row");
  // Invalidate cache and push to render.ts.
  setCache(row);
  return row;
}

/** Reset all brand fields to the hardcoded defaults. */
export async function resetToDefaults(
  ctx: DbContext,
  updatedByUserId: string | null,
): Promise<EmailBrandSettingsRow> {
  const d = BRAND_DEFAULTS;
  const rows = await withDbContext(ctx, (c) =>
    q<EmailBrandSettingsRow>(
      c,
      `insert into email_brand_settings (
         id, primary_color, font_stack, org_name, program_name,
         signature_name, director_name, director_email, director_title,
         header_image_url, updated_at, updated_by
       )
       values (1, $1, $2, $3, $4, $5, $6, $7, $8, null, now(), $9)
       on conflict (id) do update set
         primary_color    = excluded.primary_color,
         font_stack       = excluded.font_stack,
         org_name         = excluded.org_name,
         program_name     = excluded.program_name,
         signature_name   = excluded.signature_name,
         director_name    = excluded.director_name,
         director_email   = excluded.director_email,
         director_title   = excluded.director_title,
         header_image_url = null,
         updated_at       = now(),
         updated_by       = excluded.updated_by
       returning ${INTERNAL_COLS}`,
      [
        d.primaryColor,
        d.fontStack,
        d.orgName,
        d.programName,
        d.signatureName,
        d.directorName,
        d.directorEmail,
        d.directorTitle,
        updatedByUserId,
      ],
    ),
  );
  const row = rows[0];
  if (!row) throw new Error("emailBrandSettings.resetToDefaults returned no row");
  setCache(row);
  return row;
}
