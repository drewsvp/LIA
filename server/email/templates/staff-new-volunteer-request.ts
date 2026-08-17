/** staff_new_volunteer_request — volunteer request submitted at MP-11/MP-12 (TEMPLATES.md §4). */
import { shell, para, sectionHeading, kv, button, textKv, textBody } from "../render";
import type { ProductTemplate } from "./types";

export type StaffNewVolunteerRequestVars = {
  volunteerRequestName: string;
  organizationName: string;
  organizationPrimaryContact: string;
  organizationPrimaryContactEmail: string;
  adminUrl: string;
};

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
  render(vars) {
    const subject = `Volunteer Request Pending Approval: ${vars.volunteerRequestName}`;
    const html = shell(
      "Volunteer Request Pending Approval",
      [
        para("A new volunteer opportunity has been submitted. Here are the details for review &amp; approval:"),
        sectionHeading("Volunteer Request Details"),
        kv("Volunteer Request", vars.volunteerRequestName),
        kv("Organization", vars.organizationName),
        kv("Primary Contact", vars.organizationPrimaryContact),
        kv("Primary Contact's Email", vars.organizationPrimaryContactEmail),
        button("View/Approve Volunteer Request", vars.adminUrl),
      ].join("\n"),
    );
    const text = textBody(
      "Volunteer Request Pending Approval",
      "A new volunteer opportunity has been submitted. Here are the details for review & approval:",
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
