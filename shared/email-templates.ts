/**
 * ADMIN-06 §8: the single template_key → readable name mapping. The email
 * log, its filters, and queue result messages on other admin surfaces all
 * read from here — template keys never appear raw in the interface.
 */
export const EMAIL_TEMPLATE_NAMES: Record<string, string> = {
  staff_new_org: "New organization, staff notice",
  staff_new_item_request: "New item request, staff notice",
  staff_new_volunteer_request: "New volunteer request, staff notice",
  staff_new_user: "New member, staff notice",
  org_approved: "Organization approved",
  org_request_received: "Request received",
  org_request_approved: "Request approved",
  org_member_approved: "Member approved, login information",
  org_new_item_donation: "New item donation, organization notice",
  org_new_volunteer: "New volunteer, organization notice",
  donor_item_confirmation: "Donation confirmation, donor",
  donor_volunteer_confirmation: "Volunteer confirmation, supporter",
  digest_new_needs: "Weekly New Needs digest",
  auth_magic_link: "Login link",
};

export function templateDisplayName(key: string): string {
  return EMAIL_TEMPLATE_NAMES[key] ?? key;
}
