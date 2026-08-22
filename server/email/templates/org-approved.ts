/**
 * org_approved — organization approved at ADMIN-01 (TEMPLATES.md §5).
 * Highest-consequence email in the system. No logo block (D50).
 * The christina@defendingthecause.org line is captured body copy, not a
 * configured recipient — it stays verbatim.
 */
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

export type OrgApprovedVars = {
  organizationName: string;
  orgAddress: string | null;
  orgPhoneNumber: string | null;
  websiteUrl: string | null;
  missionStatement: string | null;
  primaryPopulationServed: string | null;
  organizationPrimaryContact: string;
  organizationPrimaryContactEmail: string;
  organizationPrimaryContactPhone: string | null;
  dashboardUrl: string;
};

const DEFAULT_COPY: TemplateCopy = {
  subject: "Welcome to the {orgName} {programName} Database {organizationName}",
  heading: "Your Organization Has Been Approved!",
  paragraphs: [
    "Hi {organizationName},",
    "You've been approved to start using {orgName}'s {programName} Database! We can't wait to help get your donation needs and volunteer opportunities met by community members.",
    "Within the next few minutes you will be receiving a second email with instructions on how to log in to your new dashboard.",
    "Please review the information in your organization's profile below and save this email for your records.",
    "If you have questions about using any of the features of this database, please email <strong>{directorName}</strong>, our {directorTitle}, at {directorEmail}.",
  ],
};

const SECTIONS: TemplateSectionDef<OrgApprovedVars>[] = [
  {
    name: "dashboard_button",
    label: "Dashboard button",
    renderHtml: (vars) => button("Go to Your Dashboard", vars.dashboardUrl),
    renderText: (vars) => [textKv("Go to Your Dashboard", vars.dashboardUrl)],
  },
  {
    name: "org_details",
    label: "Organization Details",
    renderHtml: (vars) =>
      [
        sectionHeading("Organization Details"),
        kv("Name", vars.organizationName),
        kvOpt("Address", vars.orgAddress),
        kvOpt("Phone", vars.orgPhoneNumber),
        kvOpt("Website", vars.websiteUrl),
        kvOpt("Mission Statement", vars.missionStatement),
        kvOpt("Population Served", vars.primaryPopulationServed),
        `      <div style="height:16px;"></div>`,
        kv("Primary Contact", vars.organizationPrimaryContact),
        kv("Primary Contact's Email", vars.organizationPrimaryContactEmail),
        kvOpt("Primary Contact's Phone #", vars.organizationPrimaryContactPhone),
      ]
        .filter(Boolean)
        .join("\n"),
    renderText: (vars) => [
      "Organization Details",
      textKv("Name", vars.organizationName),
      ...textKvOpt("Address", vars.orgAddress),
      ...textKvOpt("Phone", vars.orgPhoneNumber),
      ...textKvOpt("Website", vars.websiteUrl),
      ...textKvOpt("Mission Statement", vars.missionStatement),
      ...textKvOpt("Population Served", vars.primaryPopulationServed),
      textKv("Primary Contact", vars.organizationPrimaryContact),
      textKv("Primary Contact's Email", vars.organizationPrimaryContactEmail),
      ...textKvOpt("Primary Contact's Phone #", vars.organizationPrimaryContactPhone),
    ],
  },
];
const DEFAULT_BLOCKS: import("../render").BodyBlock[] = [
  { kind: "paragraph", html: DEFAULT_COPY.paragraphs[0]! },
  { kind: "paragraph", html: DEFAULT_COPY.paragraphs[1]! },
  { kind: "paragraph", html: DEFAULT_COPY.paragraphs[2]! },
  { kind: "paragraph", html: DEFAULT_COPY.paragraphs[3]! },
  { kind: "section",   name: "dashboard_button" },
  { kind: "section",   name: "org_details" },
  { kind: "paragraph", html: DEFAULT_COPY.paragraphs[4]! },
];

export const orgApproved: ProductTemplate<OrgApprovedVars> = {
  key: "org_approved",
  entityType: "organization",
  required: ["organizationName", "organizationPrimaryContact", "organizationPrimaryContactEmail", "dashboardUrl"],
  trigger: "Staff approves an organization",
  recipients: "The organization's primary contact",
  recipientsConfigurable: false,
  defaultCopy: DEFAULT_COPY,
  sections: SECTIONS,
  defaultBlocks: DEFAULT_BLOCKS,
  sample: {
    organizationName: "Hope Community Center",
    orgAddress: "123 Main St, Los Angeles, CA 90012",
    orgPhoneNumber: "(213) 555-0142",
    websiteUrl: "https://hopecommunity.example.org",
    missionStatement: "Providing food, shelter, and hope to families in need.",
    primaryPopulationServed: "Families experiencing homelessness",
    organizationPrimaryContact: "Maria Alvarez",
    organizationPrimaryContactEmail: "maria@hopecommunity.example.org",
    organizationPrimaryContactPhone: "(213) 555-0143",
    dashboardUrl: "https://example.org/dashboard",
  },
  render(vars, copy = DEFAULT_COPY) {
    const subject = fillText(copy.subject, vars);
    const bodyHtml = copy.bodyBlocks?.length
      ? renderBodyBlocksHtml(copy.bodyBlocks, vars, SECTIONS)
      : [
          copyPara(copy.paragraphs[0] ?? "", vars),
          copyPara(copy.paragraphs[1] ?? "", vars),
          copyPara(copy.paragraphs[2] ?? "", vars),
          copyPara(copy.paragraphs[3] ?? "", vars),
          button("Go to Your Dashboard", vars.dashboardUrl),
          sectionHeading("Organization Details"),
          kv("Name", vars.organizationName),
          kvOpt("Address", vars.orgAddress),
          kvOpt("Phone", vars.orgPhoneNumber),
          kvOpt("Website", vars.websiteUrl),
          kvOpt("Mission Statement", vars.missionStatement),
          kvOpt("Population Served", vars.primaryPopulationServed),
          `      <div style="height:16px;"></div>`,
          kv("Primary Contact", vars.organizationPrimaryContact),
          kv("Primary Contact's Email", vars.organizationPrimaryContactEmail),
          kvOpt("Primary Contact's Phone #", vars.organizationPrimaryContactPhone),
          copyPara(copy.paragraphs[4] ?? "", vars),
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
          copyText(copy.paragraphs[3] ?? "", vars),
          textKv("Go to Your Dashboard", vars.dashboardUrl),
          [
            "Organization Details",
            textKv("Name", vars.organizationName),
            ...textKvOpt("Address", vars.orgAddress),
            ...textKvOpt("Phone", vars.orgPhoneNumber),
            ...textKvOpt("Website", vars.websiteUrl),
            ...textKvOpt("Mission Statement", vars.missionStatement),
            ...textKvOpt("Population Served", vars.primaryPopulationServed),
            textKv("Primary Contact", vars.organizationPrimaryContact),
            textKv("Primary Contact's Email", vars.organizationPrimaryContactEmail),
            ...textKvOpt("Primary Contact's Phone #", vars.organizationPrimaryContactPhone),
          ],
          copyText(copy.paragraphs[4] ?? "", vars),
        );
    return { subject, html, text };
  },
};
