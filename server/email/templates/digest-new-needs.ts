/**
 * digest_new_needs — the weekly "New Needs" digest (task 58).
 *
 * Sent on the configured weekly or one-time schedule to every subscribed digest_subscribers row, one email
 * per recipient, entity-bound to the digest_runs row (once per recipient per
 * run — the restart dedup). The needs list and the per-recipient unsubscribe
 * link are structural, not editable copy; the intro and closing are.
 */
import {
  shell,
  para,
  escapeHtml,
  link,
  textBody,
  fillText,
  copyPara,
  copyText,
  getBrand,
  type TemplateCopy,
} from "../render";
import type { ProductTemplate } from "./types";

export type DigestNeed = {
  name: string;
  organizationName: string;
  /** "Item need" | "Volunteer need", exactly. */
  typeLabel: string;
  /** Absolute URL to the need's public page. */
  url: string;
  /** Absolute image URL, or null — the card omits the image entirely. */
  imageUrl: string | null;
};

export type DigestNewNeedsVars = {
  needs: DigestNeed[];
  /** Per-recipient absolute unsubscribe URL (/unsubscribe/:token). */
  unsubscribeUrl: string;
};

function needCardHtml(n: DigestNeed): string {
  const color = getBrand().primaryColor;
  const image =
    n.imageUrl == null || n.imageUrl.trim() === ""
      ? ""
      : `        <img src="${escapeHtml(n.imageUrl)}" alt="${escapeHtml(n.name)}" width="280"
          style="display:block;max-width:280px;width:100%;height:auto;border-radius:5px;margin:0 0 8px;" />\n`;
  return `      <div style="border:1px solid ${color};border-radius:5px;padding:16px;margin:0 0 16px;">
${image}        <div style="font-size:16px;font-weight:700;line-height:1.5;">${link(n.url, n.name)}</div>
        <div style="font-size:15px;line-height:1.6;color:${color};">Organization: ${escapeHtml(n.organizationName)}</div>
        <div style="font-size:15px;line-height:1.6;color:${color};">Type: ${escapeHtml(n.typeLabel)}</div>
      </div>`;
}

function needsText(needs: DigestNeed[]): string[] {
  const lines: string[] = [];
  for (const n of needs) {
    if (lines.length > 0) lines.push("");
    lines.push(n.name, `Organization: ${n.organizationName}`, `Type: ${n.typeLabel}`, n.url);
  }
  return lines;
}

const DEFAULT_COPY: TemplateCopy = {
  subject: "New Needs from {programName}",
  heading: "New Needs This Week",
  paragraphs: [
    "Here are the needs our member organizations have published since the last digest. Every one of them is an opportunity to show love in action.",
    "Thank you,<br /><strong>{signature}</strong>",
  ],
};

export const digestNewNeeds: ProductTemplate<DigestNewNeedsVars> = {
  key: "digest_new_needs",
  entityType: "digest_run",
  required: ["needs", "unsubscribeUrl"],
  trigger: "Sent automatically on its configured schedule when needs went live since the previous digest",
  recipients: "Everyone on the digest subscriber list with status subscribed",
  recipientsConfigurable: false,
  defaultCopy: DEFAULT_COPY,
  sample: {
    needs: [
      {
        name: "Winter Warmth Drive",
        organizationName: "Hope Community Center",
        typeLabel: "Item need",
        url: "https://example.org/items/10432",
        imageUrl: null,
      },
      {
        name: "Meal Service Volunteers",
        organizationName: "Neighbors Table",
        typeLabel: "Volunteer need",
        url: "https://example.org/volunteer/10433",
        imageUrl: null,
      },
    ],
    unsubscribeUrl: "https://example.org/unsubscribe/00000000-0000-0000-0000-000000000000",
  },
  render(vars, copy = DEFAULT_COPY) {
    const subject = fillText(copy.subject, vars);
    const color = getBrand().primaryColor;
    const programName = getBrand().programName;
    const html = shell(
      fillText(copy.heading, vars),
      [
        copyPara(copy.paragraphs[0] ?? "", vars),
        ...vars.needs.map(needCardHtml),
        copyPara(copy.paragraphs[1] ?? "", vars),
        para(
          `<span style="font-size:13px;">You are receiving this because you subscribed to the ${escapeHtml(programName)} weekly digest. ` +
            `<a href="${escapeHtml(vars.unsubscribeUrl)}" style="color:${color};text-decoration:underline;">Unsubscribe</a></span>`,
        ),
      ]
        .filter(Boolean)
        .join("\n"),
    );
    const text = textBody(
      copyText(copy.heading, vars),
      copyText(copy.paragraphs[0] ?? "", vars),
      needsText(vars.needs),
      copyText(copy.paragraphs[1] ?? "", vars),
      [
        `You are receiving this because you subscribed to the ${programName} weekly digest.`,
        `Unsubscribe: ${vars.unsubscribeUrl}`,
      ],
    );
    return { subject, html, text };
  },
};
