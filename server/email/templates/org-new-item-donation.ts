/**
 * org_new_item_donation — item pledge recorded at PB-02 (TEMPLATES.md §5).
 * Reply-to is the donor's email. Items render as a table, Item | Number
 * Donated (D51), reading item_pledge_lines — never the on-screen string.
 */
import {
  shell,
  sectionHeading,
  kv,
  kvOpt,
  kvLink,
  itemsTable,
  button,
  textKv,
  textKvOpt,
  textItemsTable,
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

export type OrgNewItemDonationVars = {
  organizationName: string;
  requestName: string;
  requestDescription: string | null;
  requestUrl: string;
  items: ItemLine[];
  donorName: string;
  donorEmail: string;
  donorPhone: string | null;
  supportersUrl: string;
};

const DEFAULT_COPY: TemplateCopy = {
  subject: "Item(s) have been donated for {requestName}",
  heading: "New Item(s) Have Been Donated!",
  paragraphs: [
    "Hi {organizationName},",
    "Congratulations, someone is interested in donating items to your organization! Their details and which item(s) they've claimed are included below. This donor has been instructed to reach out to you in the <strong>next 2 weeks</strong> to set up delivery of the item(s) but you may also contact them directly.",
    "Thank you,<br /><strong>{signature}</strong>",
  ],
};

const SECTIONS: TemplateSectionDef<OrgNewItemDonationVars>[] = [
  {
    name: "request_details",
    label: "Request Details",
    renderHtml: (vars) =>
      [
        sectionHeading("Request Details"),
        kv("Name", vars.requestName),
        kvOpt("Description", vars.requestDescription),
        kvLink("Request Link", vars.requestUrl),
      ]
        .filter(Boolean)
        .join("\n"),
    renderText: (vars) => [
      "Request Details",
      textKv("Name", vars.requestName),
      ...textKvOpt("Description", vars.requestDescription),
      textKv("Request Link", vars.requestUrl),
    ],
  },
  {
    name: "items_donated",
    label: "Item(s) Donated",
    renderHtml: (vars) =>
      [sectionHeading("Item(s) Donated"), itemsTable(vars.items, "Number Donated")].join("\n"),
    renderText: (vars) => ["Item(s) Donated", ...textItemsTable(vars.items, "Number Donated")],
  },
  {
    name: "donor_info",
    label: "Donor Information",
    renderHtml: (vars) =>
      [
        sectionHeading("Donor Information"),
        kv("Name", vars.donorName),
        kv("Email", vars.donorEmail),
        kvOpt("Phone", vars.donorPhone),
      ]
        .filter(Boolean)
        .join("\n"),
    renderText: (vars) => [
      "Donor Information",
      textKv("Name", vars.donorName),
      textKv("Email", vars.donorEmail),
      ...textKvOpt("Phone", vars.donorPhone),
    ],
  },
  {
    name: "view_button",
    label: "View Donors button",
    renderHtml: (vars) => button("View Donors", vars.supportersUrl),
    renderText: (vars) => [textKv("View Donors", vars.supportersUrl)],
  },
];
const DEFAULT_BLOCKS: import("../render").BodyBlock[] = [
  { kind: "paragraph", html: DEFAULT_COPY.paragraphs[0]! },
  { kind: "paragraph", html: DEFAULT_COPY.paragraphs[1]! },
  { kind: "section",   name: "request_details" },
  { kind: "section",   name: "items_donated" },
  { kind: "section",   name: "donor_info" },
  { kind: "paragraph", html: DEFAULT_COPY.paragraphs[2]! },
  { kind: "section",   name: "view_button" },
];

export const orgNewItemDonation: ProductTemplate<OrgNewItemDonationVars> = {
  key: "org_new_item_donation",
  entityType: "item_pledge",
  required: ["organizationName", "requestName", "requestUrl", "items", "donorName", "donorEmail", "supportersUrl"],
  trigger: "A donor pledges items on a public request",
  recipients: "The request's contact person",
  recipientsConfigurable: false,
  defaultCopy: DEFAULT_COPY,
  sections: SECTIONS,
  defaultBlocks: DEFAULT_BLOCKS,
  sample: {
    organizationName: "Hope Community Center",
    requestName: "Winter Warmth Drive",
    requestDescription: "Warm supplies for families ahead of the cold season.",
    requestUrl: "https://example.org/requests/winter-warmth-drive",
    items: [
      { name: "Blankets", quantity: 3 },
      { name: "Socks", quantity: 10 },
    ],
    donorName: "Jordan Lee",
    donorEmail: "jordan.lee@example.org",
    donorPhone: "(213) 555-0187",
    supportersUrl: "https://example.org/admin/supporters",
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
          kvLink("Request Link", vars.requestUrl),
          sectionHeading("Item(s) Donated"),
          itemsTable(vars.items, "Number Donated"),
          sectionHeading("Donor Information"),
          kv("Name", vars.donorName),
          kv("Email", vars.donorEmail),
          kvOpt("Phone", vars.donorPhone),
          copyPara(copy.paragraphs[2] ?? "", vars),
          button("View Donors", vars.supportersUrl),
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
            textKv("Request Link", vars.requestUrl),
          ],
          ["Item(s) Donated", ...textItemsTable(vars.items, "Number Donated")],
          [
            "Donor Information",
            textKv("Name", vars.donorName),
            textKv("Email", vars.donorEmail),
            ...textKvOpt("Phone", vars.donorPhone),
          ],
          copyText(copy.paragraphs[2] ?? "", vars),
          textKv("View Donors", vars.supportersUrl),
        );
    return { subject, html, text };
  },
};
