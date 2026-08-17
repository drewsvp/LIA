/**
 * org_request_received — request submitted at MP-08 or MP-11 (TEMPLATES.md §5).
 * itemOrVolunteer resolves to exactly "Item" or "Volunteer" (captain's work
 * order, Aug 17 2026 — capture closed), in the subject and the details heading.
 */
import {
  shell,
  para,
  sectionHeading,
  kv,
  kvOpt,
  itemsTable,
  rolesList,
  escapeHtml,
  textKv,
  textKvOpt,
  textItemsTable,
  textRolesList,
  textBody,
} from "../render";
import type { ProductTemplate, ItemLine } from "./types";

export type RequestChildren =
  | { kind: "item"; rows: ItemLine[] }
  | { kind: "volunteer"; rows: ItemLine[] };

export type OrgRequestReceivedVars = {
  itemOrVolunteer: string; // "Item" | "Volunteer", exactly
  organizationName: string;
  requestName: string;
  requestDescription: string | null;
  requestContactName: string;
  requestContactEmail: string;
  requestContactPhone: string | null;
  requestId: string;
  itemsOrRoles: RequestChildren;
};

export function childrenHtml(children: RequestChildren): string {
  if (children.kind === "item") return itemsTable(children.rows, "Quantity");
  return rolesList(children.rows.map((r) => `${r.name} — ${r.quantity} needed`));
}

export function childrenText(children: RequestChildren): string[] {
  if (children.kind === "item") return textItemsTable(children.rows, "Quantity");
  return textRolesList(children.rows.map((r) => `${r.name} — ${r.quantity} needed`));
}

export const orgRequestReceived: ProductTemplate<OrgRequestReceivedVars> = {
  key: "org_request_received",
  // entityType is set per queue call: "item_request" or "volunteer_request".
  entityType: "item_request",
  required: [
    "itemOrVolunteer",
    "organizationName",
    "requestName",
    "requestContactName",
    "requestContactEmail",
    "requestId",
    "itemsOrRoles",
  ],
  render(vars) {
    const subject = `${vars.itemOrVolunteer} Request Pending Approval: ${vars.requestName}`;
    const html = shell(
      "Request Pending Approval",
      [
        para(`Hi ${escapeHtml(vars.organizationName)},`),
        para(
          "Thank you for submitting the following request through The Alliance&#39;s Love in Action Database. Our team will create a custom graphic with your logo and publish your need within 1–2 business days. Once your post goes live, you will receive a confirmation email with the information so you can share this need to your own community and social media platforms.",
        ),
        sectionHeading("Request Details"),
        kv("Name", vars.requestName),
        kvOpt("Description", vars.requestDescription),
        `      <div style="height:16px;"></div>`,
        kv("Request Contact", vars.requestContactName),
        kv("Contact's Email", vars.requestContactEmail),
        kvOpt("Contact's Phone", vars.requestContactPhone),
        kv("Unique ID", vars.requestId),
        sectionHeading(`${vars.itemOrVolunteer}s Details`),
        childrenHtml(vars.itemsOrRoles),
      ]
        .filter(Boolean)
        .join("\n"),
    );
    const text = textBody(
      "Request Pending Approval",
      `Hi ${vars.organizationName},`,
      "Thank you for submitting the following request through The Alliance's Love in Action Database. Our team will create a custom graphic with your logo and publish your need within 1–2 business days. Once your post goes live, you will receive a confirmation email with the information so you can share this need to your own community and social media platforms.",
      [
        "Request Details",
        textKv("Name", vars.requestName),
        ...textKvOpt("Description", vars.requestDescription),
      ],
      [
        textKv("Request Contact", vars.requestContactName),
        textKv("Contact's Email", vars.requestContactEmail),
        ...textKvOpt("Contact's Phone", vars.requestContactPhone),
        textKv("Unique ID", vars.requestId),
      ],
      [`${vars.itemOrVolunteer}s Details`, ...childrenText(vars.itemsOrRoles)],
    );
    return { subject, html, text };
  },
};
