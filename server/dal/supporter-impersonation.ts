import type { PoolClient } from "pg";
import { q, withDbContext, type DbContext } from "../db/client";
import { recordAuditInTx } from "./admin-supporters";

export type ActiveSupporterContext = {
  id: string;
  adminUserId: string;
  supporterUserId: string;
  supporterName: string;
  startedAt: string;
  expiresAt: string;
};

export async function start(
  ctx: DbContext,
  input: { adminUserId: string; supporterUserId: string },
): Promise<ActiveSupporterContext> {
  return withDbContext(ctx, async (client) => {
    const stale = await q<{ id: string; supporterUserId: string }>(
      client,
      `update supporter_impersonation_contexts
          set ended_at = now(), end_reason = 'expired'
        where admin_user_id = $1 and ended_at is null and expires_at <= now()
        returning id, supporter_user_id as "supporterUserId"`,
      [input.adminUserId],
    );
    for (const context of stale) {
      await recordAuditInTx(client, {
        actorUserId: input.adminUserId,
        targetUserId: context.supporterUserId,
        contextId: context.id,
        action: "impersonate",
        outcome: "expired",
      });
    }
    const target = await q<{ id: string; name: string }>(
      client,
      `select u.id, trim(p.first_name || ' ' || p.last_name) as name
         from users u join people p on p.id = u.person_id
        where u.id = $1 and u.kind = 'supporter' and u.status = 'active'
          and not exists (
            select 1 from org_memberships om
             where om.user_id = u.id and om.status = 'active'
          )
        for update`,
      [input.supporterUserId],
    );
    if (!target[0]) throw new Error("SUPPORTER_NOT_ELIGIBLE");
    const current = await q<{ id: string }>(
      client,
      `select id from supporter_impersonation_contexts
        where admin_user_id = $1 and ended_at is null
        for update`,
      [input.adminUserId],
    );
    if (current[0]) throw new Error("SUPPORTER_CONTEXT_ACTIVE");
    const rows = await q<ActiveSupporterContext>(
      client,
      `insert into supporter_impersonation_contexts (admin_user_id, supporter_user_id)
       values ($1, $2)
       returning id, admin_user_id as "adminUserId", supporter_user_id as "supporterUserId",
         $3::text as "supporterName", started_at as "startedAt", expires_at as "expiresAt"`,
      [input.adminUserId, input.supporterUserId, target[0].name],
    );
    const context = rows[0];
    if (!context) throw new Error("Supporter context was not created.");
    await recordAuditInTx(client, {
      actorUserId: input.adminUserId,
      targetUserId: input.supporterUserId,
      contextId: context.id,
      action: "impersonate",
      outcome: "started",
    });
    return context;
  });
}

export async function getActive(
  ctx: DbContext,
  contextId: string,
  adminUserId: string,
): Promise<ActiveSupporterContext | null> {
  return withDbContext(ctx, async (client) => {
    const rows = await q<ActiveSupporterContext>(
      client,
      `select c.id, c.admin_user_id as "adminUserId", c.supporter_user_id as "supporterUserId",
              trim(p.first_name || ' ' || p.last_name) as "supporterName",
              c.started_at as "startedAt", c.expires_at as "expiresAt",
              u.status as "supporterStatus"
         from supporter_impersonation_contexts c
         join users u on u.id = c.supporter_user_id and u.kind = 'supporter'
         join people p on p.id = u.person_id
        where c.id = $1 and c.admin_user_id = $2 and c.ended_at is null
        for update of c`,
      [contextId, adminUserId],
    );
    const context = rows[0];
    if (!context) return null;
    if (new Date(context.expiresAt).getTime() <= Date.now()) {
      await endInTx(client, context.id, adminUserId, "expired");
      return null;
    }
    const status = (context as ActiveSupporterContext & { supporterStatus?: string }).supporterStatus;
    if (status !== "active") {
      await endInTx(client, context.id, adminUserId, "target_disabled");
      return null;
    }
    return context;
  });
}

async function endInTx(client: PoolClient, contextId: string, adminUserId: string, reason: string): Promise<boolean> {
  const rows = await q<{ id: string; supporterUserId: string }>(
    client,
    `update supporter_impersonation_contexts
        set ended_at = now(), end_reason = $3
      where id = $1 and admin_user_id = $2 and ended_at is null
      returning id, supporter_user_id as "supporterUserId"`,
    [contextId, adminUserId, reason],
  );
  const row = rows[0];
  if (!row) return false;
  await recordAuditInTx(client, {
    actorUserId: adminUserId,
    targetUserId: row.supporterUserId,
    contextId,
    action: "impersonate",
    outcome: reason === "exited" ? "ended" : reason,
  });
  return true;
}

export async function end(ctx: DbContext, contextId: string, adminUserId: string, reason = "exited"): Promise<boolean> {
  return withDbContext(ctx, (client) => endInTx(client, contextId, adminUserId, reason));
}