/** staff_new_item_request — item request submitted at MP-08/MP-09 (TEMPLATES.md §4). */
import {
  shell,
  sectionHeading,
  kv,
  button,
  textKv,
  textBody,
  fillText,
  copyPara,
  copyText,
  type TemplateCopy,
} from "../render";
import type { ProductTemplate } from "./types";

export type StaffNewItemRequestVars = {
  itemRequestName: string;
  organizationName: string;
  organizationPrimaryContact: string;
  organizationPrimaryContactEmail: string;
  adminUrl: string;
};

const DEFAULT_COPY: TemplateCopy = {
  subject: "Item Request Pending Approval: {itemRequestName}",
  heading: "Item Request Pending Approval",
  paragraphs: ["A new item request has been submitted. Here are the details for review & approval:"],
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
  trigger: "A member submits a new item request",
  recipients: "The staff notification addresses",
  recipientsConfigurable: true,
  defaultCopy: DEFAULT_COPY,
  sample: {
    itemRequestName: "Winter Coat Drive",
    organizationName: "Hope Community Center",
    organizationPrimaryContact: "Maria Alvarez",
    organizationPrimaryContactEmail: "maria@hopecommunity.example.org",
    adminUrl: "https://example.org/admin/item-requests",
  },
  render(vars, copy = DEFAULT_COPY) {
    const subject = fillText(copy.subject, vars);
    const html = shell(
      fillText(copy.heading, vars),
      [
        copyPara(copy.paragraphs[0] ?? "", vars),
        sectionHeading("Item Request Details"),
        kv("Request Name", vars.itemRequestName),
        kv("Organization", vars.organizationName),
        kv("Primary Contact", vars.organizationPrimaryContact),
        kv("Primary Contact's Email", vars.organizationPrimaryContactEmail),
        button("View/Approve Item Request", vars.adminUrl),
      ].join("\n"),
    );
    const text = textBody(
      copyText(copy.heading, vars),
      copyText(copy.paragraphs[0] ?? "", vars),
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
