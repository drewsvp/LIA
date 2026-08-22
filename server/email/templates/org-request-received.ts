/**
 * org_request_received — request submitted at MP-08 or MP-11 (TEMPLATES.md §5).
 * itemOrVolunteer resolves to exactly "Item" or "Volunteer" (captain's work
 * order, Aug 17 2026 — capture closed), in the subject and the details heading.
 */
import {
  shell,
  sectionHeading,
  kv,
  kvOpt,
  itemsTable,
  rolesList,
  textKv,
  textKvOpt,
  textItemsTable,
  textRolesList,
  textBody,
  fillText,
  copyPara,
  copyText,
  renderBodyBlocksHtml,
  renderBodyBlocksToTextBlocks,
  type TemplateCopy,
  type TemplateSectionDef,
} from "../render";
import type { ProductTemplate, ItemLine } from "./types";

export type RequestChildren =
  | { kind: "item"; rows: ItemLine[] }
  | { kind: "volunteer"; rows: ItemLine[] };

export type OrgRequestReceivedVars = {
  itemOrVolunteer: string; // "Item" | "Volunteer", exactly
  organizationName: string;
  requestName: string;
  requestDescription: string | null;
  requestContactName: string;
  requestContactEmail: string;
  requestContactPhone: string | null;
  requestId: string;
  itemsOrRoles: RequestChildren;
};

export function childrenHtml(children: RequestChildren): string {
  if (children.kind === "item") return itemsTable(children.rows, "Quantity");
  return rolesList(children.rows.map((r) => `${r.name} — ${r.quantity} needed`));
}

export function childrenText(children: RequestChildren): string[] {
  if (children.kind === "item") return textItemsTable(children.rows, "Quantity");
  return textRolesList(children.rows.map((r) => `${r.name} — ${r.quantity} needed`));
}

const DEFAULT_COPY: TemplateCopy = {
  subject: "{itemOrVolunteer} Request Pending Approval: {requestName}",
  heading: "Request Pending Approval",
  paragraphs: [
    "Hi {organizationName},",
    "Thank you for submitting the following request through {orgName}'s {programName} Database. Our team will create a custom graphic with your logo and publish your need within 1–2 business days. Once your post goes live, you will receive a confirmation email with the information so you can share this need to your own community and social media platforms.",
  ],
};

const SECTIONS: TemplateSectionDef<OrgRequestReceivedVars>[] = [
  {
    name: "request_details",
    label: "Request Details",
    renderHtml: (vars) =>
      [
        sectionHeading("Request Details"),
        kv("Name", vars.requestName),
        kvOpt("Description", vars.requestDescription),
        `      <div style="height:16px;"></div>`,
        kv("Request Contact", vars.requestContactName),
        kv("Contact's Email", vars.requestContactEmail),
        kvOpt("Contact's Phone", vars.requestContactPhone),
        kv("Unique ID", vars.requestId),
        sectionHeading(`${vars.itemOrVolunteer}s Details`),
        childrenHtml(vars.itemsOrRoles),
      ]
        .filter(Boolean)
        .join("\n"),
    renderText: (vars) => [
      "Request Details",
      textKv("Name", vars.requestName),
      ...textKvOpt("Description", vars.requestDescription),
      textKv("Request Contact", vars.requestContactName),
      textKv("Contact's Email", vars.requestContactEmail),
      ...textKvOpt("Contact's Phone", vars.requestContactPhone),
      textKv("Unique ID", vars.requestId),
      `${vars.itemOrVolunteer}s Details`,
      ...childrenText(vars.itemsOrRoles),
    ],
  },
];
const DEFAULT_BLOCKS: import("../render").BodyBlock[] = [
  { kind: "paragraph", html: DEFAULT_COPY.paragraphs[0]! },
  { kind: "paragraph", html: DEFAULT_COPY.paragraphs[1]! },
  { kind: "section",   name: "request_details" },
];

export const orgRequestReceived: ProductTemplate<OrgRequestReceivedVars> = {
  key: "org_request_received",
  // entityType is set per queue call: "item_request" or "volunteer_request".
  entityType: "item_request",
  required: [
    "itemOrVolunteer",
    "organizationName",
    "requestName",
    "requestContactName",
    "requestContactEmail",
    "requestId",
    "itemsOrRoles",
  ],
  trigger: "A member submits an item or volunteer request",
  recipients: "The member who submitted the request",
  recipientsConfigurable: false,
  defaultCopy: DEFAULT_COPY,
  sections: SECTIONS,
  defaultBlocks: DEFAULT_BLOCKS,
  sample: {
    itemOrVolunteer: "Item",
    organizationName: "Hope Community Center",
    requestName: "Winter Warmth Drive",
    requestDescription: "Collecting warm clothing for families this winter.",
    requestContactName: "Maria Alvarez",
    requestContactEmail: "maria@hopecommunity.example.org",
    requestContactPhone: "(213) 555-0143",
    requestId: "REQ-10432",
    itemsOrRoles: {
      kind: "item",
      rows: [
        { name: "Blankets", quantity: 3 },
        { name: "Socks", quantity: 10 },
      ],
    },
  },
  render(vars, copy = DEFAULT_COPY) {
    const subject = fillText(copy.subject, vars);
    const bodyHtml = copy.bodyBlocks?.length
      ? renderBodyBlocksHtml(copy.bodyBlocks, vars, SECTIONS)
      : [
          copyPara(copy.paragraphs[0] ?? "", vars),
          copyPara(copy.paragraphs[1] ?? "", vars),
          sectionHeading("Request Details"),
          kv("Name", vars.requestName),
          kvOpt("Description", vars.requestDescription),
          `      <div style="height:16px;"></div>`,
          kv("Request Contact", vars.requestContactName),
          kv("Contact's Email", vars.requestContactEmail),
          kvOpt("Contact's Phone", vars.requestContactPhone),
          kv("Unique ID", vars.requestId),
          sectionHeading(`${vars.itemOrVolunteer}s Details`),
          childrenHtml(vars.itemsOrRoles),
        ]
          .filter(Boolean)
          .join("\n");
    const html = shell(fillText(copy.heading, vars), bodyHtml);
    const text = copy.bodyBlocks?.length
      ? textBody(copyText(copy.heading, vars), ...renderBodyBlocksToTextBlocks(copy.bodyBlocks, vars, SECTIONS))
      : textBody(
          copyText(copy.heading, vars),
          copyText(copy.paragraphs[0] ?? "", vars),
          copyText(copy.paragraphs[1] ?? "", vars),
          [
            "Request Details",
            textKv("Name", vars.requestName),
            ...textKvOpt("Description", vars.requestDescription),
            textKv("Request Contact", vars.requestContactName),
            textKv("Contact's Email", vars.requestContactEmail),
            ...textKvOpt("Contact's Phone", vars.requestContactPhone),
            textKv("Unique ID", vars.requestId),
            `${vars.itemOrVolunteer}s Details`,
            ...childrenText(vars.itemsOrRoles),
          ],
        );
    return { subject, html, text };
  },
};
