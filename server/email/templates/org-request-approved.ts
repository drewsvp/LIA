/**
 * org_request_approved — request approved at ADMIN-02 (TEMPLATES.md §5).
 * Two recipients (primary contact + creator), one email each; the dedup
 * index collapses them to one when they are the same address.
 */
import {
  shell,
  para,
  sectionHeading,
  kv,
  kvOpt,
  kvLink,
  button,
  escapeHtml,
  textKv,
  textKvOpt,
  textBody,
} from "../render";
import type { ProductTemplate } from "./types";
import { childrenHtml, childrenText, type RequestChildren } from "./org-request-received";

export type OrgRequestApprovedVars = {
  organizationName: string;
  viewRequestUrl: string;
  requestName: string;
  requestDescription: string | null;
  requestContactName: string;
  requestContactEmail: string;
  requestContactPhone: string | null;
  itemOrVolunteer: string; // "Item" | "Volunteer", exactly
  itemsOrRoles: RequestChildren;
};

export const orgRequestApproved: ProductTemplate<OrgRequestApprovedVars> = {
  key: "org_request_approved",
  // entityType is set per queue call: "item_request" or "volunteer_request".
  entityType: "item_request",
  required: [
    "organizationName",
    "viewRequestUrl",
    "requestName",
    "requestContactName",
    "requestContactEmail",
    "itemOrVolunteer",
    "itemsOrRoles",
  ],
  render(vars) {
    const subject = "Your Love in Action Request was Approved!";
    const html = shell(
      "Your Request Has Been Approved!",
      [
        para(`Hi ${escapeHtml(vars.organizationName)},`),
        para("Your request was approved and published to the Love in Action Database!"),
        para(
          "For your convenience, here is the URL to your published need and a photo so you can share this request with your community and post it on your social media sites.",
        ),
        kvLink("URL", vars.viewRequestUrl),
        sectionHeading("Request Details"),
        kv("Name", vars.requestName),
        kvOpt("Description", vars.requestDescription),
        sectionHeading("Request Contact"),
        kv("Request's Contact", vars.requestContactName),
        kv("Contact's Email", vars.requestContactEmail),
        kvOpt("Contact's Phone", vars.requestContactPhone),
        sectionHeading(`${vars.itemOrVolunteer}s Details`),
        childrenHtml(vars.itemsOrRoles),
        para("Thank you,<br /><strong>The Alliance Love in Action Team</strong>"),
        button("View Your Request", vars.viewRequestUrl),
      ]
        .filter(Boolean)
        .join("\n"),
    );
    const text = textBody(
      "Your Request Has Been Approved!",
      `Hi ${vars.organizationName},`,
      "Your request was approved and published to the Love in Action Database!",
      "For your convenience, here is the URL to your published need and a photo so you can share this request with your community and post it on your social media sites.",
      textKv("URL", vars.viewRequestUrl),
      [
        "Request Details",
        textKv("Name", vars.requestName),
        ...textKvOpt("Description", vars.requestDescription),
      ],
      [
        "Request Contact",
        textKv("Request's Contact", vars.requestContactName),
        textKv("Contact's Email", vars.requestContactEmail),
        ...textKvOpt("Contact's Phone", vars.requestContactPhone),
      ],
      [`${vars.itemOrVolunteer}s Details`, ...childrenText(vars.itemsOrRoles)],
      ["Thank you,", "The Alliance Love in Action Team"],
      textKv("View Your Request", vars.viewRequestUrl),
    );
    return { subject, html, text };
  },
};
