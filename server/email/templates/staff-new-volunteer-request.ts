/** staff_new_volunteer_request — volunteer request submitted at MP-11/MP-12 (TEMPLATES.md §4). */
import {
  shell,
  sectionHeading,
  kv,
  button,
  textKv,
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

export type StaffNewVolunteerRequestVars = {
  volunteerRequestName: string;
  organizationName: string;
  organizationPrimaryContact: string;
  organizationPrimaryContactEmail: string;
  adminUrl: string;
};

const DEFAULT_COPY: TemplateCopy = {
  subject: "Volunteer Request Pending Approval: {volunteerRequestName}",
  heading: "Volunteer Request Pending Approval",
  paragraphs: ["A new volunteer opportunity has been submitted. Here are the details for review & approval:"],
};

const SECTIONS: TemplateSectionDef<StaffNewVolunteerRequestVars>[] = [
  {
    name: "volunteer_request_details",
    label: "Volunteer Request Details",
    renderHtml: (vars) =>
      [
        sectionHeading("Volunteer Request Details"),
        kv("Volunteer Request", vars.volunteerRequestName),
        kv("Organization", vars.organizationName),
        kv("Primary Contact", vars.organizationPrimaryContact),
        kv("Primary Contact's Email", vars.organizationPrimaryContactEmail),
      ].join("\n"),
    renderText: (vars) => [
      "Volunteer Request Details",
      textKv("Volunteer Request", vars.volunteerRequestName),
      textKv("Organization", vars.organizationName),
      textKv("Primary Contact", vars.organizationPrimaryContact),
      textKv("Primary Contact's Email", vars.organizationPrimaryContactEmail),
    ],
  },
  {
    name: "view_button",
    label: "View/Approve button",
    renderHtml: (vars) => button("View/Approve Volunteer Request", vars.adminUrl),
    renderText: (vars) => [textKv("View/Approve Volunteer Request", vars.adminUrl)],
  },
];

const DEFAULT_BLOCKS: import("../render").BodyBlock[] = [
  { kind: "paragraph", html: DEFAULT_COPY.paragraphs[0]! },
  { kind: "section",   name: "volunteer_request_details" },
  { kind: "section",   name: "view_button" },
];

export const staffNewVolunteerRequest: ProductTemplate<StaffNewVolunteerRequestVars> = {
  key: "staff_new_volunteer_request",
  entityType: "volunteer_request",
  required: [
    "volunteerRequestName",
    "organizationName",
    "organizationPrimaryContact",
    "organizationPrimaryContactEmail",
    "adminUrl",
  ],
  trigger: "A member submits a new volunteer request",
  recipients: "The staff notification addresses",
  recipientsConfigurable: true,
  defaultCopy: DEFAULT_COPY,
  sections: SECTIONS,
  defaultBlocks: DEFAULT_BLOCKS,
  sample: {
    volunteerRequestName: "Food Pantry Helpers",
    organizationName: "Hope Community Center",
    organizationPrimaryContact: "Maria Alvarez",
    organizationPrimaryContactEmail: "maria@hopecommunity.example.org",
    adminUrl: "https://example.org/admin/volunteer-requests",
  },
  render(vars, copy = DEFAULT_COPY) {
    const subject = fillText(copy.subject, vars);
    const bodyHtml = copy.bodyBlocks?.length
      ? renderBodyBlocksHtml(copy.bodyBlocks, vars, SECTIONS)
      : [
          copyPara(copy.paragraphs[0] ?? "", vars),
          sectionHeading("Volunteer Request Details"),
          kv("Volunteer Request", vars.volunteerRequestName),
          kv("Organization", vars.organizationName),
          kv("Primary Contact", vars.organizationPrimaryContact),
          kv("Primary Contact's Email", vars.organizationPrimaryContactEmail),
          button("View/Approve Volunteer Request", vars.adminUrl),
        ].join("\n");
    const html = shell(fillText(copy.heading, vars), bodyHtml);
    const text = copy.bodyBlocks?.length
      ? textBody(copyText(copy.heading, vars), ...renderBodyBlocksToTextBlocks(copy.bodyBlocks, vars, SECTIONS))
      : textBody(
          copyText(copy.heading, vars),
          copyText(copy.paragraphs[0] ?? "", vars),
          [
            "Volunteer Request Details",
            textKv("Volunteer Request", vars.volunteerRequestName),
            textKv("Organization", vars.organizationName),
            textKv("Primary Contact", vars.organizationPrimaryContact),
            textKv("Primary Contact's Email", vars.organizationPrimaryContactEmail),
          ],
          textKv("View/Approve Volunteer Request", vars.adminUrl),
        );
    return { subject, html, text };
  },
};
