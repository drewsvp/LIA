/**
 * org_member_approved — membership approved at ADMIN-03 (TEMPLATES.md §5).
 *
 * BODY IS LOREM IPSUM, DELIBERATELY (captain's work order, Aug 17 2026).
 * The body prose has not been captured from the source system and nobody is
 * to write replacement copy. Everything else — subject, recipient, entity,
 * variable list, HTML/text parts, dispatch, logging, variable resolution —
 * is real and final. Variables sit in their final positions surrounded by
 * lorem ipsum so layout and resolution are testable. The greeting is
 * "Dear {memberName}," exactly. Swap the prose verbatim when the capture
 * arrives; docs/build-log.md carries the pending-capture line.
 */
import {
  shell,
  button,
  textKv,
  textBody,
  fillText,
  copyPara,
  copyText,
  type TemplateCopy,
} from "../render";
import type { ProductTemplate } from "./types";

export type OrgMemberApprovedVars = {
  memberName: string;
  organizationName: string;
  loginUrl: string;
  dashboardUrl: string;
};

const DEFAULT_COPY: TemplateCopy = {
  subject: "Love in Action Database Login Info for {memberName}",
  heading: "Lorem Ipsum Dolor Sit Amet",
  paragraphs: [
    "Dear {memberName},",
    "Lorem ipsum dolor sit amet, consectetur adipiscing elit {organizationName} sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.",
    "Ut enim ad minim veniam, quis nostrud exercitation ullamco {loginUrl} laboris nisi ut aliquip ex ea commodo consequat.",
    "Duis aute irure dolor in reprehenderit {dashboardUrl} in voluptate velit esse cillum dolore eu fugiat nulla pariatur.",
  ],
};

export const orgMemberApproved: ProductTemplate<OrgMemberApprovedVars> = {
  key: "org_member_approved",
  entityType: "org_membership",
  required: ["memberName", "organizationName", "loginUrl", "dashboardUrl"],
  trigger: "Staff approves a new member",
  recipients: "The approved member",
  recipientsConfigurable: false,
  defaultCopy: DEFAULT_COPY,
  sample: {
    memberName: "Maria Alvarez",
    organizationName: "Hope Community Center",
    loginUrl: "https://example.org/login",
    dashboardUrl: "https://example.org/dashboard",
  },
  render(vars, copy = DEFAULT_COPY) {
    const subject = fillText(copy.subject, vars);
    const html = shell(
      fillText(copy.heading, vars),
      [
        copyPara(copy.paragraphs[0] ?? "", vars),
        copyPara(copy.paragraphs[1] ?? "", vars),
        copyPara(copy.paragraphs[2] ?? "", vars),
        button("Lorem Ipsum", vars.loginUrl),
        copyPara(copy.paragraphs[3] ?? "", vars),
      ].join("\n"),
    );
    const text = textBody(
      copyText(copy.heading, vars),
      copyText(copy.paragraphs[0] ?? "", vars),
      copyText(copy.paragraphs[1] ?? "", vars),
      copyText(copy.paragraphs[2] ?? "", vars),
      textKv("Lorem Ipsum", vars.loginUrl),
      copyText(copy.paragraphs[3] ?? "", vars),
    );
    return { subject, html, text };
  },
};
