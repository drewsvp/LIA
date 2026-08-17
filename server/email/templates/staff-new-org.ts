/** staff_new_org — organization submitted at MP-03 (docs/email/TEMPLATES.md §4). */
import { shell, para, sectionHeading, kv, kvOpt, button, textKv, textKvOpt, textBody } from "../render";
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

export const staffNewOrg: ProductTemplate<StaffNewOrgVars> = {
  key: "staff_new_org",
  entityType: "organization",
  required: ["organizationName", "primaryContactName", "primaryContactEmail", "adminUrl"],
  render(vars) {
    const subject = `Organization Pending Approval: ${vars.organizationName}`;
    const html = shell(
      "New Organization Pending Approval",
      [
        para("The following organization has requested approval to use the Love in Action Database:"),
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
        .join("\n"),
    );
    const text = textBody(
      "New Organization Pending Approval",
      "The following organization has requested approval to use the Love in Action Database:",
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
