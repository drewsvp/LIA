/**
 * Domain types — the shapes the data-access layer returns and accepts.
 * Column names are snake_case in Postgres; every DAL query aliases them to the
 * camelCase fields below. TypeScript never sees a snake_case column name.
 *
 * These are type aliases (not interfaces) on purpose: aliases satisfy pg's
 * QueryResultRow constraint without an explicit index signature.
 */

// ---------------------------------------------------------------- statuses

export type UserStatus = "invited" | "active" | "disabled";
/** 'member' = org member/staff account; 'supporter' = self-service donor/volunteer profile. */
export type UserKind = "member" | "supporter";
export type OrganizationKind = "member_org" | "platform_owner";
export type OrganizationStatus = "pending" | "approved" | "disabled";
export type MembershipRole = "owner" | "member" | "staff_admin" | "staff_approver";
export type MembershipStatus = "pending" | "active" | "removed";
export type RequestStatus = "draft" | "pending" | "active" | "archived";
export type DeadlineType = "date_specific" | "until_fulfilled" | "ongoing";

/** Latest auto-image attempt for an item request. Null = never attempted. */
export type ImageGenStatus = "pending" | "succeeded" | "failed";
export type ArchivedReason = "manual" | "expired" | "fulfilled";
export type ItemCondition = "new" | "gently_used" | "any";
export type ApprovalEntityType =
  | "organization"
  | "org_membership"
  | "item_request"
  | "volunteer_request"
  | "person";
export type EmailStatus = "queued" | "sending" | "sent" | "failed" | "skipped";
export type SubscriberStatus = "subscribed" | "unsubscribed" | "bounced";

// ---------------------------------------------------------------- identity

export type Person = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  needsReview: boolean;
  reviewNote: string | null;
  sourceNote: string | null;
  legacyWixContactId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type User = {
  id: string;
  personId: string;
  authSubject: string | null;
  status: UserStatus;
  kind: UserKind;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
};

/** A user joined to its person row — what auth flows resolve. */
export type UserWithPerson = User & {
  firstName: string;
  lastName: string;
  email: string;
};

// ---------------------------------------------------------------- organizations

export type Organization = {
  id: string;
  legacyWixId: string | null;
  kind: OrganizationKind;
  name: string;
  slug: string;
  websiteUrl: string | null;
  mission: string | null;
  phone: string | null;
  logoUrl: string | null;
  populationsOther: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  addressFormatted: string | null;
  primaryContactPersonId: string | null;
  status: OrganizationStatus;
  approvedAt: string | null;
  approvedBy: string | null;
  createdAt: string;
  updatedAt: string;
};

/** The subset of organization fields public surfaces may display. */
export type PublicOrganization = {
  id: string;
  name: string;
  slug: string;
  mission: string | null;
  websiteUrl: string | null;
  city: string | null;
  logoUrl: string | null;
};

export type OrgMembership = {
  id: string;
  orgId: string;
  userId: string;
  role: MembershipRole;
  status: MembershipStatus;
  invitedBy: string | null;
  approvedAt: string | null;
  approvedBy: string | null;
  createdAt: string;
  updatedAt: string;
};

/** Membership joined to person/org display fields for lists. */
export type MembershipWithPerson = OrgMembership & {
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
};

export type MembershipWithOrganization = OrgMembership & {
  orgName: string;
  orgSlug: string;
  orgKind: OrganizationKind;
  orgStatus: OrganizationStatus;
};

// ---------------------------------------------------------------- populations

export type Population = {
  id: string;
  name: string;
  slug: string;
  sortOrder: number;
  isActive: boolean;
};

// ---------------------------------------------------------------- volunteer interests

/** Shared, staff-managed vocabulary used by supporter profile preferences. */
export type VolunteerCategory = {
  id: string;
  name: string;
  isActive: boolean;
};

// ---------------------------------------------------------------- requests

export type ItemRequest = {
  id: string;
  legacyWixId: string | null;
  orgId: string;
  title: string;
  description: string | null;
  imageUrl: string | null;
  /** True when imageUrl was auto-sourced (stock/AI), not uploaded by a person. */
  imageGenerated: boolean;
  imageGenStatus: ImageGenStatus | null;
  imageGenError: string | null;
  imageGenRetries: number;
  dropoffLocation: string | null;
  peopleHelped: number | null;
  deadlineType: DeadlineType;
  deadlineDate: string | null;
  expiresOn: string | null;
  contactPersonId: string | null;
  status: RequestStatus;
  submittedAt: string | null;
  approvedAt: string | null;
  approvedBy: string | null;
  archivedAt: string | null;
  archivedReason: ArchivedReason | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type Item = {
  id: string;
  legacyWixId: string | null;
  itemRequestId: string;
  name: string;
  description: string | null;
  condition: ItemCondition | null;
  productUrl: string | null;
  quantityRequested: number;
  quantityClaimed: number;
  quantityReceived: number;
  quantityRemaining: number;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type VolunteerRequest = {
  id: string;
  legacyWixId: string | null;
  orgId: string;
  title: string;
  description: string | null;
  details: string | null;
  eventLocation: string | null;
  imageUrl: string | null;
  /** True when imageUrl was auto-sourced (AI-generated), not uploaded by a person. */
  imageGenerated: boolean;
  imageGenStatus: ImageGenStatus | null;
  imageGenError: string | null;
  imageGenRetries: number;
  peopleHelped: number | null;
  deadlineType: DeadlineType;
  deadlineDate: string | null;
  expiresOn: string | null;
  contactPersonId: string | null;
  status: RequestStatus;
  submittedAt: string | null;
  approvedAt: string | null;
  approvedBy: string | null;
  archivedAt: string | null;
  archivedReason: ArchivedReason | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type VolunteerRole = {
  id: string;
  legacyWixId: string | null;
  volunteerRequestId: string;
  name: string;
  description: string | null;
  quantityNeeded: number;
  quantityInterested: number;
  quantityConfirmed: number;
  quantityRemaining: number;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

/** A request joined to the public organization fields, for public surfaces. */
export type PublicItemRequest = ItemRequest & { organization: PublicOrganization };
export type PublicVolunteerRequest = VolunteerRequest & { organization: PublicOrganization };

// ---------------------------------------------------------------- pledges & signups

export type ItemPledge = {
  id: string;
  legacyWixId: string | null;
  personId: string;
  itemRequestId: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ItemPledgeLine = {
  id: string;
  itemPledgeId: string;
  itemId: string;
  quantity: number;
};

export type VolunteerSignup = {
  id: string;
  legacyWixId: string | null;
  personId: string;
  volunteerRequestId: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type VolunteerSignupRole = {
  id: string;
  volunteerSignupId: string;
  volunteerRoleId: string;
};

/** Supporter rows as MP-13 renders them: pledge + person + request title. */
export type PledgeWithSupporter = ItemPledge & {
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  requestTitle: string;
  /** One line per pledged item: quantity and item name. */
  lines: { itemId: string; itemName: string; quantity: number }[];
};

export type SignupWithSupporter = VolunteerSignup & {
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  requestTitle: string;
  roles: { roleId: string; roleName: string }[];
};

// ---------------------------------------------------------------- governance

export type ApprovalEvent = {
  id: string;
  entityType: ApprovalEntityType;
  entityId: string;
  fromStatus: string | null;
  toStatus: string;
  actorUserId: string | null;
  note: string | null;
  createdAt: string;
};

/** Machine-readable bucket for why a send failed. Null on pre-migration rows and non-failed rows. */
export type EmailFailureCategory = "config" | "render" | "provider_timeout" | "provider" | "sweep";

export type EmailLogEntry = {
  id: string;
  templateKey: string;
  toEmail: string;
  toPersonId: string | null;
  entityType: string | null;
  entityId: string | null;
  payload: Record<string, unknown>;
  status: EmailStatus;
  providerMessageId: string | null;
  error: string | null;
  /** Structured failure bucket set at failure time; null on success rows and pre-migration failures. */
  failureCategory: EmailFailureCategory | null;
  /** When this row is a resend attempt, the id of the original failed row. */
  resendOfId: string | null;
  sentAt: string | null;
  createdAt: string;
};

export type DigestSubscriber = {
  id: string;
  personId: string | null;
  email: string;
  firstName: string | null;
  lastName: string | null;
  status: SubscriberStatus;
  unsubscribeToken: string;
  subscribedAt: string;
  unsubscribedAt: string | null;
  legacySource: string | null;
};

// ---------------------------------------------------------------- session

/** What /api/session returns and what guards attach to the request. */
export type SessionInfo = {
  authenticated: boolean;
  user: UserWithPerson | null;
  memberships: MembershipWithOrganization[];
  /** The organization the session currently acts as, when resolved. */
  activeOrgId: string | null;
  /** True when the user holds an active staff membership in the platform owner. */
  isStaff: boolean;
  /** True when the account is a supporter profile (donor/volunteer, no org portal). */
  isSupporter: boolean;
  staffRole: Extract<MembershipRole, "staff_admin" | "staff_approver"> | null;
};
