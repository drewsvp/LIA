/**
 * Org memberships — the ONLY link between people/users and organizations
 * (replit.md rule 1: membership is never inferred by matching text fields).
 * Removal is a status change, never a DELETE (rule 7).
 */
import type { PoolClient } from "pg";
import { q, withDbContext, type DbContext } from "../db/client";
import type {
  MembershipRole,
  MembershipWithOrganization,
  MembershipWithPerson,
  OrgMembership,
} from "../../shared/types";
import { insertInTx } from "./approval-events";

const COLS = `m.id, m.org_id as "orgId", m.user_id as "userId", m.role, m.status,
  m.invited_by as "invitedBy", m.approved_at as "approvedAt", m.approved_by as "approvedBy",
  m.created_at as "createdAt", m.updated_at as "updatedAt"`;

export type CreateMembershipInput = {
  orgId: string;
  userId: string;
  role?: MembershipRole;
  invitedBy?: string | null;
};

/** Active memberships for a user, joined to org display fields. Guards call this. */
export async function listActiveByUser(ctx: DbContext, userId: string): Promise<MembershipWithOrganization[]> {
  return withDbContext(ctx, (c) =>
    q<MembershipWithOrganization>(
      c,
      `select ${COLS}, o.name as "orgName", o.slug as "orgSlug", o.kind as "orgKind", o.status as "orgStatus"
         from org_memberships m join organizations o on o.id = m.org_id
        where m.user_id = $1 and m.status = 'active' order by o.name asc`,
      [userId],
    ),
  );
}

/**
 * All memberships of an organization joined to person fields (MP-05 list).
 * Runs after the org guard has verified access; callers pass system/staff
 * context because the member RLS policy on org_memberships is own-rows-only.
 */
export async function listByOrganization(ctx: DbContext, orgId: string): Promise<MembershipWithPerson[]> {
  return withDbContext(ctx, (c) =>
    q<MembershipWithPerson>(
      c,
      `select ${COLS}, p.first_name as "firstName", p.last_name as "lastName", p.email, p.phone
         from org_memberships m
         join users u on u.id = m.user_id
         join people p on p.id = u.person_id
        where m.org_id = $1 order by m.created_at asc`,
      [orgId],
    ),
  );
}

export async function getById(ctx: DbContext, membershipId: string): Promise<OrgMembership | null> {
  const rows = await withDbContext(ctx, (c) =>
    q<OrgMembership>(c, `select ${COLS} from org_memberships m where m.id = $1`, [membershipId]),
  );
  return rows[0] ?? null;
}

export async function findByOrgAndUser(ctx: DbContext, orgId: string, userId: string): Promise<OrgMembership | null> {
  const rows = await withDbContext(ctx, (c) =>
    q<OrgMembership>(c, `select ${COLS} from org_memberships m where m.org_id = $1 and m.user_id = $2`, [
      orgId,
      userId,
    ]),
  );
  return rows[0] ?? null;
}

/** Create a membership; starts pending unless activated separately. */
/** Tx-composable lookup by the (org, user) unique pair (MP-06 duplicate check). */
export async function findByOrgAndUserInTx(c: PoolClient, orgId: string, userId: string): Promise<OrgMembership | null> {
  const rows = await q<OrgMembership>(
    c,
    `select id, org_id as "orgId", user_id as "userId", role, status,
            invited_by as "invitedBy", approved_at as "approvedAt", approved_by as "approvedBy",
            created_at as "createdAt", updated_at as "updatedAt"
     from org_memberships where org_id = $1 and user_id = $2`,
    [orgId, userId],
  );
  return rows[0] ?? null;
}

export async function create(ctx: DbContext, input: CreateMembershipInput): Promise<OrgMembership> {
  return withDbContext(ctx, (c) => createInTx(c, input));
}

/** Transaction-composable variant (MP-03 one-tx signup). */
export async function createInTx(c: PoolClient, input: CreateMembershipInput): Promise<OrgMembership> {
  const rows = await q<OrgMembership>(
    c,
    `insert into org_memberships (org_id, user_id, role, status, invited_by)
     values ($1, $2, $3, 'pending', $4)
     returning id, org_id as "orgId", user_id as "userId", role, status,
               invited_by as "invitedBy", approved_at as "approvedAt", approved_by as "approvedBy",
               created_at as "createdAt", updated_at as "updatedAt"`,
    [input.orgId, input.userId, input.role ?? "member", input.invitedBy ?? null],
  );
  const membership = rows[0];
  if (!membership) throw new Error("memberships.create returned no row");
  return membership;
}

/**
 * Activate a membership; writes the event in the same transaction. Sources:
 * pending (approval) and removed (re-add — unique(org_id, user_id) means the
 * removed row IS the person's membership slot, so reactivating it is the only
 * way back in; the event trail records it).
 */
export async function activate(ctx: DbContext, membershipId: string, approvedByUserId: string): Promise<OrgMembership> {
  return withDbContext(ctx, (c) => activateInTx(c, membershipId, approvedByUserId));
}

/**
 * Tx-composable variant (ADMIN-01: the owner membership activates in the same
 * transaction as the organization's approval).
 */
export async function activateInTx(c: PoolClient, membershipId: string, approvedByUserId: string): Promise<OrgMembership> {
  const current = await q<{ status: string }>(
    c,
    `select status from org_memberships where id = $1 for update`,
    [membershipId],
  );
  const from = current[0]?.status;
  if (!from) throw new Error(`memberships.activate: membership not found: ${membershipId}`);
  if (from === "active") throw new Error("memberships.activate: already active");
  const rows = await q<OrgMembership>(
    c,
    `update org_memberships set status = 'active', approved_at = now(), approved_by = $2
      where id = $1
     returning id, org_id as "orgId", user_id as "userId", role, status,
               invited_by as "invitedBy", approved_at as "approvedAt", approved_by as "approvedBy",
               created_at as "createdAt", updated_at as "updatedAt"`,
    [membershipId, approvedByUserId],
  );
  const membership = rows[0];
  if (!membership) throw new Error(`memberships.activate: update failed: ${membershipId}`);
  await insertInTx(c, {
    entityType: "org_membership",
    entityId: membershipId,
    fromStatus: from,
    toStatus: "active",
    actorUserId: approvedByUserId,
  });
  return membership;
}

/**
 * The owner membership of an organization (ADMIN-01 activates it on org
 * approval). Oldest first if data ever holds more than one owner row; MP-03
 * creates exactly one.
 */
export async function findOwnerByOrgInTx(c: PoolClient, orgId: string): Promise<OrgMembership | null> {
  const rows = await q<OrgMembership>(
    c,
    `select id, org_id as "orgId", user_id as "userId", role, status,
            invited_by as "invitedBy", approved_at as "approvedAt", approved_by as "approvedBy",
            created_at as "createdAt", updated_at as "updatedAt"
       from org_memberships where org_id = $1 and role = 'owner'
      order by created_at asc limit 1`,
    [orgId],
  );
  return rows[0] ?? null;
}

/** Remove by status change (never DELETE); writes the event in the same transaction. */
export async function removeByStatus(
  ctx: DbContext,
  membershipId: string,
  actorUserId: string,
  note?: string,
): Promise<OrgMembership> {
  return withDbContext(ctx, async (c) => {
    const current = await q<{ status: string }>(
      c,
      `select status from org_memberships where id = $1 for update`,
      [membershipId],
    );
    const from = current[0]?.status;
    if (!from) throw new Error(`memberships.removeByStatus: membership not found: ${membershipId}`);
    if (from === "removed") throw new Error("memberships.removeByStatus: already removed");
    const rows = await q<OrgMembership>(
      c,
      `update org_memberships set status = 'removed' where id = $1
       returning id, org_id as "orgId", user_id as "userId", role, status,
                 invited_by as "invitedBy", approved_at as "approvedAt", approved_by as "approvedBy",
                 created_at as "createdAt", updated_at as "updatedAt"`,
      [membershipId],
    );
    const membership = rows[0];
    if (!membership) throw new Error(`memberships.removeByStatus: update failed: ${membershipId}`);
    await insertInTx(c, {
      entityType: "org_membership",
      entityId: membershipId,
      fromStatus: from,
      toStatus: "removed",
      actorUserId,
      note: note ?? null,
    });
    return membership;
  });
}

/**
 * Re-invite a removed membership: back to pending for a fresh ADMIN-03 pass
 * (MP-06 §12 — unique(org_id, user_id) means the removed row IS the person's
 * membership slot). A real transition, so the event is written in the same
 * transaction. approved_at / approved_by are left untouched (§3); approval
 * overwrites them when staff act.
 */
export async function reinviteInTx(c: PoolClient, membershipId: string, actorUserId: string): Promise<OrgMembership> {
  const rows = await q<OrgMembership>(
    c,
    `update org_memberships set status = 'pending', invited_by = $2
     where id = $1 and status = 'removed'
     returning id, org_id as "orgId", user_id as "userId", role, status,
               invited_by as "invitedBy", approved_at as "approvedAt", approved_by as "approvedBy",
               created_at as "createdAt", updated_at as "updatedAt"`,
    [membershipId, actorUserId],
  );
  const membership = rows[0];
  if (!membership) throw new Error(`memberships.reinviteInTx: membership not in removed state: ${membershipId}`);
  await insertInTx(c, {
    entityType: "org_membership",
    entityId: membershipId,
    fromStatus: "removed",
    toStatus: "pending",
    actorUserId,
    note: "Reinvited via MP-06",
  });
  return membership;
}

/** Count of active memberships in an organization. */
export async function countActiveForOrganization(ctx: DbContext, orgId: string): Promise<number> {
  const rows = await withDbContext(ctx, (c) =>
    q<{ count: string }>(c, `select count(*)::text as count from org_memberships where org_id = $1 and status = 'active'`, [
      orgId,
    ]),
  );
  return Number(rows[0]?.count ?? 0);
}

/**
 * Re-point every membership approved_by / invited_by reference from one user
 * to another. Seed-migration support (legacy synthetic staff_admin removal).
 * Returns how many rows changed.
 */
export async function reassignUserRefs(ctx: DbContext, fromUserId: string, toUserId: string): Promise<number> {
  const approved = await withDbContext(ctx, (c) =>
    q<{ id: string }>(c, `update org_memberships set approved_by = $2 where approved_by = $1 returning id`, [
      fromUserId,
      toUserId,
    ]),
  );
  const invited = await withDbContext(ctx, (c) =>
    q<{ id: string }>(c, `update org_memberships set invited_by = $2 where invited_by = $1 returning id`, [
      fromUserId,
      toUserId,
    ]),
  );
  return approved.length + invited.length;
}

/** Delete a membership row. Seed-migration support. */
export async function removeById(ctx: DbContext, membershipId: string): Promise<void> {
  const rows = await withDbContext(ctx, (c) =>
    q<{ id: string }>(c, `delete from org_memberships where id = $1 returning id`, [membershipId]),
  );
  if (!rows[0]) throw new Error(`memberships.removeById: membership not found: ${membershipId}`);
}

// ---------------------------------------------------------------------------
// ADMIN-09 — role management
// ---------------------------------------------------------------------------

export type RoleAdminRow = OrgMembership & {
  firstName: string;
  lastName: string;
  email: string;
  orgName: string;
  orgKind: "member_org" | "platform_owner";
  orgStatus: "pending" | "approved" | "disabled";
};

/**
 * Every membership across every organization — including platform_owner
 * staff rows, which the ADMIN-03 queue deliberately excludes. This is the
 * only surface that manages staff roles, so it must see them.
 */
export async function listForRoleAdmin(ctx: DbContext): Promise<RoleAdminRow[]> {
  return withDbContext(ctx, (c) =>
    q<RoleAdminRow>(
      c,
      `select ${COLS}, p.first_name as "firstName", p.last_name as "lastName", p.email,
              o.name as "orgName", o.kind as "orgKind", o.status as "orgStatus"
         from org_memberships m
         join organizations o on o.id = m.org_id
         join users u on u.id = m.user_id
         join people p on p.id = u.person_id
        order by p.last_name asc, p.first_name asc, o.name asc`,
    ),
  );
}

/** One membership joined to org kind — what the role-change route validates against. */
export async function getRoleAdminRowInTx(c: PoolClient, membershipId: string): Promise<RoleAdminRow | null> {
  const rows = await q<RoleAdminRow>(
    c,
    `select ${COLS}, p.first_name as "firstName", p.last_name as "lastName", p.email,
            o.name as "orgName", o.kind as "orgKind", o.status as "orgStatus"
       from org_memberships m
       join organizations o on o.id = m.org_id
       join users u on u.id = m.user_id
       join people p on p.id = u.person_id
      where m.id = $1
      for update of m`,
    [membershipId],
  );
  return rows[0] ?? null;
}

/**
 * Active staff_admin memberships in the platform_owner org, counted AFTER
 * taking a lock on the platform_owner organization row itself. Every
 * staff-role demotion serializes on that one lock, so two concurrent
 * demotions cannot both observe two admins and leave zero — the second
 * transaction waits, re-counts, and is refused.
 */
export async function countActiveStaffAdminsLockedInTx(c: PoolClient): Promise<number> {
  await q(c, `select id from organizations where kind = 'platform_owner' for update`);
  const rows = await q<{ count: string }>(
    c,
    `select count(*)::text as count
       from org_memberships m join organizations o on o.id = m.org_id
      where o.kind = 'platform_owner' and m.role = 'staff_admin' and m.status = 'active'`,
  );
  return Number(rows[0]?.count ?? 0);
}

/**
 * Change a membership's role. The caller has already validated the target
 * role against the org kind and the last-staff-admin rule under the same
 * transaction's row lock. The approval event records old -> new role in the
 * status fields ("role:<name>") so the ADMIN-07 trail shows the transition.
 */
export async function changeRoleInTx(
  c: PoolClient,
  membershipId: string,
  fromRole: MembershipRole,
  toRole: MembershipRole,
  actorUserId: string,
): Promise<OrgMembership> {
  const rows = await q<OrgMembership>(
    c,
    `update org_memberships set role = $2 where id = $1
     returning id, org_id as "orgId", user_id as "userId", role, status,
               invited_by as "invitedBy", approved_at as "approvedAt", approved_by as "approvedBy",
               created_at as "createdAt", updated_at as "updatedAt"`,
    [membershipId, toRole],
  );
  const membership = rows[0];
  if (!membership) throw new Error(`memberships.changeRoleInTx: update failed: ${membershipId}`);
  await insertInTx(c, {
    entityType: "org_membership",
    entityId: membershipId,
    fromStatus: `role:${fromRole}`,
    toStatus: `role:${toRole}`,
    actorUserId,
    note: "Role changed via ADMIN-09",
  });
  return membership;
}

// ---------------------------------------------------------------------------
// ADMIN-03 — member approval queue
// ---------------------------------------------------------------------------

/**
 * The queue predicate (ADMIN-03 §7): owner memberships never appear — they
 * activate at ADMIN-01 in the org-approval transaction — and platform_owner
 * memberships are staff, not members (§11). Must match admin-counts.ts's
 * pendingMembers count exactly or the nav badge lies.
 */
const ADMIN_QUEUE_PREDICATE = `m.role <> 'owner' and o.kind = 'member_org'`;

export type AdminMemberRow = OrgMembership & {
  firstName: string;
  lastName: string;
  email: string;
  orgName: string;
  orgStatus: "pending" | "approved" | "disabled";
  inviterFirstName: string | null;
  inviterLastName: string | null;
};

export type AdminMemberDetail = AdminMemberRow & {
  personId: string;
  phone: string | null;
  needsReview: boolean;
};

/** Queue rows for one status tab, oldest invite first. */
export async function listForAdminQueue(
  ctx: DbContext,
  status: "pending" | "active" | "removed",
): Promise<AdminMemberRow[]> {
  return withDbContext(ctx, (c) =>
    q<AdminMemberRow>(
      c,
      `select ${COLS}, p.first_name as "firstName", p.last_name as "lastName", p.email,
              o.name as "orgName", o.status as "orgStatus",
              ip.first_name as "inviterFirstName", ip.last_name as "inviterLastName"
         from org_memberships m
         join organizations o on o.id = m.org_id
         join users u on u.id = m.user_id
         join people p on p.id = u.person_id
         left join users iu on iu.id = m.invited_by
         left join people ip on ip.id = iu.person_id
        where m.status = $1 and ${ADMIN_QUEUE_PREDICATE}
        order by m.created_at asc`,
      [status],
    ),
  );
}

/**
 * One membership with person, org, and inviter context. Returns null for ids
 * outside the queue's world (owner memberships, platform_owner orgs) so the
 * routes can 404 them byte-identically with genuinely unknown ids.
 */
export async function getAdminDetail(ctx: DbContext, membershipId: string): Promise<AdminMemberDetail | null> {
  const rows = await withDbContext(ctx, (c) =>
    q<AdminMemberDetail>(
      c,
      `select ${COLS}, p.id as "personId", p.first_name as "firstName", p.last_name as "lastName", p.email, p.phone,
              p.needs_review as "needsReview",
              o.name as "orgName", o.status as "orgStatus",
              ip.first_name as "inviterFirstName", ip.last_name as "inviterLastName"
         from org_memberships m
         join organizations o on o.id = m.org_id
         join users u on u.id = m.user_id
         join people p on p.id = u.person_id
         left join users iu on iu.id = m.invited_by
         left join people ip on ip.id = iu.person_id
        where m.id = $1 and ${ADMIN_QUEUE_PREDICATE}`,
      [membershipId],
    ),
  );
  return rows[0] ?? null;
}

/**
 * Approve strictly from pending (ADMIN-03 §6). activateInTx also serves
 * ADMIN-01's owner path and accepts removed → active; this queue must not,
 * so the edge is enforced here, in the row lock.
 */
export async function approvePendingInTx(
  c: PoolClient,
  membershipId: string,
  approvedByUserId: string,
): Promise<OrgMembership> {
  const current = await q<{ status: string }>(
    c,
    `select status from org_memberships where id = $1 for update`,
    [membershipId],
  );
  const from = current[0]?.status;
  if (!from) throw new Error(`memberships.approvePending: membership not found: ${membershipId}`);
  if (from === "active") throw new Error("memberships.approvePending: already active");
  if (from !== "pending") throw new Error(`memberships.approvePending: not pending: ${from}`);
  const rows = await q<OrgMembership>(
    c,
    `update org_memberships set status = 'active', approved_at = now(), approved_by = $2
      where id = $1
     returning id, org_id as "orgId", user_id as "userId", role, status,
               invited_by as "invitedBy", approved_at as "approvedAt", approved_by as "approvedBy",
               created_at as "createdAt", updated_at as "updatedAt"`,
    [membershipId, approvedByUserId],
  );
  const membership = rows[0];
  if (!membership) throw new Error(`memberships.approvePending: update failed: ${membershipId}`);
  await insertInTx(c, {
    entityType: "org_membership",
    entityId: membershipId,
    fromStatus: "pending",
    toStatus: "active",
    actorUserId: approvedByUserId,
  });
  return membership;
}

/**
 * Reject strictly from pending (ADMIN-03 §6). removeByStatus also removes
 * active members (MP-05's path); this queue only ever rejects invitations.
 * Never touches people or users (§3). Optional note lands on the event (D15).
 */
export async function rejectPendingInTx(
  c: PoolClient,
  membershipId: string,
  actorUserId: string,
  note?: string,
): Promise<OrgMembership> {
  const current = await q<{ status: string }>(
    c,
    `select status from org_memberships where id = $1 for update`,
    [membershipId],
  );
  const from = current[0]?.status;
  if (!from) throw new Error(`memberships.rejectPending: membership not found: ${membershipId}`);
  if (from === "removed") throw new Error("memberships.rejectPending: already removed");
  if (from !== "pending") throw new Error(`memberships.rejectPending: not pending: ${from}`);
  const rows = await q<OrgMembership>(
    c,
    `update org_memberships set status = 'removed' where id = $1
     returning id, org_id as "orgId", user_id as "userId", role, status,
               invited_by as "invitedBy", approved_at as "approvedAt", approved_by as "approvedBy",
               created_at as "createdAt", updated_at as "updatedAt"`,
    [membershipId],
  );
  const membership = rows[0];
  if (!membership) throw new Error(`memberships.rejectPending: update failed: ${membershipId}`);
  await insertInTx(c, {
    entityType: "org_membership",
    entityId: membershipId,
    fromStatus: "pending",
    toStatus: "removed",
    actorUserId,
    note: note ?? null,
  });
  return membership;
}

/**
 * Reinstate a removed membership to PENDING, not active (ADMIN-03 §6): the
 * normal approval path and its login email must still run. Unlike MP-06's
 * reinviteInTx this does not overwrite invited_by — the original inviter
 * stays on the row for the queue display.
 */
export async function reinstateToPendingInTx(
  c: PoolClient,
  membershipId: string,
  actorUserId: string,
): Promise<OrgMembership> {
  const current = await q<{ status: string }>(
    c,
    `select status from org_memberships where id = $1 for update`,
    [membershipId],
  );
  const from = current[0]?.status;
  if (!from) throw new Error(`memberships.reinstateToPending: membership not found: ${membershipId}`);
  if (from === "pending") throw new Error("memberships.reinstateToPending: already pending");
  if (from !== "removed") throw new Error(`memberships.reinstateToPending: not removed: ${from}`);
  const rows = await q<OrgMembership>(
    c,
    `update org_memberships set status = 'pending' where id = $1
     returning id, org_id as "orgId", user_id as "userId", role, status,
               invited_by as "invitedBy", approved_at as "approvedAt", approved_by as "approvedBy",
               created_at as "createdAt", updated_at as "updatedAt"`,
    [membershipId],
  );
  const membership = rows[0];
  if (!membership) throw new Error(`memberships.reinstateToPending: update failed: ${membershipId}`);
  await insertInTx(c, {
    entityType: "org_membership",
    entityId: membershipId,
    fromStatus: "removed",
    toStatus: "pending",
    actorUserId,
    note: "Reinstated to pending via ADMIN-03",
  });
  return membership;
}
