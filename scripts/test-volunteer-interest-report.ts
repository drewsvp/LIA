/**
 * Regression coverage for the staff-admin volunteer interest report.
 *
 * Usage: NODE_ENV=development npx tsx scripts/test-volunteer-interest-report.ts
 */
import { execFileSync } from "node:child_process";
import { chromium, type BrowserContext } from "playwright";
import * as dal from "../server/dal";
import { auth } from "../server/auth/auth";
import { pool, SYSTEM, withDbContext } from "../server/db/client";

const BASE = "http://localhost:5000";
const BROWSER_BASE = process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : BASE;
const runId = `${process.pid}-${Date.now()}`;
const fixturePrefix = `zz.fixture.volunteer-report.${runId}`;
const fixtureEmail = (label: string) => `${fixturePrefix}.${label}@example.org`;
const SEEDED_EMAILS = {
  staffAdmin: "tiffany@defendingthecause.org",
  staffApprover: "approver@thealliance.example.org",
  orgOwner: "dana@heartsandhands.example.org",
} as const;

const personIds: string[] = [];
const userIds: string[] = [];
const categoryIds: string[] = [];
let digestId: string | null = null;
let staffCookie = "";
let approverCookie = "";
let ownerCookie = "";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
  console.log(`  ✓ ${message}`);
}

function cookieHeader(response: Response): string {
  const headers = response.headers as unknown as {
    getSetCookie?: () => string[];
    get: (name: string) => string | null;
  };
  const values =
    typeof headers.getSetCookie === "function"
      ? headers.getSetCookie()
      : (headers.get("set-cookie") ?? "").split(/,(?=\s*\w+=)/);
  return values.map((value) => value.split(";")[0]).join("; ");
}

async function mintSessionCookie(email: string, label: string): Promise<string> {
  const token = `zz-volunteer-report-${runId}-${label}`;
  await pool.query(
    `insert into verification (id, identifier, value, "expiresAt", "createdAt", "updatedAt")
     values (gen_random_uuid(), $1, $2, now() + interval '2 minutes', now(), now())`,
    [token, JSON.stringify({ email })],
  );
  type MagicLinkApi = {
    magicLinkVerify(input: {
      query: { token: string; callbackURL: string };
      headers: Headers;
      asResponse: true;
    }): Promise<Response>;
  };
  let response: Response;
  try {
    response = await (auth.api as unknown as MagicLinkApi).magicLinkVerify({
      query: { token, callbackURL: "/" },
      headers: new Headers(),
      asResponse: true,
    });
  } finally {
    await pool.query(`delete from verification where identifier = $1`, [token]);
  }
  assert(response.ok || response.status === 302, `${label} session can be created`);
  const cookie = cookieHeader(response);
  assert(cookie !== "", `${label} session has a cookie`);
  return cookie;
}

async function request(
  path: string,
  options: { cookie?: string; method?: string } = {},
): Promise<{ response: Response; body: Record<string, unknown> }> {
  const response = await fetch(`${BASE}${path}`, {
    method: options.method ?? "GET",
    headers: options.cookie ? { Cookie: options.cookie } : undefined,
  });
  let body: Record<string, unknown> = {};
  try {
    body = (await response.json()) as Record<string, unknown>;
  } catch {
    // Status assertions remain useful if the body is unexpectedly non-JSON.
  }
  return { response, body };
}

async function createSupporter(
  label: string,
  status: "invited" | "active" | "disabled",
  interests: string[],
  alertPreference?: boolean,
): Promise<{ personId: string; userId: string; email: string }> {
  const email = fixtureEmail(label);
  const person = await dal.people.create(SYSTEM, {
    firstName: "zz_fixture",
    lastName: `Volunteer Report ${label}`,
    email,
    phone: `555-010-${label}`,
    sourceNote: "zz_fixture volunteer interest report",
  });
  personIds.push(person.id);
  const user = await dal.users.create(SYSTEM, { personId: person.id, kind: "supporter", status });
  userIds.push(user.id);
  await withDbContext(SYSTEM, async (c) => {
    if (interests.length > 0) {
      await c.query(
        `insert into person_volunteer_interests (person_id, category_id)
         select $1, unnest($2::uuid[])`,
        [person.id, interests],
      );
    }
    if (alertPreference !== undefined) {
      await c.query(
        `insert into volunteer_alert_preferences (user_id, enabled)
         values ($1, $2)`,
        [user.id, alertPreference],
      );
    }
  });
  return { personId: person.id, userId: user.id, email };
}

function reportRows(body: Record<string, unknown>): Array<Record<string, unknown>> {
  return body.rows as Array<Record<string, unknown>>;
}

async function testAccessBoundaries(): Promise<void> {
  console.log("\nAccess boundaries");
  for (const path of [
    "/api/admin/volunteer-interest-report",
    "/api/admin/volunteer-interest-report/options",
  ]) {
    for (const [label, cookie] of [
      ["staff approvers", approverCookie],
      ["organization members", ownerCookie],
      ["signed-out visitors", ""],
    ] as const) {
      const result = await request(path, { cookie });
      assert(result.response.status === 404, `${label} cannot discover ${path}`);
      assert(JSON.stringify(result.body) === '{"message":"Not found"}', `${path} uses the indistinguishable 404 body`);
    }
  }
}

async function testDatasetAndFilters(
  activeCategoryId: string,
  inactiveCategoryId: string,
  fixtures: {
    zero: Awaited<ReturnType<typeof createSupporter>>;
    optedIn: Awaited<ReturnType<typeof createSupporter>>;
    disabled: Awaited<ReturnType<typeof createSupporter>>;
    invited: Awaited<ReturnType<typeof createSupporter>>;
  },
): Promise<void> {
  console.log("\nDataset, filters, and privacy");
  const options = await request("/api/admin/volunteer-interest-report/options", { cookie: staffCookie });
  assert(options.response.status === 200, "staff admins can load report filter options");
  const optionCategories = options.body.categories as Array<{ id: string; isActive: boolean }>;
  assert(
    optionCategories.some((category) => category.id === inactiveCategoryId && !category.isActive),
    "inactive categories remain available as report filters",
  );

  const zero = await request(
    `/api/admin/volunteer-interest-report?search=${encodeURIComponent(fixtures.zero.email)}`,
    { cookie: staffCookie },
  );
  assert(zero.response.status === 200 && reportRows(zero.body).length === 1, "default report includes an active supporter with no interests");
  assert((reportRows(zero.body)[0]?.categories as unknown[]).length === 0, "zero-interest supporter has an explicit empty category list");
  assert(reportRows(zero.body)[0]?.matchingAlertsEnabled === false, "missing alert preference is reported as Off");

  const optedIn = await request(
    `/api/admin/volunteer-interest-report?search=${encodeURIComponent(fixtures.optedIn.email)}`,
    { cookie: staffCookie },
  );
  const optedInRow = reportRows(optedIn.body)[0];
  assert(optedIn.response.status === 200 && optedInRow?.matchingAlertsEnabled === true, "enabled matching-alert preference is reported as On");
  const interests = optedInRow?.categories as Array<{ id: string; isActive: boolean }>;
  assert(interests.length === 2, "all selected interests are returned");
  assert(interests.some((interest) => interest.id === inactiveCategoryId && !interest.isActive), "saved inactive interest stays visible and labeled");
  assert(!JSON.stringify(optedIn.body).toLowerCase().includes("unsubscribe"), "report payload never exposes unsubscribe fields or tokens");
  assert(!JSON.stringify(optedIn.body).toLowerCase().includes("digest"), "report payload does not conflate weekly digest state with matching alerts");

  const disabled = await request(
    `/api/admin/volunteer-interest-report?search=${encodeURIComponent(fixtures.disabled.email)}&accountState=disabled`,
    { cookie: staffCookie },
  );
  assert(reportRows(disabled.body)[0]?.accountState === "disabled", "disabled supporter accounts can be filtered explicitly");
  const invited = await request(
    `/api/admin/volunteer-interest-report?search=${encodeURIComponent(fixtures.invited.email)}&accountState=invited`,
    { cookie: staffCookie },
  );
  assert(reportRows(invited.body)[0]?.accountState === "invited", "invited supporter accounts can be filtered explicitly");

  const activeCategory = await request(
    `/api/admin/volunteer-interest-report?search=${encodeURIComponent(fixturePrefix)}&accountState=all&categoryId=${activeCategoryId}&categoryState=active`,
    { cookie: staffCookie },
  );
  assert(Number(activeCategory.body.total) === 2, "active category filter matches only supporters who selected that active category");
  const inactiveCategory = await request(
    `/api/admin/volunteer-interest-report?search=${encodeURIComponent(fixturePrefix)}&accountState=all&categoryId=${inactiveCategoryId}&categoryState=inactive`,
    { cookie: staffCookie },
  );
  assert(Number(inactiveCategory.body.total) === 2, "inactive category filter matches saved historical interests");
  const impossibleCombination = await request(
    `/api/admin/volunteer-interest-report?search=${encodeURIComponent(fixturePrefix)}&accountState=all&categoryId=${activeCategoryId}&categoryState=inactive`,
    { cookie: staffCookie },
  );
  assert(Number(impossibleCombination.body.total) === 0, "category and category-state filters apply to the same selected interest");

  const on = await request(
    `/api/admin/volunteer-interest-report?search=${encodeURIComponent(fixturePrefix)}&accountState=all&matchingAlerts=on`,
    { cookie: staffCookie },
  );
  assert(Number(on.body.total) === 1, "matching-alert On filter excludes missing and disabled preferences");
  const off = await request(
    `/api/admin/volunteer-interest-report?search=${encodeURIComponent(fixturePrefix)}&accountState=all&matchingAlerts=off`,
    { cookie: staffCookie },
  );
  assert(Number(off.body.total) === 3, "matching-alert Off filter includes missing preference rows");

  const firstPage = await request(
    `/api/admin/volunteer-interest-report?search=${encodeURIComponent(fixturePrefix)}&accountState=all&page=1&pageSize=2`,
    { cookie: staffCookie },
  );
  const secondPage = await request(
    `/api/admin/volunteer-interest-report?search=${encodeURIComponent(fixturePrefix)}&accountState=all&page=2&pageSize=2`,
    { cookie: staffCookie },
  );
  assert(Number(firstPage.body.total) === 4 && reportRows(firstPage.body).length === 2, "first page reports the full total and requested page size");
  assert(reportRows(secondPage.body).length === 2, "second page returns the remaining supporters");
  const pageIds = [...reportRows(firstPage.body), ...reportRows(secondPage.body)].map((row) => row.userId);
  assert(new Set(pageIds).size === 4, "pagination is stable without duplicated supporters");

  for (const query of [
    "accountState=removed",
    "matchingAlerts=yes",
    "categoryState=retired",
    "page=0",
    "page=9007199254740991",
    "pageSize=101",
    "categoryId=not-a-uuid",
  ]) {
    const invalid = await request(`/api/admin/volunteer-interest-report?${query}`, { cookie: staffCookie });
    assert(invalid.response.status === 400, `invalid report filter is rejected: ${query}`);
  }
}

function chromiumExecutable(): string {
  const configured = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?.trim();
  if (configured) return configured;
  return execFileSync("which", ["chromium"], { encoding: "utf8" }).trim();
}

async function applyCookieHeader(context: BrowserContext, header: string): Promise<void> {
  await context.addCookies(
    header.split("; ").map((pair) => {
      const separator = pair.indexOf("=");
      return {
        name: pair.slice(0, separator),
        value: pair.slice(separator + 1),
        url: BROWSER_BASE,
        httpOnly: true,
        secure: BROWSER_BASE.startsWith("https://"),
        sameSite: "Lax" as const,
      };
    }),
  );
}

async function testAdminUi(optedInEmail: string): Promise<void> {
  console.log("\nAdmin report UI");
  const browser = await chromium.launch({ headless: true, executablePath: chromiumExecutable() });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await applyCookieHeader(context, staffCookie);
    const page = await context.newPage();
    await page.goto(`${BROWSER_BASE}/admin/volunteer-categories`);
    await page.getByRole("button", { name: "Interested supporters" }).click();
    assert(
      (await page.getByRole("button", { name: "Interested supporters" }).getAttribute("aria-pressed")) === "true",
      "report view control exposes its selected state",
    );
    await page.getByLabel("Search supporters").fill(optedInEmail);
    const row = page.locator("tbody tr").filter({ hasText: optedInEmail });
    await row.waitFor();
    assert(await row.getByText("Inactive", { exact: true }).isVisible(), "UI clearly labels saved inactive interests");
    assert(await row.getByText("On", { exact: true }).isVisible(), "UI shows the matching-alert preference");
    assert(await page.getByText("Matching alerts are separate from weekly digest subscriptions.").isVisible(), "UI explains matching alerts and weekly digest are separate");
    await context.close();
  } finally {
    await browser.close();
  }
}

async function setup(): Promise<{
  activeCategoryId: string;
  inactiveCategoryId: string;
  fixtures: {
    zero: Awaited<ReturnType<typeof createSupporter>>;
    optedIn: Awaited<ReturnType<typeof createSupporter>>;
    disabled: Awaited<ReturnType<typeof createSupporter>>;
    invited: Awaited<ReturnType<typeof createSupporter>>;
  };
}> {
  staffCookie = await mintSessionCookie(SEEDED_EMAILS.staffAdmin, "staff admin");
  approverCookie = await mintSessionCookie(SEEDED_EMAILS.staffApprover, "staff approver");
  ownerCookie = await mintSessionCookie(SEEDED_EMAILS.orgOwner, "organization owner");
  const active = await dal.volunteerInterests.create(SYSTEM, `zz_fixture Report Active ${runId}`);
  const inactive = await dal.volunteerInterests.create(SYSTEM, `zz_fixture Report Inactive ${runId}`);
  categoryIds.push(active.id, inactive.id);
  await dal.volunteerInterests.deactivate(SYSTEM, inactive.id);

  const zero = await createSupporter("zero", "active", []);
  const optedIn = await createSupporter("opted-in", "active", [active.id, inactive.id], true);
  const disabled = await createSupporter("disabled", "disabled", [active.id], false);
  const invited = await createSupporter("invited", "invited", [inactive.id]);
  const digestRows = await pool.query<{ id: string }>(
    `insert into digest_subscribers (person_id, email, status, first_name, last_name)
     values ($1, $2, 'unsubscribed', 'zz_fixture', 'Volunteer Report Digest')
     returning id`,
    [optedIn.personId, optedIn.email],
  );
  digestId = digestRows.rows[0]?.id ?? null;
  return {
    activeCategoryId: active.id,
    inactiveCategoryId: inactive.id,
    fixtures: { zero, optedIn, disabled, invited },
  };
}

async function cleanup(): Promise<void> {
  try {
    if (digestId) await pool.query(`delete from digest_subscribers where id = $1`, [digestId]);
    await withDbContext(SYSTEM, async (c) => {
      if (userIds.length > 0) await c.query(`delete from users where id = any($1::uuid[])`, [userIds]);
      if (personIds.length > 0) await c.query(`delete from people where id = any($1::uuid[])`, [personIds]);
      if (categoryIds.length > 0) await c.query(`delete from volunteer_categories where id = any($1::uuid[])`, [categoryIds]);
    });
  } catch (err) {
    console.error("Fixture cleanup failed:", err);
  }
}

async function main(): Promise<void> {
  console.log("Volunteer interest report regression test");
  try {
    const setupResult = await setup();
    await testAccessBoundaries();
    await testDatasetAndFilters(
      setupResult.activeCategoryId,
      setupResult.inactiveCategoryId,
      setupResult.fixtures,
    );
    await testAdminUi(setupResult.fixtures.optedIn.email);
    console.log("\nAll volunteer-interest report checks passed.");
  } finally {
    await cleanup();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("\nFAIL:", err);
  process.exit(1);
});