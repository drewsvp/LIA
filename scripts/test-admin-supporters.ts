/**
 * Staff-admin supporter boundary regression coverage.
 *
 * Requires the development server. Creates one disposable supporter-only
 * account and removes its contexts, audits, identities, and person in finally.
 *
 * Usage: npm run test:admin-supporters
 */
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { chromium, type BrowserContext } from "playwright";
import { pool } from "../server/db/client";

const BASE =
  process.env.TEST_BASE_URL ??
  (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : "http://127.0.0.1:5000");
const marker = `zz.admin-supporters.${process.pid}`;
const email = `${marker}@example.invalid`;
const authSubject = randomUUID();
let supporterId = "";
let personId = "";
let adminId = "";
let hybridMembershipId = "";

type Session = {
  authenticated?: boolean;
  user?: { id?: string; email?: string };
  memberships?: unknown[];
  staffRole?: string | null;
  isStaff?: boolean;
  isSupporter?: boolean;
  supporterContext?: { id: string; supporterUserId: string; supporterName: string } | null;
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`  ✓ ${message}`);
}

function responseCookies(response: Response): string[] {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  return typeof headers.getSetCookie === "function"
    ? headers.getSetCookie()
    : (headers.get("set-cookie") ?? "").split(/,(?=\s*\w+=)/);
}

function cookies(response: Response): string {
  return responseCookies(response).filter(Boolean).map((value) => value.split(";")[0]).join("; ");
}

function mergeCookies(existing: string, response: Response): string {
  const jar = new Map<string, string>();
  for (const pair of existing.split("; ").filter(Boolean)) jar.set(pair.slice(0, pair.indexOf("=")), pair);
  for (const pair of cookies(response).split("; ").filter(Boolean)) jar.set(pair.slice(0, pair.indexOf("=")), pair);
  return [...jar.values()].join("; ");
}

async function login(role: "staff_admin" | "staff_approver" | "org_owner" | "supporter"): Promise<string> {
  const response = await fetch(`${BASE}/api/login/quick`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role }),
  });
  assert(response.ok, `${role} fixture login succeeds`);
  return cookies(response);
}

async function getSession(cookie: string): Promise<Session> {
  const response = await fetch(`${BASE}/api/session`, { headers: { Cookie: cookie }, cache: "no-store" });
  assert(response.ok, "session resolves");
  return (await response.json()) as Session;
}

async function createFixture(): Promise<void> {
  const person = await pool.query<{ id: string }>(
    `insert into people (first_name, last_name, email, phone, source_note)
     values ('Supporter', 'Fixture', $1, '555-0145', $2) returning id`,
    [email, marker],
  );
  personId = person.rows[0]!.id;
  await pool.query(
    `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     values ($1, 'Supporter Fixture', $2, true, now(), now())`,
    [authSubject, email],
  );
  const user = await pool.query<{ id: string }>(
    `insert into users (person_id, auth_subject, status, kind)
     values ($1, $2, 'active', 'supporter') returning id`,
    [personId, authSubject],
  );
  supporterId = user.rows[0]!.id;
}

async function cleanup(): Promise<void> {
  try {
    if (supporterId) {
      await pool.query(
        `delete from supporter_admin_audit where target_user_id = $1 or actor_user_id = $1`,
        [supporterId],
      );
      await pool.query(
        `delete from supporter_impersonation_contexts where supporter_user_id = $1 or admin_user_id = $1`,
        [supporterId],
      );
      if (hybridMembershipId) {
        await pool.query(`delete from org_memberships where id = $1`, [hybridMembershipId]);
      }
      await pool.query(`delete from users where id = $1`, [supporterId]);
    }
    await pool.query(`delete from "session" where "userId" = $1`, [authSubject]);
    await pool.query(`delete from "account" where "userId" = $1`, [authSubject]);
    await pool.query(`delete from "user" where id = $1`, [authSubject]);
    if (personId) await pool.query(`delete from people where id = $1 and source_note = $2`, [personId, marker]);
  } catch (error) {
    console.error("Fixture cleanup failed:", error);
  }
}

function browserCookies(cookie: string): Parameters<BrowserContext["addCookies"]>[0] {
  return cookie.split("; ").map((pair) => {
    const separator = pair.indexOf("=");
    return { name: pair.slice(0, separator), value: pair.slice(separator + 1), url: BASE };
  });
}

async function main(): Promise<void> {
  await createFixture();
  const [adminCookieOriginal, approverCookie, memberCookie, supporterCookie] = await Promise.all([
    login("staff_admin"),
    login("staff_approver"),
    login("org_owner"),
    login("supporter"),
  ]);
  let adminCookie = adminCookieOriginal;
  const adminSession = await getSession(adminCookie);
  adminId = adminSession.user?.id ?? "";
  assert(adminSession.staffRole === "staff_admin" && adminId !== "", "admin fixture has staff-admin authority");

  try {
    const guardedPath = `${BASE}/api/admin/supporters?status=active&search=${encodeURIComponent(marker)}`;
    const [anonymous, approver, member, ordinarySupporter] = await Promise.all([
      fetch(guardedPath),
      fetch(guardedPath, { headers: { Cookie: approverCookie } }),
      fetch(guardedPath, { headers: { Cookie: memberCookie } }),
      fetch(guardedPath, { headers: { Cookie: supporterCookie } }),
    ]);
    assert(
      [anonymous, approver, member, ordinarySupporter].every((response) => response.status === 404),
      "anonymous, approver, member, and supporter sessions cannot use the directory API",
    );

    const directory = await fetch(guardedPath, { headers: { Cookie: adminCookie } });
    const directoryBody = (await directory.json()) as { supporters?: Array<{ id: string }> };
    assert(
      directory.ok && directoryBody.supporters?.length === 1 && directoryBody.supporters[0]?.id === supporterId,
      "directory search explicitly returns the supporter-only fixture",
    );
    const memberSession = await getSession(memberCookie);
    const memberTarget = memberSession.user?.id ?? "";
    const memberDetail = await fetch(`${BASE}/api/admin/supporters/${memberTarget}`, {
      headers: { Cookie: adminCookie },
    });
    assert(memberDetail.status === 404, "organization member accounts are outside supporter detail scope");

    const detail = await fetch(`${BASE}/api/admin/supporters/${supporterId}`, {
      headers: { Cookie: adminCookie },
    });
    const detailBody = (await detail.json()) as {
      supporter?: { id: string; email: string };
      preferences?: unknown;
      pledges?: unknown[];
      signups?: unknown[];
      recentlyViewed?: unknown[];
    };
    assert(
      detail.ok &&
        detailBody.supporter?.email === email &&
        detailBody.preferences !== undefined &&
        Array.isArray(detailBody.pledges) &&
        Array.isArray(detailBody.signups) &&
        Array.isArray(detailBody.recentlyViewed),
      "profile returns identity, preferences, and all required history collections",
    );

    const contact = await fetch(`${BASE}/api/admin/supporters/${supporterId}/contact`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({
        firstName: "Updated",
        lastName: "Supporter",
        email,
        phone: "555-0199",
      }),
    });
    assert(contact.ok, "admin can update supporter name and phone");
    const identity = await pool.query<{ firstName: string; phone: string; personEmail: string; authEmail: string; authName: string }>(
      `select p.first_name as "firstName", p.phone, p.email as "personEmail",
              au.email as "authEmail", au.name as "authName"
         from users u join people p on p.id = u.person_id
         join "user" au on au.id = u.auth_subject where u.id = $1`,
      [supporterId],
    );
    assert(
      identity.rows[0]?.firstName === "Updated" &&
        identity.rows[0]?.phone === "555-0199" &&
        identity.rows[0]?.personEmail === email &&
        identity.rows[0]?.authEmail === email &&
        identity.rows[0]?.authName === "Updated Supporter",
      "safe contact edit keeps application and auth identities synchronized",
    );

    const disabled = await fetch(`${BASE}/api/admin/supporters/${supporterId}/disable`, {
      method: "POST",
      headers: { Cookie: adminCookie },
    });
    assert(disabled.ok, "admin can disable a supporter");
    const rejectedDisabled = await fetch(`${BASE}/api/admin/supporters/${supporterId}/impersonate`, {
      method: "POST",
      headers: { Cookie: adminCookie },
    });
    assert(rejectedDisabled.status === 409, "disabled supporter cannot be impersonated");
    const reactivated = await fetch(`${BASE}/api/admin/supporters/${supporterId}/reactivate`, {
      method: "POST",
      headers: { Cookie: adminCookie },
    });
    assert(reactivated.ok, "admin can reactivate a supporter");

    const invalidMember = await fetch(`${BASE}/api/admin/supporters/${memberTarget}/impersonate`, {
      method: "POST",
      headers: { Cookie: adminCookie },
    });
    assert(invalidMember.status === 404, "member account cannot be an impersonation target");
    const entered = await fetch(`${BASE}/api/admin/supporters/${supporterId}/impersonate`, {
      method: "POST",
      headers: { Cookie: adminCookie },
    });
    assert(entered.ok, "admin can begin a supporter context");
    adminCookie = mergeCookies(adminCookie, entered);
    const impersonated = await getSession(adminCookie);
    assert(
      impersonated.user?.id === supporterId &&
        impersonated.isSupporter === true &&
        impersonated.isStaff === false &&
        impersonated.staffRole === null &&
        impersonated.memberships?.length === 0 &&
        impersonated.supporterContext?.supporterUserId === supporterId,
      "supporter context exposes target identity with no inherited staff or organization authority",
    );
    const adminInsideContext = await fetch(`${BASE}/api/admin/supporters?status=active`, {
      headers: { Cookie: adminCookie },
    });
    const supporterProfile = await fetch(`${BASE}/api/supporter/profile`, { headers: { Cookie: adminCookie } });
    assert(
      adminInsideContext.status === 404 && supporterProfile.ok,
      "supporter context can use supporter profile but cannot use staff administration",
    );

    const disabledWhileActive = await fetch(`${BASE}/api/admin/supporters/${supporterId}/disable`, {
      method: "POST",
      headers: { Cookie: adminCookieOriginal },
    });
    assert(disabledWhileActive.ok, "admin can disable a supporter while a support context is active");
    const revokedByDisable = await getSession(adminCookie);
    assert(
      revokedByDisable.user?.id === adminId &&
        revokedByDisable.staffRole === "staff_admin" &&
        revokedByDisable.supporterContext === null,
      "disabling a supporter immediately revokes and restores an active support context",
    );
    const activeAgain = await fetch(`${BASE}/api/admin/supporters/${supporterId}/reactivate`, {
      method: "POST",
      headers: { Cookie: adminCookieOriginal },
    });
    assert(activeAgain.ok, "supporter can be reactivated after context revocation");
    adminCookie = adminCookieOriginal;
    const reentered = await fetch(`${BASE}/api/admin/supporters/${supporterId}/impersonate`, {
      method: "POST",
      headers: { Cookie: adminCookie },
    });
    assert(reentered.ok, "admin can open a fresh context after reactivation");
    adminCookie = mergeCookies(adminCookie, reentered);

    const exited = await fetch(`${BASE}/api/session/supporter-context/exit`, {
      method: "POST",
      headers: { Cookie: adminCookie },
    });
    assert(exited.ok, "supporter context has a reversible exit");
    adminCookie = mergeCookies(adminCookie, exited);
    const restored = await getSession(adminCookie);
    assert(
      restored.user?.id === adminId && restored.staffRole === "staff_admin" && restored.supporterContext === null,
      "exit restores the real admin session",
    );

    const expiryEntry = await fetch(`${BASE}/api/admin/supporters/${supporterId}/impersonate`, {
      method: "POST",
      headers: { Cookie: adminCookie },
    });
    assert(expiryEntry.ok, "admin can begin a second context after exit");
    const expiryCookie = mergeCookies(adminCookie, expiryEntry);
    const expiryActive = await getSession(expiryCookie);
    await pool.query(
      `update supporter_impersonation_contexts set expires_at = now() - interval '1 minute' where id = $1`,
      [expiryActive.supporterContext?.id],
    );
    const restartedAfterLostCookie = await fetch(`${BASE}/api/admin/supporters/${supporterId}/impersonate`, {
      method: "POST",
      headers: { Cookie: adminCookie },
    });
    assert(
      restartedAfterLostCookie.ok,
      "a naturally expired context is closed before a new entry even when its old cookie is absent",
    );
    const restartedCookie = mergeCookies(adminCookie, restartedAfterLostCookie);
    const restartedSession = await getSession(restartedCookie);
    await pool.query(
      `update supporter_impersonation_contexts set expires_at = now() - interval '1 minute' where id = $1`,
      [restartedSession.supporterContext?.id],
    );
    const expired = await getSession(restartedCookie);
    assert(
      expired.user?.id === adminId && expired.staffRole === "staff_admin" && expired.supporterContext === null,
      "server expiry restores the admin authorization even while the old cookie is present",
    );

    const approvedOrg = await pool.query<{ id: string }>(
      `select id from organizations where kind = 'member_org' and status = 'approved' order by created_at limit 1`,
    );
    assert(approvedOrg.rows[0]?.id, "approved organization fixture exists");
    const hybrid = await pool.query<{ id: string }>(
      `insert into org_memberships (org_id, user_id, role, status)
       values ($1, $2, 'member', 'active') returning id`,
      [approvedOrg.rows[0].id, supporterId],
    );
    hybridMembershipId = hybrid.rows[0]!.id;
    const hybridDirectory = await fetch(guardedPath, { headers: { Cookie: adminCookie } });
    const hybridBody = (await hybridDirectory.json()) as { supporters?: Array<{ id: string }> };
    const hybridDetail = await fetch(`${BASE}/api/admin/supporters/${supporterId}`, {
      headers: { Cookie: adminCookie },
    });
    const hybridEntry = await fetch(`${BASE}/api/admin/supporters/${supporterId}/impersonate`, {
      method: "POST",
      headers: { Cookie: adminCookie },
    });
    assert(
      hybridBody.supporters?.length === 0 && hybridDetail.status === 404 && hybridEntry.status === 404,
      "accounts with an active organization membership stay outside every supporter-only admin path",
    );
    await pool.query(`delete from org_memberships where id = $1`, [hybridMembershipId]);
    hybridMembershipId = "";

    const audits = await pool.query<{ actorUserId: string; targetUserId: string; action: string; outcome: string }>(
      `select actor_user_id as "actorUserId", target_user_id as "targetUserId", action, outcome
         from supporter_admin_audit
        where actor_user_id = $1 and target_user_id = $2`,
      [adminId, supporterId],
    );
    assert(
      audits.rows.every((row) => row.actorUserId === adminId && row.targetUserId === supporterId) &&
        audits.rows.some((row) => row.action === "contact_edit" && row.outcome === "success") &&
        audits.rows.some((row) => row.action === "disable" && row.outcome === "success") &&
        audits.rows.some((row) => row.action === "reactivate" && row.outcome === "success") &&
        audits.rows.some((row) => row.action === "impersonate" && row.outcome === "started") &&
        audits.rows.some((row) => row.action === "impersonate" && row.outcome === "ended") &&
        audits.rows.some((row) => row.action === "impersonate" && row.outcome === "expired") &&
        audits.rows.some((row) => row.action === "impersonate" && row.outcome === "target_disabled"),
      "audit rows retain real admin actor, target, action, timestamp lifecycle, and outcome",
    );

    const executablePath = execFileSync("which", ["chromium"], { encoding: "utf8" }).trim();
    const browser = await chromium.launch({ headless: true, executablePath });
    try {
      const approverContext = await browser.newContext();
      await approverContext.addCookies(browserCookies(approverCookie));
      const approverPage = await approverContext.newPage();
      await approverPage.goto(`${BASE}/admin/organizations`, { waitUntil: "networkidle" });
      assert(
        (await approverPage.locator('.adm-nav-link[href="/admin/supporters"]').count()) === 0,
        "Supporters navigation row is hidden from staff approvers",
      );
      await approverPage.goto(`${BASE}/admin/supporters`, { waitUntil: "networkidle" });
      assert(await approverPage.getByText("Page not found").isVisible(), "staff approver cannot open the Supporters route");
      await approverContext.close();
    } finally {
      await browser.close();
    }

    console.log("\nAll admin supporter checks passed.");
  } finally {
    await cleanup();
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});