/**
 * org_new_item_donation — item pledge recorded at PB-02 (TEMPLATES.md §5).
 * Reply-to is the donor's email. Items render as a table, Item | Number
 * Donated (D51), reading item_pledge_lines — never the on-screen string.
 */
import {
  shell,
  para,
  sectionHeading,
  kv,
  kvOpt,
  kvLink,
  itemsTable,
  button,
  escapeHtml,
  textKv,
  textKvOpt,
  textItemsTable,
  textBody,
} from "../render";
import type { ProductTemplate, ItemLine } from "./types";

export type OrgNewItemDonationVars = {
  organizationName: string;
  requestName: string;
  requestDescription: string | null;
  requestUrl: string;
  items: ItemLine[];
  donorName: string;
  donorEmail: string;
  donorPhone: string | null;
  supportersUrl: string;
};

export const orgNewItemDonation: ProductTemplate<OrgNewItemDonationVars> = {
  key: "org_new_item_donation",
  entityType: "item_pledge",
  required: ["organizationName", "requestName", "requestUrl", "items", "donorName", "donorEmail", "supportersUrl"],
  render(vars) {
    const subject = `Item(s) have been donated for ${vars.requestName}`;
    const html = shell(
      "New Item(s) Have Been Donated!",
      [
        para(`Hi ${escapeHtml(vars.organizationName)},`),
        para(
          "Congratulations, someone is interested in donating items to your organization! Their details and which item(s) they&#39;ve claimed are included below. This donor has been instructed to reach out to you in the <strong>next 2 weeks</strong> to set up delivery of the item(s) but you may also contact them directly.",
        ),
        sectionHeading("Request Details"),
        kv("Name", vars.requestName),
        kvOpt("Description", vars.requestDescription),
        kvLink("Request Link", vars.requestUrl),
        sectionHeading("Item(s) Donated"),
        itemsTable(vars.items, "Number Donated"),
        sectionHeading("Donor Information"),
        kv("Name", vars.donorName),
        kv("Email", vars.donorEmail),
        kvOpt("Phone", vars.donorPhone),
        para("Thank you,<br /><strong>The Alliance Love in Action Team</strong>"),
        button("View Donors", vars.supportersUrl),
      ]
        .filter(Boolean)
        .join("\n"),
    );
    const text = textBody(
      "New Item(s) Have Been Donated!",
      `Hi ${vars.organizationName},`,
      "Congratulations, someone is interested in donating items to your organization! Their details and which item(s) they've claimed are included below. This donor has been instructed to reach out to you in the next 2 weeks to set up delivery of the item(s) but you may also contact them directly.",
      [
        "Request Details",
        textKv("Name", vars.requestName),
        ...textKvOpt("Description", vars.requestDescription),
        textKv("Request Link", vars.requestUrl),
      ],
      ["Item(s) Donated", ...textItemsTable(vars.items, "Number Donated")],
      [
        "Donor Information",
        textKv("Name", vars.donorName),
        textKv("Email", vars.donorEmail),
        ...textKvOpt("Phone", vars.donorPhone),
      ],
      ["Thank you,", "The Alliance Love in Action Team"],
      textKv("View Donors", vars.supportersUrl),
    );
    return { subject, html, text };
  },
};
