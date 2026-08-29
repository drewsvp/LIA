/**
 * Task 338 — staff administrator organization-context regression coverage.
 *
 * The development server must already be running. This script creates only
 * `zz.admin-org-context.<pid>` fixtures and removes them (and their context
 * audit rows) in a finally block.
 *
 * Usage: npx tsx scripts/test-admin-organization-context.ts
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { chromium, type BrowserContext } from "playwright";
import { pool } from "../server/db/client";

const BASE =
  process.env.TEST_BASE_URL ??
  (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : "http://127.0.0.1:5000");
const marker = `zz.admin-org-context.${process.pid}`;
const organizationIds: string[] = [];
const requestIds: string[] = [];
let adminUserId: string | null = null;

type Session = {
  authenticated?: boolean;
  user?: { id?: string; email?: string; authSubject?: string };
  staffRole?: string | null;
  activeOrgId?: string | null;
  organizationContext?: { id: string; organizationId: string; organizationName: string } | null;
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`  ✓ ${message}`);
}

function cookies(response: Response): string {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const values =
    typeof headers.getSetCookie === "function"
      ? headers.getSetCookie()
      : (headers.get("set-cookie") ?? "").split(/,(?=\s*\w+=)/);
  return values.filter(Boolean).map((value) => value.split(";")[0]).join("; ");
}

/** Node fetch has no cookie jar; retain the auth cookie while accepting the
 * signed context cookie set by the enter response. */
function mergeCookieHeader(existing: string, response: Response): string {
  const jar = new Map(
    existing.split("; ").filter(Boolean).map((pair) => {
      const separator = pair.indexOf("=");
      return [pair.slice(0, separator), pair];
    }),
  );
  for (const pair of cookies(response).split("; ").filter(Boolean)) {
    const separator = pair.indexOf("=");
    jar.set(pair.slice(0, separator), pair);
  }
  return [...jar.values()].join("; ");
}

async function login(role: "staff_admin" | "staff_approver" | "org_owner"): Promise<string> {
  const response = await fetch(`${BASE}/api/login/quick`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role }),
  });
  assert(response.ok, `${role} quick login succeeds`);
  return cookies(response);
}

async function session(cookie: string): Promise<Session> {
  const response = await fetch(`${BASE}/api/session`, { headers: { Cookie: cookie }, cache: "no-store" });
  assert(response.ok, "session endpoint resolves");
  return (await response.json()) as Session;
}

async function enter(cookie: string, organizationId: string): Promise<Response> {
  return fetch(`${BASE}/api/admin/organization-context`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ organizationId }),
  });
}

async function exit(cookie: string): Promise<Response> {
  return fetch(`${BASE}/api/session/organization-context/exit`, {
    method: "POST",
    headers: { Cookie: cookie },
  });
}

async function fixture(status: "approved" | "pending" | "disabled", suffix: string): Promise<{ id: string; name: string }> {
  const name = `${marker} ${suffix}`;
  const result = await pool.query<{ id: string }>(
    `insert into organizations (kind, name, slug, status)
     values ('member_org', $1, $2, $3)
     returning id`,
    [name, `${marker.replace(/\./g, "-")}-${suffix}`.toLowerCase(), status],
  );
  const id = result.rows[0]!.id;
  organizationIds.push(id);
  return { id, name };
}

async function cleanup(): Promise<void> {
  if (adminUserId) {
    await pool.query(
      `delete from approval_events
        where organization_context_id in (
          select id from admin_organization_contexts
           where admin_user_id = $1 or organization_id = any($2::uuid[])
        )`,
      [adminUserId, organizationIds],
    );
    await pool.query(
      `delete from organization_context_actions
        where actor_user_id = $1 or organization_id = any($2::uuid[])`,
      [adminUserId, organizationIds],
    );
    await pool.query(
      `delete from admin_organization_contexts
        where admin_user_id = $1 or organization_id = any($2::uuid[])`,
      [adminUserId, organizationIds],
    );
  }
  if (organizationIds.length) {
    if (requestIds.length) {
      await pool.query(`delete from item_requests where id = any($1::uuid[])`, [requestIds]);
    }
    await pool.query(`delete from organizations where id = any($1::uuid[]) and name like $2`, [
      organizationIds,
      `${marker}%`,
    ]);
    await pool.query(`delete from people where email = $1`, [`${marker}@example.org`]);
  }
}

function browserCookies(cookie: string): Parameters<BrowserContext["addCookies"]>[0] {
  return cookie.split("; ").map((pair) => {
    const split = pair.indexOf("=");
    return { name: pair.slice(0, split), value: pair.slice(split + 1), url: BASE };
  });
}

async function main(): Promise<void> {
  const [initialAdminCookie, approverCookie, memberCookie] = await Promise.all([
    login("staff_admin"),
    login("staff_approver"),
    login("org_owner"),
  ]);
  let adminCookie = initialAdminCookie;
  const before = await session(adminCookie);
  adminUserId = before.user?.id ?? null;
  assert(before.authenticated && adminUserId !== null && before.staffRole === "staff_admin", "admin session has staff-admin identity");

  const [first, second, pending, disabled] = await Promise.all([
    fixture("approved", "approved-one"),
    fixture("approved", "approved-two"),
    fixture("pending", "pending"),
    fixture("disabled", "disabled"),
  ]);

  try {
    const [approver, member, malformed, pendingResult, disabledResult] = await Promise.all([
      enter(approverCookie, first.id),
      enter(memberCookie, first.id),
      enter(adminCookie, "not-a-uuid"),
      enter(adminCookie, pending.id),
      enter(adminCookie, disabled.id),
    ]);
    assert(approver.status === 404 && member.status === 404, "approver and ordinary member cannot enter organization view");
    assert(!malformed.ok, "malformed organization id is rejected");
    assert(!pendingResult.ok && !disabledResult.ok, "pending and disabled organizations cannot be entered");
    const afterRejected = await session(adminCookie);
    assert(afterRejected.organizationContext === null, "rejected entries do not create context");

    const entered = await enter(adminCookie, first.id);
    assert(entered.ok, "staff admin can enter an approved member organization");
    adminCookie = mergeCookieHeader(adminCookie, entered);
    const active = await session(adminCookie);
    assert(
      active.organizationContext?.organizationId === first.id && active.activeOrgId === first.id,
      "session exposes the scoped organization context as active organization",
    );
    assert(
      active.user?.id === before.user?.id &&
        active.user?.email === before.user?.email &&
        active.user?.authSubject === before.user?.authSubject &&
        active.staffRole === before.staffRole,
      "entering context does not change the signed-in staff identity",
    );

    const scopedOverview = await fetch(`${BASE}/api/dashboard/overview?orgId=${encodeURIComponent(second.id)}`, {
      headers: { Cookie: adminCookie },
    });
    const overview = (await scopedOverview.json()) as { org?: { name?: string } };
    assert(scopedOverview.ok && overview.org?.name === first.name, "dashboard APIs ignore cross-organization input and stay scoped");

    const created = await fetch(`${BASE}/api/dashboard/items`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({
        contactFirstName: "Context",
        contactLastName: "Fixture",
        contactEmail: `${marker}@example.org`,
        contactPhone: "555-0100",
        title: `${marker} request`,
        description: "Organization-context attribution fixture.",
        deadlineType: "until_fulfilled",
        deadlineDate: "",
        peopleHelped: 1,
      }),
    });
    assert(created.ok, "organization-context admin can create a scoped member-portal draft");
    const createdBody = (await created.json()) as { id?: string };
    assert(typeof createdBody.id === "string", "context-created draft returns its id");
    requestIds.push(createdBody.id);
    const requestAttribution = await pool.query<{
      orgId: string;
      createdBy: string;
      contextId: string;
      contextOrgId: string;
    }>(
      `select r.org_id as "orgId", r.created_by as "createdBy",
              a.organization_context_id as "contextId",
              a.organization_id as "contextOrgId"
         from item_requests r
         join organization_context_actions a
           on a.entity_type = 'item_requests' and a.entity_id = r.id and a.action = 'insert'
        where r.id = $1`,
      [createdBody.id],
    );
    assert(
      requestAttribution.rows[0]?.orgId === first.id &&
        requestAttribution.rows[0]?.createdBy === adminUserId &&
        requestAttribution.rows[0]?.contextId === active.organizationContext?.id &&
        requestAttribution.rows[0]?.contextOrgId === first.id,
      "portal write keeps the admin actor and records the selected organization context atomically",
    );

    const audit = await pool.query<{ action: string; actorUserId: string; organizationId: string }>(
      `select action, actor_user_id as "actorUserId", organization_id as "organizationId"
         from organization_context_actions
        where actor_user_id = $1 and organization_id = $2
        order by created_at`,
      [adminUserId, first.id],
    );
    assert(
      audit.rows.some((row) => row.action === "entered" && row.actorUserId === adminUserId && row.organizationId === first.id),
      "enter action has staff actor and target-organization audit attribution",
    );

    // A full browser reload must obtain the persisted server context, rather
    // than restoring a client-only cache or changing the authentication user.
    const executablePath = execFileSync("which", ["chromium"], { encoding: "utf8" }).trim();
    const browser = await chromium.launch({ headless: true, executablePath });
    try {
      const context = await browser.newContext();
      await context.addCookies(browserCookies(adminCookie));
      const page = await context.newPage();
      await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
      assert(await page.getByLabel("Organization view").isVisible(), "organization-view banner is rendered");
      await page.reload({ waitUntil: "networkidle" });
      assert(await page.getByLabel("Organization view").isVisible(), "organization context survives a full reload without client cache");
      assert(
        (await page.locator('.site-nav a[href="/admin/organizations"]:visible').count()) === 0 &&
          (await page.locator(".site-nav-switcher:visible").count()) === 0,
        "context UI hides staff navigation and the ordinary organization switcher",
      );
      await context.close();
    } finally {
      await browser.close();
    }

    // Simulate a staff disable after entry: a stale context must not remain
    // usable even when the browser still holds its signed context cookie.
    await pool.query(`update organizations set status = 'disabled' where id = $1`, [first.id]);
    await pool.query(`update organizations set status = 'approved' where id = $1`, [first.id]);
    const invalidated = await session(adminCookie);
    assert(
      invalidated.organizationContext === null && invalidated.activeOrgId !== first.id,
      "disable then reapprove cannot revive a context without an intervening context request",
    );
    const notRevived = await session(adminCookie);
    assert(
      notRevived.organizationContext === null,
      "reapproving an organization does not revive its invalidated context",
    );

    const exited = await exit(adminCookie);
    assert(exited.ok, "exit endpoint succeeds after context invalidation");
    const exitedBody = (await exited.json()) as { redirectTo?: string };
    assert(exitedBody.redirectTo === "/admin/roles", "exit returns staff-administration destination");
    const finalSession = await session(adminCookie);
    assert(finalSession.organizationContext === null, "exit clears organization context from session");
    const exitAudit = await pool.query<{ action: string }>(
      `select action from organization_context_actions
        where actor_user_id = $1 and organization_id = $2`,
      [adminUserId, first.id],
    );
    assert(
      exitAudit.rows.some((row) => row.action === "invalidated"),
      "invalidated exit is recorded in context audit history",
    );

    adminCookie = mergeCookieHeader(adminCookie, exited);
    const secondEntry = await enter(adminCookie, second.id);
    assert(secondEntry.ok, "admin can enter a new organization after invalidation");
    adminCookie = mergeCookieHeader(adminCookie, secondEntry);
    const secondSession = await session(adminCookie);
    assert(secondSession.organizationContext?.organizationId === second.id, "new context becomes active");
    await pool.query(
      `update admin_organization_contexts
          set expires_at = now() - interval '1 minute'
        where id = $1`,
      [secondSession.organizationContext?.id],
    );
    const expired = await session(adminCookie);
    assert(expired.organizationContext === null, "server expiry invalidates a context even if its cookie remains");
    const afterExpiry = await enter(adminCookie, first.id);
    assert(afterExpiry.ok, "an expired context does not block entering another organization");

    const controls = readFileSync("client/src/components/OrganizationContext.tsx", "utf8");
    assert(
      controls.includes('window.location.assign("/dashboard")') &&
        controls.includes('window.location.assign(body.redirectTo ?? "/dashboard")') &&
        !/\b(?:localStorage|sessionStorage)\b/.test(controls),
      "organization-context UI uses full navigations and no browser-storage cache",
    );
  } finally {
    await cleanup();
    await pool.end();
  }
}

main().catch(async (error: unknown) => {
  console.error(error);
  try {
    await cleanup();
    await pool.end();
  } catch {
    // Keep the original regression failure.
  }
  process.exit(1);
});