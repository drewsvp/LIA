/**
 * Concurrency test for the ADMIN-09 last-staff-admin protection.
 *
 * With exactly two active staff admins, fires two simultaneous demotions
 * (one per admin). The platform_owner org-row lock must serialize them so
 * exactly one succeeds and at least one active staff admin remains.
 *
 * Usage: NODE_ENV=development npx tsx scripts/test-role-last-admin.ts
 * Exit 0 = pass. Restores original roles before exiting.
 */
import { pool } from "../server/db/client";
import {
  changeMembershipStatus,
  LastActiveStaffAdminError,
} from "../server/services/member-approval";

const BASE = process.env.REPLIT_DEV_DOMAIN
  ? `https://${process.env.REPLIT_DEV_DOMAIN}`
  : "http://127.0.0.1:5000";

function cookieHeader(res: Response): string {
  const h = res.headers as unknown as { getSetCookie?: () => string[]; get: (n: string) => string | null };
  const raw = typeof h.getSetCookie === "function" ? h.getSetCookie() : (h.get("set-cookie") ?? "").split(/,(?=\s*\w+=)/);
  return raw.map((c) => c.split(";")[0]).join("; ");
}

async function main(): Promise<void> {
  // Sign in as the quick-login staff admin.
  const login = await fetch(`${BASE}/api/login/quick`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role: "staff_admin" }),
  });
  if (!login.ok) throw new Error(`quick login failed: ${login.status}`);
  const cookie = cookieHeader(login);

  const admins = await pool.query<{ id: string; role: string }>(
    `select m.id, m.role from org_memberships m join organizations o on o.id = m.org_id
      where o.kind = 'platform_owner' and m.role = 'staff_admin' and m.status = 'active'`,
  );
  if (admins.rows.length !== 2) {
    throw new Error(`expected exactly 2 active staff admins for this test, found ${admins.rows.length}`);
  }
  const [a, b] = admins.rows;

  const demote = (id: string) =>
    fetch(`${BASE}/api/admin/roles/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ role: "staff_approver" }),
    });

  try {
    const [ra, rb] = await Promise.all([demote(a!.id), demote(b!.id)]);
    const statuses = [ra.status, rb.status].sort();
    const remaining = await pool.query<{ count: string }>(
      `select count(*)::text as count from org_memberships m join organizations o on o.id = m.org_id
        where o.kind = 'platform_owner' and m.role = 'staff_admin' and m.status = 'active'`,
    );
    const left = Number(remaining.rows[0]!.count);
    console.log(`statuses: ${statuses.join(", ")}; active staff admins remaining: ${left}`);
    if (left < 1) {
      console.error("FAIL: concurrent demotions removed every staff admin");
      process.exitCode = 1;
    } else if (statuses[0] === 200 && statuses[1] === 409) {
      console.log("PASS: one demotion succeeded, the other was refused, one admin remains");
    } else {
      console.error(`FAIL: unexpected status pair ${statuses.join("/")}`);
      process.exitCode = 1;
    }

    // Restore roles before exercising the independent status-removal guard.
    for (const membership of [a!, b!]) {
      await pool.query(`update org_memberships set role = 'staff_admin' where id = $1`, [membership.id]);
    }
    const approver = await pool.query<{ id: string }>(
      `select m.user_id as id
         from org_memberships m join organizations o on o.id = m.org_id
        where o.kind = 'platform_owner' and m.role = 'staff_approver' and m.status = 'active'
        limit 1`,
    );
    const actorUserId = approver.rows[0]?.id;
    if (!actorUserId) throw new Error("expected an active staff approver to act in the service concurrency test");

    const removals = await Promise.allSettled(
      [a!, b!].map((membership) =>
        changeMembershipStatus({
          membershipId: membership.id,
          staffUserId: actorUserId,
          status: "removed",
        }),
      ),
    );
    const fulfilled = removals.filter((result) => result.status === "fulfilled").length;
    const lastAdminBlocks = removals.filter(
      (result) => result.status === "rejected" && result.reason instanceof LastActiveStaffAdminError,
    ).length;
    const afterRemoval = await pool.query<{ count: string }>(
      `select count(*)::text as count
         from org_memberships m join organizations o on o.id = m.org_id
        where o.kind = 'platform_owner' and m.role = 'staff_admin' and m.status = 'active'`,
    );
    const activeAfterRemoval = Number(afterRemoval.rows[0]?.count ?? 0);
    console.log(
      `status removals: ${fulfilled} succeeded, ${lastAdminBlocks} blocked; active staff admins remaining: ${activeAfterRemoval}`,
    );
    if (fulfilled !== 1 || lastAdminBlocks !== 1 || activeAfterRemoval !== 1) {
      console.error("FAIL: concurrent status removals did not preserve exactly one active staff admin");
      process.exitCode = 1;
    } else {
      console.log("PASS: concurrent status removals preserved one active staff admin");
    }
  } finally {
    // Restore both active staff-admin memberships.
    for (const m of [a!, b!]) {
      await pool.query(
        `update org_memberships set role = 'staff_admin', status = 'active' where id = $1`,
        [m.id],
      );
    }
    await pool.query(
      `delete from approval_events
        where entity_type = 'org_membership'
          and entity_id in ($1, $2)
          and created_at > now() - interval '2 minutes'
          and (
            note = 'Role changed via ADMIN-09'
            or (from_status = 'active' and to_status = 'removed')
          )`,
      [a!.id, b!.id],
    );
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
