/**
 * Shared readable names for approval-event transitions and entity types
 * (ADMIN-07 §5/§8). One mapping so the activity trail and the admin
 * surfaces describe the same change with the same words.
 *
 * Automated archives are distinguished by the event NOTE the writing code
 * records ('fulfilled' from the quantity-zero auto-archive, 'expired' from
 * the nightly expiry job) — a null actor alone is NOT enough, because
 * fulfillment auto-archives and self-registration also write null actors.
 */
export const ENTITY_TYPE_NAMES: Record<string, string> = {
  organization: "Organization",
  item_request: "Item request",
  volunteer_request: "Volunteer request",
  org_membership: "Membership",
  person: "Person",
};

export function entityTypeName(entityType: string): string {
  return ENTITY_TYPE_NAMES[entityType] ?? entityType;
}

const REQUEST_LABELS: Record<string, string> = {
  "draft:pending": "Submitted for approval",
  "pending:active": "Approved and published",
  "pending:draft": "Returned to draft",
  "archived:active": "Reinstated",
  "archived:pending": "Reinstated for approval",
};

const ORG_LABELS: Record<string, string> = {
  ":pending": "Registered",
  "pending:approved": "Organization approved",
  "disabled:approved": "Organization approved",
  "pending:disabled": "Organization disabled",
  "approved:disabled": "Organization disabled",
};

const MEMBERSHIP_LABELS: Record<string, string> = {
  "pending:active": "Member approved",
  "active:removed": "Member removed",
  "pending:removed": "Member removed",
  "removed:pending": "Reinstated",
};

const ROLE_NAMES: Record<string, string> = {
  owner: "Owner",
  member: "Member",
  staff_admin: "Staff admin",
  staff_approver: "Staff approver",
};

function roleName(status: string): string {
  const slug = status.startsWith("role:") ? status.slice(5) : status;
  return ROLE_NAMES[slug] ?? slug;
}

export function transitionLabel(
  entityType: string,
  fromStatus: string | null,
  toStatus: string,
  note: string | null,
): string {
  const key = `${fromStatus ?? ""}:${toStatus}`;
  if (entityType === "item_request" || entityType === "volunteer_request") {
    if (toStatus === "archived") {
      if (note === "expired") return "Archived automatically after expiry";
      if (note === "fulfilled") return "Archived automatically when filled";
      return "Archived";
    }
    const label = REQUEST_LABELS[key];
    if (label !== undefined) return label;
  }
  if (entityType === "organization") {
    const label = ORG_LABELS[key];
    if (label !== undefined) return label;
  }
  if (entityType === "org_membership") {
    // Role changes: both statuses carry the "role:" prefix.
    if (toStatus.startsWith("role:")) {
      if (fromStatus !== null && fromStatus.startsWith("role:")) {
        return `Role changed from ${roleName(fromStatus)} to ${roleName(toStatus)}`;
      }
      return `Role set to ${roleName(toStatus)}`;
    }
    const label = MEMBERSHIP_LABELS[key];
    if (label !== undefined) return label;
  }
  if (entityType === "person" && toStatus === "merged") return "Merged";
  // Never hide an event behind an unmapped pair — show the raw movement.
  return `${fromStatus ?? "created"} → ${toStatus}`;
}
