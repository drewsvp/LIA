/**
 * MP-12 — save volunteer request-level edits (docs/specs/MP-12.md §6,
 * "Submit Request Edits").
 *
 * ONE transaction: contact person resolved by lower(email) (attached as-is,
 * never overwritten — one human, one row), request fields updated, and —
 * when the member moved the status selector — the transition plus its
 * approval_events row, plus submission emails when the move lands on
 * pending. No status change writes no event (§14).
 *
 * Member-legal moves only (D2, deviation seven): draft→pending,
 * active→archived (reason 'manual'), archived→pending. `active` is never a
 * target; everything else — including a tampered payload — is
 * IllegalStatusMoveError, mapped to the form's failure copy. Moving to
 * pending with zero roles throws NoRolesError before any write (§12).
 *
 * RoleOverInterestError lives here too: MP-12's role-edits save (in the
 * route, one transaction for all roles) blocks lowering Quantity below the
 * interested count, naming the role (§5 conflict 2). Interested is written
 * by record_volunteer_signup() and nothing else (Handbook invariant 2).
 */
import { SYSTEM, withDbContext } from "../db/client";
import * as people from "../dal/people";
import * as volunteerRequests from "../dal/volunteer-requests";
import {
  prepareVolunteerSubmissionBundle,
  queueVolunteerSubmissionEmailsInTx,
  type VolunteerSubmissionBundle,
} from "./volunteer-submit";
import { IllegalStatusMoveError } from "./item-request-edit";
import type { PendingDispatch } from "../email/send";
import type { VolunteerRequest, RequestStatus, DeadlineType } from "../../shared/types";

/** §5 conflict 2 — the message names the role and its interested count. */
export class RoleOverInterestError extends Error {
  constructor(roleName: string, interested: number) {
    super(`"${roleName}" has ${interested} interested volunteers — Quantity can't go below ${interested}.`);
    this.name = "RoleOverInterestError";
  }
}

/** D2: the complete set of member-initiated moves (same table as MP-09's). */
const MEMBER_EDGES: Record<RequestStatus, readonly RequestStatus[]> = {
  draft: ["pending"],
  pending: [],
  active: ["archived"],
  archived: ["pending"],
};

export type SaveVolunteerRequestEditsInput = {
  /** Already ownership-checked by the route (§11). */
  request: VolunteerRequest;
  orgId: string;
  userId: string;
  actorEmail: string;
  statusTo: "pending" | "archived" | null;
  fields: {
    title: string;
    description: string;
    details: string;
    eventLocation: string;
    peopleHelped: number | null;
    deadlineType: DeadlineType;
    deadlineDate: string | null;
    contactFirstName: string;
    contactLastName: string;
    contactEmail: string;
    contactPhone: string;
  };
};

export type SaveVolunteerRequestEditsResult = {
  request: VolunteerRequest;
  dispatches: PendingDispatch[];
};

export async function saveVolunteerRequestEdits(
  input: SaveVolunteerRequestEditsInput,
): Promise<SaveVolunteerRequestEditsResult> {
  const { request, statusTo, fields } = input;

  if (statusTo !== null) {
    const legal = MEMBER_EDGES[request.status] ?? [];
    if (!legal.includes(statusTo)) throw new IllegalStatusMoveError(request.status, statusTo);
  }

  // Throws NoRolesError before any write when moving to pending with an
  // empty request (§7/§12 — same gate as MP-11).
  const bundle: VolunteerSubmissionBundle | null =
    statusTo === "pending" ? await prepareVolunteerSubmissionBundle(request) : null;

  return withDbContext(SYSTEM, async (c) => {
    // Lock the request row FIRST and re-validate the member edge against the
    // status as of this transaction. The pre-check above read a snapshot a
    // concurrent transition (e.g. staff approving pending→active) can
    // invalidate; without this, a member save could ride a stale `from` into
    // an edge members aren't allowed to take.
    const locked = await c.query<{ status: RequestStatus }>(
      "select status from volunteer_requests where id = $1 and org_id = $2 for update",
      [request.id, input.orgId],
    );
    const currentStatus = locked.rows[0]?.status;
    if (currentStatus === undefined) {
      throw new Error(`volunteer-request-edit: request ${request.id} vanished mid-save`);
    }
    if (statusTo !== null && !(MEMBER_EDGES[currentStatus] ?? []).includes(statusTo)) {
      throw new IllegalStatusMoveError(currentStatus, statusTo);
    }
    if (statusTo === "pending") {
      await volunteerRequests.assertHasActiveCategoriesInTx(c, request.id);
    }

    // One human, one row (§5): resolve by lower(email), attach as stored,
    // never overwrite an existing person's fields. A resolved person must
    // already be visible to this organization (its contacts, members, or
    // supporters) — otherwise knowing a stranger's email is enough to attach
    // their people row and read the stored name/phone back off GET /edit.
    const existingPerson = await people.findByEmailInTx(c, fields.contactEmail);
    if (existingPerson !== null && !(await people.isVisibleToOrgInTx(c, existingPerson.id, input.orgId))) {
      throw new people.ContactNotVisibleError();
    }
    const person =
      existingPerson ??
      (await people.createInTx(c, {
        firstName: fields.contactFirstName,
        lastName: fields.contactLastName,
        email: fields.contactEmail,
        phone: fields.contactPhone,
        sourceNote: "volunteer request contact (MP-12)",
      }));

    let updated = await volunteerRequests.updateInTx(c, input.orgId, request.id, {
      title: fields.title,
      description: fields.description,
      details: fields.details,
      eventLocation: fields.eventLocation,
      peopleHelped: fields.peopleHelped,
      deadlineType: fields.deadlineType,
      deadlineDate: fields.deadlineDate,
      contactPersonId: person.id,
    });

    const dispatches: PendingDispatch[] = [];
    if (statusTo !== null) {
      updated = await volunteerRequests.transitionStatusInTx(c, {
        requestId: request.id,
        to: statusTo,
        actorUserId: input.userId,
        ...(statusTo === "archived" ? { archivedReason: "manual" as const } : {}),
      });
      if (statusTo === "pending" && bundle !== null) {
        dispatches.push(
          ...(await queueVolunteerSubmissionEmailsInTx(c, {
            request: updated,
            org: bundle.org,
            primaryContact: bundle.primaryContact,
            requestContact: person,
            roles: bundle.roles,
            actorEmail: input.actorEmail,
          })),
        );
      }
    }
    return { request: updated, dispatches };
  });
}
