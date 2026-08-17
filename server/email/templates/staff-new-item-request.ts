/** staff_new_item_request — item request submitted at MP-08/MP-09 (TEMPLATES.md §4). */
import { shell, para, sectionHeading, kv, button, textKv, textBody } from "../render";
import type { ProductTemplate } from "./types";

export type StaffNewItemRequestVars = {
  itemRequestName: string;
  organizationName: string;
  organizationPrimaryContact: string;
  organizationPrimaryContactEmail: string;
  adminUrl: string;
};

export const staffNewItemRequest: ProductTemplate<StaffNewItemRequestVars> = {
  key: "staff_new_item_request",
  entityType: "item_request",
  required: [
    "itemRequestName",
    "organizationName",
    "organizationPrimaryContact",
    "organizationPrimaryContactEmail",
    "adminUrl",
  ],
  render(vars) {
    const subject = `Item Request Pending Approval: ${vars.itemRequestName}`;
    const html = shell(
      "Item Request Pending Approval",
      [
        para("A new item request has been submitted. Here are the details for review &amp; approval:"),
        sectionHeading("Item Request Details"),
        kv("Request Name", vars.itemRequestName),
        kv("Organization", vars.organizationName),
        kv("Primary Contact", vars.organizationPrimaryContact),
        kv("Primary Contact's Email", vars.organizationPrimaryContactEmail),
        button("View/Approve Item Request", vars.adminUrl),
      ].join("\n"),
    );
    const text = textBody(
      "Item Request Pending Approval",
      "A new item request has been submitted. Here are the details for review & approval:",
      [
        "Item Request Details",
        textKv("Request Name", vars.itemRequestName),
        textKv("Organization", vars.organizationName),
        textKv("Primary Contact", vars.organizationPrimaryContact),
        textKv("Primary Contact's Email", vars.organizationPrimaryContactEmail),
      ],
      textKv("View/Approve Item Request", vars.adminUrl),
    );
    return { subject, html, text };
  },
};
