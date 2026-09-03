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
const ADMIN_ORG_CONTEXT_COOKIE = "lia_admin_org_context";
const organizationIds: string[] = [];
const requestIds: string[] = [];
const membershipIds: string[] = [];
const personIds: string[] = [];
const pledgeIds: string[] = [];
const signupIds: string[] = [];
const supporterRequestIds: string[] = [];
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

function removeCookie(cookie: string, name: string): string {
  return cookie
    .split("; ")
    .filter((pair) => !pair.startsWith(`${name}=`))
    .join("; ");
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

async function chooseOrganization(cookie: string, orgId: string): Promise<Response> {
  return fetch(`${BASE}/api/session/active-org`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ orgId }),
  });
}

async function supporterLists(cookie: string, query = ""): Promise<{
  donorsResponse: Response;
  volunteersResponse: Response;
  donors: { orgName?: string; donors?: Array<{ id: string; email: string }> };
  volunteers: { orgName?: string; volunteers?: Array<{ id: string; email: string }> };
}> {
  const [donorsResponse, volunteersResponse] = await Promise.all([
    fetch(`${BASE}/api/dashboard/supporters/donors${query}`, { headers: { Cookie: cookie } }),
    fetch(`${BASE}/api/dashboard/supporters/volunteers${query}`, { headers: { Cookie: cookie } }),
  ]);
  return {
    donorsResponse,
    volunteersResponse,
    donors: (await donorsResponse.json()) as { orgName?: string; donors?: Array<{ id: string; email: string }> },
    volunteers: (await volunteersResponse.json()) as {
      orgName?: string;
      volunteers?: Array<{ id: string; email: string }>;
    },
  };
}

async function createSupporterFixtures(
  orgId: string,
  suffix: string,
): Promise<{ donorEmail: string; volunteerEmail: string }> {
  const donorEmail = `${marker}.${suffix}.donor@example.org`;
  const volunteerEmail = `${marker}.${suffix}.volunteer@example.org`;
  const people = await pool.query<{ id: string }>(
    `insert into people (first_name, last_name, email, phone, source_note)
     values ('Donor', $1, $2, '555-0101', $3),
            ('Volunteer', $1, $4, '555-0102', $3)
     returning id`,
    [suffix, donorEmail, marker, volunteerEmail],
  );
  const donorPersonId = people.rows[0]!.id;
  const volunteerPersonId = people.rows[1]!.id;
  personIds.push(donorPersonId, volunteerPersonId);

  const itemRequest = await pool.query<{ id: string }>(
    `insert into item_requests (org_id, title, deadline_type, status)
     values ($1, $2, 'ongoing', 'active') returning id`,
    [orgId, `${marker} ${suffix} item request`],
  );
  const volunteerRequest = await pool.query<{ id: string }>(
    `insert into volunteer_requests (org_id, title, deadline_type, status)
     values ($1, $2, 'ongoing', 'active') returning id`,
    [orgId, `${marker} ${suffix} volunteer request`],
  );
  const itemRequestId = itemRequest.rows[0]!.id;
  const volunteerRequestId = volunteerRequest.rows[0]!.id;
  requestIds.push(itemRequestId, volunteerRequestId);
  supporterRequestIds.push(itemRequestId, volunteerRequestId);

  const item = await pool.query<{ id: string }>(
    `insert into items (item_request_id, name, quantity_requested, quantity_claimed, sort_order)
     values ($1, $2, 5, 1, 0) returning id`,
    [itemRequestId, `${suffix} blankets`],
  );
  const role = await pool.query<{ id: string }>(
    `insert into volunteer_roles
       (volunteer_request_id, name, quantity_needed, quantity_interested, sort_order)
     values ($1, $2, 5, 1, 0) returning id`,
    [volunteerRequestId, `${suffix} driver`],
  );
  const pledge = await pool.query<{ id: string }>(
    `insert into item_pledges (person_id, item_request_id, notes)
     values ($1, $2, $3) returning id`,
    [donorPersonId, itemRequestId, marker],
  );
  const signup = await pool.query<{ id: string }>(
    `insert into volunteer_signups (person_id, volunteer_request_id, notes)
     values ($1, $2, $3) returning id`,
    [volunteerPersonId, volunteerRequestId, marker],
  );
  pledgeIds.push(pledge.rows[0]!.id);
  signupIds.push(signup.rows[0]!.id);
  await pool.query(
    `insert into item_pledge_lines (item_pledge_id, item_id, quantity) values ($1, $2, 1)`,
    [pledge.rows[0]!.id, item.rows[0]!.id],
  );
  await pool.query(
    `insert into volunteer_signup_roles (volunteer_signup_id, volunteer_role_id) values ($1, $2)`,
    [signup.rows[0]!.id, role.rows[0]!.id],
  );
  return { donorEmail, volunteerEmail };
}

async function removeSupporterFixtures(): Promise<void> {
  if (pledgeIds.length) await pool.query(`delete from item_pledges where id = any($1::uuid[])`, [pledgeIds]);
  if (signupIds.length) await pool.query(`delete from volunteer_signups where id = any($1::uuid[])`, [signupIds]);
  if (supporterRequestIds.length) {
    await pool.query(`delete from items where item_request_id = any($1::uuid[])`, [supporterRequestIds]);
    await pool.query(`delete from volunteer_roles where volunteer_request_id = any($1::uuid[])`, [supporterRequestIds]);
    await pool.query(`delete from item_requests where id = any($1::uuid[])`, [supporterRequestIds]);
    await pool.query(`delete from volunteer_requests where id = any($1::uuid[])`, [supporterRequestIds]);
  }
  pledgeIds.length = 0;
  signupIds.length = 0;
  supporterRequestIds.length = 0;
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
    await removeSupporterFixtures();
    if (requestIds.length) {
      await pool.query(`delete from email_log where entity_id = any($1::uuid[])`, [requestIds]);
      await pool.query(`delete from approval_events where entity_id = any($1::uuid[])`, [requestIds]);
      await pool.query(`delete from items where item_request_id = any($1::uuid[])`, [requestIds]);
      await pool.query(`delete from volunteer_roles where volunteer_request_id = any($1::uuid[])`, [requestIds]);
      await pool.query(`delete from item_requests where id = any($1::uuid[])`, [requestIds]);
      await pool.query(`delete from volunteer_requests where id = any($1::uuid[])`, [requestIds]);
    }
    if (membershipIds.length) {
      await pool.query(`delete from org_memberships where id = any($1::uuid[])`, [membershipIds]);
    }
    await pool.query(`delete from organizations where id = any($1::uuid[]) and name like $2`, [
      organizationIds,
      `${marker}%`,
    ]);
    if (personIds.length) await pool.query(`delete from people where id = any($1::uuid[])`, [personIds]);
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
  const [initialAdminCookie, approverCookie, initialMemberCookie] = await Promise.all([
    login("staff_admin"),
    login("staff_approver"),
    login("org_owner"),
  ]);
  let adminCookie = initialAdminCookie;
  let memberCookie = initialMemberCookie;
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

    const memberSession = await session(memberCookie);
    const memberUserId = memberSession.user?.id;
    assert(typeof memberUserId === "string", "member fixture has an application user");
    const memberships = await pool.query<{ id: string }>(
      `insert into org_memberships (org_id, user_id, role, status, approved_at)
       values ($1, $3, 'member', 'active', now()),
              ($2, $3, 'member', 'active', now())
       returning id`,
      [first.id, second.id, memberUserId],
    );
    membershipIds.push(...memberships.rows.map((row) => row.id));
    const firstSupporters = await createSupporterFixtures(first.id, "selected");
    const foreignSupporters = await createSupporterFixtures(second.id, "foreign");
    const selected = await chooseOrganization(memberCookie, first.id);
    assert(selected.ok, "multi-organization member can select the supporter fixture organization");
    memberCookie = mergeCookieHeader(memberCookie, selected);
    const memberLists = await supporterLists(memberCookie, `?orgId=${encodeURIComponent(second.id)}`);
    assert(
      memberLists.donorsResponse.ok &&
        memberLists.volunteersResponse.ok &&
        memberLists.donors.orgName === first.name &&
        memberLists.volunteers.orgName === first.name &&
        memberLists.donors.donors?.some((row) => row.email === firstSupporters.donorEmail) &&
        memberLists.volunteers.volunteers?.some((row) => row.email === firstSupporters.volunteerEmail) &&
        !memberLists.donors.donors?.some((row) => row.email === foreignSupporters.donorEmail) &&
        !memberLists.volunteers.volunteers?.some((row) => row.email === foreignSupporters.volunteerEmail),
      "member supporter reads ignore manipulated organization input and isolate both contact lists",
    );

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
    const staffLists = await supporterLists(adminCookie, `?orgId=${encodeURIComponent(second.id)}`);
    assert(
      staffLists.donorsResponse.ok &&
        staffLists.volunteersResponse.ok &&
        staffLists.donors.orgName === first.name &&
        staffLists.volunteers.orgName === first.name &&
        staffLists.donors.donors?.some((row) => row.email === firstSupporters.donorEmail) &&
        staffLists.volunteers.volunteers?.some((row) => row.email === firstSupporters.volunteerEmail) &&
        !staffLists.donors.donors?.some((row) => row.email === foreignSupporters.donorEmail) &&
        !staffLists.volunteers.volunteers?.some((row) => row.email === foreignSupporters.volunteerEmail),
      "staff organization view returns only the selected organization's donor and volunteer contacts",
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

    const volunteer = await pool.query<{ id: string }>(
      `insert into volunteer_requests
         (org_id, title, description, details, event_location, people_helped, deadline_type,
          contact_person_id, status, created_by)
       select $1, $2, 'Context volunteer fixture.', 'Fixture details.', 'Fixture location.',
              1, 'ongoing', p.id, 'draft', $3
         from people p
        where lower(p.email) = lower($4)
       returning id`,
      [first.id, `${marker} volunteer request`, adminUserId, `${marker}@example.org`],
    );
    assert(volunteer.rows[0]?.id, "organization-context admin fixture has a volunteer request");
    requestIds.push(volunteer.rows[0]!.id);

    const requestLists = (await (
      await fetch(`${BASE}/api/dashboard/overview`, { headers: { Cookie: adminCookie } })
    ).json()) as {
      org?: { name?: string };
      itemRequests?: Array<{ id?: string }>;
      volunteerRequests?: Array<{ id?: string }>;
    };
    assert(
      requestLists.org?.name === first.name &&
        requestLists.itemRequests?.some((request) => request.id === createdBody.id) &&
        requestLists.volunteerRequests?.some((request) => request.id === volunteer.rows[0]!.id),
      "staff organization view lists both request types from the selected organization",
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
      assert(
        (await page.locator("select").nth(0).locator("option").filter({ hasText: `${marker} request` }).count()) === 1 &&
          (await page
            .locator("select")
            .nth(1)
            .locator("option")
            .filter({ hasText: `${marker} volunteer request` })
            .count()) === 1,
        "Preview-origin staff organization view loads both populated request selectors",
      );
      await page.reload({ waitUntil: "networkidle" });
      assert(await page.getByLabel("Organization view").isVisible(), "organization context survives a full reload without client cache");
      assert(
        (await page.locator('.site-nav a[href="/admin/organizations"]:visible').count()) === 0 &&
          (await page.locator(".site-nav-switcher:visible").count()) === 0,
        "context UI hides staff navigation and the ordinary organization switcher",
      );
      await page.route("**/api/dashboard/supporters/volunteers", async (route) => {
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ message: "fixture failure" }),
        });
      });
      await page.goto(`${BASE}/dashboard/supporters`, { waitUntil: "networkidle" });
      assert(
        (await page.locator(".mp13-table-donors").count()) === 1 &&
          (await page.locator("#mp13-volunteers-heading + .mp13-error").count()) === 1,
        "a genuine volunteer failure leaves the healthy donor branch visible",
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
    const noContextLists = await supporterLists(adminCookie);
    assert(
      noContextLists.donorsResponse.status === 403 && noContextLists.volunteersResponse.status === 403,
      "staff admin without an organization view cannot read member-organization supporters",
    );
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
    await removeSupporterFixtures();
    const emptySelection = await chooseOrganization(memberCookie, second.id);
    assert(emptySelection.ok, "member can switch to the empty fixture organization");
    memberCookie = mergeCookieHeader(memberCookie, emptySelection);
    const emptyMemberLists = await supporterLists(memberCookie);
    assert(
      emptyMemberLists.donorsResponse.ok &&
        emptyMemberLists.volunteersResponse.ok &&
        emptyMemberLists.donors.donors?.length === 0 &&
        emptyMemberLists.volunteers.volunteers?.length === 0,
      "member session receives independent empty donor and volunteer results",
    );
    const secondEntry = await enter(adminCookie, second.id);
    assert(secondEntry.ok, "admin can enter a new organization after invalidation");
    adminCookie = mergeCookieHeader(adminCookie, secondEntry);
    const secondSession = await session(adminCookie);
    assert(secondSession.organizationContext?.organizationId === second.id, "new context becomes active");
    const emptyOverviewResponse = await fetch(`${BASE}/api/dashboard/overview`, {
      headers: { Cookie: adminCookie },
    });
    const emptyOverview = (await emptyOverviewResponse.json()) as {
      itemRequests?: unknown[];
      volunteerRequests?: unknown[];
    };
    assert(
      emptyOverviewResponse.ok &&
        emptyOverview.itemRequests?.length === 0 &&
        emptyOverview.volunteerRequests?.length === 0,
      "staff organization view returns independent empty request lists",
    );
    const emptyStaffLists = await supporterLists(adminCookie);
    assert(
      emptyStaffLists.donorsResponse.ok &&
        emptyStaffLists.volunteersResponse.ok &&
        emptyStaffLists.donors.donors?.length === 0 &&
        emptyStaffLists.volunteers.volunteers?.length === 0,
      "staff organization view receives independent empty donor and volunteer results",
    );
    await pool.query(
      `update admin_organization_contexts
          set expires_at = now() - interval '1 minute'
        where id = $1`,
      [secondSession.organizationContext?.id],
    );
    const expired = await session(adminCookie);
    assert(expired.organizationContext === null, "server expiry invalidates a context even if its cookie remains");
    const expiredBrowser = await chromium.launch({
      headless: true,
      executablePath: execFileSync("which", ["chromium"], { encoding: "utf8" }).trim(),
    });
    try {
      const expiredContext = await expiredBrowser.newContext();
      await expiredContext.addCookies(browserCookies(adminCookie));
      const expiredPage = await expiredContext.newPage();
       await expiredPage.goto(`${BASE}/dashboard/supporters`, { waitUntil: "networkidle" });
      assert(
        new URL(expiredPage.url()).pathname === "/admin/organizations" &&
           (await expiredPage.locator(".mp13-error").count()) === 0,
         "expired Preview organization context returns staff to organization selection without supporter table errors",
      );
      await expiredContext.close();
    } finally {
      await expiredBrowser.close();
    }
    const afterExpiry = await enter(adminCookie, first.id);
    assert(afterExpiry.ok, "an expired context does not block entering another organization");
    adminCookie = mergeCookieHeader(adminCookie, afterExpiry);
    const activeBeforeCookieLoss = await session(adminCookie);
    const orphanedContextId = activeBeforeCookieLoss.organizationContext?.id;
    assert(typeof orphanedContextId === "string", "replacement fixture has an active context before cookie loss");

    const parallelEntry = await enter(adminCookie, second.id);
    assert(
      parallelEntry.status === 404,
      "a valid active context still blocks parallel organization-view entry",
    );

    const cookieLost = removeCookie(adminCookie, ADMIN_ORG_CONTEXT_COOKIE);
    const recoveredEntry = await enter(cookieLost, second.id);
    assert(recoveredEntry.ok, "staff can enter an organization after losing the context cookie");
    adminCookie = mergeCookieHeader(cookieLost, recoveredEntry);
    const recoveredSession = await session(adminCookie);
    assert(
      recoveredSession.organizationContext?.organizationId === second.id &&
        recoveredSession.organizationContext?.id !== orphanedContextId,
      "cookie-loss recovery starts a replacement organization context",
    );
    const recoveredContext = await pool.query<{ endedAt: string | null }>(
      `select ended_at as "endedAt"
         from admin_organization_contexts
        where id = $1`,
      [orphanedContextId],
    );
    const recoveryAudit = await pool.query<{
      action: string;
      actorUserId: string;
      organizationId: string;
    }>(
      `select action, actor_user_id as "actorUserId", organization_id as "organizationId"
         from organization_context_actions
        where organization_context_id = $1`,
      [orphanedContextId],
    );
    assert(
      recoveredContext.rows[0]?.endedAt !== null &&
        recoveryAudit.rows.some(
          (row) =>
            row.action === "recovered" &&
            row.actorUserId === adminUserId &&
            row.organizationId === first.id,
        ),
      "cookie-loss recovery closes and audits the orphaned context with the staff actor",
    );

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