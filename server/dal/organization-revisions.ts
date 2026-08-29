/**
 * Audit trail for direct staff-admin organization profile edits.
 *
 * These rows are deliberately separate from approval_events: an edit does not
 * change lifecycle status and must not manufacture an organization context.
 */
import type { PoolClient } from "pg";
import { q, withDbContext, type DbContext } from "../db/client";

export type OrganizationChangedFields = Record<
  string,
  { before: string | string[] | null; after: string | string[] | null }
>;

export type OrganizationRevision = {
  id: string;
  organizationId: string;
  actorUserId: string;
  changedFields: OrganizationChangedFields;
  createdAt: string;
};

export type OrganizationRevisionWithActor = OrganizationRevision & {
  actorName: string | null;
};

const COLS = `orv.id, orv.organization_id as "organizationId",
  orv.actor_user_id as "actorUserId", orv.changed_fields as "changedFields",
  orv.created_at as "createdAt"`;

export async function insertInTx(
  c: PoolClient,
  input: { organizationId: string; actorUserId: string; changedFields: OrganizationChangedFields },
): Promise<void> {
  await c.query(
    `insert into organization_revisions (organization_id, actor_user_id, changed_fields)
     values ($1, $2, $3::jsonb)`,
    [input.organizationId, input.actorUserId, JSON.stringify(input.changedFields)],
  );
}

export async function listByOrganization(
  ctx: DbContext,
  organizationId: string,
): Promise<OrganizationRevisionWithActor[]> {
  return withDbContext(ctx, (c) =>
    q<OrganizationRevisionWithActor>(
      c,
      `select ${COLS},
              nullif(trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), '') as "actorName"
         from organization_revisions orv
         join users u on u.id = orv.actor_user_id
         join people p on p.id = u.person_id
        where orv.organization_id = $1
        order by orv.created_at desc`,
      [organizationId],
    ),
  );
}
