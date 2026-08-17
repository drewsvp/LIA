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
import { shell, para, button, escapeHtml, link, textKv, textBody } from "../render";
import type { ProductTemplate } from "./types";

export type OrgMemberApprovedVars = {
  memberName: string;
  organizationName: string;
  loginUrl: string;
  dashboardUrl: string;
};

export const orgMemberApproved: ProductTemplate<OrgMemberApprovedVars> = {
  key: "org_member_approved",
  entityType: "org_membership",
  required: ["memberName", "organizationName", "loginUrl", "dashboardUrl"],
  render(vars) {
    const subject = `Love in Action Database Login Info for ${vars.memberName}`;
    const html = shell(
      "Lorem Ipsum Dolor Sit Amet",
      [
        para(`Dear ${escapeHtml(vars.memberName)},`),
        para(
          `Lorem ipsum dolor sit amet, consectetur adipiscing elit ${escapeHtml(vars.organizationName)} sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.`,
        ),
        para(
          `Ut enim ad minim veniam, quis nostrud exercitation ullamco ${link(vars.loginUrl)} laboris nisi ut aliquip ex ea commodo consequat.`,
        ),
        button("Lorem Ipsum", vars.loginUrl),
        para(
          `Duis aute irure dolor in reprehenderit ${link(vars.dashboardUrl)} in voluptate velit esse cillum dolore eu fugiat nulla pariatur.`,
        ),
      ].join("\n"),
    );
    const text = textBody(
      "LOREM IPSUM DOLOR SIT AMET",
      `Dear ${vars.memberName},`,
      `Lorem ipsum dolor sit amet, consectetur adipiscing elit ${vars.organizationName} sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.`,
      `Ut enim ad minim veniam, quis nostrud exercitation ullamco ${vars.loginUrl} laboris nisi ut aliquip ex ea commodo consequat.`,
      textKv("Lorem Ipsum", vars.loginUrl),
      `Duis aute irure dolor in reprehenderit ${vars.dashboardUrl} in voluptate velit esse cillum dolore eu fugiat nulla pariatur.`,
    );
    return { subject, html, text };
  },
};
