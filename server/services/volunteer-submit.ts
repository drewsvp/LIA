/**
 * Volunteer-request submission emails + the MP-11 submit flow.
 *
 * MP-11 submit and MP-12's status move to pending share one email contract
 * (MP-11 §6): staff_new_volunteer_request to both staff addresses and
 * org_request_received to the submitting member, all queued INSIDE the same
 * transaction as the status transition. Dispatch happens after commit — a
 * send failure is an operations problem recorded on the email_log row,
 * never a member-facing one.
 *
 * A request with zero roles cannot be submitted (MP-11 §1);
 * prepareVolunteerSubmissionBundle throws NoRolesError and the caller
 * returns the surface's failure copy.
 */
import type { PoolClient } from "pg";
import { SYSTEM, withDbContext } from "../db/client";
import * as organizations from "../dal/organizations";
import * as people from "../dal/people";
import * as volunteerRoles from "../dal/volunteer-roles";
import * as volunteerRequests from "../dal/volunteer-requests";
import { queueProductEmailInTx, pushDispatch, absoluteUrl, type PendingDispatch } from "../email/send";
import { staffRecipientsInTx } from "../email/overrides";
import { SURFACE_ROUTES } from "../../shared/routes";
import type { VolunteerRequest, VolunteerRole, Organization, Person } from "../../shared/types";

const ADMIN_REQUESTS_PATH = SURFACE_ROUTES.find((r) => r.id === "ADMIN-02")?.path ?? "/admin";

/** §1: a request cannot be submitted with no roles. */
export class NoRolesError extends Error {
  constructor() {
    super("request has no roles");
    this.name = "NoRolesError";
  }
}

export type VolunteerSubmissionBundle = {
  org: Organization;
  primaryContact: Person | null;
  roles: VolunteerRole[];
};

/**
 * Pre-transaction reads for the submission emails. Throws NoRolesError when
 * the request has nothing on it — checked here so MP-11 (and later MP-12)
 * hit the same gate before any write.
 */
export async function prepareVolunteerSubmissionBundle(request: VolunteerRequest): Promise<VolunteerSubmissionBundle> {
  const [org, roles] = await Promise.all([
    organizations.getById(SYSTEM, request.orgId),
    volunteerRoles.listByRequest(SYSTEM, request.id),
  ]);
  if (org === null) throw new Error(`volunteer-submit: organization not found: ${request.orgId}`);
  if (roles.length === 0) throw new NoRolesError();
  // Loud, not silent: a missing contact leaves required template variables
  // unresolved and aborts the enclosing transaction via EmailConfigError.
  const primaryContact = org.primaryContactPersonId ? await people.getById(SYSTEM, org.primaryContactPersonId) : null;
  return { org, primaryContact, roles };
}

export type QueueVolunteerSubmissionEmailsArgs = {
  /** The post-transition request row — titles and ids in the emails reflect what was saved. */
  request: VolunteerRequest;
  org: Organization;
  primaryContact: Person | null;
  requestContact: Person | null;
  roles: VolunteerRole[];
  /** Session user's email — org_request_received goes to the submitting member. */
  actorEmail: string;
};

export async function queueVolunteerSubmissionEmailsInTx(
  c: PoolClient,
  args: QueueVolunteerSubmissionEmailsArgs,
): Promise<PendingDispatch[]> {
  const { request, org, primaryContact, requestContact } = args;

  // Staff notification to both addresses (D53 pattern); a missing env is loud.
  const staffRecipients = await staffRecipientsInTx(c, "staff_new_volunteer_request");
  if (staffRecipients.length === 0) {
    console.error(
      `[volunteer-submit] request ${request.id}: no staff notification recipients (override empty and STAFF_NOTIFY_PRIMARY/SECONDARY unset) — staff_new_volunteer_request not sent`,
    );
  }

  const dispatches: PendingDispatch[] = [];
  for (const toEmail of staffRecipients) {
    pushDispatch(
      dispatches,
      await queueProductEmailInTx(c, {
        key: "staff_new_volunteer_request",
        entityId: request.id,
        toEmail,
        vars: {
          volunteerRequestName: request.title,
          organizationName: org.name,
          organizationPrimaryContact: primaryContact ? `${primaryContact.firstName} ${primaryContact.lastName}` : "",
          organizationPrimaryContactEmail: primaryContact?.email ?? "",
          adminUrl: absoluteUrl(ADMIN_REQUESTS_PATH),
        },
      }),
    );
  }
  pushDispatch(
    dispatches,
    await queueProductEmailInTx(c, {
      key: "org_request_received",
      entityType: "volunteer_request",
      entityId: request.id,
      toEmail: args.actorEmail,
      vars: {
        itemOrVolunteer: "Volunteer",
        organizationName: org.name,
        requestName: request.title,
        requestDescription: request.description,
        requestContactName: requestContact ? `${requestContact.firstName} ${requestContact.lastName}` : "",
        requestContactEmail: requestContact?.email ?? "",
        requestContactPhone: requestContact?.phone ?? null,
        requestId: request.id,
        itemsOrRoles: {
          kind: "role",
          rows: args.roles.map((r) => ({ name: r.name, quantity: r.quantityNeeded })),
        },
      },
    }),
  );
  return dispatches;
}

export type SubmitVolunteerRequestInput = {
  /** Already ownership-checked by the route (§11). */
  request: VolunteerRequest;
  actorUserId: string;
  actorEmail: string;
};

export type SubmitVolunteerRequestResult = {
  dispatches: PendingDispatch[];
};

export async function submitVolunteerRequest(input: SubmitVolunteerRequestInput): Promise<SubmitVolunteerRequestResult> {
  const bundle = await prepareVolunteerSubmissionBundle(input.request);
  const requestContact = input.request.contactPersonId
    ? await people.getById(SYSTEM, input.request.contactPersonId)
    : null;

  return withDbContext(SYSTEM, async (c) => {
    const updated = await volunteerRequests.transitionStatusInTx(c, {
      requestId: input.request.id,
      to: "pending",
      actorUserId: input.actorUserId,
    });
    const dispatches = await queueVolunteerSubmissionEmailsInTx(c, {
      request: updated,
      org: bundle.org,
      primaryContact: bundle.primaryContact,
      requestContact,
      roles: bundle.roles,
      actorEmail: input.actorEmail,
    });
    return { dispatches };
  });
}
