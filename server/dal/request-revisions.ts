/**
 * Revision entries for staff content corrections to item and volunteer needs.
 * Written in the same transaction as a successful save; separate from the
 * approval_events table which tracks lifecycle status transitions.
 *
 * Summaries name changed fields (never contact values) and child counts.
 */
import type { PoolClient } from "pg";
import { q, withDbContext, type DbContext } from "../db/client";
import type { RequestRevisionWithActor } from "../../shared/types";

const SELECT_COLS = `rr.id,
  rr.entity_type as "entityType",
  rr.entity_id as "entityId",
  rr.actor_user_id as "actorUserId",
  rr.summary,
  rr.created_at as "createdAt"`;

export type InsertRevisionInput = {
  entityType: "item_request" | "volunteer_request";
  entityId: string;
  actorUserId: string;
  summary: string;
};

/** Same-transaction insert — call after the edit succeeds in the same tx. */
export async function insertInTx(client: PoolClient, input: InsertRevisionInput): Promise<void> {
  await client.query(
    `insert into request_revisions (entity_type, entity_id, actor_user_id, summary)
     values ($1, $2, $3, $4)`,
    [input.entityType, input.entityId, input.actorUserId, input.summary],
  );
}

/** All revision entries for one entity, newest first, with actor name joined. */
export async function listByEntity(
  ctx: DbContext,
  entityType: "item_request" | "volunteer_request",
  entityId: string,
): Promise<RequestRevisionWithActor[]> {
  const sql = `
    select ${SELECT_COLS},
           case when p.id is null then null
                else nullif(trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), '')
           end as "actorName"
    from request_revisions rr
    left join users u on u.id = rr.actor_user_id
    left join people p on p.id = u.person_id
    where rr.entity_type = $1 and rr.entity_id = $2
    order by rr.created_at desc`;
  return withDbContext(ctx, (c) => q<RequestRevisionWithActor>(c, sql, [entityType, entityId]));
}
