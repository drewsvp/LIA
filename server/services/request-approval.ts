/**
 * ADMIN-02 — request approve / return-to-draft / archive / reinstate
 * (docs/specs/ADMIN-02.md §6).
 *
 * Approve is the one-transaction bundle: status -> active with
 * approved_at/approved_by stamped by transitionStatusInTx (exactly one
 * approval event, D48), plus the org_request_approved email_log rows queued
 * in the SAME tx. Dispatch happens after commit — a provider failure never
 * rolls back an approval; the route reports the real outcome (§12).
 *
 * Recipients (§6): the organization's primary contact and the request's
 * creator, resolved BEFORE the send — the same address means one email by
 * resolution, not a rejected insert. Nobody on file means no email and a
 * message that says so. A template-variable gap (legacy rows with no
 * request contact) writes a failed email_log row in the same tx: the
 * approval stands and ADMIN-06 shows the failure — Handbook §13 blocks the
 * send, never the approval. Re-approval probes the once-only email key before
 * insert, so recipients already notified are reported without a duplicate.
 *
 * Return to draft notifies no one (D45 — Christina owns that outreach and
 * there is no thirteenth template). Archive here is always reason 'manual'.
 * Reinstate is the staff-only archived->active edge and deliberately does
 * not re-stamp approval.
 */
import type { PoolClient } from "pg";
import type { Item, ItemRequest, Person, VolunteerRequest, VolunteerRole } from "../../shared/types";
import * as dal from "../dal";
import type { DbContext } from "../db/client";
import { withDbContext } from "../db/client";
import { absoluteUrl, queueProductEmailInTx, EmailConfigError, type PendingDispatch } from "../email/send";

export type RequestKind = "item" | "volunteer";
export type AdminRequest = ItemRequest | VolunteerRequest;

export class RequestNotFoundError extends Error {
  constructor(requestId: string) {
    super(`request not found: ${requestId}`);
    this.name = "RequestNotFoundError";
  }
}

/** Another staff member won the race — §12 makes this a no-op success. */
export class AlreadyActiveError extends Error {
  constructor(public readonly requestId: string) {
    super("request already active");
    this.name = "AlreadyActiveError";
  }
}

/** The action does not apply to the request's current status. */
export class IllegalStateError extends Error {
  constructor(public readonly currentStatus: string) {
    super(`illegal for status: ${currentStatus}`);
    this.name = "IllegalStateError";
  }
}

/** §7: unreachable given the submit gates — guarded anyway, loudly. */
export class NoChildrenError extends Error {
  constructor() {
    super("request has no items or roles");
    this.name = "NoChildrenError";
  }
}

export class NoVolunteerCategoriesError extends Error {
  constructor() {
    super("Assign at least one active volunteer category before approving this request.");
    this.name = "NoVolunteerCategoriesError";
  }
}

/** §7: approving under an unapproved org would publish nothing. */
export class OrgNotApprovedError extends Error {
  constructor(public readonly orgName: string) {
    super(`organization not approved: ${orgName}`);
    this.name = "OrgNotApprovedError";
  }
}

export type RequestApprovalEmail =
  | { outcome: "queued"; toEmail: string; dispatch: PendingDispatch }
  | { outcome: "already_sent"; toEmail: string }
  | { outcome: "skipped_disabled"; toEmail: string }
  | { outcome: "blocked"; toEmail: string; reason: string };

export type ApproveRequestResult = {
  request: AdminRequest;
  emails: RequestApprovalEmail[];
  /** True when contact and creator resolved to the same address (§6). */
  samePerson: boolean;
  /** True when neither a contact nor a creator email exists. */
  noRecipients: boolean;
};

function displayName(person: Person): string {
  return `${person.firstName} ${person.lastName}`.trim();
}

async function getRequest(ctx: DbContext, kind: RequestKind, requestId: string): Promise<AdminRequest | null> {
  return kind === "item" ? dal.itemRequests.getById(ctx, requestId) : dal.volunteerRequests.getById(ctx, requestId);
}

/** Map the dal's thrown strings onto typed errors the routes can branch on. */
function mapTransitionError(err: unknown, requestId: string, currentStatus: string): never {
  const message = err instanceof Error ? err.message : String(err);
  if (message.includes("not found")) throw new RequestNotFoundError(requestId);
  if (message.includes("already active")) throw new AlreadyActiveError(requestId);
  if (message.includes("not a legal edge") || message.includes("already") || message.includes("can be reinstated")) {
    throw new IllegalStateError(currentStatus);
  }
  throw err;
}

export type ApproveRequestInput = {
  kind: RequestKind;
  requestId: string;
  staffUserId: string;
};

export async function approveRequest(input: ApproveRequestInput): Promise<ApproveRequestResult> {
  const { kind, requestId, staffUserId } = input;
  const staff: DbContext = { kind: "staff", userId: staffUserId };

  const request = await getRequest(staff, kind, requestId);
  if (!request) throw new RequestNotFoundError(requestId);

  const org = await dal.organizations.getById(staff, request.orgId);
  if (!org) throw new Error(`request-approval: organization not found: ${request.orgId}`);
  // §7: public queries filter on organization status — approving under an
  // unapproved org would claim publication that cannot happen.
  if (org.status !== "approved") throw new OrgNotApprovedError(org.name);

  const children: Item[] | VolunteerRole[] =
    kind === "item"
      ? await dal.items.listByRequest(staff, request.id)
      : await dal.volunteerRoles.listByRequest(staff, request.id);
  if (children.length === 0) throw new NoChildrenError();

  // Recipients, resolved before any write (§6): org primary contact + creator.
  const orgContact = org.primaryContactPersonId ? await dal.people.getById(staff, org.primaryContactPersonId) : null;
  let creatorPerson: Person | null = null;
  if (request.createdBy) {
    const creatorUser = await dal.users.getById(staff, request.createdBy);
    creatorPerson = creatorUser ? await dal.people.getById(staff, creatorUser.personId) : null;
  }
  const byEmail = new Map<string, Person>();
  for (const person of [orgContact, creatorPerson]) {
    if (person?.email) {
      const key = person.email.trim().toLowerCase();
      if (!byEmail.has(key)) byEmail.set(key, person);
    }
  }
  const recipients = [...byEmail.values()];
  const samePerson = Boolean(orgContact?.email) && Boolean(creatorPerson?.email) && recipients.length === 1;

  // The template's "Request's Contact" block is the request-level contact.
  const requestContact = request.contactPersonId ? await dal.people.getById(staff, request.contactPersonId) : null;

  const entityType = kind === "item" ? "item_request" : "volunteer_request";
  const viewPath = kind === "item" ? `/items/${request.id}` : `/volunteer/${request.id}`;
  const itemsOrRoles =
    kind === "item"
      ? { kind: "item" as const, rows: (children as Item[]).map((i) => ({ name: i.name, quantity: i.quantityRequested })) }
      : {
          kind: "volunteer" as const,
          rows: (children as VolunteerRole[]).map((r) => ({ name: r.name, quantity: r.quantityNeeded })),
        };

  try {
    return await withDbContext(staff, async (c: PoolClient) => {
      if (kind === "volunteer") {
        try {
          await dal.volunteerRequests.assertHasActiveCategoriesInTx(c, requestId);
        } catch (err) {
          if (err instanceof dal.volunteerRequests.NoActiveVolunteerRequestCategoriesError) {
            throw new NoVolunteerCategoriesError();
          }
          throw err;
        }
      }
      const updated =
        kind === "item"
          ? await dal.itemRequests.transitionStatusInTx(c, { requestId, to: "active", actorUserId: staffUserId })
          : await dal.volunteerRequests.transitionStatusInTx(c, { requestId, to: "active", actorUserId: staffUserId });

      const emails: RequestApprovalEmail[] = [];
      for (const person of recipients) {
        const vars = {
          organizationName: org.name,
          viewRequestUrl: absoluteUrl(viewPath),
          requestName: updated.title,
          requestDescription: updated.description,
          requestContactName: requestContact ? displayName(requestContact) : "",
          requestContactEmail: requestContact?.email ?? "",
          requestContactPhone: requestContact?.phone ?? null,
          itemOrVolunteer: kind === "item" ? "Item" : "Volunteer",
          itemsOrRoles,
        };
        const alreadySent = await dal.emailLog.existsForRecipientInTx(c, {
          templateKey: "org_request_approved",
          entityType,
          entityId: updated.id,
          toEmail: person.email,
        });
        if (alreadySent) {
          emails.push({ outcome: "already_sent", toEmail: person.email });
          continue;
        }
        try {
          const dispatch = await queueProductEmailInTx(c, {
            key: "org_request_approved",
            entityType,
            entityId: updated.id,
            toEmail: person.email,
            toPersonId: person.id,
            vars,
          });
          if (dispatch) emails.push({ outcome: "queued", toEmail: person.email, dispatch });
          else emails.push({ outcome: "skipped_disabled", toEmail: person.email });
        } catch (err) {
          if (!(err instanceof EmailConfigError)) throw err;
          // Variable resolution blocked the send. The approval stands; the
          // failed row is written in this same tx so ADMIN-06 shows it.
          const row = await dal.emailLog.insertQueuedInTx(c, {
            templateKey: "org_request_approved",
            toEmail: person.email,
            toPersonId: person.id,
            entityType,
            entityId: updated.id,
            payload: { vars },
          });
          await dal.emailLog.markFailedInTx(c, row.id, err.message, "render");
          console.error(`[admin] request ${updated.id} approved but org_request_approved blocked: ${err.message}`);
          emails.push({ outcome: "blocked", toEmail: person.email, reason: err.message });
        }
      }
      return { request: updated, emails, samePerson, noRecipients: recipients.length === 0 };
    });
  } catch (err) {
    if (
      err instanceof RequestNotFoundError ||
      err instanceof AlreadyActiveError ||
      err instanceof IllegalStateError ||
      err instanceof NoChildrenError ||
      err instanceof NoVolunteerCategoriesError ||
      err instanceof OrgNotApprovedError
    ) {
      throw err;
    }
    mapTransitionError(err, requestId, request.status);
  }
}

export type ReturnToDraftInput = {
  kind: RequestKind;
  requestId: string;
  staffUserId: string;
  /** Non-empty; the route enforces it — §6 "an empty note is not accepted". */
  note: string;
};

export async function returnRequestToDraft(input: ReturnToDraftInput): Promise<AdminRequest> {
  const staff: DbContext = { kind: "staff", userId: input.staffUserId };
  const request = await getRequest(staff, input.kind, input.requestId);
  if (!request) throw new RequestNotFoundError(input.requestId);
  try {
    const transition = {
      requestId: input.requestId,
      to: "draft" as const,
      actorUserId: input.staffUserId,
      note: input.note,
    };
    return input.kind === "item"
      ? await dal.itemRequests.transitionStatus(staff, transition)
      : await dal.volunteerRequests.transitionStatus(staff, transition);
  } catch (err) {
    mapTransitionError(err, input.requestId, request.status);
  }
}

export type ArchiveRequestInput = {
  kind: RequestKind;
  requestId: string;
  staffUserId: string;
};

export async function archiveRequest(input: ArchiveRequestInput): Promise<AdminRequest> {
  const staff: DbContext = { kind: "staff", userId: input.staffUserId };
  const request = await getRequest(staff, input.kind, input.requestId);
  if (!request) throw new RequestNotFoundError(input.requestId);
  try {
    return input.kind === "item"
      ? await dal.itemRequests.archive(staff, input.requestId, "manual", input.staffUserId)
      : await dal.volunteerRequests.archive(staff, input.requestId, "manual", input.staffUserId);
  } catch (err) {
    mapTransitionError(err, input.requestId, request.status);
  }
}

export async function reinstateRequest(input: ArchiveRequestInput): Promise<AdminRequest> {
  const staff: DbContext = { kind: "staff", userId: input.staffUserId };
  const request = await getRequest(staff, input.kind, input.requestId);
  if (!request) throw new RequestNotFoundError(input.requestId);
  try {
    return input.kind === "item"
      ? await dal.itemRequests.reinstate(staff, input.requestId, input.staffUserId)
      : await dal.volunteerRequests.reinstate(staff, input.requestId, input.staffUserId);
  } catch (err) {
    mapTransitionError(err, input.requestId, request.status);
  }
}
