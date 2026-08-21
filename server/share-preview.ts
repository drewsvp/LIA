/**
 * Server-rendered link previews (Open Graph / Twitter Card) for the three
 * shareable public surfaces: /o/:slug, /items/:id, /volunteer/:id.
 *
 * Social crawlers (Facebook, LinkedIn, X, iMessage, Slack) do not run
 * JavaScript, so anything the SPA sets after mount is invisible to them.
 * Every shared link would otherwise preview the generic site-wide card baked
 * into client/index.html. This module rewrites the tags in <head> of the shell
 * HTML — nothing else about the response changes, and the page still mounts
 * and renders client-side exactly as before.
 *
 * Two rules make this safe:
 *  - The default tags are REPLACED, never appended to. Duplicated og:* keys
 *    make crawler behaviour non-deterministic, and the hardcoded 1200×630
 *    JPEG dimension hints would mis-crop a per-record image of unknown size.
 *  - Nothing here may break page delivery. Every lookup runs inside a
 *    try/catch that falls back to the unmodified default HTML; an unresolved
 *    record is not an error, because the client already renders not-found.
 *
 * Share wording comes from shared/share-copy.ts, the same module the share
 * button uses, so the pre-fill text and the preview description cannot drift.
 */
import { PUBLIC } from "./db/client";
import * as dal from "./dal";
import { absoluteUrl } from "./email/send";
import {
  itemShareDescription,
  itemShareTitle,
  organizationPath,
  organizationShareDescription,
  organizationShareTitle,
  itemRequestPath,
  volunteerRequestPath,
  volunteerShareDescription,
  volunteerShareTitle,
} from "../shared/share-copy";

/** The stable site-wide share image in client/public — never a hashed build asset. */
const DEFAULT_IMAGE_PATH = "/og-image.jpg";
/** Known dimensions of og-image.jpg. Only ever emitted for that exact file. */
const DEFAULT_IMAGE_TYPE = "image/jpeg";
const DEFAULT_IMAGE_WIDTH = "1200";
const DEFAULT_IMAGE_HEIGHT = "630";

/** Roughly the length Facebook and X show before truncating. */
const DESCRIPTION_MAX = 155;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,199}$/;

export type SharePreview = {
  /** Used for both <title> and og:title / twitter:title. */
  title: string;
  description: string;
  /** Absolute canonical URL of the record. */
  url: string;
  /** Absolute image URL. */
  image: string;
  imageAlt: string;
  /**
   * True when `image` is the site-wide og-image.jpg, whose dimensions we know.
   * A per-record image has unknown dimensions, so no size hints are emitted.
   */
  imageIsDefault: boolean;
};

// ---------------------------------------------------------------- text utils

/** Escape free text for use inside a double-quoted HTML attribute. */
export function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Collapse whitespace and cut at a word boundary, never mid-word. */
export function truncateOnWord(text: string, max = DESCRIPTION_MAX): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const slice = clean.slice(0, max);
  const lastSpace = slice.lastIndexOf(" ");
  const base = lastSpace > 0 ? slice.slice(0, lastSpace) : slice;
  return `${base.replace(/[\s,;:.!?-]+$/, "")}…`;
}

// ---------------------------------------------------------------- lookups

/**
 * Absolute URL for the first stored image path (among the candidates) that
 * begins with "/", or the stable site-wide fallback. Pass candidates in
 * priority order: the need's own image first, then the organization logo, so
 * a shared need without a photo shows the org identity before the generic card.
 */
function imageFor(...storedPaths: (string | null | undefined)[]): { image: string; imageIsDefault: boolean } {
  for (const storedPath of storedPaths) {
    const trimmed = (storedPath ?? "").trim();
    if (trimmed.startsWith("/")) return { image: absoluteUrl(trimmed), imageIsDefault: false };
  }
  return { image: absoluteUrl(DEFAULT_IMAGE_PATH), imageIsDefault: true };
}

/**
 * Resolve the preview for a path, or null when the path is not one of the
 * three surfaces or the record is not publicly visible. Visibility mirrors the
 * matching public API handler exactly — the runtime DB role has BYPASSRLS, so
 * every rule is explicit here too.
 */
async function resolvePreview(pathname: string): Promise<SharePreview | null> {
  const orgMatch = /^\/o\/([^/]+)\/?$/.exec(pathname);
  if (orgMatch) return organizationPreview(decodeURIComponent(orgMatch[1]!));

  const itemMatch = /^\/items\/([^/]+)\/?$/.exec(pathname);
  if (itemMatch) return itemPreview(decodeURIComponent(itemMatch[1]!));

  const volunteerMatch = /^\/volunteer\/([^/]+)\/?$/.exec(pathname);
  if (volunteerMatch) return volunteerPreview(decodeURIComponent(volunteerMatch[1]!));

  return null;
}

async function organizationPreview(rawSlug: string): Promise<SharePreview | null> {
  const slug = rawSlug.trim().toLowerCase();
  if (!SLUG_RE.test(slug)) return null;
  const org = await dal.organizations.getBySlug(PUBLIC, slug);
  // Same gate as GET /api/public/organizations/:slug: status alone. The
  // platform owner keeps a public profile; pending/disabled/rejected do not.
  if (!org || org.status !== "approved") return null;

  const title = organizationShareTitle(org.name);
  return {
    title,
    description: truncateOnWord(organizationShareDescription(org.name, org.mission)),
    url: absoluteUrl(organizationPath(org.slug)),
    imageAlt: title,
    ...imageFor(org.logoUrl),
  };
}

async function itemPreview(id: string): Promise<SharePreview | null> {
  if (!UUID_RE.test(id)) return null;
  const request = await dal.itemRequests.getActiveAvailableById(PUBLIC, id);
  if (!request) return null;
  const org = await dal.organizations.getById(PUBLIC, request.orgId);
  if (!org || org.status !== "approved" || org.kind !== "member_org") return null;

  const title = itemShareTitle(request.title, org.name);
  return {
    title,
    description: truncateOnWord(itemShareDescription(org.name)),
    url: absoluteUrl(itemRequestPath(request.id)),
    imageAlt: title,
    ...imageFor(request.imageUrl, org.logoUrl),
  };
}

async function volunteerPreview(id: string): Promise<SharePreview | null> {
  if (!UUID_RE.test(id)) return null;
  // Re-check expires_on at read time: the nightly job can lag, so an
  // expired-but-still-active request must produce the default site card,
  // not a live preview. Mirrors the detail endpoint and item-preview pattern.
  const request = await dal.volunteerRequests.getActiveAvailableById(PUBLIC, id);
  if (!request) return null;
  const org = await dal.organizations.getById(PUBLIC, request.orgId);
  if (!org || org.status !== "approved" || org.kind !== "member_org") return null;

  const title = volunteerShareTitle(request.title, org.name);
  return {
    title,
    description: truncateOnWord(volunteerShareDescription(org.name)),
    url: absoluteUrl(volunteerRequestPath(request.id)),
    imageAlt: title,
    ...imageFor(request.imageUrl, org.logoUrl),
  };
}

/**
 * Preview tags for a request URL, or null when the default HTML should be
 * served untouched. Never throws: a database hiccup or a missing APP_BASE_URL
 * (the email base-URL helper throws in production without it) must not turn a
 * page request into a 500.
 */
export async function sharePreviewFor(originalUrl: string): Promise<SharePreview | null> {
  try {
    const pathname = originalUrl.split("?")[0]!.split("#")[0]!;
    return await resolvePreview(pathname);
  } catch (err) {
    console.error(`[share-preview] falling back to default tags for ${originalUrl}:`, err);
    return null;
  }
}

// ---------------------------------------------------------------- html rewrite

/**
 * Meta keys the default shell ships that a per-record preview owns. Everything
 * else in <head> (og:type, og:site_name, twitter:card, icons, fonts) is left
 * exactly as it is.
 */
const REPLACED_META_KEYS: ReadonlySet<string> = new Set([
  "description",
  "og:title",
  "og:description",
  "og:url",
  "og:image",
  "og:image:type",
  "og:image:width",
  "og:image:height",
  "og:image:alt",
  "twitter:title",
  "twitter:description",
  "twitter:image",
  "twitter:image:alt",
]);

function stripDefaultTags(html: string): string {
  // Each pattern swallows the tag's own indentation and trailing newline so
  // the remaining <head> keeps its shape instead of filling with blank lines.
  return html
    .replace(/[ \t]*<meta\b[^>]*>[ \t]*\r?\n?/gi, (match) => {
      const key = /(?:property|name)\s*=\s*"([^"]*)"/i.exec(match)?.[1]?.trim().toLowerCase();
      return key !== undefined && REPLACED_META_KEYS.has(key) ? "" : match;
    })
    .replace(/[ \t]*<link\b[^>]*\brel\s*=\s*"canonical"[^>]*>[ \t]*\r?\n?/gi, "")
    .replace(/[ \t]*<title>[\s\S]*?<\/title>[ \t]*\r?\n?/i, "");
}

function renderTags(preview: SharePreview): string {
  const title = escapeHtmlAttribute(preview.title);
  const description = escapeHtmlAttribute(preview.description);
  const url = escapeHtmlAttribute(preview.url);
  const image = escapeHtmlAttribute(preview.image);
  const imageAlt = escapeHtmlAttribute(preview.imageAlt);
  const lines = [
    `<title>${title}</title>`,
    `<meta name="description" content="${description}" />`,
    `<meta property="og:title" content="${title}" />`,
    `<meta property="og:description" content="${description}" />`,
    `<meta property="og:url" content="${url}" />`,
    `<meta property="og:image" content="${image}" />`,
  ];
  // Dimension hints describe og-image.jpg only. A stored image has unknown
  // dimensions, and a stale hint makes Facebook mis-crop the card.
  if (preview.imageIsDefault) {
    lines.push(
      `<meta property="og:image:type" content="${DEFAULT_IMAGE_TYPE}" />`,
      `<meta property="og:image:width" content="${DEFAULT_IMAGE_WIDTH}" />`,
      `<meta property="og:image:height" content="${DEFAULT_IMAGE_HEIGHT}" />`,
    );
  }
  lines.push(
    `<meta property="og:image:alt" content="${imageAlt}" />`,
    `<meta name="twitter:title" content="${title}" />`,
    `<meta name="twitter:description" content="${description}" />`,
    `<meta name="twitter:image" content="${image}" />`,
    `<meta name="twitter:image:alt" content="${imageAlt}" />`,
    `<link rel="canonical" href="${url}" />`,
  );
  return lines.map((line) => `    ${line}`).join("\n");
}

/**
 * Replace the shell's default share tags with this record's. The default
 * `<title>` and every meta key listed above is removed first, so the response
 * carries exactly one of each.
 */
export function applySharePreview(html: string, preview: SharePreview): string {
  const stripped = stripDefaultTags(html);
  const block = `${renderTags(preview)}\n`;
  if (/<\/head>/i.test(stripped)) return stripped.replace(/[ \t]*<\/head>/i, `${block}  </head>`);
  // No </head> to anchor to: leave the document alone rather than guessing.
  return html;
}

/** Convenience for the SPA-shell handlers: default HTML unless a record resolves. */
export async function withSharePreview(originalUrl: string, html: string): Promise<string> {
  const preview = await sharePreviewFor(originalUrl);
  if (!preview) return html;
  try {
    return applySharePreview(html, preview);
  } catch (err) {
    console.error(`[share-preview] tag rewrite failed for ${originalUrl}:`, err);
    return html;
  }
}
