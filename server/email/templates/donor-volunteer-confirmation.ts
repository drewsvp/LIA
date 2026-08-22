/**
 * donor_volunteer_confirmation — volunteer signup recorded at PB-04
 * (TEMPLATES.md §6). followUpWindow = "1-3 business days" (D52), and the
 * captain's work order states the explicit window: within 1 to 3 business
 * days. Reply-to: the requesting organization's contact email.
 */
import {
  shell,
  sectionHeading,
  kv,
  kvOpt,
  kvLink,
  rolesList,
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

export type DonorVolunteerConfirmationVars = {
  donorName: string;
  organizationName: string;
  requestContactName: string;
  requestContactEmail: string;
  requestContactPhone: string | null;
  requestName: string;
  requestDescription: string | null;
  requestDeadlineType: string;
  requestDetails: string | null;
  requestUrl: string;
  roles: string[];
  followUpWindow: string;
};

const DEFAULT_COPY: TemplateCopy = {
  subject: "Thank you for expressing interest in volunteering!",
  heading: "Thank You for Expressing Interest!",
  paragraphs: [
    "Hi {donorName},",
    "Thank you so much for signing up to volunteer with {organizationName}! {requestContactName} from their team will be reaching out to you <strong>within {followUpWindow}</strong> with more details. If you have any questions or want to reach out directly, you can email them at ({requestContactEmail}).",
    "By participating in {orgName}'s {programName} Program, you are making a difference for local kids and families!",
    "Here are the details of this volunteer role:",
    "Thank you,<br /><strong>{signature}</strong>",
    "If you have any questions or do not hear from the {organizationName} contact within 1 week, please email <strong>{directorName}</strong>, our {directorTitle}, at {directorEmail}.",
  ],
};

export const donorVolunteerConfirmation: ProductTemplate<DonorVolunteerConfirmationVars> = {
  key: "donor_volunteer_confirmation",
  entityType: "volunteer_signup",
  required: [
    "donorName",
    "organizationName",
    "requestContactName",
    "requestContactEmail",
    "requestName",
    "requestDeadlineType",
    "requestUrl",
    "roles",
    "followUpWindow",
  ],
  trigger: "A volunteer signs up on a public request",
  recipients: "The volunteer who signed up",
  recipientsConfigurable: false,
  defaultCopy: DEFAULT_COPY,
  sample: {
    donorName: "Maria Alvarez",
    organizationName: "Hope Community Center",
    requestContactName: "Jordan Lee",
    requestContactEmail: "jordan.lee@example.org",
    requestContactPhone: "(213) 555-0187",
    requestName: "Saturday Food Pantry Support",
    requestDescription: "Volunteers to help sort and distribute groceries.",
    requestDeadlineType: "Ongoing",
    requestDetails: "Shifts run 9am–12pm; please wear closed-toe shoes.",
    requestUrl: "https://example.org/requests/food-pantry-support",
    roles: ["Greeter", "Sorter"],
    followUpWindow: "1-3 business days",
  },
  render(vars, copy = DEFAULT_COPY) {
    const subject = fillText(copy.subject, vars);
    const html = shell(
      fillText(copy.heading, vars),
      [
        copyPara(copy.paragraphs[0] ?? "", vars),
        copyPara(copy.paragraphs[1] ?? "", vars),
        copyPara(copy.paragraphs[2] ?? "", vars),
        copyPara(copy.paragraphs[3] ?? "", vars),
        sectionHeading(`${vars.organizationName} Contact`),
        kv("Name", vars.requestContactName),
        kv("Email", vars.requestContactEmail),
        kvOpt("Phone #", vars.requestContactPhone),
        sectionHeading("Request Details"),
        kv("Name", vars.requestName),
        kvOpt("Description", vars.requestDescription),
        kv("Volunteer Type", vars.requestDeadlineType),
        kvOpt("Details", vars.requestDetails),
        kvLink("Website Link", vars.requestUrl),
        sectionHeading("Role Details"),
        rolesList(vars.roles),
        copyPara(copy.paragraphs[4] ?? "", vars),
        copyPara(copy.paragraphs[5] ?? "", vars),
      ]
        .filter(Boolean)
        .join("\n"),
    );
    const text = textBody(
      copyText(copy.heading, vars),
      copyText(copy.paragraphs[0] ?? "", vars),
      copyText(copy.paragraphs[1] ?? "", vars),
      copyText(copy.paragraphs[2] ?? "", vars),
      copyText(copy.paragraphs[3] ?? "", vars),
      [
        `${vars.organizationName} Contact`,
        textKv("Name", vars.requestContactName),
        textKv("Email", vars.requestContactEmail),
        ...textKvOpt("Phone #", vars.requestContactPhone),
      ],
      [
        "Request Details",
        textKv("Name", vars.requestName),
        ...textKvOpt("Description", vars.requestDescription),
        textKv("Volunteer Type", vars.requestDeadlineType),
        ...textKvOpt("Details", vars.requestDetails),
        textKv("Website Link", vars.requestUrl),
      ],
      ["Role Details", ...textRolesList(vars.roles)],
      copyText(copy.paragraphs[4] ?? "", vars),
      copyText(copy.paragraphs[5] ?? "", vars),
    );
    return { subject, html, text };
  },
};
