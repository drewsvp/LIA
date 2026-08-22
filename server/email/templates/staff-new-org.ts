/** staff_new_org — organization submitted at MP-03 (docs/email/TEMPLATES.md §4). */
import {
  shell,
  sectionHeading,
  kv,
  kvOpt,
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

export type StaffNewOrgVars = {
  organizationName: string;
  organizationAddress: string | null;
  organizationPhone: string | null;
  organizationWebsite: string | null;
  primaryContactName: string;
  primaryContactEmail: string;
  primaryContactPhone: string | null;
  adminUrl: string;
};

const DEFAULT_COPY: TemplateCopy = {
  subject: "Organization Pending Approval: {organizationName}",
  heading: "New Organization Pending Approval",
  paragraphs: ["The following organization has requested approval to use the {programName} Database:"],
};

const SECTIONS: TemplateSectionDef<StaffNewOrgVars>[] = [
  {
    name: "org_details",
    label: "Organization Details",
    renderHtml: (vars) =>
      [
        sectionHeading("Organization Details"),
        kv("Name", vars.organizationName),
        kvOpt("Address", vars.organizationAddress),
        kvOpt("Phone Number", vars.organizationPhone),
        kvOpt("Website", vars.organizationWebsite),
      ]
        .filter(Boolean)
        .join("\n"),
    renderText: (vars) => [
      "Organization Details",
      textKv("Name", vars.organizationName),
      ...textKvOpt("Address", vars.organizationAddress),
      ...textKvOpt("Phone Number", vars.organizationPhone),
      ...textKvOpt("Website", vars.organizationWebsite),
    ],
  },
  {
    name: "primary_contact",
    label: "Primary Contact",
    renderHtml: (vars) =>
      [
        sectionHeading("Primary Contact"),
        kv("Name", vars.primaryContactName),
        kv("Email", vars.primaryContactEmail),
        kvOpt("Phone", vars.primaryContactPhone),
      ]
        .filter(Boolean)
        .join("\n"),
    renderText: (vars) => [
      "Primary Contact",
      textKv("Name", vars.primaryContactName),
      textKv("Email", vars.primaryContactEmail),
      ...textKvOpt("Phone", vars.primaryContactPhone),
    ],
  },
  {
    name: "review_button",
    label: "Review & Approve button",
    renderHtml: (vars) => button("Review & Approve", vars.adminUrl),
    renderText: (vars) => [textKv("Review & Approve", vars.adminUrl)],
  },
];
const DEFAULT_BLOCKS: import("../render").BodyBlock[] = [
  { kind: "paragraph", html: DEFAULT_COPY.paragraphs[0]! },
  { kind: "section",   name: "org_details" },
  { kind: "section",   name: "primary_contact" },
  { kind: "section",   name: "review_button" },
];

export const staffNewOrg: ProductTemplate<StaffNewOrgVars> = {
  key: "staff_new_org",
  entityType: "organization",
  required: ["organizationName", "primaryContactName", "primaryContactEmail", "adminUrl"],
  trigger: "An organization submits the signup form",
  recipients: "The staff notification addresses",
  recipientsConfigurable: true,
  defaultCopy: DEFAULT_COPY,
  sections: SECTIONS,
  defaultBlocks: DEFAULT_BLOCKS,
  sample: {
    organizationName: "Hope Community Center",
    organizationAddress: "123 Main St, Los Angeles, CA 90012",
    organizationPhone: "(213) 555-0142",
    organizationWebsite: "https://hopecommunity.example.org",
    primaryContactName: "Maria Alvarez",
    primaryContactEmail: "maria@hopecommunity.example.org",
    primaryContactPhone: "(213) 555-0143",
    adminUrl: "https://example.org/admin/organizations",
  },
  render(vars, copy = DEFAULT_COPY) {
    const subject = fillText(copy.subject, vars);
    const bodyHtml = copy.bodyBlocks?.length
      ? renderBodyBlocksHtml(copy.bodyBlocks, vars, SECTIONS)
      : [
          copyPara(copy.paragraphs[0] ?? "", vars),
          sectionHeading("Organization Details"),
          kv("Name", vars.organizationName),
          kvOpt("Address", vars.organizationAddress),
          kvOpt("Phone Number", vars.organizationPhone),
          kvOpt("Website", vars.organizationWebsite),
          sectionHeading("Primary Contact"),
          kv("Name", vars.primaryContactName),
          kv("Email", vars.primaryContactEmail),
          kvOpt("Phone", vars.primaryContactPhone),
          button("Review & Approve", vars.adminUrl),
        ]
          .filter(Boolean)
          .join("\n");
    const html = shell(fillText(copy.heading, vars), bodyHtml);
    const text = copy.bodyBlocks?.length
      ? textBody(copyText(copy.heading, vars), ...renderBodyBlocksToTextBlocks(copy.bodyBlocks, vars, SECTIONS))
      : textBody(
          copyText(copy.heading, vars),
          copyText(copy.paragraphs[0] ?? "", vars),
          [
            "Organization Details",
            textKv("Name", vars.organizationName),
            ...textKvOpt("Address", vars.organizationAddress),
            ...textKvOpt("Phone Number", vars.organizationPhone),
            ...textKvOpt("Website", vars.organizationWebsite),
          ],
          [
            "Primary Contact",
            textKv("Name", vars.primaryContactName),
            textKv("Email", vars.primaryContactEmail),
            ...textKvOpt("Phone", vars.primaryContactPhone),
          ],
          textKv("Review & Approve", vars.adminUrl),
        );
    return { subject, html, text };
  },
};
