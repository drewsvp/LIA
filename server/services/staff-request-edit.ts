/**
 * ADMIN-02 staff correction flow.
 *
 * Staff may fully correct a pending request, or a draft that staff previously
 * returned, only before approval and before any donor/volunteer activity.
 * Request fields, contact attachment, and the complete ordered child structure
 * commit together. Activity counters are not present in the input types and the
 * child DALs reject the transaction if any activity exists.
 *
 * Successful content edits and image uploads write a request_revisions entry
 * in the same transaction. Failed saves, validation rejections, and automatic
 * image attempts never write a revision entry.
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
  reason = "This request has donor or volunteer activity and cannot be edited.",
): never {
  if (
    err instanceof dal.items.RequestHasItemActivityError ||
    err instanceof dal.volunteerRoles.RequestHasVolunteerActivityError
  ) {
    throw new StaffRequestEditConflictError(reason);
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
  if (
    err instanceof dal.items.UnknownItemOnRequestError ||
    err instanceof dal.volunteerRoles.UnknownRoleOnRequestError
  ) {
    throw new StaffRequestEditConflictError("The request changed while you were editing. Reload it and try again.");
  }
  throw err;
}

// ── Before-state reads for diff summary ─────────────────────────────────────

type BeforeContact = {
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
};

type ItemBeforeState = {
  title: string;
  description: string | null;
  deadlineType: string;
  deadlineDate: string | null;
  dropoffLocation: string | null;
  peopleHelped: number | null;
  contact: BeforeContact;
  childIds: string[];
};

type VolunteerBeforeState = {
  title: string;
  description: string | null;
  details: string | null;
  deadlineType: string;
  deadlineDate: string | null;
  eventLocation: string | null;
  peopleHelped: number | null;
  contact: BeforeContact;
  childIds: string[];
  categoryIds: string[];
};

async function readItemBeforeState(c: PoolClient, requestId: string): Promise<ItemBeforeState> {
  type Row = {
    title: string;
    description: string | null;
    deadlineType: string;
    deadlineDate: string | null;
    dropoffLocation: string | null;
    peopleHelped: number | null;
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    phone: string | null;
  };
  const rows = await c.query<Row>(
    `select ir.title, ir.description,
            ir.deadline_type as "deadlineType", ir.deadline_date as "deadlineDate",
            ir.dropoff_location as "dropoffLocation", ir.people_helped as "peopleHelped",
            p.first_name as "firstName", p.last_name as "lastName",
            p.email, p.phone
       from item_requests ir
       left join people p on p.id = ir.contact_person_id
      where ir.id = $1`,
    [requestId],
  );
  const r = rows.rows[0];
  if (!r) throw new RequestNotFoundError(requestId);
  const childRows = await c.query<{ id: string }>(
    `select id from items where item_request_id = $1 order by sort_order asc, created_at asc`,
    [requestId],
  );
  return {
    title: r.title,
    description: r.description,
    deadlineType: r.deadlineType,
    deadlineDate: r.deadlineDate,
    dropoffLocation: r.dropoffLocation,
    peopleHelped: r.peopleHelped,
    contact: { firstName: r.firstName, lastName: r.lastName, email: r.email, phone: r.phone },
    childIds: childRows.rows.map((row) => row.id),
  };
}

async function readVolunteerBeforeState(c: PoolClient, requestId: string): Promise<VolunteerBeforeState> {
  type Row = {
    title: string;
    description: string | null;
    details: string | null;
    deadlineType: string;
    deadlineDate: string | null;
    eventLocation: string | null;
    peopleHelped: number | null;
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    phone: string | null;
  };
  const rows = await c.query<Row>(
    `select vr.title, vr.description, vr.details,
            vr.deadline_type as "deadlineType", vr.deadline_date as "deadlineDate",
            vr.event_location as "eventLocation", vr.people_helped as "peopleHelped",
            p.first_name as "firstName", p.last_name as "lastName",
            p.email, p.phone
       from volunteer_requests vr
       left join people p on p.id = vr.contact_person_id
      where vr.id = $1`,
    [requestId],
  );
  const r = rows.rows[0];
  if (!r) throw new RequestNotFoundError(requestId);
  const childRows = await c.query<{ id: string }>(
    `select id from volunteer_roles where volunteer_request_id = $1 order by sort_order asc, created_at asc`,
    [requestId],
  );
  const catRows = await c.query<{ categoryId: string }>(
    `select category_id as "categoryId" from volunteer_request_categories
      where volunteer_request_id = $1 order by category_id`,
    [requestId],
  );
  return {
    title: r.title,
    description: r.description,
    details: r.details,
    deadlineType: r.deadlineType,
    deadlineDate: r.deadlineDate,
    eventLocation: r.eventLocation,
    peopleHelped: r.peopleHelped,
    contact: { firstName: r.firstName, lastName: r.lastName, email: r.email, phone: r.phone },
    childIds: childRows.rows.map((row) => row.id),
    categoryIds: catRows.rows.map((row) => row.categoryId),
  };
}

/** Detect which child IDs were added, removed, or reordered vs. the before snapshot. */
function childrenDiff(
  beforeIds: string[],
  inputChildren: Array<{ id?: string }>,
): { added: number; removed: number; reordered: boolean } {
  const beforeSet = new Set(beforeIds);
  const afterIds = inputChildren.map((ch) => ch.id).filter((id): id is string => id !== undefined);
  const afterSet = new Set(afterIds);

  const added = inputChildren.filter((ch) => ch.id === undefined || !beforeSet.has(ch.id)).length;
  const removed = beforeIds.filter((id) => !afterSet.has(id)).length;

  // Reorder: compare the relative order of surviving IDs.
  const beforeSurviving = beforeIds.filter((id) => afterSet.has(id));
  const afterSurviving = afterIds.filter((id) => beforeSet.has(id));
  const reordered = beforeSurviving.join(",") !== afterSurviving.join(",");

  return { added, removed, reordered };
}

function buildItemRevisionSummary(before: ItemBeforeState, input: StaffItemRequestEditInput): string {
  const changed: string[] = [];

  if (before.title !== input.fields.title) changed.push("title");
  if (before.description !== input.fields.description) changed.push("description");
  if (
    before.deadlineType !== input.fields.deadlineType ||
    before.deadlineDate !== input.fields.deadlineDate
  ) {
    changed.push("deadline");
  }
  if (before.dropoffLocation !== input.fields.dropoffLocation) changed.push("drop-off location");
  if (before.peopleHelped !== input.fields.peopleHelped) changed.push("people helped");

  const contactChanged =
    before.contact.firstName !== input.fields.contact.firstName ||
    before.contact.lastName !== input.fields.contact.lastName ||
    before.contact.email !== input.fields.contact.email ||
    before.contact.phone !== input.fields.contact.phone;
  if (contactChanged) changed.push("contact");

  const { added, removed, reordered } = childrenDiff(before.childIds, input.children);
  const childParts: string[] = [];
  if (added > 0) childParts.push(`${added} added`);
  if (removed > 0) childParts.push(`${removed} removed`);
  if (reordered) childParts.push("reordered");

  const parts: string[] = [];
  if (changed.length > 0) parts.push(`Edited: ${changed.join(", ")}`);
  if (childParts.length > 0) parts.push(`Items: ${childParts.join(", ")}`);
  return parts.length > 0 ? parts.join("; ") : "Saved (no changes detected)";
}

function buildVolunteerRevisionSummary(before: VolunteerBeforeState, input: StaffVolunteerRequestEditInput): string {
  const changed: string[] = [];

  if (before.title !== input.fields.title) changed.push("title");
  if (before.description !== input.fields.description) changed.push("description");
  if (before.details !== input.fields.details) changed.push("details");
  if (
    before.deadlineType !== input.fields.deadlineType ||
    before.deadlineDate !== input.fields.deadlineDate
  ) {
    changed.push("deadline");
  }
  if (before.eventLocation !== input.fields.eventLocation) changed.push("event location");
  if (before.peopleHelped !== input.fields.peopleHelped) changed.push("people helped");

  const contactChanged =
    before.contact.firstName !== input.fields.contact.firstName ||
    before.contact.lastName !== input.fields.contact.lastName ||
    before.contact.email !== input.fields.contact.email ||
    before.contact.phone !== input.fields.contact.phone;
  if (contactChanged) changed.push("contact");

  const sortedInputCategoryIds = [...input.categoryIds].sort().join(",");
  if (before.categoryIds.join(",") !== sortedInputCategoryIds) changed.push("categories");

  const { added, removed, reordered } = childrenDiff(before.childIds, input.children);
  const childParts: string[] = [];
  if (added > 0) childParts.push(`${added} added`);
  if (removed > 0) childParts.push(`${removed} removed`);
  if (reordered) childParts.push("reordered");

  const parts: string[] = [];
  if (changed.length > 0) parts.push(`Edited: ${changed.join(", ")}`);
  if (childParts.length > 0) parts.push(`Roles: ${childParts.join(", ")}`);
  return parts.length > 0 ? parts.join("; ") : "Saved (no changes detected)";
}

export async function saveStaffRequestEdits(
  input: StaffRequestEditInput,
): Promise<{ request: ItemRequest | VolunteerRequest }> {
  const staff: DbContext = { kind: "staff", userId: input.staffUserId };
  const entityType = input.kind === "item" ? "item_request" : "volunteer_request";
  try {
    return await withDbContext(staff, async (c) => {
      const locked = await lockEditableRequest(c, input.kind, input.requestId);

      if (input.kind === "item") {
        const before = await readItemBeforeState(c, input.requestId);
        const person = await resolveContactInTx(
          c,
          locked.orgId,
          locked.contactPersonId,
          input.fields.contact,
          `${input.kind} request contact (ADMIN-02 staff edit)`,
        );

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

        const summary = buildItemRevisionSummary(before, input);
        await dal.requestRevisions.insertInTx(c, {
          entityType,
          entityId: input.requestId,
          actorUserId: input.staffUserId,
          summary,
        });

        return { request };
      }

      // volunteer
      const before = await readVolunteerBeforeState(c, input.requestId);
      const person = await resolveContactInTx(
        c,
        locked.orgId,
        locked.contactPersonId,
        input.fields.contact,
        `${input.kind} request contact (ADMIN-02 staff edit)`,
      );

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

      const summary = buildVolunteerRevisionSummary(before, input);
      await dal.requestRevisions.insertInTx(c, {
        entityType,
        entityId: input.requestId,
        actorUserId: input.staffUserId,
        summary,
      });

      return { request };
    });
  } catch (err) {
    mapActivityError(err, "This request has donor or volunteer activity and cannot be edited in its current status.");
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
  const entityType = input.kind === "item" ? "item_request" : "volunteer_request";
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
        await dal.requestRevisions.insertInTx(c, {
          entityType,
          entityId: input.requestId,
          actorUserId: input.staffUserId,
          summary: "Image uploaded",
        });
        return { request, previousImageUrl: locked.imageUrl };
      }
      const request = await dal.volunteerRequests.updateInTx(c, locked.orgId, input.requestId, {
        imageUrl: input.imageUrl,
        imageGenerated: false,
        imageGenStatus: null,
        imageGenError: null,
      });
      await dal.requestRevisions.insertInTx(c, {
        entityType,
        entityId: input.requestId,
        actorUserId: input.staffUserId,
        summary: "Image uploaded",
      });
      return { request, previousImageUrl: locked.imageUrl };
    });
  } catch (err) {
    mapActivityError(err);
  }
}
