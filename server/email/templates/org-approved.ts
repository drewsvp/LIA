/**
 * org_approved — organization approved at ADMIN-01 (TEMPLATES.md §5).
 * Highest-consequence email in the system. No logo block (D50).
 * The christina@defendingthecause.org line is captured body copy, not a
 * configured recipient — it stays verbatim.
 */
import { shell, para, sectionHeading, kv, kvOpt, button, escapeHtml, textKv, textKvOpt, textBody } from "../render";
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

export const orgApproved: ProductTemplate<OrgApprovedVars> = {
  key: "org_approved",
  entityType: "organization",
  required: ["organizationName", "organizationPrimaryContact", "organizationPrimaryContactEmail", "dashboardUrl"],
  render(vars) {
    const subject = `Welcome to the Love in Action Database ${vars.organizationName}`;
    const html = shell(
      "Your Organization Has Been Approved!",
      [
        para(`Hi ${escapeHtml(vars.organizationName)},`),
        para(
          "You&#39;ve been approved to start using The Alliance&#39;s Love in Action Database! We can&#39;t wait to help get your donation needs and volunteer opportunities met by community members.",
        ),
        para(
          "Within the next few minutes you will be receiving a second email with instructions on how to log in to your new dashboard.",
        ),
        para("Please review the information in your organization&#39;s profile below and save this email for your records."),
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
        para(
          "If you have questions about using any of the features of this database, please email <strong>Christina Moe</strong>, our Love in Action Program Director, at christina@defendingthecause.org.",
        ),
      ]
        .filter(Boolean)
        .join("\n"),
    );
    const text = textBody(
      "Your Organization Has Been Approved!",
      `Hi ${vars.organizationName},`,
      "You've been approved to start using The Alliance's Love in Action Database! We can't wait to help get your donation needs and volunteer opportunities met by community members.",
      "Within the next few minutes you will be receiving a second email with instructions on how to log in to your new dashboard.",
      "Please review the information in your organization's profile below and save this email for your records.",
      textKv("Go to Your Dashboard", vars.dashboardUrl),
      [
        "Organization Details",
        textKv("Name", vars.organizationName),
        ...textKvOpt("Address", vars.orgAddress),
        ...textKvOpt("Phone", vars.orgPhoneNumber),
        ...textKvOpt("Website", vars.websiteUrl),
        ...textKvOpt("Mission Statement", vars.missionStatement),
        ...textKvOpt("Population Served", vars.primaryPopulationServed),
      ],
      [
        textKv("Primary Contact", vars.organizationPrimaryContact),
        textKv("Primary Contact's Email", vars.organizationPrimaryContactEmail),
        ...textKvOpt("Primary Contact's Phone #", vars.organizationPrimaryContactPhone),
      ],
      "If you have questions about using any of the features of this database, please email Christina Moe, our Love in Action Program Director, at christina@defendingthecause.org.",
    );
    return { subject, html, text };
  },
};
