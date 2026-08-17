/** staff_new_user — member invited at MP-06 (TEMPLATES.md §4). */
import { shell, para, sectionHeading, kv, kvOpt, button, textKv, textKvOpt, textBody } from "../render";
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

export const staffNewUser: ProductTemplate<StaffNewUserVars> = {
  key: "staff_new_user",
  entityType: "org_membership",
  required: ["memberName", "memberEmail", "organizationName", "submitterName", "submitterEmail", "adminUrl"],
  render(vars) {
    const subject = `New Member Pending Approval: ${vars.memberName}`;
    const html = shell(
      "New Database User Pending Approval",
      [
        para(
          "An Alliance Member has requested a new teammate be given access to the Love in Action Database. Here is their information:",
        ),
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
        .join("\n"),
    );
    const text = textBody(
      "New Database User Pending Approval",
      "An Alliance Member has requested a new teammate be given access to the Love in Action Database. Here is their information:",
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
