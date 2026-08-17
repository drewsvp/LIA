/**
 * Shared rendering kit for the twelve product templates
 * (docs/email/TEMPLATES.md section 2):
 *   - navy and white from docs/Design.md, system font stack, single column,
 *     no background images;
 *   - every template ships an HTML part and a WRITTEN plain-text part;
 *   - item/role lists render as tables in HTML (D51), never the on-screen
 *     "3x Blankets" string;
 *   - links are always absolute URLs built by the caller (send.ts) — this
 *     module never touches env vars;
 *   - a missing optional value omits the surrounding line (kvOpt/textKvOpt
 *     return nothing), it never renders a blank.
 */

export const NAVY = "rgb(6, 54, 93)";
const FONT_STACK =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export type Rendered = { subject: string; html: string; text: string };

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Full HTML document: white page, single navy-on-white column. */
export function shell(heading: string, bodyHtml: string): string {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#ffffff;font-family:${FONT_STACK};color:${NAVY};">
    <div style="max-width:560px;margin:0 auto;">
      <h1 style="margin:0 0 16px;font-size:20px;font-weight:700;color:${NAVY};">${escapeHtml(heading)}</h1>
${bodyHtml}
    </div>
  </body>
</html>`;
}

export function para(html: string): string {
  return `      <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:${NAVY};">${html}</p>`;
}

export function sectionHeading(text: string): string {
  return `      <h2 style="margin:24px 0 8px;font-size:15px;font-weight:700;color:${NAVY};">${escapeHtml(text)}</h2>`;
}

/** "Label: value" detail line. Value is escaped. */
export function kv(label: string, value: string): string {
  return `      <div style="font-size:15px;line-height:1.6;color:${NAVY};">${escapeHtml(label)}: ${escapeHtml(value)}</div>`;
}

/** Detail line omitted entirely when the value is null/empty (section 2 rule). */
export function kvOpt(label: string, value: string | null | undefined): string {
  if (value == null || value.trim() === "") return "";
  return kv(label, value);
}

/** "Label: linked URL" detail line for URL values. */
export function kvLink(label: string, url: string): string {
  return `      <div style="font-size:15px;line-height:1.6;color:${NAVY};">${escapeHtml(label)}: <a href="${escapeHtml(url)}" style="color:${NAVY};text-decoration:underline;">${escapeHtml(url)}</a></div>`;
}

export function link(url: string, label?: string): string {
  return `<a href="${escapeHtml(url)}" style="color:${NAVY};text-decoration:underline;">${escapeHtml(label ?? url)}</a>`;
}

export function button(label: string, url: string): string {
  return `      <p style="margin:24px 0;">
        <a href="${escapeHtml(url)}"
           style="display:inline-block;background:${NAVY};color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:12px 24px;border-radius:5px;">${escapeHtml(label)}</a>
      </p>`;
}

/** HTML table for item lists: Item | <quantity column label> (D51). */
export function itemsTable(
  rows: readonly { name: string; quantity: number }[],
  quantityHeader: string,
): string {
  const body = rows
    .map(
      (r) => `        <tr>
          <td style="border:1px solid ${NAVY};padding:6px 10px;font-size:15px;color:${NAVY};">${escapeHtml(r.name)}</td>
          <td style="border:1px solid ${NAVY};padding:6px 10px;font-size:15px;color:${NAVY};text-align:right;">${r.quantity}</td>
        </tr>`,
    )
    .join("\n");
  return `      <table style="border-collapse:collapse;margin:8px 0 16px;">
        <tr>
          <th style="border:1px solid ${NAVY};padding:6px 10px;font-size:15px;color:${NAVY};text-align:left;">Item</th>
          <th style="border:1px solid ${NAVY};padding:6px 10px;font-size:15px;color:${NAVY};text-align:left;">${escapeHtml(quantityHeader)}</th>
        </tr>
${body}
      </table>`;
}

/** Role list under its own heading (D51): one line per role. */
export function rolesList(rows: readonly string[]): string {
  const items = rows
    .map((r) => `        <li style="font-size:15px;line-height:1.6;color:${NAVY};">${escapeHtml(r)}</li>`)
    .join("\n");
  return `      <ul style="margin:8px 0 16px;padding-left:20px;">
${items}
      </ul>`;
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
