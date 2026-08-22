/**
 * supporter_volunteer_match — one immediate alert when a newly approved
 * volunteer opportunity intersects an opted-in supporter's active interests.
 */
import {
  shell,
  para,
  sectionHeading,
  rolesList,
  button,
  textBody,
  textRolesList,
  fillText,
  copyPara,
  copyText,
  escapeHtml,
  getBrand,
  type TemplateCopy,
} from "../render";
import type { ProductTemplate } from "./types";

export type SupporterVolunteerMatchVars = {
  supporterFirstName: string;
  opportunityName: string;
  organizationName: string;
  matchingCategories: string[];
  opportunityUrl: string;
  unsubscribeUrl: string;
};

const DEFAULT_COPY: TemplateCopy = {
  subject: "A volunteer opportunity matches your interests: {opportunityName}",
  heading: "A Volunteer Opportunity for You",
  paragraphs: [
    "Hi {supporterFirstName},",
    "{organizationName} just posted a volunteer opportunity that matches the interests you saved with {programName}.",
    "Thank you,<br /><strong>{signature}</strong>",
  ],
};

export const supporterVolunteerMatch: ProductTemplate<SupporterVolunteerMatchVars> = {
  key: "supporter_volunteer_match",
  entityType: "volunteer_request",
  required: [
    "supporterFirstName",
    "opportunityName",
    "organizationName",
    "matchingCategories",
    "opportunityUrl",
    "unsubscribeUrl",
  ],
  trigger: "A categorized volunteer opportunity is approved for the first time",
  recipients: "Opted-in active supporter profiles with at least one matching active volunteer interest",
  recipientsConfigurable: false,
  defaultCopy: DEFAULT_COPY,
  sample: {
    supporterFirstName: "Maria",
    opportunityName: "Saturday Food Pantry Support",
    organizationName: "Hope Community Center",
    matchingCategories: ["Food service", "Hands-on service"],
    opportunityUrl: "https://example.org/volunteer/00000000-0000-0000-0000-000000000001",
    unsubscribeUrl: "https://example.org/volunteer-alerts/unsubscribe/00000000-0000-0000-0000-000000000002",
  },
  render(vars, copy = DEFAULT_COPY) {
    const subject = fillText(copy.subject, vars);
    const color = getBrand().primaryColor;
    const html = shell(
      fillText(copy.heading, vars),
      [
        copyPara(copy.paragraphs[0] ?? "", vars),
        copyPara(copy.paragraphs[1] ?? "", vars),
        sectionHeading(vars.opportunityName),
        para(`<strong>Organization:</strong> ${escapeHtml(vars.organizationName)}`),
        sectionHeading(vars.matchingCategories.length === 1 ? "Matching Interest" : "Matching Interests"),
        rolesList(vars.matchingCategories),
        button("Review This Volunteer Opportunity", vars.opportunityUrl),
        copyPara(copy.paragraphs[2] ?? "", vars),
        para(
          `<span style="font-size:13px;">You are receiving this because you turned on matching volunteer alerts. ` +
            `<a href="${escapeHtml(vars.unsubscribeUrl)}" style="color:${color};text-decoration:underline;">Stop these alerts</a></span>`,
        ),
      ]
        .filter(Boolean)
        .join("\n"),
    );
    const text = textBody(
      copyText(copy.heading, vars),
      copyText(copy.paragraphs[0] ?? "", vars),
      copyText(copy.paragraphs[1] ?? "", vars),
      [
        vars.opportunityName,
        `Organization: ${vars.organizationName}`,
        vars.matchingCategories.length === 1 ? "Matching Interest" : "Matching Interests",
        ...textRolesList(vars.matchingCategories),
        `Review this volunteer opportunity: ${vars.opportunityUrl}`,
      ],
      copyText(copy.paragraphs[2] ?? "", vars),
      [
        "You are receiving this because you turned on matching volunteer alerts.",
        `Stop these alerts: ${vars.unsubscribeUrl}`,
      ],
    );
    return { subject, html, text };
  },
};
