/** staff_new_user — member invited at MP-06 (TEMPLATES.md §4). */
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

export type StaffNewUserVars = {
  memberName: string;
  memberEmail: string;
  memberPhone: string | null;
  organizationName: string;
  submitterName: string;
  submitterEmail: string;
  adminUrl: string;
};

const DEFAULT_COPY: TemplateCopy = {
  subject: "New Member Pending Approval: {memberName}",
  heading: "New Database User Pending Approval",
  paragraphs: [
    "An {orgName} Member has requested a new teammate be given access to the {programName} Database. Here is their information:",
  ],
};

const SECTIONS: TemplateSectionDef<StaffNewUserVars>[] = [
  {
    name: "requesting_member",
    label: "Requesting Member Details",
    renderHtml: (vars) =>
      [
        sectionHeading("Requesting Member Details"),
        kv("Organization", vars.organizationName),
        kv("Requesting Contact", vars.submitterName),
        kv("Requesting Contact's Email", vars.submitterEmail),
      ].join("\n"),
    renderText: (vars) => [
      "Requesting Member Details",
      textKv("Organization", vars.organizationName),
      textKv("Requesting Contact", vars.submitterName),
      textKv("Requesting Contact's Email", vars.submitterEmail),
    ],
  },
  {
    name: "new_member",
    label: "New Member Details",
    renderHtml: (vars) =>
      [
        sectionHeading("New Member Details"),
        kv("Name", vars.memberName),
        kv("Email", vars.memberEmail),
        kvOpt("Phone", vars.memberPhone),
      ]
        .filter(Boolean)
        .join("\n"),
    renderText: (vars) => [
      "New Member Details",
      textKv("Name", vars.memberName),
      textKv("Email", vars.memberEmail),
      ...textKvOpt("Phone", vars.memberPhone),
    ],
  },
  {
    name: "approve_button",
    label: "Review & Approve button",
    renderHtml: (vars) => button("Review & Approve New Member", vars.adminUrl),
    renderText: (vars) => [textKv("Review & Approve New Member", vars.adminUrl)],
  },
];
const DEFAULT_BLOCKS: import("../render").BodyBlock[] = [
  { kind: "paragraph", html: DEFAULT_COPY.paragraphs[0]! },
  { kind: "section",   name: "requesting_member" },
  { kind: "section",   name: "new_member" },
  { kind: "section",   name: "approve_button" },
];

export const staffNewUser: ProductTemplate<StaffNewUserVars> = {
  key: "staff_new_user",
  entityType: "org_membership",
  required: ["memberName", "memberEmail", "organizationName", "submitterName", "submitterEmail", "adminUrl"],
  trigger: "A member invites a new teammate",
  recipients: "The staff notification addresses",
  recipientsConfigurable: true,
  defaultCopy: DEFAULT_COPY,
  sections: SECTIONS,
  defaultBlocks: DEFAULT_BLOCKS,
  sample: {
    memberName: "Jordan Lee",
    memberEmail: "jordan@hopecommunity.example.org",
    memberPhone: "(213) 555-0177",
    organizationName: "Hope Community Center",
    submitterName: "Maria Alvarez",
    submitterEmail: "maria@hopecommunity.example.org",
    adminUrl: "https://example.org/admin/members",
  },
  render(vars, copy = DEFAULT_COPY) {
    const subject = fillText(copy.subject, vars);
    const bodyHtml = copy.bodyBlocks?.length
      ? renderBodyBlocksHtml(copy.bodyBlocks, vars, SECTIONS)
      : [
          copyPara(copy.paragraphs[0] ?? "", vars),
          sectionHeading("Requesting Member Details"),
          kv("Organization", vars.organizationName),
          kv("Requesting Contact", vars.submitterName),
          kv("Requesting Contact's Email", vars.submitterEmail),
          sectionHeading("New Member Details"),
          kv("Name", vars.memberName),
          kv("Email", vars.memberEmail),
          kvOpt("Phone", vars.memberPhone),
          button("Review & Approve New Member", vars.adminUrl),
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
            "Requesting Member Details",
            textKv("Organization", vars.organizationName),
            textKv("Requesting Contact", vars.submitterName),
            textKv("Requesting Contact's Email", vars.submitterEmail),
          ],
          [
            "New Member Details",
            textKv("Name", vars.memberName),
            textKv("Email", vars.memberEmail),
            ...textKvOpt("Phone", vars.memberPhone),
          ],
          textKv("Review & Approve New Member", vars.adminUrl),
        );
    return { subject, html, text };
  },
};
