/**
 * ADMIN-09 role/status integration coverage.
 *
 * The development server must be running. Fixtures are removed on exit.
 */
import { execFileSync } from "node:child_process";
import { chromium } from "playwright";
import { pool } from "../server/db/client";

const BASE = process.env.REPLIT_DEV_DOMAIN
  ? `https://${process.env.REPLIT_DEV_DOMAIN}`
  : "http://127.0.0.1:5000";
const marker = `zz.role-status.${process.pid}`;
const testStartedAt = new Date();
const peopleIds: string[] = [];
const membershipIds: string[] = [];
const organizationIds: string[] = [];
let seededMembershipSnapshot: {
  id: string;
  role: string;
  status: string;
  approvedAt: Date | null;
  approvedBy: string | null;
} | null = null;

type MembershipStatus = "pending" | "active" | "removed";

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
  if (!response.ok) throw new Error(`quick login as ${role} failed: ${response.status}`);
  return cookieHeader(response);
}

async function createMember(
  orgId: string,
  suffix: string,
  status: MembershipStatus,
): Promise<{ membershipId: string; email: string }> {
  const email = `${marker}.${suffix}@example.invalid`;
  const person = await pool.query<{ id: string }>(
    `insert into people (first_name, last_name, email, source_note)
     values ('ZZ', 'Role Status', $1, $2) returning id`,
    [email, marker],
  );
  const personId = person.rows[0]!.id;
  peopleIds.push(personId);
  const user = await pool.query<{ id: string }>(
    `insert into users (person_id, status, kind) values ($1, 'invited', 'member') returning id`,
    [personId],
  );
  const membership = await pool.query<{ id: string }>(
    `insert into org_memberships (org_id, user_id, role, status)
     values ($1, $2, 'member', $3) returning id`,
    [orgId, user.rows[0]!.id, status],
  );
  const membershipId = membership.rows[0]!.id;
  membershipIds.push(membershipId);
  return { membershipId, email };
}

async function postStatus(
  cookie: string,
  membershipId: string,
  status: MembershipStatus,
): Promise<Response> {
  return fetch(`${BASE}/api/admin/roles/${membershipId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ status }),
  });
}

async function cleanup(): Promise<void> {
  if (seededMembershipSnapshot) {
    await pool.query(
      `update org_memberships
          set role = $2, status = $3, approved_at = $4, approved_by = $5
        where id = $1`,
      [
        seededMembershipSnapshot.id,
        seededMembershipSnapshot.role,
        seededMembershipSnapshot.status,
        seededMembershipSnapshot.approvedAt,
        seededMembershipSnapshot.approvedBy,
      ],
    );
    await pool.query(
      `delete from approval_events
        where entity_type = 'org_membership' and entity_id = $1 and created_at >= $2`,
      [seededMembershipSnapshot.id, testStartedAt],
    );
  }
  if (membershipIds.length > 0) {
    await pool.query(
      `delete from email_log
        where entity_type = 'org_membership' and entity_id = any($1::uuid[])`,
      [membershipIds],
    );
    await pool.query(
      `delete from approval_events
        where entity_type = 'org_membership' and entity_id = any($1::uuid[])`,
      [membershipIds],
    );
  }
  if (organizationIds.length > 0) {
    await pool.query(`delete from organizations where id = any($1::uuid[])`, [organizationIds]);
  }
  if (peopleIds.length > 0) {
    await pool.query(`delete from users where person_id = any($1::uuid[])`, [peopleIds]);
    await pool.query(`delete from people where id = any($1::uuid[])`, [peopleIds]);
  }
}

async function main(): Promise<void> {
  const [adminCookie, approverCookie] = await Promise.all([
    quickLogin("staff_admin"),
    quickLogin("staff_approver"),
  ]);
  const organizations = await pool.query<{ id: string; status: string }>(
    `select id, status from organizations
      where kind = 'member_org' and status in ('approved', 'pending')
      order by status`,
  );
  const approvedOrg = organizations.rows.find((row) => row.status === "approved");
  const pendingOrg = organizations.rows.find((row) => row.status === "pending");
  if (!approvedOrg || !pendingOrg) throw new Error("expected approved and pending member organizations");

  const approvable = await createMember(approvedOrg.id, "approvable", "pending");
  const removable = await createMember(approvedOrg.id, "removable", "active");
  const blocked = await createMember(pendingOrg.id, "blocked", "pending");
  const raceOrg = await pool.query<{ id: string }>(
    `insert into organizations (kind, name, slug, status)
     values ('member_org', $1, $2, 'approved') returning id`,
    [`ZZ Role Status ${process.pid}`, `zz-role-status-${process.pid}`],
  );
  const raceOrgId = raceOrg.rows[0]!.id;
  organizationIds.push(raceOrgId);
  const raceMember = await createMember(raceOrgId, "race", "pending");

  try {
    const listResponse = await fetch(`${BASE}/api/admin/roles`, {
      headers: { Cookie: adminCookie },
    });
    const list = (await listResponse.json()) as {
      memberships: Array<{
        id: string;
        userId: string;
        type: string;
        orgKind: string;
        role: string;
      }>;
    };
    assert(listResponse.ok, "staff admin can list role-management rows");
    assert(
      list.memberships.every((row) =>
        row.orgKind === "platform_owner" ? row.type === "Staff" : row.type === "Member",
      ),
      "each list row has a type matching its organization kind",
    );

    const deniedList = await fetch(`${BASE}/api/admin/roles`, {
      headers: { Cookie: approverCookie },
    });
    const deniedWrite = await postStatus(approverCookie, approvable.membershipId, "active");
    assert(deniedList.status === 404 && deniedWrite.status === 404, "staff approvers cannot read or change roles");

    const blockedActivation = await postStatus(adminCookie, blocked.membershipId, "active");
    assert(blockedActivation.status === 409, "activation is blocked under an unapproved organization");
    const blockedState = await pool.query<{ status: string }>(
      `select status from org_memberships where id = $1`,
      [blocked.membershipId],
    );
    assert(blockedState.rows[0]?.status === "pending", "blocked activation changes nothing");

    const lockClient = await pool.connect();
    try {
      await lockClient.query("begin");
      await lockClient.query(`update organizations set status = 'disabled' where id = $1`, [raceOrgId]);
      const racedActivation = postStatus(adminCookie, raceMember.membershipId, "active");
      await new Promise((resolve) => setTimeout(resolve, 100));
      await lockClient.query("commit");
      const racedResponse = await racedActivation;
      assert(racedResponse.status === 409, "activation rechecks organization approval after a concurrent disable");
    } finally {
      try {
        await lockClient.query("rollback");
      } catch {
        // Transaction already committed.
      }
      lockClient.release();
    }
    const raceState = await pool.query<{ status: string }>(
      `select status from org_memberships where id = $1`,
      [raceMember.membershipId],
    );
    assert(raceState.rows[0]?.status === "pending", "disable race leaves the membership pending");

    const activation = await postStatus(adminCookie, approvable.membershipId, "active");
    assert(activation.ok, "pending member can be activated");
    const activated = await pool.query<{
      status: string;
      approvedAt: Date | null;
      approvedBy: string | null;
      events: string;
      emails: string;
    }>(
      `select m.status, m.approved_at as "approvedAt", m.approved_by as "approvedBy",
              (select count(*)::text from approval_events e
                where e.entity_type = 'org_membership' and e.entity_id = m.id
                  and e.from_status = 'pending' and e.to_status = 'active') as events,
              (select count(*)::text from email_log l
                where l.entity_type = 'org_membership' and l.entity_id = m.id
                  and l.template_key = 'org_member_approved') as emails
         from org_memberships m where m.id = $1`,
      [approvable.membershipId],
    );
    assert(
      activated.rows[0]?.status === "active" &&
        activated.rows[0].approvedAt !== null &&
        activated.rows[0].approvedBy !== null,
      "activation records approval metadata",
    );
    assert(activated.rows[0]?.events === "1", "activation records one audit event");
    assert(activated.rows[0]?.emails === "1", "activation records the normal approval email");

    const invalidReverse = await postStatus(adminCookie, approvable.membershipId, "pending");
    assert(invalidReverse.status === 409, "active membership cannot move directly to pending");

    await pool.query(
      `update email_log
          set status = 'sent', sent_at = coalesce(sent_at, now()), error = null
        where entity_type = 'org_membership' and entity_id = $1
          and template_key = 'org_member_approved'`,
      [approvable.membershipId],
    );
    const removeApproved = await postStatus(adminCookie, approvable.membershipId, "removed");
    const reinstateApproved = await postStatus(adminCookie, approvable.membershipId, "pending");
    const reapprove = await postStatus(adminCookie, approvable.membershipId, "active");
    const reapproveBody = (await reapprove.json()) as { message?: string };
    assert(
      removeApproved.ok &&
        reinstateApproved.ok &&
        reapprove.ok &&
        reapproveBody.message?.includes("no duplicate email"),
      "previously emailed member can complete removal, reinstatement, and reapproval",
    );
    const repeatEmailCount = await pool.query<{ count: string }>(
      `select count(*)::text as count
         from email_log
        where entity_type = 'org_membership' and entity_id = $1
          and template_key = 'org_member_approved'`,
      [approvable.membershipId],
    );
    assert(repeatEmailCount.rows[0]?.count === "1", "reapproval does not create a duplicate approval email");

    const removal = await postStatus(adminCookie, removable.membershipId, "removed");
    const reinstatement = await postStatus(adminCookie, removable.membershipId, "pending");
    assert(removal.ok && reinstatement.ok, "active member can be removed and reinstated to pending");
    const transitions = await pool.query<{ fromStatus: string; toStatus: string }>(
      `select from_status as "fromStatus", to_status as "toStatus"
         from approval_events
        where entity_type = 'org_membership' and entity_id = $1
        order by created_at`,
      [removable.membershipId],
    );
    assert(
      transitions.rows.some((row) => row.fromStatus === "active" && row.toStatus === "removed") &&
        transitions.rows.some((row) => row.fromStatus === "removed" && row.toStatus === "pending"),
      "removal and reinstatement both appear in audit history",
    );

    const sessionResponse = await fetch(`${BASE}/api/session`, {
      headers: { Cookie: adminCookie },
    });
    const session = (await sessionResponse.json()) as { user?: { id?: string } };
    const signedInUserId = session.user?.id;
    if (!signedInUserId) throw new Error("staff-admin session did not resolve a user id");
    const ownStaff = list.memberships.find(
      (row) =>
        row.userId === signedInUserId &&
        row.type === "Staff" &&
        row.role === "staff_admin",
    );
    if (!ownStaff) throw new Error("expected an active staff-admin row");
    const seededState = await pool.query<{
      id: string;
      role: string;
      status: string;
      approvedAt: Date | null;
      approvedBy: string | null;
    }>(
      `select id, role, status, approved_at as "approvedAt", approved_by as "approvedBy"
         from org_memberships where id = $1`,
      [ownStaff.id],
    );
    seededMembershipSnapshot = seededState.rows[0] ?? null;
    if (!seededMembershipSnapshot) throw new Error("signed-in staff membership disappeared");
    const selfRemoval = await postStatus(adminCookie, ownStaff.id, "removed");
    assert(selfRemoval.status === 409, "a staff admin cannot remove their own staff membership");

    const executablePath = execFileSync("which", ["chromium"], { encoding: "utf8" }).trim();
    const browser = await chromium.launch({ headless: true, executablePath });
    try {
      const context = await browser.newContext();
      await context.addCookies(
        adminCookie.split("; ").map((pair) => {
          const separator = pair.indexOf("=");
          return {
            name: pair.slice(0, separator),
            value: pair.slice(separator + 1),
            url: BASE,
          };
        }),
      );
      const page = await context.newPage();
      await page.setViewportSize({ width: 1024, height: 500 });
      await page.goto(`${BASE}/admin/roles`, { waitUntil: "networkidle" });

      const memberRow = page.locator("tr", { hasText: removable.email });
      assert((await memberRow.locator("td").nth(3).textContent())?.trim() === "Member", "table labels member rows");
      assert(
        JSON.stringify(await memberRow.locator("select").nth(1).locator("option").allTextContents()) ===
          JSON.stringify(["Owner", "Member"]),
        "member rows offer only member-organization roles",
      );

      const staffRow = page.locator("tr", { hasText: ownStaff.id }).first();
      const visibleStaffRow =
        (await staffRow.count()) > 0
          ? staffRow
          : page.locator("tbody tr").filter({ has: page.locator('td:nth-child(4)', { hasText: "Staff" }) }).first();
      assert(
        JSON.stringify(await visibleStaffRow.locator("select").nth(1).locator("option").allTextContents()) ===
          JSON.stringify(["Staff admin", "Staff approver"]),
        "staff rows offer only staff roles",
      );
      assert(
        JSON.stringify(await memberRow.locator("select").first().locator("option").allTextContents()) ===
          JSON.stringify(["Pending", "Active", "Removed"]),
        "pending member row shows every valid lifecycle choice",
      );

      const roleChangeRequests: unknown[] = [];
      page.on("request", (request) => {
        if (
          request.method() === "POST" &&
          request.url().includes(`/api/admin/roles/${removable.membershipId}`)
        ) {
          roleChangeRequests.push(request);
        }
      });
      const requestCount = (): number => roleChangeRequests.length;
      await memberRow.locator("select").first().selectOption("removed");
      const confirmation = page.locator(".adm-confirm");
      await confirmation.waitFor({ state: "visible" });
      await page.waitForFunction(() => {
        const element = document.querySelector<HTMLElement>(".adm-confirm");
        if (!element) return false;
        const rect = element.getBoundingClientRect();
        return rect.top >= 0 && rect.bottom <= window.innerHeight;
      });
      assert(
        requestCount() === 0,
        "opening a role confirmation does not call the server before approval",
      );
      const beforeCancel = await pool.query<{ status: string }>(
        `select status from org_memberships where id = $1`,
        [removable.membershipId],
      );
      assert(beforeCancel.rows[0]?.status === "pending", "opening a role confirmation changes nothing");

      await confirmation.getByRole("button", { name: "Cancel" }).click();
      await confirmation.waitFor({ state: "detached" });
      assert(requestCount() === 0, "cancelling a role confirmation does not call the server");
      const afterCancel = await pool.query<{ status: string }>(
        `select status from org_memberships where id = $1`,
        [removable.membershipId],
      );
      assert(afterCancel.rows[0]?.status === "pending", "cancelling a role confirmation changes nothing");

      await memberRow.locator("select").first().selectOption("removed");
      await confirmation.waitFor({ state: "visible" });
      await Promise.all([
        page.waitForRequest(
          (request) =>
            request.method() === "POST" &&
            request.url().includes(`/api/admin/roles/${removable.membershipId}`),
        ),
        confirmation.getByRole("button", { name: "Change status" }).click(),
      ]);
      await page.waitForFunction(
        async (membershipId) => {
          const response = await fetch(`/api/admin/roles`);
          if (!response.ok) return false;
          const payload = (await response.json()) as { memberships?: Array<{ id: string; status: string }> };
          return payload.memberships?.some((membership) => membership.id === membershipId && membership.status === "removed") ?? false;
        },
        removable.membershipId,
      );
      assert(requestCount() === 1, "the role change calls the server only after approval");
      await context.close();
    } finally {
      await browser.close();
    }
  } finally {
    await cleanup();
    await pool.end();
  }
}

main().catch(async (error) => {
  console.error(error);
  try {
    await cleanup();
    await pool.end();
  } catch {
    // Preserve the original test failure.
  }
  process.exit(1);
});