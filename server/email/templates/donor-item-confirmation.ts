/**
 * donor_item_confirmation — item pledge recorded at PB-02 (TEMPLATES.md §6).
 * Reply-to: the requesting organization's contact email. The org contact
 * details are required content — this email is the donor's only channel to
 * ask a question, change a quantity, or cancel. dropoffLocation and the
 * deadline-date line are omitted when absent, never rendered blank.
 */
import {
  shell,
  sectionHeading,
  kv,
  kvOpt,
  kvLink,
  itemsTable,
  textKv,
  textKvOpt,
  textItemsTable,
  textBody,
  fillText,
  copyPara,
  copyText,
  type TemplateCopy,
} from "../render";
import type { ProductTemplate, ItemLine } from "./types";

export type DonorItemConfirmationVars = {
  donorName: string;
  organizationName: string;
  requestContactName: string;
  requestContactEmail: string;
  requestContactPhone: string | null;
  requestName: string;
  requestDescription: string | null;
  requestDeadlineType: string;
  requestDeadlineDate: string | null; // only for date_specific; line omitted otherwise
  dropoffLocation: string | null;
  requestUrl: string;
  items: ItemLine[];
};

const DEFAULT_COPY: TemplateCopy = {
  subject: "Thank you for donating item(s) to {organizationName}",
  heading: "Thank You for Meeting a Need!",
  paragraphs: [
    "Hi {donorName},",
    "Thank you so much for signing up to meet a need through {organizationName}! Please collect or purchase the item(s) within the <strong>next 2 weeks</strong> and reach out to {requestContactName} at ({requestContactEmail}) to coordinate delivery. You are welcome to mail the item(s) or set up a time to drop off. If you have questions regarding this donation, please feel free to reach out directly to {requestContactName}.",
    "By participating in {orgName}'s <strong>{programName} Program</strong>, you are making a difference for local kids and families!",
    "Here are the details of the need you are meeting:",
    "Thank you,<br /><strong>{signature}</strong>",
    "If you have any questions or you email the contact and do not hear back from them within 1 week, please email <strong>{directorName}</strong>, our {directorTitle}, at {directorEmail}.",
  ],
};

export const donorItemConfirmation: ProductTemplate<DonorItemConfirmationVars> = {
  key: "donor_item_confirmation",
  entityType: "item_pledge",
  required: [
    "donorName",
    "organizationName",
    "requestContactName",
    "requestContactEmail",
    "requestName",
    "requestDeadlineType",
    "requestUrl",
    "items",
  ],
  trigger: "A donor pledges items on a public request",
  recipients: "The donor who pledged",
  recipientsConfigurable: false,
  defaultCopy: DEFAULT_COPY,
  sample: {
    donorName: "Jordan Lee",
    organizationName: "Hope Community Center",
    requestContactName: "Maria Alvarez",
    requestContactEmail: "maria.alvarez@example.org",
    requestContactPhone: "(213) 555-0164",
    requestName: "Winter Warmth Drive",
    requestDescription: "Warm supplies for families ahead of the cold season.",
    requestDeadlineType: "Date Specific",
    requestDeadlineDate: "December 15, 2025",
    dropoffLocation: "123 Main St, Los Angeles, CA 90012",
    requestUrl: "https://example.org/requests/winter-warmth-drive",
    items: [
      { name: "Blankets", quantity: 3 },
      { name: "Socks", quantity: 10 },
    ],
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
        sectionHeading("Contact"),
        kv("Name", vars.requestContactName),
        kv("Email", vars.requestContactEmail),
        kvOpt("Phone #", vars.requestContactPhone),
        sectionHeading("Request Details"),
        kv("Name", vars.requestName),
        kvOpt("Description", vars.requestDescription),
        kv("Deadline Type", vars.requestDeadlineType),
        kvOpt("Deadline Date", vars.requestDeadlineDate),
        kvOpt("Dropoff Location", vars.dropoffLocation),
        kvLink("Website Link", vars.requestUrl),
        sectionHeading("Item(s) Donated"),
        itemsTable(vars.items, "Number Donated"),
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
        "Contact",
        textKv("Name", vars.requestContactName),
        textKv("Email", vars.requestContactEmail),
        ...textKvOpt("Phone #", vars.requestContactPhone),
      ],
      [
        "Request Details",
        textKv("Name", vars.requestName),
        ...textKvOpt("Description", vars.requestDescription),
        textKv("Deadline Type", vars.requestDeadlineType),
        ...textKvOpt("Deadline Date", vars.requestDeadlineDate),
        ...textKvOpt("Dropoff Location", vars.dropoffLocation),
        textKv("Website Link", vars.requestUrl),
      ],
      ["Item(s) Donated", ...textItemsTable(vars.items, "Number Donated")],
      copyText(copy.paragraphs[4] ?? "", vars),
      copyText(copy.paragraphs[5] ?? "", vars),
    );
    return { subject, html, text };
  },
};
