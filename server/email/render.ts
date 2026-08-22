/**
 * Shared rendering kit for the twelve product templates
 * (docs/email/TEMPLATES.md section 2):
 *   - colour and font come from the DB-backed brand settings (single row,
 *     in-process cache); defaults match the original hardcoded navy/system-font;
 *   - every template ships an HTML part and a WRITTEN plain-text part;
 *   - item/role lists render as tables in HTML (D51), never the on-screen
 *     "3x Blankets" string;
 *   - links are always absolute URLs built by the caller (send.ts) — this
 *     module never touches env vars;
 *   - a missing optional value omits the surrounding line (kvOpt/textKvOpt
 *     return nothing), it never renders a blank.
 */

/* ------------------------------------------------------------------ */
/* Brand settings — module-level cache updated by the brand-settings   */
/* DAL after a DB read or write. Render functions read _brand at call  */
/* time so every outbound email uses the most-recently saved settings. */
/* ------------------------------------------------------------------ */

export type BrandSettings = {
  primaryColor: string;
  fontStack: string;
  orgName: string;
  programName: string;
  signatureName: string;
  directorName: string;
  directorEmail: string;
  directorTitle: string;
  headerImageUrl: string | null;
};

/** Hardcoded defaults — match the original source-code constants exactly. */
export const BRAND_DEFAULTS: BrandSettings = {
  primaryColor: "rgb(6, 54, 93)",
  fontStack: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  orgName: "The Alliance",
  programName: "Love in Action",
  signatureName: "The Alliance Love in Action Team",
  directorName: "Christina Moe",
  directorEmail: "christina@defendingthecause.org",
  directorTitle: "Love in Action Program Director",
  headerImageUrl: null,
};

let _brand: BrandSettings = { ...BRAND_DEFAULTS };

/** Replace the active brand settings (called by the brand-settings DAL). */
export function setBrand(settings: BrandSettings): void {
  _brand = { ...settings };
}

/** Read the currently active brand settings. */
export function getBrand(): Readonly<BrandSettings> {
  return _brand;
}

/**
 * The six brand token vars injected into every template render, matching
 * the {placeholder} names used in DEFAULT_COPY strings.
 */
export function brandTokenVars(): Record<string, string> {
  return {
    orgName: _brand.orgName,
    programName: _brand.programName,
    signature: _brand.signatureName,
    directorName: _brand.directorName,
    directorEmail: _brand.directorEmail,
    directorTitle: _brand.directorTitle,
  };
}

/**
 * The set of brand-token placeholder names. Recognised by overrides.ts so
 * staff copy editors may keep or replace them without triggering "unknown
 * placeholder" validation errors.
 */
export const BRAND_TOKEN_NAMES = new Set([
  "orgName",
  "programName",
  "signature",
  "directorName",
  "directorEmail",
  "directorTitle",
]);

/**
 * Legacy constant for backward compatibility — equals the default primary
 * colour. Render helper functions use _brand.primaryColor at call time;
 * prefer getBrand().primaryColor in new code.
 */
export const NAVY = "rgb(6, 54, 93)";

export type Rendered = { subject: string; html: string; text: string };

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * Slot the LIA email header image occupies in shell() output. Templates never
 * know the absolute URL (it depends on the environment base URL), so shell
 * emits this marker and send.ts swaps in the <img> via finalizeHtml() before
 * anything is dispatched.
 */
export const HEADER_IMAGE_MARKER = "<!--lia-email-header-->";

/**
 * Replace the header slot with the actual banner <img>. Loud by design: a
 * shell()-rendered document always carries the marker, so its absence means
 * the HTML was not built by shell() — refuse rather than send a half-branded
 * email silently.
 */
export function finalizeHtml(html: string, headerImageUrl: string): string {
  if (!html.includes(HEADER_IMAGE_MARKER)) {
    throw new Error("finalizeHtml: header slot marker missing from rendered HTML");
  }
  const altText = `${_brand.orgName} – ${_brand.programName}`;
  const img = `<img src="${escapeHtml(headerImageUrl)}" alt="${escapeHtml(altText)}" width="560"
        style="display:block;width:100%;max-width:560px;height:auto;margin:0 0 24px;" />`;
  return html.replace(HEADER_IMAGE_MARKER, img);
}

/** Full HTML document: white page, LIA header banner, single navy-on-white column. */
export function shell(heading: string, bodyHtml: string): string {
  const color = _brand.primaryColor;
  const font = _brand.fontStack;
  return `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#ffffff;font-family:${font};color:${color};">
    <div style="max-width:560px;margin:0 auto;">
      ${HEADER_IMAGE_MARKER}
      <h1 style="margin:0 0 16px;font-size:20px;font-weight:700;color:${color};">${escapeHtml(heading)}</h1>
${bodyHtml}
    </div>
  </body>
</html>`;
}

export function para(html: string): string {
  const color = _brand.primaryColor;
  return `      <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:${color};">${html}</p>`;
}

export function sectionHeading(text: string): string {
  const color = _brand.primaryColor;
  return `      <h2 style="margin:24px 0 8px;font-size:15px;font-weight:700;color:${color};">${escapeHtml(text)}</h2>`;
}

/** "Label: value" detail line. Value is escaped. */
export function kv(label: string, value: string): string {
  const color = _brand.primaryColor;
  return `      <div style="font-size:15px;line-height:1.6;color:${color};">${escapeHtml(label)}: ${escapeHtml(value)}</div>`;
}

/** Detail line omitted entirely when the value is null/empty (section 2 rule). */
export function kvOpt(label: string, value: string | null | undefined): string {
  if (value == null || value.trim() === "") return "";
  return kv(label, value);
}

/** "Label: linked URL" detail line for URL values. */
export function kvLink(label: string, url: string): string {
  const color = _brand.primaryColor;
  return `      <div style="font-size:15px;line-height:1.6;color:${color};">${escapeHtml(label)}: <a href="${escapeHtml(url)}" style="color:${color};text-decoration:underline;">${escapeHtml(url)}</a></div>`;
}

export function link(url: string, label?: string): string {
  const color = _brand.primaryColor;
  return `<a href="${escapeHtml(url)}" style="color:${color};text-decoration:underline;">${escapeHtml(label ?? url)}</a>`;
}

export function button(label: string, url: string): string {
  const color = _brand.primaryColor;
  return `      <p style="margin:24px 0;">
        <a href="${escapeHtml(url)}"
           style="display:inline-block;background:${color};color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:12px 24px;border-radius:5px;">${escapeHtml(label)}</a>
      </p>`;
}

/** HTML table for item lists: Item | <quantity column label> (D51). */
export function itemsTable(
  rows: readonly { name: string; quantity: number }[],
  quantityHeader: string,
): string {
  const color = _brand.primaryColor;
  const body = rows
    .map(
      (r) => `        <tr>
          <td style="border:1px solid ${color};padding:6px 10px;font-size:15px;color:${color};">${escapeHtml(r.name)}</td>
          <td style="border:1px solid ${color};padding:6px 10px;font-size:15px;color:${color};text-align:right;">${r.quantity}</td>
        </tr>`,
    )
    .join("\n");
  return `      <table style="border-collapse:collapse;margin:8px 0 16px;">
        <tr>
          <th style="border:1px solid ${color};padding:6px 10px;font-size:15px;color:${color};text-align:left;">Item</th>
          <th style="border:1px solid ${color};padding:6px 10px;font-size:15px;color:${color};text-align:left;">${escapeHtml(quantityHeader)}</th>
        </tr>
${body}
      </table>`;
}

/** Role list under its own heading (D51): one line per role. */
export function rolesList(rows: readonly string[]): string {
  const color = _brand.primaryColor;
  const items = rows
    .map((r) => `        <li style="font-size:15px;line-height:1.6;color:${color};">${escapeHtml(r)}</li>`)
    .join("\n");
  return `      <ul style="margin:8px 0 16px;padding-left:20px;">
${items}
      </ul>`;
}

/**
 * A single block in a rich email body. Stored as JSONB in body_blocks.
 * - paragraph: staff-authored HTML prose (may contain {placeholder} tokens).
 * - section:   references a named auto-generated section declared by the template.
 */
export type BodyBlock =
  | { kind: "paragraph"; html: string }
  | { kind: "section"; name: string };
export type TemplateCopy = {
  /** Subject line with {placeholder} tokens. */
  subject: string;
  /** The H1 heading inside the email shell (plain text, escaped by shell()). */
  heading: string;
  /**
   * Free-text paragraphs in order. Limited inline HTML (<strong>, <br />) is
   * allowed — copy is staff-admin-authored and therefore trusted; variable
   * values are always escaped on substitution.
   */
  paragraphs: string[];
  /**
   * Rich-body blocks. When present the render path uses these instead of
   * paragraphs; the hardcoded section order becomes the fallback only when
   * bodyBlocks is absent (backward compatibility).
   */
  bodyBlocks?: BodyBlock[];
};

const PLACEHOLDER_RE = /\{([a-zA-Z][a-zA-Z0-9_]*)\}/g;

/**
 * Unique placeholder names used anywhere in a copy block.
 *
 * When `bodyBlocks` is present and non-empty it IS the active body content —
 * scan its paragraph blocks instead of the legacy `paragraphs` array so that
 * placeholder-presence validation is not fooled by stale text the editor has
 * already replaced. The default copy (which never has bodyBlocks) continues to
 * use the paragraphs array, giving an accurate reference set for validation.
 */
export function copyPlaceholders(copy: TemplateCopy): string[] {
  const found = new Set<string>();
  const bodyTexts =
    copy.bodyBlocks && copy.bodyBlocks.length > 0
      ? copy.bodyBlocks.filter((b): b is { kind: "paragraph"; html: string } => b.kind === "paragraph").map((b) => b.html)
      : copy.paragraphs;
  const sources = [copy.subject, copy.heading, ...bodyTexts];
  for (const s of sources) {
    for (const m of s.matchAll(PLACEHOLDER_RE)) {
      const name = m[1];
      if (name) found.add(name);
    }
  }
  return [...found];
}

/**
 * Render a bodyBlocks array to HTML body, calling the template's declared
 * sections for section blocks and copyPara for paragraph blocks.
 */
export function renderBodyBlocksHtml<TVars extends Record<string, unknown>>(
  blocks: BodyBlock[],
  vars: TVars,
  sections: TemplateSectionDef<TVars>[],
): string {
  return blocks
    .map((block) => {
      if (block.kind === "paragraph") return copyPara(block.html, vars);
      const sec = sections.find((s) => s.name === block.name);
      return sec ? sec.renderHtml(vars) : "";
    })
    .filter(Boolean)
    .join("\n");
}
/**
 * Substitute {name} tokens with raw values (subject/plain-text use). A
 * missing or non-scalar value leaves the token literal, which the send
 * path's leftover-placeholder check catches loudly.
 */
export function fillText(tpl: string, vars: Record<string, unknown>): string {
  return tpl.replace(PLACEHOLDER_RE, (m, name: string) => {
    const v = vars[name];
    return v == null || typeof v === "object" ? m : String(v);
  });
}

const URL_VALUE_RE = /^https?:\/\//;

/**
 * HTML substitution: values are escaped; URL values render as styled links.
 * The copy string itself passes through as trusted (staff-authored) HTML.
 */
export function fillHtml(tpl: string, vars: Record<string, unknown>): string {
  return tpl.replace(PLACEHOLDER_RE, (m, name: string) => {
    const v = vars[name];
    if (v == null || typeof v === "object") return m;
    const s = String(v);
    return URL_VALUE_RE.test(s) ? link(s) : escapeHtml(s);
  });
}

/** One copy paragraph as an HTML <p> block. */
export function copyPara(tpl: string, vars: Record<string, unknown>): string {
  return para(fillHtml(tpl, vars));
}

/** One copy string for the plain-text part: filled, tags dropped, entities decoded. */
export function copyText(tpl: string, vars: Record<string, unknown>): string {
  return fillText(tpl, vars)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replaceAll("&amp;", "&")
    .replaceAll("&#39;", "'")
    .replaceAll("&quot;", '"')
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

/* ------------------------------------------------------------------ */
/* Plain-text counterparts. Written, not stripped from the HTML.       */
/* ------------------------------------------------------------------ */

export function textKv(label: string, value: string): string {
  return `${label}: ${value}`;
}

export function textKvOpt(label: string, value: string | null | undefined): string[] {
  if (value == null || value.trim() === "") return [];
  return [`${label}: ${value}`];
}

export function textItemsTable(
  rows: readonly { name: string; quantity: number }[],
  quantityHeader: string,
): string[] {
  const lines = [`Item | ${quantityHeader}`];
  for (const r of rows) lines.push(`${r.name} | ${r.quantity}`);
  return lines;
}

export function textRolesList(rows: readonly string[]): string[] {
  return rows.map((r) => `- ${r}`);
}

/** Join text blocks, dropping empties, with blank lines between blocks. */
export function textBody(...blocks: (string | string[] | null)[]): string {
  const flat: string[] = [];
  for (const block of blocks) {
    if (block == null) continue;
    const lines = Array.isArray(block) ? block : [block];
    if (lines.length === 0) continue;
    if (flat.length > 0) flat.push("");
    flat.push(...lines);
  }
  return flat.join("\n");
}

/**
 * Named, reusable section declared by a ProductTemplate. The editor exposes
 * each one as an insertable chip; the render path calls renderHtml/renderText
 * when it encounters a section block.
 */
export type TemplateSectionDef<TVars> = {
  name: string;
  label: string;
  renderHtml(vars: TVars): string;
  renderText(vars: TVars): string[];
};

/**
 * Expand a bodyBlocks array to text-body blocks (suitable as spread args for
 * textBody). Heading is NOT included — add it as the first textBody argument.
 */
export function renderBodyBlocksToTextBlocks<TVars extends Record<string, unknown>>(
  blocks: BodyBlock[],
  vars: TVars,
  sections: TemplateSectionDef<TVars>[],
): (string | string[] | null)[] {
  return blocks.map((block) => {
    if (block.kind === "paragraph") {
      const t = copyText(block.html, vars);
      return t || null;
    }
    const sec = sections.find((s) => s.name === block.name);
    return sec ? sec.renderText(vars) : null;
  });
}
