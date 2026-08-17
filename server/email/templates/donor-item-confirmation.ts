/**
 * donor_item_confirmation — item pledge recorded at PB-02 (TEMPLATES.md §6).
 * Reply-to: the requesting organization's contact email. The org contact
 * details are required content — this email is the donor's only channel to
 * ask a question, change a quantity, or cancel. dropoffLocation and the
 * deadline-date line are omitted when absent, never rendered blank.
 */
import {
  shell,
  para,
  sectionHeading,
  kv,
  kvOpt,
  kvLink,
  itemsTable,
  escapeHtml,
  textKv,
  textKvOpt,
  textItemsTable,
  textBody,
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
  render(vars) {
    const subject = `Thank you for donating item(s) to ${vars.organizationName}`;
    const html = shell(
      "Thank You for Meeting a Need!",
      [
        para(`Hi ${escapeHtml(vars.donorName)},`),
        para(
          `Thank you so much for signing up to meet a need through ${escapeHtml(vars.organizationName)}! Please collect or purchase the item(s) within the <strong>next 2 weeks</strong> and reach out to ${escapeHtml(vars.requestContactName)} at (${escapeHtml(vars.requestContactEmail)}) to coordinate delivery. You are welcome to mail the item(s) or set up a time to drop off. If you have questions regarding this donation, please feel free to reach out directly to ${escapeHtml(vars.requestContactName)}.`,
        ),
        para(
          "By participating in The Alliance&#39;s <strong>Love in Action Program</strong>, you are making a difference for local kids and families!",
        ),
        para("Here are the details of the need you are meeting:"),
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
        para("Thank you,<br /><strong>The Alliance Love in Action Team</strong>"),
        para(
          "If you have any questions or you email the contact and do not hear back from them within 1 week, please email <strong>Christina Moe</strong>, our Love in Action Program Director, at christina@defendingthecause.org.",
        ),
      ]
        .filter(Boolean)
        .join("\n"),
    );
    const text = textBody(
      "Thank You for Meeting a Need!",
      `Hi ${vars.donorName},`,
      `Thank you so much for signing up to meet a need through ${vars.organizationName}! Please collect or purchase the item(s) within the next 2 weeks and reach out to ${vars.requestContactName} at (${vars.requestContactEmail}) to coordinate delivery. You are welcome to mail the item(s) or set up a time to drop off. If you have questions regarding this donation, please feel free to reach out directly to ${vars.requestContactName}.`,
      "By participating in The Alliance's Love in Action Program, you are making a difference for local kids and families!",
      "Here are the details of the need you are meeting:",
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
      ["Thank you,", "The Alliance Love in Action Team"],
      "If you have any questions or you email the contact and do not hear back from them within 1 week, please email Christina Moe, our Love in Action Program Director, at christina@defendingthecause.org.",
    );
    return { subject, html, text };
  },
};
