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
  orgId: string;
  orgName: string;
  orgCity: string | null;
  orgStatus: "pending" | "approved" | "disabled";
  childCount: number;
};

export async function listByStatus(ctx: DbContext, status: RequestStatus): Promise<AdminQueueRow[]> {
  return withDbContext(ctx, (c) =>
    q<AdminQueueRow>(
      c,
      `select 'item' as type, r.id, r.title, r.status, r.submitted_at as "submittedAt", r.created_at as "createdAt",
              o.id as "orgId", o.name as "orgName", o.city as "orgCity", o.status as "orgStatus",
              (select count(*)::int from items i where i.item_request_id = r.id) as "childCount"
         from item_requests r
         join organizations o on o.id = r.org_id
        where r.status = $1
        union all
       select 'volunteer', v.id, v.title, v.status, v.submitted_at, v.created_at,
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
