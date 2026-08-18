/**
 * ADMIN-06 §6 — resend a FAILED email. Not a replay: the payload is
 * re-resolved from current data through the same template pipeline as the
 * original send (a stored payload would just resend the original defect —
 * §6's ADMIN-04 example: a name corrected since the failure must appear in
 * the resend). A brand-new log row records the outcome; the failed row
 * stays untouched. The referenced entity is never written.
 *
 * Recipient resolution (documented for the captain's report):
 * - Templates whose recipient IS an entity-derived person re-resolve it:
 *   org_approved → current org primary contact; org_member_approved →
 *   current member; donor_* → current donor/supporter person.
 * - Otherwise, a row that recorded to_person_id re-resolves that person's
 *   current email (ADMIN-04 merges repoint to_person_id to the survivor).
 * - All remaining rows (staff copies, submitting-member copies, org copies
 *   with no person link) keep the recorded to_email — the identity behind
 *   those addresses is not derivable from the entity.
 *
 * D24 lives here as a pre-check that mirrors email_log_once_idx exactly
 * (template, entity type, entity id, lower(recipient), non-failed) so the
 * operator reads a dated sentence, never a constraint violation.
 */
import * as dal from "../dal";
import type { DbContext } from "../db/client";
import type { EmailLogEntry } from "../../shared/types";
import { absoluteUrl, dispatchQueuedEmails, MAY_HAVE_SENT_MARKER, queueProductEmail } from "../email/send";
import { formatDeadlineDate, humanizeDeadlineType } from "../routes/public";
import type {
  MembershipResendContext,
  OrgResendContext,
  PledgeResendContext,
  RequestResendContext,
  SignupResendContext,
} from "../dal/email-resend-data";

export class EmailRowNotFoundError extends Error {
  constructor() {
    super("That email log entry no longer exists.");
  }
}

/** Refused before any write; message is the stated reason shown verbatim. */
export class ResendBlockedError extends Error {}

/** D24: a matching non-failed row already exists. */
export class AlreadyDeliveredError extends Error {
  readonly deliveredOn: string;
  constructor(deliveredOn: string) {
    super(`This email was already delivered on ${deliveredOn}. No new email was sent.`);
    this.deliveredOn = deliveredOn;
  }
}

export type ResendResult = { outcome: "sent"; toEmail: string } | { outcome: "failed"; error: string };

type QueueInput = Parameters<typeof queueProductEmail>[1];

type Rebuilt = {
  toEmail: string;
  toPersonId: string | null;
  replyTo?: string;
  entityType: string;
  vars: Record<string, unknown>;
};

const GONE = {
  organization: "The organization this email refers to no longer exists. Nothing was sent.",
  request: "The request this email refers to no longer exists. Nothing was sent.",
  membership: "The membership this email refers to no longer exists. Nothing was sent.",
  pledge: "The pledge this email refers to no longer exists. Nothing was sent.",
  signup: "The signup this email refers to no longer exists. Nothing was sent.",
  person: "The person this email was addressed to no longer exists. Nothing was sent.",
} as const;

function fullName(p: { firstName: string; lastName: string }): string {
  return `${p.firstName} ${p.lastName}`;
}

function deliveredOnDate(row: EmailLogEntry): string {
  const ts = row.sentAt ?? row.createdAt;
  return new Date(ts).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "America/Los_Angeles",
  });
}

/** Recorded recipient, upgraded to the person's current email when linked. */
async function recordedRecipient(ctx: DbContext, row: EmailLogEntry): Promise<{ email: string; personId: string | null }> {
  if (row.toPersonId) {
    const person = await dal.people.getById(ctx, row.toPersonId);
    if (!person) throw new ResendBlockedError(GONE.person);
    return { email: person.email, personId: person.id };
  }
  return { email: row.toEmail, personId: null };
}

async function orgCtx(ctx: DbContext, row: EmailLogEntry): Promise<OrgResendContext> {
  const org = row.entityId ? await dal.emailResendData.orgResendContext(ctx, row.entityId) : null;
  if (!org) throw new ResendBlockedError(GONE.organization);
  return org;
}

async function requestCtx(ctx: DbContext, kind: "item" | "volunteer", row: EmailLogEntry): Promise<RequestResendContext> {
  const request = row.entityId ? await dal.emailResendData.requestResendContext(ctx, kind, row.entityId) : null;
  if (!request) throw new ResendBlockedError(GONE.request);
  return request;
}

async function membershipCtx(ctx: DbContext, row: EmailLogEntry): Promise<MembershipResendContext> {
  const membership = row.entityId ? await dal.emailResendData.membershipResendContext(ctx, row.entityId) : null;
  if (!membership) throw new ResendBlockedError(GONE.membership);
  return membership;
}

async function pledgeCtx(ctx: DbContext, row: EmailLogEntry): Promise<PledgeResendContext> {
  const pledge = row.entityId ? await dal.emailResendData.pledgeResendContext(ctx, row.entityId) : null;
  if (!pledge) throw new ResendBlockedError(GONE.pledge);
  return pledge;
}

async function signupCtx(ctx: DbContext, row: EmailLogEntry): Promise<SignupResendContext> {
  const signup = row.entityId ? await dal.emailResendData.signupResendContext(ctx, row.entityId) : null;
  if (!signup) throw new ResendBlockedError(GONE.signup);
  return signup;
}

/** Kind for the two request-scoped templates, from the row's entity_type. */
function requestKindOf(row: EmailLogEntry): "item" | "volunteer" {
  return row.entityType === "volunteer_request" ? "volunteer" : "item";
}

/** Template keys for which a resend procedure exists; used for eligibility checks. */
export const RESENDABLE_TEMPLATE_KEYS: ReadonlySet<string> = new Set<string>([
  "staff_new_org",
  "staff_new_item_request",
  "staff_new_volunteer_request",
  "staff_new_user",
  "org_approved",
  "org_request_received",
  "org_request_approved",
  "org_member_approved",
  "org_new_item_donation",
  "donor_item_confirmation",
  "org_new_volunteer",
  "donor_volunteer_confirmation",
]);

const REBUILDERS: Record<string, (ctx: DbContext, row: EmailLogEntry) => Promise<Rebuilt>> = {
  async staff_new_org(ctx, row) {
    const org = await orgCtx(ctx, row);
    return {
      toEmail: row.toEmail,
      toPersonId: null,
      entityType: "organization",
      vars: {
        organizationName: org.name,
        organizationAddress: org.city,
        organizationPhone: org.phone,
        organizationWebsite: org.websiteUrl,
        primaryContactName: org.contact ? fullName(org.contact) : "",
        primaryContactEmail: org.contact?.email ?? "",
        primaryContactPhone: org.contact?.phone ?? null,
        adminUrl: absoluteUrl("/admin/organizations"),
      },
    };
  },

  async staff_new_item_request(ctx, row) {
    const request = await requestCtx(ctx, "item", row);
    return {
      toEmail: row.toEmail,
      toPersonId: null,
      entityType: "item_request",
      vars: {
        itemRequestName: request.title,
        organizationName: request.orgName,
        organizationPrimaryContact: request.orgPrimaryContact ? fullName(request.orgPrimaryContact) : "",
        organizationPrimaryContactEmail: request.orgPrimaryContact?.email ?? "",
        adminUrl: absoluteUrl("/admin/requests"),
      },
    };
  },

  async staff_new_volunteer_request(ctx, row) {
    const request = await requestCtx(ctx, "volunteer", row);
    return {
      toEmail: row.toEmail,
      toPersonId: null,
      entityType: "volunteer_request",
      vars: {
        volunteerRequestName: request.title,
        organizationName: request.orgName,
        organizationPrimaryContact: request.orgPrimaryContact ? fullName(request.orgPrimaryContact) : "",
        organizationPrimaryContactEmail: request.orgPrimaryContact?.email ?? "",
        adminUrl: absoluteUrl("/admin/requests"),
      },
    };
  },

  async staff_new_user(ctx, row) {
    const membership = await membershipCtx(ctx, row);
    return {
      toEmail: row.toEmail,
      toPersonId: null,
      entityType: "org_membership",
      vars: {
        memberName: fullName(membership.member),
        memberEmail: membership.member.email,
        memberPhone: membership.member.phone,
        organizationName: membership.orgName,
        submitterName: membership.inviter ? fullName(membership.inviter) : "",
        submitterEmail: membership.inviter?.email ?? "",
        adminUrl: absoluteUrl("/admin/members"),
      },
    };
  },

  async org_approved(ctx, row) {
    const org = await orgCtx(ctx, row);
    if (!org.contact) {
      throw new ResendBlockedError("The organization no longer has a primary contact on file. Nothing was sent.");
    }
    const populationNames = [...org.populationNames];
    if (org.populationsOther) populationNames.push(org.populationsOther);
    return {
      toEmail: org.contact.email,
      toPersonId: org.contact.id,
      entityType: "organization",
      vars: {
        organizationName: org.name,
        orgAddress: org.addressFormatted ?? org.city,
        orgPhoneNumber: org.phone,
        websiteUrl: org.websiteUrl,
        missionStatement: org.mission,
        primaryPopulationServed: populationNames.length > 0 ? populationNames.join(", ") : null,
        organizationPrimaryContact: fullName(org.contact),
        organizationPrimaryContactEmail: org.contact.email,
        organizationPrimaryContactPhone: org.contact.phone,
        dashboardUrl: absoluteUrl("/dashboard"),
      },
    };
  },

  async org_request_received(ctx, row) {
    const kind = requestKindOf(row);
    const request = await requestCtx(ctx, kind, row);
    const recipient = await recordedRecipient(ctx, row);
    return {
      toEmail: recipient.email,
      toPersonId: recipient.personId,
      entityType: kind === "item" ? "item_request" : "volunteer_request",
      vars: {
        itemOrVolunteer: kind === "item" ? "Item" : "Volunteer",
        organizationName: request.orgName,
        requestName: request.title,
        requestDescription: request.description,
        requestContactName: request.requestContact ? fullName(request.requestContact) : "",
        requestContactEmail: request.requestContact?.email ?? "",
        requestContactPhone: request.requestContact?.phone ?? null,
        requestId: request.id,
        itemsOrRoles: { kind, rows: request.children },
      },
    };
  },

  async org_request_approved(ctx, row) {
    const kind = requestKindOf(row);
    const request = await requestCtx(ctx, kind, row);
    const recipient = await recordedRecipient(ctx, row);
    return {
      toEmail: recipient.email,
      toPersonId: recipient.personId,
      entityType: kind === "item" ? "item_request" : "volunteer_request",
      vars: {
        organizationName: request.orgName,
        viewRequestUrl: absoluteUrl(kind === "item" ? `/items/${request.id}` : `/volunteer/${request.id}`),
        requestName: request.title,
        requestDescription: request.description,
        requestContactName: request.requestContact ? fullName(request.requestContact) : "",
        requestContactEmail: request.requestContact?.email ?? "",
        requestContactPhone: request.requestContact?.phone ?? null,
        itemOrVolunteer: kind === "item" ? "Item" : "Volunteer",
        itemsOrRoles: { kind, rows: request.children },
      },
    };
  },

  async org_member_approved(ctx, row) {
    const membership = await membershipCtx(ctx, row);
    return {
      toEmail: membership.member.email,
      toPersonId: membership.member.id,
      entityType: "org_membership",
      vars: {
        memberName: fullName(membership.member),
        organizationName: membership.orgName,
        loginUrl: absoluteUrl("/login"),
        dashboardUrl: absoluteUrl("/dashboard"),
      },
    };
  },

  async org_new_item_donation(ctx, row) {
    const pledge = await pledgeCtx(ctx, row);
    const recipient = await recordedRecipient(ctx, row);
    return {
      toEmail: recipient.email,
      toPersonId: recipient.personId,
      replyTo: pledge.donor.email,
      entityType: "item_pledge",
      vars: {
        organizationName: pledge.request.orgName,
        requestName: pledge.request.title,
        requestDescription: pledge.request.description,
        requestUrl: absoluteUrl(`/items/${pledge.request.id}`),
        items: pledge.lines,
        donorName: fullName(pledge.donor),
        donorEmail: pledge.donor.email,
        donorPhone: pledge.donor.phone,
        supportersUrl: absoluteUrl("/dashboard/supporters"),
      },
    };
  },

  async donor_item_confirmation(ctx, row) {
    const pledge = await pledgeCtx(ctx, row);
    const contact = pledge.request.requestContact;
    return {
      toEmail: pledge.donor.email,
      toPersonId: pledge.donor.id,
      replyTo: contact?.email,
      entityType: "item_pledge",
      vars: {
        donorName: fullName(pledge.donor),
        organizationName: pledge.request.orgName,
        requestContactName: contact ? fullName(contact) : "",
        requestContactEmail: contact?.email ?? "",
        requestContactPhone: contact?.phone ?? null,
        requestName: pledge.request.title,
        requestDescription: pledge.request.description,
        requestDeadlineType: humanizeDeadlineType(pledge.request.deadlineType),
        requestDeadlineDate:
          pledge.request.deadlineType === "date_specific" ? formatDeadlineDate(pledge.request.deadlineDate) : null,
        dropoffLocation: pledge.request.dropoffLocation,
        requestUrl: absoluteUrl(`/items/${pledge.request.id}`),
        items: pledge.lines,
      },
    };
  },

  async org_new_volunteer(ctx, row) {
    const signup = await signupCtx(ctx, row);
    const recipient = await recordedRecipient(ctx, row);
    const staffPrimary = (process.env.STAFF_NOTIFY_PRIMARY ?? "").trim();
    return {
      toEmail: recipient.email,
      toPersonId: recipient.personId,
      replyTo: staffPrimary !== "" ? staffPrimary : undefined,
      entityType: "volunteer_signup",
      vars: {
        organizationName: signup.request.orgName,
        requestName: signup.request.title,
        requestDescription: signup.request.description,
        requestDetails: signup.request.details,
        requestUrl: absoluteUrl(`/volunteer/${signup.request.id}`),
        roles: signup.roleNames,
        donorName: fullName(signup.supporter),
        donorEmail: signup.supporter.email,
        donorPhone: signup.supporter.phone,
        donorNotes: signup.notes,
        supportersUrl: absoluteUrl("/dashboard/supporters"),
      },
    };
  },

  async donor_volunteer_confirmation(ctx, row) {
    const signup = await signupCtx(ctx, row);
    const contact = signup.request.requestContact;
    return {
      toEmail: signup.supporter.email,
      toPersonId: signup.supporter.id,
      replyTo: contact?.email,
      entityType: "volunteer_signup",
      vars: {
        donorName: fullName(signup.supporter),
        organizationName: signup.request.orgName,
        requestContactName: contact ? fullName(contact) : "",
        requestContactEmail: contact?.email ?? "",
        requestContactPhone: contact?.phone ?? null,
        requestName: signup.request.title,
        requestDescription: signup.request.description,
        requestDeadlineType: humanizeDeadlineType(signup.request.deadlineType),
        requestDetails: signup.request.details,
        requestUrl: absoluteUrl(`/volunteer/${signup.request.id}`),
        roles: signup.roleNames,
        followUpWindow: "1-3 business days",
      },
    };
  },
};

export async function resendEmail(ctx: DbContext, emailLogId: string): Promise<ResendResult> {
  const row = await dal.emailLog.getById(ctx, emailLogId);
  if (!row) throw new EmailRowNotFoundError();
  if (row.status !== "failed") throw new ResendBlockedError("Only failed emails can be resent.");
  // No-double-send guards: a recorded provider id means the provider already
  // accepted this email (possibly confirmed late, after a timeout); the
  // may-have-sent marker means a mid-send crash/timeout left the provider
  // outcome unknown. Either way a resend could deliver a duplicate.
  if (row.providerMessageId) {
    throw new ResendBlockedError(
      "The provider already accepted this email (a provider message id is recorded), so resending would deliver a duplicate. Nothing was sent.",
    );
  }
  if (row.error && row.error.includes(MAY_HAVE_SENT_MARKER)) {
    throw new ResendBlockedError(
      "This send was interrupted and the provider may already have delivered it. Verify in the provider dashboard first; resending from here is blocked to avoid a duplicate email.",
    );
  }
  if (row.templateKey === "auth_magic_link") {
    throw new ResendBlockedError(
      "Login link emails cannot be resent. The member can request a new link from the sign-in page.",
    );
  }
  const rebuilder = REBUILDERS[row.templateKey];
  if (!rebuilder) {
    throw new ResendBlockedError(`No resend procedure exists for the "${row.templateKey}" template. Nothing was sent.`);
  }

  const rebuilt = await rebuilder(ctx, row);

  // D24 pre-check against the rebuilt recipient, mirroring email_log_once_idx.
  if (row.entityId) {
    const delivered = await dal.emailLog.findDelivered(ctx, {
      templateKey: row.templateKey,
      entityType: rebuilt.entityType,
      entityId: row.entityId,
      toEmail: rebuilt.toEmail,
    });
    if (delivered) throw new AlreadyDeliveredError(deliveredOnDate(delivered));
  }

  const queued = await queueProductEmail(ctx, {
    key: row.templateKey as QueueInput["key"],
    entityType: rebuilt.entityType,
    entityId: row.entityId ?? undefined,
    toEmail: rebuilt.toEmail,
    toPersonId: rebuilt.toPersonId ?? undefined,
    replyTo: rebuilt.replyTo,
    vars: rebuilt.vars,
    resendOfId: emailLogId,
  } as QueueInput);

  if (queued.outcome === "duplicate") {
    // Race backstop: a non-failed row landed between the pre-check and the
    // insert. Re-read it for the date; it must exist for 'duplicate' to fire.
    if (row.entityId) {
      const delivered = await dal.emailLog.findDelivered(ctx, {
        templateKey: row.templateKey,
        entityType: rebuilt.entityType,
        entityId: row.entityId,
        toEmail: rebuilt.toEmail,
      });
      if (delivered) throw new AlreadyDeliveredError(deliveredOnDate(delivered));
    }
    throw new ResendBlockedError("A matching email already exists. Nothing was sent.");
  }

  if (queued.outcome === "skipped_disabled") {
    return {
      outcome: "failed",
      error: "This email's template is disabled by a staff admin — a skipped row was recorded. Re-enable it under Automated emails to send.",
    };
  }

  if (queued.outcome === "blocked") {
    // Variable resolution failed — the pipeline wrote a NEW failed row with
    // the readable reason (§12), exactly as a first send would.
    return { outcome: "failed", error: queued.reason };
  }

  await dispatchQueuedEmails([queued.dispatch]);
  const sent = await dal.emailLog.getById(ctx, queued.dispatch.emailLogId);
  if (!sent) return { outcome: "failed", error: "The resent row could not be read back" };
  if (sent.status === "sent") return { outcome: "sent", toEmail: sent.toEmail };
  if (sent.status === "failed") return { outcome: "failed", error: sent.error ?? "Unknown delivery error" };
  return { outcome: "failed", error: "Queued but not dispatched" };
}
