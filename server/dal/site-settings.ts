/**
 * site_settings DAL.
 *
 * Singleton table (id = 1); one row holds platform-wide copy values that
 * staff admins can change without a code deploy. An in-process cache
 * (invalidated on write) keeps the hot path free of DB round-trips.
 */
import { q, withDbContext, type DbContext } from "../db/client";

export type SiteSettingsRow = {
  id: number;
  siteName: string;
  contactEmail: string;
  responseTimeLanguage: string;
  imageGenerationEnabled: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
  /** Display name resolved via the users + people join. */
  updatedByName: string | null;
};

/** Hardcoded defaults — match the original source-code constants exactly. */
export const SITE_SETTINGS_DEFAULTS = {
  siteName: "Love in Action Database",
  contactEmail: "info@defendingthecause.org",
  responseTimeLanguage: "1-3 business days",
  imageGenerationEnabled: false,
};

const ADMIN_COLS = `
  s.id,
  s.site_name              as "siteName",
  s.contact_email          as "contactEmail",
  s.response_time_language as "responseTimeLanguage",
  s.image_generation_enabled as "imageGenerationEnabled",
  s.updated_at             as "updatedAt",
  s.updated_by             as "updatedBy",
  case when p.id is not null
    then p.first_name || ' ' || p.last_name
    else null
  end                      as "updatedByName"`;

const INTERNAL_COLS = `
  id,
  site_name              as "siteName",
  contact_email          as "contactEmail",
  response_time_language as "responseTimeLanguage",
  image_generation_enabled as "imageGenerationEnabled",
  updated_at             as "updatedAt",
  updated_by             as "updatedBy",
  null::text             as "updatedByName"`;

// ---- In-process cache -------------------------------------------------------

let _cache: SiteSettingsRow | null = null;

function setCache(row: SiteSettingsRow): void {
  _cache = row;
}

// ---- Public API ------------------------------------------------------------

/**
 * Read the currently cached site settings without a DB round-trip. Returns
 * defaults when the cache has not yet been populated (pre-startup safety).
 */
export function getCachedSiteSettings(): SiteSettingsRow {
  return (
    _cache ?? {
      id: 1,
      ...SITE_SETTINGS_DEFAULTS,
      updatedAt: null,
      updatedBy: null,
      updatedByName: null,
    }
  );
}

/**
 * Return the current site settings, using the in-process cache.
 * Falls back to defaults if the row is absent (pre-migration safety).
 */
export async function getSiteSettings(ctx: DbContext): Promise<SiteSettingsRow> {
  if (_cache) return _cache;
  return refreshSiteSettingsCache(ctx);
}

/**
 * Load site settings from DB and populate the in-process cache.
 * Safe to call at startup or after a write.
 */
export async function refreshSiteSettingsCache(ctx: DbContext): Promise<SiteSettingsRow> {
  const rows = await withDbContext(ctx, (c) =>
    q<SiteSettingsRow>(c, `select ${INTERNAL_COLS} from site_settings where id = 1`),
  );
  const row = rows[0];
  if (row) {
    setCache(row);
    return row;
  }
  // Table exists but row absent — seed defaults into cache without DB round-trip.
  const fallback: SiteSettingsRow = {
    id: 1,
    ...SITE_SETTINGS_DEFAULTS,
    updatedAt: null,
    updatedBy: null,
    updatedByName: null,
  };
  setCache(fallback);
  return fallback;
}

/** Admin-facing read: returns the row with the updatedByName join. */
export async function getSiteSettingsAdmin(ctx: DbContext): Promise<SiteSettingsRow> {
  const rows = await withDbContext(ctx, (c) =>
    q<SiteSettingsRow>(
      c,
      `select ${ADMIN_COLS}
       from site_settings s
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
  const fallback: SiteSettingsRow = {
    id: 1,
    ...SITE_SETTINGS_DEFAULTS,
    updatedAt: null,
    updatedBy: null,
    updatedByName: null,
  };
  setCache(fallback);
  return fallback;
}

export type UpsertSiteSettingsInput = {
  siteName: string;
  contactEmail: string;
  responseTimeLanguage: string;
  imageGenerationEnabled: boolean;
  updatedByUserId: string | null;
};

/** Save site settings (upsert the singleton row) and invalidate the cache. */
export async function upsertSiteSettings(
  ctx: DbContext,
  input: UpsertSiteSettingsInput,
): Promise<SiteSettingsRow> {
  const rows = await withDbContext(ctx, (c) =>
    q<SiteSettingsRow>(
      c,
      `insert into site_settings (
         id, site_name, contact_email, response_time_language, image_generation_enabled, updated_at, updated_by
       )
       values (1, $1, $2, $3, $4, now(), $5)
       on conflict (id) do update set
         site_name              = excluded.site_name,
         contact_email          = excluded.contact_email,
         response_time_language = excluded.response_time_language,
          image_generation_enabled = excluded.image_generation_enabled,
         updated_at             = now(),
         updated_by             = excluded.updated_by
       returning ${INTERNAL_COLS}`,
       [input.siteName, input.contactEmail, input.responseTimeLanguage, input.imageGenerationEnabled, input.updatedByUserId],
    ),
  );
  const row = rows[0];
  if (!row) throw new Error("siteSettings.upsertSiteSettings returned no row");
  setCache(row);
  return row;
}

/** Reset all site settings fields to the hardcoded defaults. */
export async function resetSiteSettingsToDefaults(
  ctx: DbContext,
  updatedByUserId: string | null,
): Promise<SiteSettingsRow> {
  const d = SITE_SETTINGS_DEFAULTS;
  const rows = await withDbContext(ctx, (c) =>
    q<SiteSettingsRow>(
      c,
      `insert into site_settings (
         id, site_name, contact_email, response_time_language, image_generation_enabled, updated_at, updated_by
       )
       values (1, $1, $2, $3, $4, now(), $5)
       on conflict (id) do update set
         site_name              = excluded.site_name,
         contact_email          = excluded.contact_email,
         response_time_language = excluded.response_time_language,
          image_generation_enabled = excluded.image_generation_enabled,
         updated_at             = now(),
         updated_by             = excluded.updated_by
       returning ${INTERNAL_COLS}`,
       [d.siteName, d.contactEmail, d.responseTimeLanguage, d.imageGenerationEnabled, updatedByUserId],
    ),
  );
  const row = rows[0];
  if (!row) throw new Error("siteSettings.resetSiteSettingsToDefaults returned no row");
  setCache(row);
  return row;
}
