/**
 * MP-09 — save request-level edits (docs/specs/MP-09.md §6, "Submit Request
 * Edits").
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
 * IllegalStatusMoveError, mapped to the form's failure copy.
 */
import { SYSTEM, withDbContext } from "../db/client";
import * as people from "../dal/people";
import * as itemRequests from "../dal/item-requests";
import {
  prepareSubmissionBundle,
  queueItemSubmissionEmailsInTx,
  type SubmissionBundle,
} from "./item-submit";
import type { PendingDispatch } from "../email/send";
import type { ItemRequest, RequestStatus, DeadlineType } from "../../shared/types";

export class IllegalStatusMoveError extends Error {
  constructor(from: string, to: string) {
    super(`member may not move a request ${from} -> ${to}`);
    this.name = "IllegalStatusMoveError";
  }
}

/** D2: the complete set of member-initiated moves. */
const MEMBER_EDGES: Record<RequestStatus, readonly RequestStatus[]> = {
  draft: ["pending"],
  pending: [],
  active: ["archived"],
  archived: ["pending"],
};

export type SaveRequestEditsInput = {
  /** Already ownership-checked by the route (§11). */
  request: ItemRequest;
  orgId: string;
  userId: string;
  actorEmail: string;
  statusTo: "pending" | "archived" | null;
  fields: {
    title: string;
    description: string;
    dropoffLocation: string | null;
    peopleHelped: number | null;
    deadlineType: DeadlineType;
    deadlineDate: string | null;
    contactFirstName: string;
    contactLastName: string;
    contactEmail: string;
    contactPhone: string;
  };
};

export type SaveRequestEditsResult = {
  request: ItemRequest;
  dispatches: PendingDispatch[];
};

export async function saveRequestEdits(input: SaveRequestEditsInput): Promise<SaveRequestEditsResult> {
  const { request, statusTo, fields } = input;

  if (statusTo !== null) {
    const legal = MEMBER_EDGES[request.status] ?? [];
    if (!legal.includes(statusTo)) throw new IllegalStatusMoveError(request.status, statusTo);
  }

  // Throws NoItemsError before any write when moving to pending with an
  // empty request (§7 — same gate as MP-08).
  const bundle: SubmissionBundle | null = statusTo === "pending" ? await prepareSubmissionBundle(request) : null;

  return withDbContext(SYSTEM, async (c) => {
    // Lock the request row FIRST and re-validate the member edge against the
    // status as of this transaction. The pre-check above read a snapshot a
    // concurrent transition (e.g. staff approving pending→active) can
    // invalidate; without this, a member save could ride a stale `from` into
    // an edge members aren't allowed to take.
    const locked = await c.query<{ status: RequestStatus }>(
      "select status from item_requests where id = $1 and org_id = $2 for update",
      [request.id, input.orgId],
    );
    const currentStatus = locked.rows[0]?.status;
    if (currentStatus === undefined) {
      throw new Error(`item-request-edit: request ${request.id} vanished mid-save`);
    }
    if (statusTo !== null && !(MEMBER_EDGES[currentStatus] ?? []).includes(statusTo)) {
      throw new IllegalStatusMoveError(currentStatus, statusTo);
    }

    // One human, one row (§12): resolve by lower(email), attach as stored,
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
        sourceNote: "item request contact (MP-09)",
      }));

    let updated = await itemRequests.updateInTx(c, input.orgId, request.id, {
      title: fields.title,
      description: fields.description,
      dropoffLocation: fields.dropoffLocation,
      peopleHelped: fields.peopleHelped,
      deadlineType: fields.deadlineType,
      deadlineDate: fields.deadlineDate,
      contactPersonId: person.id,
    });

    const dispatches: PendingDispatch[] = [];
    if (statusTo !== null) {
      updated = await itemRequests.transitionStatusInTx(c, {
        requestId: request.id,
        to: statusTo,
        actorUserId: input.userId,
        ...(statusTo === "archived" ? { archivedReason: "manual" as const } : {}),
      });
      if (statusTo === "pending" && bundle !== null) {
        dispatches.push(
          ...(await queueItemSubmissionEmailsInTx(c, {
            request: updated,
            org: bundle.org,
            primaryContact: bundle.primaryContact,
            requestContact: person,
            items: bundle.items,
            actorEmail: input.actorEmail,
          })),
        );
      }
    }
    return { request: updated, dispatches };
  });
}
