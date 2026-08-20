/**
 * ADMIN-02 — the unified request queue (docs/specs/ADMIN-02.md §3, §4).
 * Both request types in one list because the operator's job is the same for
 * both and splitting them doubles the places she has to check; the type
 * filter is client-side narrowing, not a second query. Read-only — every
 * write on that surface goes through the request dals.
 */
import { q, withDbContext, type DbContext } from "../db/client";
import type { RequestStatus } from "../../shared/types";

export type AdminQueueRow = {
  type: "item" | "volunteer";
  id: string;
  title: string;
  status: RequestStatus;
  submittedAt: string | null;
  createdAt: string;
  deadlineType: "date_specific" | "until_fulfilled" | "ongoing";
  /** Calendar date stored by the current request form. */
  deadlineDate: string | null;
  /** Calendar date imported from the legacy Archive On field. */
  expiresOn: string | null;
  orgId: string;
  orgName: string;
  orgCity: string | null;
  orgStatus: "pending" | "approved" | "disabled";
  childCount: number;
  returnedAt?: string;
};

export async function listByStatus(ctx: DbContext, status: RequestStatus): Promise<AdminQueueRow[]> {
  return withDbContext(ctx, (c) =>
    q<AdminQueueRow>(
      c,
       `select 'item' as type, r.id, r.title, r.status, r.submitted_at as "submittedAt", r.created_at as "createdAt",
               r.deadline_type as "deadlineType", r.deadline_date as "deadlineDate", r.expires_on as "expiresOn",
              o.id as "orgId", o.name as "orgName", o.city as "orgCity", o.status as "orgStatus",
              (select count(*)::int from items i where i.item_request_id = r.id) as "childCount"
         from item_requests r
         join organizations o on o.id = r.org_id
        where r.status = $1
        union all
       select 'volunteer', v.id, v.title, v.status, v.submitted_at, v.created_at,
               v.deadline_type, v.deadline_date, v.expires_on,
              o.id, o.name, o.city, o.status,
              (select count(*)::int from volunteer_roles vr where vr.volunteer_request_id = v.id)
         from volunteer_requests v
         join organizations o on o.id = v.org_id
        where v.status = $1
        order by "submittedAt" asc nulls last, "createdAt" asc`,
      [status],
    ),
  );
}

/** Only submitted requests that staff actually returned, never ordinary organization drafts. */
export async function listReturnedDrafts(ctx: DbContext): Promise<AdminQueueRow[]> {
  return withDbContext(ctx, (c) =>
    q<AdminQueueRow>(
      c,
       `select 'item' as type, r.id, r.title, r.status, r.submitted_at as "submittedAt", r.created_at as "createdAt",
               r.deadline_type as "deadlineType", r.deadline_date as "deadlineDate", r.expires_on as "expiresOn",
              o.id as "orgId", o.name as "orgName", o.city as "orgCity", o.status as "orgStatus",
              (select count(*)::int from items i where i.item_request_id = r.id) as "childCount",
              latest.created_at as "returnedAt"
         from item_requests r
         join organizations o on o.id = r.org_id
         join lateral (
           select ae.created_at
             from approval_events ae
            where ae.entity_type = 'item_request' and ae.entity_id = r.id
              and ae.from_status = 'pending' and ae.to_status = 'draft'
            order by ae.created_at desc
            limit 1
         ) latest on true
        where r.status = 'draft'
        union all
       select 'volunteer', v.id, v.title, v.status, v.submitted_at, v.created_at,
               v.deadline_type, v.deadline_date, v.expires_on,
              o.id, o.name, o.city, o.status,
              (select count(*)::int from volunteer_roles vr where vr.volunteer_request_id = v.id),
              latest.created_at
         from volunteer_requests v
         join organizations o on o.id = v.org_id
         join lateral (
           select ae.created_at
             from approval_events ae
            where ae.entity_type = 'volunteer_request' and ae.entity_id = v.id
              and ae.from_status = 'pending' and ae.to_status = 'draft'
            order by ae.created_at desc
            limit 1
         ) latest on true
        where v.status = 'draft'
        order by "returnedAt" asc, "createdAt" asc`,
    ),
  );
}

export type LatestReturn = { note: string | null; createdAt: string };

export async function latestReturn(
  ctx: DbContext,
  type: "item" | "volunteer",
  requestId: string,
): Promise<LatestReturn | null> {
  const entityType = type === "item" ? "item_request" : "volunteer_request";
  const rows = await withDbContext(ctx, (c) =>
    q<LatestReturn>(
      c,
      `select note, created_at as "createdAt"
         from approval_events
        where entity_type = $1 and entity_id = $2
          and from_status = 'pending' and to_status = 'draft'
        order by created_at desc
        limit 1`,
      [entityType, requestId],
    ),
  );
  return rows[0] ?? null;
}

/**
 * Snapshot used for display-only enablement. Every write repeats these checks
 * under a request-row lock, so a stale browser can never bypass them.
 */
export async function preApprovalEditability(
  ctx: DbContext,
  type: "item" | "volunteer",
  requestId: string,
): Promise<{
  editable: boolean;
  reason: string | null;
  unapprovable: boolean;
  unapprovalReason: string | null;
}> {
  const table = type === "item" ? "item_requests" : "volunteer_requests";
  const children = type === "item" ? "items" : "volunteer_roles";
  const requestFk = type === "item" ? "item_request_id" : "volunteer_request_id";
  const activityPredicate =
    type === "item"
      ? "coalesce(sum(quantity_claimed), 0) > 0 or coalesce(sum(quantity_received), 0) > 0"
      : "coalesce(sum(quantity_interested), 0) > 0 or coalesce(sum(quantity_confirmed), 0) > 0";
  const activityTable = type === "item" ? "item_pledges" : "volunteer_signups";
  const rows = await withDbContext(ctx, (c) =>
    q<{ status: RequestStatus; approvedAt: string | null; hasActivity: boolean; isReturnedDraft: boolean }>(
      c,
      `select r.status, r.approved_at as "approvedAt",
              (
                exists(select 1 from ${activityTable} a where a.${requestFk} = r.id)
                or exists(
                  select 1 from ${children} ch where ch.${requestFk} = r.id
                  group by ch.${requestFk} having ${activityPredicate}
                )
              ) as "hasActivity",
              exists(
                select 1 from approval_events ae
                 where ae.entity_type = $2 and ae.entity_id = r.id
                   and ae.from_status = 'pending' and ae.to_status = 'draft'
              ) as "isReturnedDraft"
         from ${table} r
        where r.id = $1`,
      [requestId, type === "item" ? "item_request" : "volunteer_request"],
    ),
  );
  const row = rows[0];
  if (!row) {
    return {
      editable: false,
      reason: "Request not found.",
      unapprovable: false,
      unapprovalReason: "Request not found.",
    };
  }
  if (row.status === "active") {
    return {
      editable: true,
      reason: null,
      unapprovable: !row.hasActivity,
      unapprovalReason: row.hasActivity
        ? "This request has donor or volunteer activity and cannot be unapproved."
        : null,
    };
  }
  if (row.approvedAt !== null || row.status === "archived") {
    return {
      editable: false,
      reason: "Approved or archived requests cannot be edited.",
      unapprovable: false,
      unapprovalReason: "Only an active request can be unapproved.",
    };
  }
  if (row.status === "draft" && !row.isReturnedDraft) {
    return {
      editable: false,
      reason: "Only drafts previously returned for changes can be edited by staff.",
      unapprovable: false,
      unapprovalReason: "Only an active request can be unapproved.",
    };
  }
  if (row.hasActivity) {
    return {
      editable: false,
      reason: "This request has donor or volunteer activity and cannot be edited.",
      unapprovable: false,
      unapprovalReason: "Only an active request can be unapproved.",
    };
  }
  return {
    editable: true,
    reason: null,
    unapprovable: false,
    unapprovalReason: "Only an active request can be unapproved.",
  };
}
