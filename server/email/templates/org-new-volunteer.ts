/**
 * org_new_volunteer — volunteer signup recorded at PB-04 (TEMPLATES.md §5).
 * Recipients: the request's contact person AND both staff addresses (D53).
 * donorNotes is shown in full, never truncated.
 */
import {
  shell,
  sectionHeading,
  kv,
  kvOpt,
  kvLink,
  rolesList,
  button,
  textKv,
  textKvOpt,
  textRolesList,
  textBody,
  fillText,
  copyPara,
  copyText,
  type TemplateCopy,
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

const DEFAULT_COPY: TemplateCopy = {
  subject: "A Volunteer has Expressed Interest in Serving",
  heading: "A New Volunteer Has Expressed Interest!",
  paragraphs: [
    "Hi {organizationName},",
    "Congratulations, someone is interested in volunteering with your organization! Their details and which role(s) they are interested in are included below. Please reach out to this person in the <strong>next 1–3 business days</strong> to confirm the requirements for this volunteer opportunity and provide any additional details they need for participating.",
    "Thank you,<br /><strong>{signature}</strong>",
  ],
};

export const orgNewVolunteer: ProductTemplate<OrgNewVolunteerVars> = {
  key: "org_new_volunteer",
  entityType: "volunteer_signup",
  required: ["organizationName", "requestName", "requestUrl", "roles", "donorName", "donorEmail", "supportersUrl"],
  trigger: "A volunteer signs up on a public request",
  recipients: "The request's contact person, plus the staff notification addresses",
  recipientsConfigurable: false,
  defaultCopy: DEFAULT_COPY,
  sample: {
    organizationName: "Hope Community Center",
    requestName: "Saturday Food Pantry Support",
    requestDescription: "Volunteers to help sort and distribute groceries.",
    requestDetails: "Shifts run 9am–12pm; please wear closed-toe shoes.",
    requestUrl: "https://example.org/requests/food-pantry-support",
    roles: ["Greeter", "Sorter"],
    donorName: "Maria Alvarez",
    donorEmail: "maria.alvarez@example.org",
    donorPhone: "(213) 555-0164",
    donorNotes: "Available on alternating Saturdays.",
    supportersUrl: "https://example.org/admin/supporters",
  },
  render(vars, copy = DEFAULT_COPY) {
    const subject = fillText(copy.subject, vars);
    const html = shell(
      fillText(copy.heading, vars),
      [
        copyPara(copy.paragraphs[0] ?? "", vars),
        copyPara(copy.paragraphs[1] ?? "", vars),
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
        copyPara(copy.paragraphs[2] ?? "", vars),
        button("View Volunteers", vars.supportersUrl),
      ]
        .filter(Boolean)
        .join("\n"),
    );
    const text = textBody(
      copyText(copy.heading, vars),
      copyText(copy.paragraphs[0] ?? "", vars),
      copyText(copy.paragraphs[1] ?? "", vars),
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
      copyText(copy.paragraphs[2] ?? "", vars),
      textKv("View Volunteers", vars.supportersUrl),
    );
    return { subject, html, text };
  },
};
