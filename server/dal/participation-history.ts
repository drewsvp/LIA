import { q, withDbContext, type DbContext } from "../db/client";
import type { ParticipationHistoryEntry } from "../../shared/types";

export async function listForEntity(
  ctx: DbContext,
  entityType: "item_pledge" | "volunteer_signup",
  entityId: string,
): Promise<ParticipationHistoryEntry[]> {
  return withDbContext(ctx, (client) =>
    q<ParticipationHistoryEntry>(
      client,
      `select ph.id, ph.entity_type as "entityType", ph.entity_id as "entityId",
              ph.action, ph.actor_user_id as "actorUserId",
              nullif(trim(concat_ws(' ', p.first_name, p.last_name)), '') as "actorName",
              ph.reason, ph.before_state as "beforeState", ph.after_state as "afterState",
              ph.created_at as "createdAt"
         from participation_history ph
         join users u on u.id = ph.actor_user_id
         join people p on p.id = u.person_id
        where ph.entity_type = $1 and ph.entity_id = $2
        order by ph.created_at desc, ph.id desc`,
      [entityType, entityId],
    ),
  );
}