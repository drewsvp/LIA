/**
 * donor_volunteer_confirmation — volunteer signup recorded at PB-04
 * (TEMPLATES.md §6). followUpWindow = "1-3 business days" (D52), and the
 * captain's work order states the explicit window: within 1 to 3 business
 * days. Reply-to: the requesting organization's contact email.
 */
import {
  shell,
  para,
  sectionHeading,
  kv,
  kvOpt,
  kvLink,
  rolesList,
  escapeHtml,
  textKv,
  textKvOpt,
  textRolesList,
  textBody,
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
  render(vars) {
    const subject = "Thank you for expressing interest in volunteering!";
    const html = shell(
      "Thank You for Expressing Interest!",
      [
        para(`Hi ${escapeHtml(vars.donorName)},`),
        para(
          `Thank you so much for signing up to volunteer with ${escapeHtml(vars.organizationName)}! ${escapeHtml(vars.requestContactName)} from their team will be reaching out to you <strong>within ${escapeHtml(vars.followUpWindow)}</strong> with more details. If you have any questions or want to reach out directly, you can email them at (${escapeHtml(vars.requestContactEmail)}).`,
        ),
        para(
          "By participating in The Alliance&#39;s Love in Action Program, you are making a difference for local kids and families!",
        ),
        para("Here are the details of this volunteer role:"),
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
        para("Thank you,<br /><strong>The Alliance Love in Action Team</strong>"),
        para(
          `If you have any questions or do not hear from the ${escapeHtml(vars.organizationName)} contact within 1 week, please email <strong>Christina Moe</strong>, our Love in Action Program Director, at christina@defendingthecause.org.`,
        ),
      ]
        .filter(Boolean)
        .join("\n"),
    );
    const text = textBody(
      "Thank You for Expressing Interest!",
      `Hi ${vars.donorName},`,
      `Thank you so much for signing up to volunteer with ${vars.organizationName}! ${vars.requestContactName} from their team will be reaching out to you within ${vars.followUpWindow} with more details. If you have any questions or want to reach out directly, you can email them at (${vars.requestContactEmail}).`,
      "By participating in The Alliance's Love in Action Program, you are making a difference for local kids and families!",
      "Here are the details of this volunteer role:",
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
      ["Thank you,", "The Alliance Love in Action Team"],
      `If you have any questions or do not hear from the ${vars.organizationName} contact within 1 week, please email Christina Moe, our Love in Action Program Director, at christina@defendingthecause.org.`,
    );
    return { subject, html, text };
  },
};
