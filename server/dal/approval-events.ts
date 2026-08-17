/**
 * Approval events — every status transition writes a row, in the same
 * transaction as the status change (replit.md rule 4). Automated transitions
 * (nightly expiry, auto-archive on fulfillment) carry a null actor.
 */
import type { PoolClient } from "pg";
import { q, withDbContext, type DbContext } from "../db/client";
import type { ApprovalEvent, ApprovalEntityType } from "../../shared/types";

const COLS = `id, entity_type as "entityType", entity_id as "entityId", from_status as "fromStatus",
  to_status as "toStatus", actor_user_id as "actorUserId", note, created_at as "createdAt"`;

export type InsertApprovalEventInput = {
  entityType: ApprovalEntityType;
  entityId: string;
  fromStatus?: string | null;
  toStatus: string;
  actorUserId?: string | null;
  note?: string | null;
};

/**
 * Same-transaction insert used by the DAL's own transition functions.
 * Takes the open client so the event commits or rolls back with the change.
 */
export async function insertInTx(client: PoolClient, input: InsertApprovalEventInput): Promise<ApprovalEvent> {
  const rows = await q<ApprovalEvent>(
    client,
    `insert into approval_events (entity_type, entity_id, from_status, to_status, actor_user_id, note)
     values ($1, $2, $3, $4, $5, $6) returning ${COLS}`,
    [
      input.entityType,
      input.entityId,
      input.fromStatus ?? null,
      input.toStatus,
      input.actorUserId ?? null,
      input.note ?? null,
    ],
  );
  const event = rows[0];
  if (!event) throw new Error("approvalEvents.insertInTx returned no row");
  return event;
}

/** Standalone insert. Prefer the transition functions, which write their own events. */
export async function insert(ctx: DbContext, input: InsertApprovalEventInput): Promise<ApprovalEvent> {
  return withDbContext(ctx, (c) => insertInTx(c, input));
}

/** Full history for one entity, newest first. */
export async function listByEntity(
  ctx: DbContext,
  entityType: ApprovalEntityType,
  entityId: string,
): Promise<ApprovalEvent[]> {
  return withDbContext(ctx, (c) =>
    q<ApprovalEvent>(
      c,
      `select ${COLS} from approval_events
        where entity_type = $1 and entity_id = $2 order by created_at desc`,
      [entityType, entityId],
    ),
  );
}

/** Recent events across all entities, newest first (ADMIN-07). */
export async function listRecent(ctx: DbContext, limit = 100): Promise<ApprovalEvent[]> {
  return withDbContext(ctx, (c) =>
    q<ApprovalEvent>(c, `select ${COLS} from approval_events order by created_at desc limit $1`, [limit]),
  );
}

/**
 * Re-point actor_user_id from one user to another across all events.
 * Seed-migration support (legacy synthetic staff_admin removal) — the events
 * themselves are immutable history and keep their timestamps and notes.
 * Returns how many rows changed.
 */
export async function reassignActor(ctx: DbContext, fromUserId: string, toUserId: string): Promise<number> {
  const rows = await withDbContext(ctx, (c) =>
    q<{ id: string }>(c, `update approval_events set actor_user_id = $2 where actor_user_id = $1 returning id`, [
      fromUserId,
      toUserId,
    ]),
  );
  return rows.length;
}

// ---------------------------------------------------------------------
// ADMIN-07 reads. This surface writes nothing (spec §3) — read-only fns.

export type ActivityFilters = {
  entityType?: string;
  /** Filter to events with a null actor (the "Automated" option). */
  automated?: boolean;
  actorUserId?: string;
  entityId?: string;
  /** Inclusive YYYY-MM-DD bounds on created_at. */
  createdFrom?: string;
  createdTo?: string;
  limit?: number;
};

export type ActivityEventRow = ApprovalEvent & { actorName: string | null };

/** Filtered event list, newest first, actor name joined through users→people. */
export async function listWithFilters(ctx: DbContext, f: ActivityFilters = {}): Promise<ActivityEventRow[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (f.entityType !== undefined) {
    params.push(f.entityType);
    where.push(`ae.entity_type = $${params.length}`);
  }
  if (f.automated === true) {
    where.push(`ae.actor_user_id is null`);
  } else if (f.actorUserId !== undefined) {
    params.push(f.actorUserId);
    where.push(`ae.actor_user_id = $${params.length}`);
  }
  if (f.entityId !== undefined) {
    params.push(f.entityId);
    where.push(`ae.entity_id = $${params.length}`);
  }
  if (f.createdFrom !== undefined) {
    params.push(f.createdFrom);
    where.push(`(ae.created_at at time zone 'America/Los_Angeles')::date >= $${params.length}::date`);
  }
  if (f.createdTo !== undefined) {
    params.push(f.createdTo);
    where.push(`(ae.created_at at time zone 'America/Los_Angeles')::date <= $${params.length}::date`);
  }
  params.push(Math.min(f.limit ?? 200, 500));
  const sql = `select ae.id, ae.entity_type as "entityType", ae.entity_id as "entityId",
      ae.from_status as "fromStatus", ae.to_status as "toStatus",
      ae.actor_user_id as "actorUserId", ae.note, ae.created_at as "createdAt",
      case when p.id is null then null
           else nullif(trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), '') end as "actorName"
    from approval_events ae
    left join users u on u.id = ae.actor_user_id
    left join people p on p.id = u.person_id
    ${where.length > 0 ? `where ${where.join(" and ")}` : ""}
    order by ae.created_at desc
    limit $${params.length}`;
  return withDbContext(ctx, (c) => q<ActivityEventRow>(c, sql, params));
}

/** Distinct actors who have recorded events, for the filter dropdown. */
export async function listActors(
  ctx: DbContext,
): Promise<{ actors: Array<{ userId: string; name: string }>; hasAutomated: boolean }> {
  return withDbContext(ctx, async (c) => {
    const actors = await q<{ userId: string; name: string }>(
      c,
      `select distinct u.id as "userId",
         coalesce(nullif(trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), ''), 'Unknown user') as name
       from approval_events ae
       join users u on u.id = ae.actor_user_id
       join people p on p.id = u.person_id
       order by name`,
      [],
    );
    const auto = await q<{ exists: boolean }>(
      c,
      `select exists(select 1 from approval_events where actor_user_id is null) as exists`,
      [],
    );
    return { actors, hasAutomated: auto[0]?.exists ?? false };
  });
}
