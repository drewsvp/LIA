import type { PoolClient } from "pg";
import { q, withDbContext, type DbContext } from "../db/client";
import type { ActiveOrganizationContext } from "../auth/organization-context-store";

export type AdminOrganizationContext = ActiveOrganizationContext & {
  adminUserId: string;
  endedAt: string | null;
  expiresAt: string;
};

const SELECT_COLS = `c.id,
  c.admin_user_id as "adminUserId",
  c.organization_id as "organizationId",
  o.name as "organizationName",
  c.started_at as "startedAt",
  c.ended_at as "endedAt",
  c.expires_at as "expiresAt"`;

export async function getActive(
  ctx: DbContext,
  contextId: string,
  adminUserId: string,
): Promise<AdminOrganizationContext | null> {
  return withDbContext(ctx, async (c) => {
    const rows = await q<AdminOrganizationContext & {
      organizationKind: string;
      organizationStatus: string;
    }>(
      c,
      `select ${SELECT_COLS}
              , o.kind as "organizationKind", o.status as "organizationStatus"
         from admin_organization_contexts c
         join organizations o on o.id = c.organization_id
        where c.id = $1
          and c.admin_user_id = $2
          and c.ended_at is null
        for update of c`,
      [contextId, adminUserId],
    );
    const context = rows[0];
    if (!context) return null;
    const expired = new Date(context.expiresAt).getTime() <= Date.now();
    if (
      expired ||
      context.organizationKind !== "member_org" ||
      context.organizationStatus !== "approved"
    ) {
      await q<{ id: string }>(
        c,
        `update admin_organization_contexts set ended_at = now()
          where id = $1 and ended_at is null returning id`,
        [context.id],
      );
      await insertAuditInTx(
        c,
        context.id,
        context.organizationId,
        adminUserId,
        expired ? "expired" : "invalidated",
      );
      return null;
    }
    return context;
  });
}

export async function start(
  ctx: DbContext,
  adminUserId: string,
  organizationId: string,
  currentContextId: string | null = null,
): Promise<AdminOrganizationContext> {
  return withDbContext(ctx, async (c) => {
    const organizations = await q<{ id: string; name: string }>(
      c,
      `select id, name from organizations
        where id = $1 and kind = 'member_org' and status = 'approved'
        for update`,
      [organizationId],
    );
    const organization = organizations[0];
    if (!organization) throw new Error("ORGANIZATION_NOT_ELIGIBLE");
    const stale = await q<AdminOrganizationContext & {
      organizationKind: string;
      organizationStatus: string;
    }>(
      c,
      `select ${SELECT_COLS},
              o.kind as "organizationKind", o.status as "organizationStatus"
         from admin_organization_contexts c
         join organizations o on o.id = c.organization_id
        where c.admin_user_id = $1 and c.ended_at is null
        for update of c`,
      [adminUserId],
    );
    for (const existing of stale) {
      const expired = new Date(existing.expiresAt).getTime() <= Date.now();
      if (
        !expired &&
        existing.organizationKind === "member_org" &&
        existing.organizationStatus === "approved"
      ) {
        if (currentContextId !== null) {
          throw new Error("ORGANIZATION_CONTEXT_ACTIVE");
        }
        await c.query(
          `update admin_organization_contexts set ended_at = now() where id = $1 and ended_at is null`,
          [existing.id],
        );
        await insertAuditInTx(
          c,
          existing.id,
          existing.organizationId,
          adminUserId,
          "recovered",
        );
        continue;
      }
      await c.query(
        `update admin_organization_contexts set ended_at = now() where id = $1 and ended_at is null`,
        [existing.id],
      );
      await insertAuditInTx(
        c,
        existing.id,
        existing.organizationId,
        adminUserId,
        expired ? "expired" : "invalidated",
      );
    }
    const rows = await q<AdminOrganizationContext>(
      c,
      `insert into admin_organization_contexts (admin_user_id, organization_id)
       values ($1, $2)
       returning id, admin_user_id as "adminUserId", organization_id as "organizationId",
         $3::text as "organizationName", started_at as "startedAt",
         ended_at as "endedAt", expires_at as "expiresAt"`,
      [adminUserId, organizationId, organization.name],
    );
    const context = rows[0];
    if (!context) throw new Error("admin organization context was not created");
    await insertAuditInTx(c, context.id, organizationId, adminUserId, "entered");
    return context;
  });
}

export async function end(
  ctx: DbContext,
  contextId: string,
  adminUserId: string,
  reason = "exited",
): Promise<AdminOrganizationContext | null> {
  return withDbContext(ctx, async (c) => {
    const rows = await q<AdminOrganizationContext>(
      c,
      `update admin_organization_contexts c
          set ended_at = now()
         from organizations o
        where c.id = $1 and c.admin_user_id = $2 and c.ended_at is null
          and o.id = c.organization_id
        returning c.id, c.admin_user_id as "adminUserId",
          c.organization_id as "organizationId", o.name as "organizationName",
          c.started_at as "startedAt", c.ended_at as "endedAt",
          c.expires_at as "expiresAt"`,
      [contextId, adminUserId],
    );
    const context = rows[0] ?? null;
    if (context) await insertAuditInTx(c, context.id, context.organizationId, adminUserId, reason);
    return context;
  });
}

async function insertAuditInTx(
  c: PoolClient,
  contextId: string,
  organizationId: string,
  actorUserId: string,
  action: string,
): Promise<void> {
  await c.query(
    `insert into organization_context_actions
       (organization_context_id, organization_id, actor_user_id, action, entity_type, entity_id)
     values ($1, $2, $3, $4, 'organization', $2)`,
    [contextId, organizationId, actorUserId, action],
  );
  await c.query(
    `insert into approval_events
       (entity_type, entity_id, from_status, to_status, actor_user_id,
        organization_context_id, context_organization_id, note)
     values ('organization_context', $2, null, $4, $3, $1, $2, null)`,
    [contextId, organizationId, actorUserId, action],
  );
}