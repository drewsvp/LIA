/**
 * Product template registry — the twelve templates of docs/email/TEMPLATES.md.
 * auth-magic-link is deliberately NOT here: it is authentication
 * infrastructure, not one of the twelve, and has no entity binding.
 */
import type { ProductTemplate } from "./types";
import { staffNewOrg } from "./staff-new-org";
import { staffNewItemRequest } from "./staff-new-item-request";
import { staffNewVolunteerRequest } from "./staff-new-volunteer-request";
import { staffNewUser } from "./staff-new-user";
import { orgApproved } from "./org-approved";
import { orgRequestReceived } from "./org-request-received";
import { orgRequestApproved } from "./org-request-approved";
import { orgMemberApproved } from "./org-member-approved";
import { orgNewItemDonation } from "./org-new-item-donation";
import { orgNewVolunteer } from "./org-new-volunteer";
import { donorItemConfirmation } from "./donor-item-confirmation";
import { donorVolunteerConfirmation } from "./donor-volunteer-confirmation";
import { digestNewNeeds } from "./digest-new-needs";

export const PRODUCT_TEMPLATES = {
  staff_new_org: staffNewOrg,
  staff_new_item_request: staffNewItemRequest,
  staff_new_volunteer_request: staffNewVolunteerRequest,
  staff_new_user: staffNewUser,
  org_approved: orgApproved,
  org_request_received: orgRequestReceived,
  org_request_approved: orgRequestApproved,
  org_member_approved: orgMemberApproved,
  org_new_item_donation: orgNewItemDonation,
  org_new_volunteer: orgNewVolunteer,
  donor_item_confirmation: donorItemConfirmation,
  donor_volunteer_confirmation: donorVolunteerConfirmation,
  digest_new_needs: digestNewNeeds,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} satisfies Record<string, ProductTemplate<any>>;

export type ProductTemplateKey = keyof typeof PRODUCT_TEMPLATES;

export function isProductTemplateKey(key: string): key is ProductTemplateKey {
  return key in PRODUCT_TEMPLATES;
}
