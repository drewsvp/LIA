/**
 * org_new_volunteer — volunteer signup recorded at PB-04 (TEMPLATES.md §5).
 * Recipients: the request's contact person AND both staff addresses (D53).
 * donorNotes is shown in full, never truncated.
 */
import {
  shell,
  para,
  sectionHeading,
  kv,
  kvOpt,
  kvLink,
  rolesList,
  button,
  escapeHtml,
  textKv,
  textKvOpt,
  textRolesList,
  textBody,
} from "../render";
import type { ProductTemplate } from "./types";

export type OrgNewVolunteerVars = {
  organizationName: string;
  requestName: string;
  requestDescription: string | null;
  requestDetails: string | null;
  requestUrl: string;
  roles: string[];
  donorName: string;
  donorEmail: string;
  donorPhone: string | null;
  donorNotes: string | null;
  supportersUrl: string;
};

export const orgNewVolunteer: ProductTemplate<OrgNewVolunteerVars> = {
  key: "org_new_volunteer",
  entityType: "volunteer_signup",
  required: ["organizationName", "requestName", "requestUrl", "roles", "donorName", "donorEmail", "supportersUrl"],
  render(vars) {
    const subject = "A Volunteer has Expressed Interest in Serving";
    const html = shell(
      "A New Volunteer Has Expressed Interest!",
      [
        para(`Hi ${escapeHtml(vars.organizationName)},`),
        para(
          "Congratulations, someone is interested in volunteering with your organization! Their details and which role(s) they are interested in are included below. Please reach out to this person in the <strong>next 1–3 business days</strong> to confirm the requirements for this volunteer opportunity and provide any additional details they need for participating.",
        ),
        sectionHeading("Request Details"),
        kv("Name", vars.requestName),
        kvOpt("Description", vars.requestDescription),
        kvOpt("Details", vars.requestDetails),
        kvLink("Request Link", vars.requestUrl),
        sectionHeading("Role Details"),
        rolesList(vars.roles),
        sectionHeading("Volunteer Information"),
        kv("Name", vars.donorName),
        kv("Email", vars.donorEmail),
        kvOpt("Phone", vars.donorPhone),
        kvOpt("Notes", vars.donorNotes),
        para("Thank you,<br /><strong>The Alliance Love in Action Team</strong>"),
        button("View Volunteers", vars.supportersUrl),
      ]
        .filter(Boolean)
        .join("\n"),
    );
    const text = textBody(
      "A New Volunteer Has Expressed Interest!",
      `Hi ${vars.organizationName},`,
      "Congratulations, someone is interested in volunteering with your organization! Their details and which role(s) they are interested in are included below. Please reach out to this person in the next 1–3 business days to confirm the requirements for this volunteer opportunity and provide any additional details they need for participating.",
      [
        "Request Details",
        textKv("Name", vars.requestName),
        ...textKvOpt("Description", vars.requestDescription),
        ...textKvOpt("Details", vars.requestDetails),
        textKv("Request Link", vars.requestUrl),
      ],
      ["Role Details", ...textRolesList(vars.roles)],
      [
        "Volunteer Information",
        textKv("Name", vars.donorName),
        textKv("Email", vars.donorEmail),
        ...textKvOpt("Phone", vars.donorPhone),
        ...textKvOpt("Notes", vars.donorNotes),
      ],
      ["Thank you,", "The Alliance Love in Action Team"],
      textKv("View Volunteers", vars.supportersUrl),
    );
    return { subject, html, text };
  },
};
