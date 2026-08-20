/**
 * ADMIN-02 staff correction flow.
 *
 * Staff may fully correct pending requests, returned drafts, and active
 * requests. Active edits preserve their public status and approval stamp;
 * activity stays on its child rows under the same request-first, child-second
 * lock order used by public participation writes. Unapproval is separate and
 * remains forbidden once participation exists.
 * Request fields, contact attachment, and the complete ordered child structure
 * commit together. Activity counters are not present in the input types and the
 * child DALs reject the transaction if any activity exists.
 */
import type { PoolClient } from "pg";
import type {
  DeadlineType,
  ItemCondition,
  ItemRequest,
  RequestStatus,
  VolunteerRequest,
} from "../../shared/types";
import * as dal from "../dal";
import { withDbContext, type DbContext } from "../db/client";
import type { RequestKind } from "./request-approval";
import { RequestNotFoundError } from "./request-approval";

export class StaffRequestEditConflictError extends Error {
  constructor(public readonly reason: string) {
    super(reason);
    this.name = "StaffRequestEditConflictError";
  }
}

type ContactFields = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
};

type CommonFields = {
  title: string;
  description: string;
  peopleHelped: number | null;
  deadlineType: DeadlineType;
  deadlineDate: string | null;
  contact: ContactFields;
};

export type StaffItemRequestEditInput = {
  kind: "item";
  requestId: string;
  staffUserId: string;
  fields: CommonFields & { dropoffLocation: string | null };
  children: Array<{
    id?: string;
    name: string;
    description: string;
    condition: ItemCondition;
    productUrl: string | null;
    quantityRequested: number;
  }>;
};

export type StaffVolunteerRequestEditInput = {
  kind: "volunteer";
  requestId: string;
  staffUserId: string;
  fields: CommonFields & { details: string; eventLocation: string };
  categoryIds: string[];
  children: Array<{
    id?: string;
    name: string;
    description: string;
    quantityNeeded: number;
  }>;
};

export type StaffRequestEditInput = StaffItemRequestEditInput | StaffVolunteerRequestEditInput;

type LockedRequest = {
  status: RequestStatus;
  approvedAt: string | null;
  orgId: string;
  contactPersonId: string | null;
  imageUrl: string | null;
};

async function lockRequest(
  c: PoolClient,
  kind: RequestKind,
  requestId: string,
): Promise<LockedRequest> {
  const requestTable = kind === "item" ? "item_requests" : "volunteer_requests";
  const locked = await c.query<LockedRequest>(
    `select status, approved_at as "approvedAt", org_id as "orgId",
            contact_person_id as "contactPersonId", image_url as "imageUrl"
       from ${requestTable}
      where id = $1
      for update`,
    [requestId],
  );
  const request = locked.rows[0];
  if (!request) throw new RequestNotFoundError(requestId);
  return request;
}

async function lockEditableRequest(
  c: PoolClient,
  kind: RequestKind,
  requestId: string,
): Promise<LockedRequest> {
  const request = await lockRequest(c, kind, requestId);
  const entityType = kind === "item" ? "item_request" : "volunteer_request";
  if (request.status === "active") return request;
  if (request.approvedAt !== null || (request.status !== "pending" && request.status !== "draft")) {
    throw new StaffRequestEditConflictError("Approved or archived requests cannot be edited.");
  }
  if (request.status === "draft") {
    const returned = await c.query<{ exists: boolean }>(
      `select exists(
         select 1 from approval_events
          where entity_type = $1 and entity_id = $2
            and from_status = 'pending' and to_status = 'draft'
       ) as exists`,
      [entityType, requestId],
    );
    if (!returned.rows[0]?.exists) {
      throw new StaffRequestEditConflictError("Only a draft previously returned by staff can be edited here.");
    }
  }
  return request;
}

async function resolveContactInTx(
  c: PoolClient,
  orgId: string,
  currentContactPersonId: string | null,
  contact: ContactFields,
  sourceNote: string,
) {
  const existing = await dal.people.findByEmailInTx(c, contact.email);
  if (existing !== null && !(await dal.people.isVisibleToOrgInTx(c, existing.id, orgId))) {
    throw new dal.people.ContactNotVisibleError();
  }
  // A same-email edit to the request's currently attached contact is an
  // intentional edit of that person record. If the email identifies some
  // other visible person, attach that canonical person without overwriting
  // their identity from request-form text.
  if (existing !== null && existing.id === currentContactPersonId) {
    return dal.people.updateContactInTx(c, existing.id, {
      firstName: contact.firstName,
      lastName: contact.lastName,
      email: contact.email,
      phone: contact.phone,
    });
  }
  return (
    existing ??
    (await dal.people.createInTx(c, {
      firstName: contact.firstName,
      lastName: contact.lastName,
      email: contact.email,
      phone: contact.phone,
      sourceNote,
    }))
  );
}

function mapActivityError(
  err: unknown,
  reason = "This request has donor or volunteer activity and cannot be edited in its current status.",
): never {
  if (
    err instanceof dal.items.RequestHasItemActivityError ||
    err instanceof dal.volunteerRoles.RequestHasVolunteerActivityError
  ) {
    throw new StaffRequestEditConflictError(reason);
  }
  if (
    err instanceof dal.items.UnknownItemOnRequestError ||
    err instanceof dal.volunteerRoles.UnknownRoleOnRequestError
  ) {
    throw new StaffRequestEditConflictError("The request changed while you were editing. Reload it and try again.");
  }
  if (
    err instanceof dal.items.RequestMustRetainAnItemError ||
    err instanceof dal.items.ItemWithActivityCannotBeRemovedError ||
    err instanceof dal.items.ItemQuantityBelowParticipationError ||
    err instanceof dal.volunteerRoles.RequestMustRetainARoleError ||
    err instanceof dal.volunteerRoles.RoleWithActivityCannotBeRemovedError ||
    err instanceof dal.volunteerRoles.RoleQuantityBelowParticipationError
  ) {
    throw new StaffRequestEditConflictError(`${err.message} Nothing was changed.`);
  }
  throw err;
}

export async function saveStaffRequestEdits(
  input: StaffRequestEditInput,
): Promise<{ request: ItemRequest | VolunteerRequest }> {
  const staff: DbContext = { kind: "staff", userId: input.staffUserId };
  try {
    return await withDbContext(staff, async (c) => {
      const locked = await lockEditableRequest(c, input.kind, input.requestId);
      const person = await resolveContactInTx(
        c,
        locked.orgId,
        locked.contactPersonId,
        input.fields.contact,
        `${input.kind} request contact (ADMIN-02 staff edit)`,
      );

      if (input.kind === "item") {
        if (locked.status !== "active") {
          await dal.items.assertNoItemActivityInTx(c, input.requestId);
        }
        const request = await dal.itemRequests.updateInTx(c, locked.orgId, input.requestId, {
          title: input.fields.title,
          description: input.fields.description,
          dropoffLocation: input.fields.dropoffLocation,
          peopleHelped: input.fields.peopleHelped,
          deadlineType: input.fields.deadlineType,
          deadlineDate: input.fields.deadlineDate,
          contactPersonId: person.id,
        });
        await dal.items.replaceForStaffEditInTx(c, input.requestId, input.children);
        return { request };
      }

      if (locked.status !== "active") {
        await dal.volunteerRoles.assertNoVolunteerActivityInTx(c, input.requestId);
      }
      const request = await dal.volunteerRequests.updateInTx(c, locked.orgId, input.requestId, {
        title: input.fields.title,
        description: input.fields.description,
        details: input.fields.details,
        eventLocation: input.fields.eventLocation,
        peopleHelped: input.fields.peopleHelped,
        deadlineType: input.fields.deadlineType,
        deadlineDate: input.fields.deadlineDate,
        contactPersonId: person.id,
      });
      await dal.volunteerRoles.replaceForStaffEditInTx(c, input.requestId, input.children);
      await dal.volunteerRequests.replaceCategoriesInTx(c, input.requestId, input.categoryIds);
      return { request };
    });
  } catch (err) {
    mapActivityError(err);
  }
}

/** Returned draft -> pending, with history, no approval and no email. */
export async function moveReturnedRequestToPending(input: {
  kind: RequestKind;
  requestId: string;
  staffUserId: string;
}): Promise<ItemRequest | VolunteerRequest> {
  const staff: DbContext = { kind: "staff", userId: input.staffUserId };
  try {
    return await withDbContext(staff, async (c) => {
      const locked = await lockEditableRequest(c, input.kind, input.requestId);
      if (locked.status !== "draft") {
        throw new StaffRequestEditConflictError("Only a returned draft can be moved back to Pending.");
      }
      if (input.kind === "item") {
        const children = await dal.items.assertNoItemActivityInTx(c, input.requestId);
        if (children.length === 0) throw new StaffRequestEditConflictError("Add at least one item before moving this request to Pending.");
        return dal.itemRequests.transitionStatusInTx(c, {
          requestId: input.requestId,
          to: "pending",
          actorUserId: input.staffUserId,
        });
      }

      const children = await dal.volunteerRoles.assertNoVolunteerActivityInTx(c, input.requestId);
      if (children.length === 0) throw new StaffRequestEditConflictError("Add at least one role before moving this request to Pending.");
      try {
        await dal.volunteerRequests.assertHasActiveCategoriesInTx(c, input.requestId);
      } catch (err) {
        if (err instanceof dal.volunteerRequests.NoActiveVolunteerRequestCategoriesError) {
          throw new StaffRequestEditConflictError(err.message);
        }
        throw err;
      }
      return dal.volunteerRequests.transitionStatusInTx(c, {
        requestId: input.requestId,
        to: "pending",
        actorUserId: input.staffUserId,
      });
    });
  } catch (err) {
    mapActivityError(err);
  }
}

/**
 * Active -> pending correction lane. Lock order is request then child rows,
 * matching public activity writes; status and activity are both rechecked in
 * the transaction before the current approval stamp is cleared.
 */
export async function unapproveRequestForCorrection(input: {
  kind: RequestKind;
  requestId: string;
  staffUserId: string;
}): Promise<ItemRequest | VolunteerRequest> {
  const staff: DbContext = { kind: "staff", userId: input.staffUserId };
  try {
    return await withDbContext(staff, async (c) => {
      const locked = await lockRequest(c, input.kind, input.requestId);
      if (locked.status !== "active") {
        throw new StaffRequestEditConflictError(
          `Only an active request can be unapproved. This one is ${locked.status}.`,
        );
      }
      if (input.kind === "item") {
        await dal.items.assertNoItemActivityInTx(c, input.requestId);
        return dal.itemRequests.unapproveForCorrectionInTx(c, input.requestId, input.staffUserId);
      }
      await dal.volunteerRoles.assertNoVolunteerActivityInTx(c, input.requestId);
      return dal.volunteerRequests.unapproveForCorrectionInTx(c, input.requestId, input.staffUserId);
    });
  } catch (err) {
    mapActivityError(err, "This request has donor or volunteer activity and cannot be unapproved.");
  }
}

/** Store an uploaded image while preserving request lifecycle metadata. */
export async function saveStaffRequestImage(input: {
  kind: RequestKind;
  requestId: string;
  staffUserId: string;
  imageUrl: string;
}): Promise<{ request: ItemRequest | VolunteerRequest; previousImageUrl: string | null }> {
  const staff: DbContext = { kind: "staff", userId: input.staffUserId };
  try {
    return await withDbContext(staff, async (c) => {
      const locked = await lockEditableRequest(c, input.kind, input.requestId);
      if (input.kind === "item") {
        const request = await dal.itemRequests.updateInTx(c, locked.orgId, input.requestId, {
          imageUrl: input.imageUrl,
          imageGenerated: false,
          imageGenStatus: null,
          imageGenError: null,
        });
        return { request, previousImageUrl: locked.imageUrl };
      }
      const request = await dal.volunteerRequests.updateInTx(c, locked.orgId, input.requestId, {
        imageUrl: input.imageUrl,
        imageGenerated: false,
        imageGenStatus: null,
        imageGenError: null,
      });
      return { request, previousImageUrl: locked.imageUrl };
    });
  } catch (err) {
    mapActivityError(err);
  }
}