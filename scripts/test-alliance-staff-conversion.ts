/**
 * Integration coverage for recovering a pending Alliance member invitation.
 *
 * Usage: npm run test:alliance-staff-conversion
 */
import { pool, SYSTEM, withDbContext } from "../server/db/client";
import * as memberships from "../server/dal/memberships";
import {
  AllianceInviteConversionError,
  convertAllianceInviteToStaffApproverInTx,
  inviteStaff,
} from "../server/services/staff-invite";
import {
  PlatformOwnerMemberInviteError,
  submitMemberInvite,
} from "../server/services/member-invite";

const marker = `zz.alliance-conversion.${process.pid}`;
const BASE = process.env.REPLIT_DEV_DOMAIN
  ? `https://${process.env.REPLIT_DEV_DOMAIN}`
  : "http://127.0.0.1:5000";
const createdPeople: string[] = [];
const createdMemberships: string[] = [];

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`  ✓ ${message}`);
}

function cookieHeader(response: Response): string {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const values =
    typeof headers.getSetCookie === "function"
      ? headers.getSetCookie()
      : (headers.get("set-cookie") ?? "").split(/,(?=\s*\w+=)/);
  return values.map((value) => value.split(";")[0]).join("; ");
}

async function quickLogin(role: "staff_admin" | "staff_approver"): Promise<string> {
  const response = await fetch(`${BASE}/api/login/quick`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role }),
  });
  if (!response.ok) throw new Error(`Quick login as ${role} failed: HTTP ${response.status}`);
  const cookie = cookieHeader(response);
  if (!cookie) throw new Error(`Quick login as ${role} returned no cookie`);
  return cookie;
}

async function createMembership(
  orgId: string,
  suffix: string,
  role: "owner" | "member" | "staff_admin" | "staff_approver",
  status: "pending" | "active" | "removed",
): Promise<{ personId: string; userId: string; membershipId: string; email: string }> {
  const email = `${marker}.${suffix}@example.invalid`;
  const person = await pool.query<{ id: string }>(
    `insert into people (first_name, last_name, email, phone, source_note)
     values ('ZZ', 'Alliance Conversion', $1, '555-0100', $2) returning id`,
    [email, marker],
  );
  const personId = person.rows[0]!.id;
  createdPeople.push(personId);
  const user = await pool.query<{ id: string }>(
    `insert into users (person_id, status, kind) values ($1, 'invited', 'member') returning id`,
    [personId],
  );
  const userId = user.rows[0]!.id;
  const membership = await pool.query<{ id: string }>(
    `insert into org_memberships (org_id, user_id, role, status)
     values ($1, $2, $3, $4) returning id`,
    [orgId, userId, role, status],
  );
  const membershipId = membership.rows[0]!.id;
  createdMemberships.push(membershipId);
  return { personId, userId, membershipId, email };
}

async function expectConversionRefused(membershipId: string, actorUserId: string, label: string): Promise<void> {
  let refused = false;
  try {
    await withDbContext(SYSTEM, (c) =>
      convertAllianceInviteToStaffApproverInTx(c, membershipId, actorUserId),
    );
  } catch (error) {
    refused = error instanceof AllianceInviteConversionError;
  }
  assert(refused, label);
}

async function cleanup(): Promise<void> {
  await pool.query(
    `delete from email_log
      where lower(to_email) like lower($1)
         or payload->'vars'->>'membershipId' = any($2::text[])`,
    [`${marker}.%@example.invalid`, createdMemberships],
  );
  await pool.query(
    `delete from approval_events where entity_type = 'org_membership' and entity_id = any($1::uuid[])`,
    [createdMemberships],
  );
  if (createdPeople.length > 0) {
    await pool.query(`delete from users where person_id = any($1::uuid[])`, [createdPeople]);
    await pool.query(`delete from people where id = any($1::uuid[])`, [createdPeople]);
  }
}

async function main(): Promise<void> {
  console.log("Alliance invitation conversion");
  console.log("==============================");

  const context = await pool.query<{ actorUserId: string; actorEmail: string; allianceId: string; memberOrgId: string }>(
    `select staff.id as "actorUserId", staff_person.email as "actorEmail",
            owner_org.id as "allianceId", member_org.id as "memberOrgId"
       from users staff
       join people staff_person on staff_person.id = staff.person_id
       join organizations owner_org on owner_org.kind = 'platform_owner'
       cross join lateral (
         select id from organizations where kind = 'member_org' and status = 'approved' order by created_at limit 1
       ) member_org
      where lower(staff_person.email) = 'tiffany@defendingthecause.org'`,
  );
  const ids = context.rows[0];
  if (!ids) throw new Error("Seed data missing; run npm run db:seed first.");

  try {
    const [adminCookie, approverCookie] = await Promise.all([
      quickLogin("staff_admin"),
      quickLogin("staff_approver"),
    ]);
    const routeTarget = await createMembership(ids.allianceId, "route-target", "member", "pending");

    const unauthorized = await fetch(`${BASE}/api/admin/roles/${routeTarget.membershipId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: approverCookie },
      body: JSON.stringify({ role: "staff_approver" }),
    });
    assert(unauthorized.status === 404, "staff approver cannot invoke the conversion route");

    const invalidTarget = await fetch(`${BASE}/api/admin/roles/${routeTarget.membershipId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({ role: "staff_admin" }),
    });
    assert(invalidTarget.status === 409, "pending Alliance member cannot be stranded as pending staff admin");
    const stillPending = await memberships.getById(SYSTEM, routeTarget.membershipId);
    assert(stillPending?.role === "member" && stillPending.status === "pending", "invalid route target changes nothing");

    const routeConversion = await fetch(`${BASE}/api/admin/roles/${routeTarget.membershipId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({ role: "staff_approver" }),
    });
    const routeBody = (await routeConversion.json()) as { message?: string };
    assert(routeConversion.ok && routeBody.message?.includes("active Staff approver"), "staff admin conversion route reports activation");
    const routeState = await memberships.getById(SYSTEM, routeTarget.membershipId);
    assert(routeState?.role === "staff_approver" && routeState.status === "active", "HTTP conversion activates the existing row");

    const routeRepeat = await fetch(`${BASE}/api/admin/roles/${routeTarget.membershipId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({ role: "staff_approver" }),
    });
    assert(routeRepeat.ok, "repeat HTTP conversion is a successful no-op");

    const target = await createMembership(ids.allianceId, "target", "member", "pending");
    const first = await withDbContext(SYSTEM, (c) =>
      convertAllianceInviteToStaffApproverInTx(c, target.membershipId, ids.actorUserId),
    );
    assert(first.outcome === "converted", "pending Alliance member converts");
    assert(first.dispatches.length === 1, "normal staff invitation email is queued");

    const state = await pool.query<{
      role: string;
      status: string;
      approvedBy: string | null;
      approvedAt: Date | null;
      eventCount: number;
      emailCount: number;
    }>(
      `select m.role, m.status, m.approved_by as "approvedBy", m.approved_at as "approvedAt",
              (select count(*)::int from approval_events e
                where e.entity_type = 'org_membership' and e.entity_id = m.id
                  and e.from_status = 'pending' and e.to_status = 'active'
                  and e.actor_user_id = $2) as "eventCount",
              (select count(*)::int from email_log l
                where l.template_key = 'staff_invited'
                  and l.payload->'vars'->>'membershipId' = m.id::text) as "emailCount"
         from org_memberships m where m.id = $1`,
      [target.membershipId, ids.actorUserId],
    );
    const converted = state.rows[0]!;
    assert(converted.role === "staff_approver" && converted.status === "active", "membership is active staff approver");
    assert(converted.approvedBy === ids.actorUserId && converted.approvedAt !== null, "approval metadata is recorded");
    assert(converted.eventCount === 1, "one approval event records the conversion");
    assert(converted.emailCount === 1, "email log is anchored to the existing membership");

    const active = await memberships.listActiveByUser(SYSTEM, target.userId);
    assert(
      active.some((m) => m.orgKind === "platform_owner" && m.role === "staff_approver"),
      "session membership resolution recognizes the converted staff approver",
    );

    const repeat = await withDbContext(SYSTEM, (c) =>
      convertAllianceInviteToStaffApproverInTx(c, target.membershipId, ids.actorUserId),
    );
    assert(repeat.outcome === "already_converted" && repeat.dispatches.length === 0, "repeat conversion is an idempotent no-op");

    const repeatCounts = await pool.query<{ events: number; emails: number }>(
      `select
         (select count(*)::int from approval_events where entity_id = $1) as events,
         (select count(*)::int from email_log where payload->'vars'->>'membershipId' = $1::text) as emails`,
      [target.membershipId],
    );
    assert(repeatCounts.rows[0]!.events === 1 && repeatCounts.rows[0]!.emails === 1, "repeat creates no audit or email duplicate");

    const regularOrg = await createMembership(ids.memberOrgId, "wrong-org", "member", "pending");
    const owner = await createMembership(ids.allianceId, "owner", "owner", "pending");
    const activeStaff = await createMembership(ids.allianceId, "active-staff", "staff_admin", "active");
    const removed = await createMembership(ids.allianceId, "removed", "member", "removed");
    await expectConversionRefused(regularOrg.membershipId, ids.actorUserId, "regular-organization row is refused");
    await expectConversionRefused(owner.membershipId, ids.actorUserId, "owner row is refused");
    await expectConversionRefused(activeStaff.membershipId, ids.actorUserId, "active staff-admin row is refused");
    await expectConversionRefused(removed.membershipId, ids.actorUserId, "removed row is refused");

    let ownerInviteRefused = false;
    try {
      await submitMemberInvite({
        orgId: ids.allianceId,
        actorUserId: ids.actorUserId,
        actorEmail: ids.actorEmail,
        firstName: "ZZ",
        lastName: "Blocked",
        email: `${marker}.blocked@example.invalid`,
        phone: "555-0100",
      });
    } catch (error) {
      ownerInviteRefused = error instanceof PlatformOwnerMemberInviteError;
    }
    assert(ownerInviteRefused, "member invite service rejects the platform owner before creating rows");

    const normalMember = await submitMemberInvite({
      orgId: ids.memberOrgId,
      actorUserId: ids.actorUserId,
      actorEmail: ids.actorEmail,
      firstName: "ZZ",
      lastName: "Normal Member",
      email: `${marker}.normal-member@example.invalid`,
      phone: "555-0100",
    });
    createdMemberships.push(normalMember.membershipId);
    const normalMemberPerson = await pool.query<{ id: string }>(
      `select p.id from people p join users u on u.person_id = p.id
        join org_memberships m on m.user_id = u.id where m.id = $1`,
      [normalMember.membershipId],
    );
    createdPeople.push(normalMemberPerson.rows[0]!.id);
    const normalMemberState = await memberships.getById(SYSTEM, normalMember.membershipId);
    assert(normalMemberState?.status === "pending" && normalMemberState.role === "member", "ordinary member invite remains pending");

    const normalStaff = await inviteStaff({
      actorUserId: ids.actorUserId,
      firstName: "ZZ",
      lastName: "Normal Staff",
      email: `${marker}.normal-staff@example.invalid`,
      role: "staff_approver",
    });
    createdMemberships.push(normalStaff.membershipId);
    const normalStaffPerson = await pool.query<{ id: string }>(
      `select p.id from people p join users u on u.person_id = p.id
        join org_memberships m on m.user_id = u.id where m.id = $1`,
      [normalStaff.membershipId],
    );
    createdPeople.push(normalStaffPerson.rows[0]!.id);
    const normalStaffState = await memberships.getById(SYSTEM, normalStaff.membershipId);
    assert(normalStaffState?.status === "active" && normalStaffState.role === "staff_approver", "ordinary staff invite remains active");
  } finally {
    await cleanup();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});