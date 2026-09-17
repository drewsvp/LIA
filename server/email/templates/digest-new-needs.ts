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
  renderBodyBlocksHtml,
  renderBodyBlocksToTextBlocks,
  type TemplateCopy,
  type TemplateSectionDef,
} from "../render";
import type { ProductTemplate } from "./types";

export type DigestNeed = {
  name: string;
  description: string | null;
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

const DESCRIPTION_EXCERPT_LENGTH = 160;

function decodeDescriptionEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_match, digits: string) => {
      const codePoint = Number(digits);
      return Number.isSafeInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : " ";
    })
    .replace(/&#x([0-9a-f]+);/gi, (_match, digits: string) => {
      const codePoint = Number.parseInt(digits, 16);
      return Number.isSafeInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : " ";
    })
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

function descriptionExcerpt(description: string | null): string {
  if (description == null || description.trim() === "") return "";
  const plain = decodeDescriptionEntities(
    description
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
      .replace(/<[^>]*>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
  const characters = Array.from(plain);
  if (characters.length <= DESCRIPTION_EXCERPT_LENGTH) return plain;
  const candidate = characters.slice(0, DESCRIPTION_EXCERPT_LENGTH + 1).join("");
  const lastSpace = candidate.lastIndexOf(" ");
  const cutAt = lastSpace >= Math.floor(DESCRIPTION_EXCERPT_LENGTH * 0.65)
    ? lastSpace
    : DESCRIPTION_EXCERPT_LENGTH;
  return `${Array.from(candidate).slice(0, cutAt).join("").trimEnd()}…`;
}

function needButtonHtml(label: string, url: string): string {
  const buttonColor = "#078b87";
  return `                  <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:10px auto 0;">
                    <tr><td bgcolor="${buttonColor}" style="border-radius:999px;"><a href="${escapeHtml(url)}" style="display:inline-block;padding:9px 16px;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;border-radius:999px;">${escapeHtml(label)}</a></td></tr>
                  </table>`;
}

function needCardHtml(n: DigestNeed): string {
  const color = getBrand().primaryColor;
  const buttonLabel = n.typeLabel === "Volunteer need" ? "View Volunteer Need" : "View Item Need";
  const excerpt = descriptionExcerpt(n.description);
  const imageCell =
    n.imageUrl == null || n.imageUrl.trim() === ""
      ? ""
      : `          <td width="132" valign="top" style="width:132px;padding:0 12px 0 0;">
            <img src="${escapeHtml(n.imageUrl)}" alt="${escapeHtml(n.name)}" width="132" height="132"
              style="display:block;width:132px;height:132px;object-fit:cover;" />
          </td>
`;
  const descriptionHtml = excerpt === ""
    ? ""
    : `              <div style="margin:7px 0 0;font-size:13px;line-height:1.45;color:#111111;text-align:center;">${escapeHtml(excerpt)}</div>\n`;
  return `      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:0 0 12px;">
        <tr>
${imageCell}          <td valign="middle" style="padding:2px 0;text-align:center;">
            <div style="font-size:15px;font-weight:700;line-height:1.35;"><a href="${escapeHtml(n.url)}" style="color:${color};text-decoration:none;">${escapeHtml(n.name)}</a></div>
${descriptionHtml}${needButtonHtml(buttonLabel, n.url)}
          </td>
        </tr>
      </table>`;
}

function needsText(needs: DigestNeed[]): string[] {
  const lines: string[] = [];
  for (const n of needs) {
    if (lines.length > 0) lines.push("");
    lines.push(n.name);
    const excerpt = descriptionExcerpt(n.description);
    if (excerpt !== "") lines.push(excerpt);
    lines.push(n.url);
  }
  return lines;
}

function unsubscribeHtml(vars: DigestNewNeedsVars): string {
  const brand = getBrand();
  return para(
    `<span style="font-size:13px;">You are receiving this because you subscribed to the ${escapeHtml(brand.programName)} weekly digest. ` +
      `<a href="${escapeHtml(vars.unsubscribeUrl)}" style="color:${brand.primaryColor};text-decoration:underline;">Unsubscribe</a></span>`,
  );
}

function unsubscribeText(vars: DigestNewNeedsVars): string[] {
  return [
    `You are receiving this because you subscribed to the ${getBrand().programName} weekly digest.`,
    `Unsubscribe: ${vars.unsubscribeUrl}`,
  ];
}

const DEFAULT_COPY: TemplateCopy = {
  subject: "New Needs from {programName}",
  heading: "New Needs This Week",
  paragraphs: [
    "Here are the needs our member organizations have published since the last digest. Every one of them is an opportunity to show love in action.",
    "Thank you,<br /><strong>{signature}</strong>",
  ],
};

const SECTIONS: TemplateSectionDef<DigestNewNeedsVars>[] = [
  {
    name: "needs_list",
    label: "Needs list",
    renderHtml: (vars) => vars.needs.map(needCardHtml).join("\n"),
    renderText: (vars) => needsText(vars.needs),
  },
  {
    name: "unsubscribe",
    label: "Unsubscribe link",
    renderHtml: unsubscribeHtml,
    renderText: unsubscribeText,
  },
];

const DEFAULT_BLOCKS: import("../render").BodyBlock[] = [
  { kind: "paragraph", html: DEFAULT_COPY.paragraphs[0]! },
  { kind: "section",   name: "needs_list" },
  { kind: "paragraph", html: DEFAULT_COPY.paragraphs[1]! },
  { kind: "section",   name: "unsubscribe" },
];

export const digestNewNeeds: ProductTemplate<DigestNewNeedsVars> = {
  key: "digest_new_needs",
  entityType: "digest_run",
  required: ["needs", "unsubscribeUrl"],
  trigger: "Sent automatically on its configured schedule when needs went live since the previous digest",
  recipients: "Everyone on the digest subscriber list with status subscribed",
  recipientsConfigurable: false,
  defaultCopy: DEFAULT_COPY,
  sections: SECTIONS,
  defaultBlocks: DEFAULT_BLOCKS,
  sample: {
    needs: [
      {
        name: "Winter Warmth Drive",
        description: "Help local families stay warm by donating new coats, blankets, gloves, and other cold-weather essentials.",
        organizationName: "Hope Community Center",
        typeLabel: "Item need",
        url: "https://example.org/items/10432",
        imageUrl: "https://images.unsplash.com/photo-1609139003551-ee40f5f73ec0?auto=format&fit=crop&w=560&q=80",
      },
      {
        name: "Meal Service Volunteers",
        description: "Join a welcoming team to prepare and serve a community meal for neighbors experiencing food insecurity.",
        organizationName: "Neighbors Table",
        typeLabel: "Volunteer need",
        url: "https://example.org/volunteer/10433",
        imageUrl: "https://images.unsplash.com/photo-1559027615-cd4628902d4a?auto=format&fit=crop&w=560&q=80",
      },
    ],
    unsubscribeUrl: "https://example.org/unsubscribe/00000000-0000-0000-0000-000000000000",
  },
  render(vars, copy = DEFAULT_COPY) {
    const subject = fillText(copy.subject, vars);
    const bodyHtml = copy.bodyBlocks?.length
      ? renderBodyBlocksHtml(copy.bodyBlocks, vars, SECTIONS)
      : [
          copyPara(copy.paragraphs[0] ?? "", vars),
          ...vars.needs.map(needCardHtml),
          copyPara(copy.paragraphs[1] ?? "", vars),
          unsubscribeHtml(vars),
        ]
          .filter(Boolean)
          .join("\n");
    const html = shell(fillText(copy.heading, vars), bodyHtml);
    const text = copy.bodyBlocks?.length
      ? textBody(copyText(copy.heading, vars), ...renderBodyBlocksToTextBlocks(copy.bodyBlocks, vars, SECTIONS))
      : textBody(
          copyText(copy.heading, vars),
          copyText(copy.paragraphs[0] ?? "", vars),
          needsText(vars.needs),
          copyText(copy.paragraphs[1] ?? "", vars),
          unsubscribeText(vars),
        );
    return { subject, html, text };
  },
};
