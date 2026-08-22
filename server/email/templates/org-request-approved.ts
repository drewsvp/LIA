/** org_request_approved — request approved at ADMIN-02 (TEMPLATES.md §5). */
import {
  shell,
  sectionHeading,
  kv,
  kvOpt,
  kvLink,
  button,
  textKv,
  textKvOpt,
  textBody,
  fillText,
  copyPara,
  copyText,
  renderBodyBlocksHtml,
  renderBodyBlocksToTextBlocks,
  type TemplateCopy,
  type TemplateSectionDef,
} from "../render";
import type { ProductTemplate } from "./types";
import { childrenHtml, childrenText, type RequestChildren } from "./org-request-received";

export type OrgRequestApprovedVars = {
  organizationName: string;
  viewRequestUrl: string;
  requestName: string;
  requestDescription: string | null;
  requestContactName: string;
  requestContactEmail: string;
  requestContactPhone: string | null;
  itemOrVolunteer: string; // "Item" | "Volunteer", exactly
  itemsOrRoles: RequestChildren;
};

const DEFAULT_COPY: TemplateCopy = {
  subject: "Your {programName} Request was Approved!",
  heading: "Your Request Has Been Approved!",
  paragraphs: [
    "Hi {organizationName},",
    "Your request was approved and published to the {orgName} {programName} Database!",
    "For your convenience, here is the URL to your published need and a photo so you can share this request with your community and post it on your social media sites.",
    "Thank you,<br /><strong>{signature}</strong>",
  ],
};

const SECTIONS: TemplateSectionDef<OrgRequestApprovedVars>[] = [
  {
    name: "request_url",
    label: "Request URL",
    renderHtml: (vars) => kvLink("URL", vars.viewRequestUrl),
    renderText: (vars) => [textKv("URL", vars.viewRequestUrl)],
  },
  {
    name: "request_details",
    label: "Request Details",
    renderHtml: (vars) =>
      [
        sectionHeading("Request Details"),
        kv("Name", vars.requestName),
        kvOpt("Description", vars.requestDescription),
        kvLink("URL", vars.viewRequestUrl),
      ]
        .filter(Boolean)
        .join("\n"),
    renderText: (vars) => [
      "Request Details",
      textKv("Name", vars.requestName),
      ...textKvOpt("Description", vars.requestDescription),
      textKv("URL", vars.viewRequestUrl),
    ],
  },
  {
    name: "request_contact",
    label: "Request Contact",
    renderHtml: (vars) =>
      [
        sectionHeading("Request Contact"),
        kv("Request's Contact", vars.requestContactName),
        kv("Contact's Email", vars.requestContactEmail),
        kvOpt("Contact's Phone", vars.requestContactPhone),
      ]
        .filter(Boolean)
        .join("\n"),
    renderText: (vars) => [
      "Request Contact",
      textKv("Request's Contact", vars.requestContactName),
      textKv("Contact's Email", vars.requestContactEmail),
      ...textKvOpt("Contact's Phone", vars.requestContactPhone),
    ],
  },
  {
    name: "items_or_roles",
    label: "Items/Roles Details",
    renderHtml: (vars) =>
      [sectionHeading(`${vars.itemOrVolunteer}s Details`), childrenHtml(vars.itemsOrRoles)].join("\n"),
    renderText: (vars) => [`${vars.itemOrVolunteer}s Details`, ...childrenText(vars.itemsOrRoles)],
  },
  {
    name: "view_button",
    label: "View Your Request button",
    renderHtml: (vars) => button("View Your Request", vars.viewRequestUrl),
    renderText: (vars) => [textKv("View Your Request", vars.viewRequestUrl)],
  },
];
const DEFAULT_BLOCKS: import("../render").BodyBlock[] = [
  { kind: "paragraph", html: DEFAULT_COPY.paragraphs[0]! },
  { kind: "paragraph", html: DEFAULT_COPY.paragraphs[1]! },
  { kind: "paragraph", html: DEFAULT_COPY.paragraphs[2]! },
  { kind: "section",   name: "request_details" },
  { kind: "section",   name: "request_contact" },
  { kind: "section",   name: "items_or_roles" },
  { kind: "paragraph", html: DEFAULT_COPY.paragraphs[3]! },
  { kind: "section",   name: "view_button" },
];

export const orgRequestApproved: ProductTemplate<OrgRequestApprovedVars> = {
  key: "org_request_approved",
  // entityType is set per queue call: "item_request" or "volunteer_request".
  entityType: "item_request",
  required: [
    "organizationName",
    "viewRequestUrl",
    "requestName",
    "requestContactName",
    "requestContactEmail",
    "itemOrVolunteer",
    "itemsOrRoles",
  ],
  trigger: "Staff approves an item or volunteer request",
  recipients: "The request's contact person",
  recipientsConfigurable: false,
  defaultCopy: DEFAULT_COPY,
  sections: SECTIONS,
  defaultBlocks: DEFAULT_BLOCKS,
  sample: {
    organizationName: "Hope Community Center",
    viewRequestUrl: "https://example.org/needs/10432",
    requestName: "Winter Warmth Drive",
    requestDescription: "Collecting warm clothing for families this winter.",
    requestContactName: "Maria Alvarez",
    requestContactEmail: "maria@hopecommunity.example.org",
    requestContactPhone: "(213) 555-0143",
    itemOrVolunteer: "Item",
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
          copyPara(copy.paragraphs[2] ?? "", vars),
          sectionHeading("Request Details"),
          kv("Name", vars.requestName),
          kvOpt("Description", vars.requestDescription),
          kvLink("URL", vars.viewRequestUrl),
          sectionHeading("Request Contact"),
          kv("Request's Contact", vars.requestContactName),
          kv("Contact's Email", vars.requestContactEmail),
          kvOpt("Contact's Phone", vars.requestContactPhone),
          sectionHeading(`${vars.itemOrVolunteer}s Details`),
          childrenHtml(vars.itemsOrRoles),
          copyPara(copy.paragraphs[3] ?? "", vars),
          button("View Your Request", vars.viewRequestUrl),
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
          copyText(copy.paragraphs[2] ?? "", vars),
          [
            "Request Details",
            textKv("Name", vars.requestName),
            ...textKvOpt("Description", vars.requestDescription),
            textKv("URL", vars.viewRequestUrl),
          ],
          [
            "Request Contact",
            textKv("Request's Contact", vars.requestContactName),
            textKv("Contact's Email", vars.requestContactEmail),
            ...textKvOpt("Contact's Phone", vars.requestContactPhone),
          ],
          [`${vars.itemOrVolunteer}s Details`, ...childrenText(vars.itemsOrRoles)],
          copyText(copy.paragraphs[3] ?? "", vars),
          textKv("View Your Request", vars.viewRequestUrl),
        );
    return { subject, html, text };
  },
};
