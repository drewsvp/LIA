/**
 * Regression coverage for supporter volunteer interests and ADMIN-11.
 *
 * Exercises seed spelling/order, profile persistence, stale/duplicate input,
 * inactive lifecycle behavior, person scoping, merge preservation, and admin
 * access boundaries. Fixture rows are zz_fixture-marked and removed on exit.
 *
 * Usage: NODE_ENV=development npx tsx scripts/test-volunteer-interests.ts
 */
import * as dal from "../server/dal";
import { auth } from "../server/auth/auth";
import { pool, q, SYSTEM, withDbContext } from "../server/db/client";
import { chromium, type BrowserContext } from "playwright";
import { execFileSync } from "node:child_process";

const BASE = "http://localhost:5000";
const BROWSER_BASE = process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : BASE;
const runId = `${process.pid}-${Date.now()}`;
const fixtureCategoryName = `zz_fixture Volunteer Interest ${runId}`;
const renamedFixtureCategoryName = `zz_fixture A Volunteer Interest ${runId}`;
const fixtureEmail = (label: string) => `zz.fixture.volunteer-interest.${label}.${runId}@example.org`;
const SEEDED_EMAILS = {
  staffAdmin: "tiffany@defendingthecause.org",
  staffApprover: "approver@thealliance.example.org",
  orgOwner: "dana@heartsandhands.example.org",
} as const;

const INITIAL_NAMES = [
  "Administrative Support",
  "Child Care & Family Support",
  "Event & Outreach Support",
  "Foster Care & Respite",
  "Hands-On Projects & General Help",
  "Kids' Camp Counselor / Help",
  "Mentoring & Relationship Building",
  "Ranch Help",
  "Skilled & Professional Services",
  "Sorting, Organizing & Distribution",
  "Technology & Digital Support",
  "Transportation & Delivery",
] as const;

let fixtureCategoryId: string | null = null;
const fixturePersonIds: string[] = [];
const fixtureUserIds: string[] = [];
const mergedDuplicateIds: string[] = [];
let staffCookie = "";
let approverCookie = "";
let originalStaffInterests: string[] = [];

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

function chromiumExecutable(): string {
  const configured = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?.trim();
  if (configured) return configured;
  return execFileSync("which", ["chromium"], { encoding: "utf8" }).trim();
}

async function mintSessionCookie(email: string, label: string): Promise<string> {
  // Use Better Auth's provider API directly so this suite can run beside the
  // quick-login validation without consuming its shared IP rate-limit budget.
  const token = `zz-volunteer-interests-${runId}-${label}`;
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
      query: { token, callbackURL: "/profile" },
      headers: new Headers(),
      asResponse: true,
    });
  } finally {
    await pool.query(`delete from verification where identifier = $1`, [token]);
  }
  assert(response.ok || response.status === 302, `${label} session mint succeeds`);
  const cookie = cookieHeader(response);
  assert(cookie !== "", `${label} session cookie is present`);
  return cookie;
}

async function request(
  path: string,
  options: { method?: string; cookie?: string; body?: unknown } = {},
): Promise<{ response: Response; body: Record<string, unknown> }> {
  const response = await fetch(`${BASE}${path}`, {
    method: options.method ?? "GET",
    headers: {
      ...(options.cookie ? { Cookie: options.cookie } : {}),
      ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  let body: Record<string, unknown> = {};
  try {
    body = (await response.json()) as Record<string, unknown>;
  } catch {
    // Status assertions below still report the response code.
  }
  return { response, body };
}

async function createPerson(label: string) {
  const person = await dal.people.create(SYSTEM, {
    firstName: "zz_fixture",
    lastName: label,
    email: fixtureEmail(label),
    sourceNote: "zz_fixture volunteer interests regression",
  });
  fixturePersonIds.push(person.id);
  return person;
}

async function testSeedAndBoundaries(): Promise<void> {
  console.log("\nSeed and access boundaries");
  const all = await dal.volunteerInterests.listAll(SYSTEM);
  const initial = all.filter((category) => INITIAL_NAMES.includes(category.name as (typeof INITIAL_NAMES)[number]));
  assert(initial.length === INITIAL_NAMES.length, "all 12 reviewed initial category names exist");
  assert(initial.every((category) => category.isActive), "the reviewed initial categories start active");
  assert(
    initial.map((category) => category.name).join("|") === INITIAL_NAMES.join("|"),
    "the reviewed initial categories are returned in exact alphabetical order",
  );

  approverCookie = await mintSessionCookie(SEEDED_EMAILS.staffApprover, "staff approver");
  const ownerCookie = await mintSessionCookie(SEEDED_EMAILS.orgOwner, "organization owner");
  const approver = await request("/api/admin/volunteer-categories", { cookie: approverCookie });
  const owner = await request("/api/admin/volunteer-categories", { cookie: ownerCookie });
  const anonymous = await request("/api/admin/volunteer-categories");
  assert(approver.response.status === 404, "staff approvers cannot discover the management API");
  assert(owner.response.status === 404, "non-staff users cannot discover the management API");
  assert(anonymous.response.status === 404, "signed-out visitors cannot discover the management API");
}

async function testAdminAndProfileApi(): Promise<void> {
  console.log("\nAdmin lifecycle and supporter profile API");
  staffCookie = await mintSessionCookie(SEEDED_EMAILS.staffAdmin, "staff admin");

  const before = await request("/api/supporter/profile", { cookie: staffCookie });
  assert(before.response.status === 200, "authenticated profile loads");
  const beforeOptions = before.body.volunteerInterests as Array<{ id: string; selected: boolean }>;
  originalStaffInterests = beforeOptions.filter((option) => option.selected).map((option) => option.id);

  const blank = await request("/api/admin/volunteer-categories", {
    method: "POST",
    cookie: staffCookie,
    body: { name: "   " },
  });
  assert(blank.response.status === 400, "blank category names are rejected");

  const added = await request("/api/admin/volunteer-categories", {
    method: "POST",
    cookie: staffCookie,
    body: { name: fixtureCategoryName },
  });
  assert(added.response.status === 200, "staff admins can add a category");
  fixtureCategoryId = (added.body.category as { id: string }).id;

  const duplicate = await request("/api/admin/volunteer-categories", {
    method: "POST",
    cookie: staffCookie,
    body: { name: `  ${fixtureCategoryName.toUpperCase()}  ` },
  });
  assert(duplicate.response.status === 409, "case-and-whitespace duplicate category names are rejected");

  const renamed = await request(`/api/admin/volunteer-categories/${fixtureCategoryId}/rename`, {
    method: "POST",
    cookie: staffCookie,
    body: { name: renamedFixtureCategoryName },
  });
  assert(renamed.response.status === 200, "staff admins can rename a category");

  const duplicateRename = await request(`/api/admin/volunteer-categories/${fixtureCategoryId}/rename`, {
    method: "POST",
    cookie: staffCookie,
    body: { name: " administrative support " },
  });
  assert(duplicateRename.response.status === 409, "renames cannot collide with another category");

  const adminList = await request("/api/admin/volunteer-categories", { cookie: staffCookie });
  const rows = (adminList.body.categories as Array<{ name: string }>).map((row) => row.name);
  const sorted = [...rows].sort((a, b) => {
    const lowerA = a.toLowerCase();
    const lowerB = b.toLowerCase();
    return lowerA < lowerB ? -1 : lowerA > lowerB ? 1 : a < b ? -1 : a > b ? 1 : 0;
  });
  assert(rows.join("|") === sorted.join("|"), "admin category display stays alphabetized after add and rename");

  const otherPerson = await createPerson("profile-target");
  const save = await request("/api/supporter/profile/volunteer-interests", {
    method: "PUT",
    cookie: staffCookie,
    body: {
      personId: otherPerson.id,
      categoryIds: [...originalStaffInterests, fixtureCategoryId],
    },
  });
  assert(save.response.status === 200, "the signed-in person can save optional interests");

  const laterVisit = await request("/api/supporter/profile", { cookie: staffCookie });
  const laterOptions = laterVisit.body.volunteerInterests as Array<{
    id: string;
    isActive: boolean;
    selected: boolean;
  }>;
  assert(
    laterOptions.some((option) => option.id === fixtureCategoryId && option.selected),
    "saved interests are restored on a later profile visit",
  );
  const otherRows = await withDbContext(SYSTEM, (client) =>
    q<{ count: number }>(
      client,
      `select count(*)::int as count from person_volunteer_interests where person_id = $1`,
      [otherPerson.id],
    ),
  );
  assert(otherRows[0]?.count === 0, "a request body cannot redirect a profile update to another person");

  const duplicateInput = await request("/api/supporter/profile/volunteer-interests", {
    method: "PUT",
    cookie: staffCookie,
    body: { categoryIds: [fixtureCategoryId, fixtureCategoryId] },
  });
  assert(duplicateInput.response.status === 400, "duplicate preference ids are rejected");

  const staleInput = await request("/api/supporter/profile/volunteer-interests", {
    method: "PUT",
    cookie: staffCookie,
    body: { categoryIds: ["00000000-0000-4000-8000-000000000099"] },
  });
  assert(staleInput.response.status === 409, "stale category ids are rejected");

  const deactivated = await request(`/api/admin/volunteer-categories/${fixtureCategoryId}/deactivate`, {
    method: "POST",
    cookie: staffCookie,
  });
  assert(deactivated.response.status === 200, "staff admins can deactivate a category");

  const inactiveProfile = await request("/api/supporter/profile", { cookie: staffCookie });
  const inactiveOptions = inactiveProfile.body.volunteerInterests as Array<{
    id: string;
    isActive: boolean;
    selected: boolean;
  }>;
  assert(
    inactiveOptions.some((option) => option.id === fixtureCategoryId && !option.isActive && option.selected),
    "an existing inactive interest remains identified on the profile",
  );

  const retainInactive = await request("/api/supporter/profile/volunteer-interests", {
    method: "PUT",
    cookie: staffCookie,
    body: { categoryIds: [...originalStaffInterests, fixtureCategoryId] },
  });
  assert(retainInactive.response.status === 200, "an already-saved inactive interest can be retained");

  const removeInactive = await request("/api/supporter/profile/volunteer-interests", {
    method: "PUT",
    cookie: staffCookie,
    body: { categoryIds: originalStaffInterests },
  });
  assert(removeInactive.response.status === 200, "a person can remove an inactive interest");

  const readdInactive = await request("/api/supporter/profile/volunteer-interests", {
    method: "PUT",
    cookie: staffCookie,
    body: { categoryIds: [...originalStaffInterests, fixtureCategoryId] },
  });
  assert(readdInactive.response.status === 409, "an inactive interest cannot be newly selected");

  const reactivated = await request(`/api/admin/volunteer-categories/${fixtureCategoryId}/reactivate`, {
    method: "POST",
    cookie: staffCookie,
  });
  assert(reactivated.response.status === 200, "staff admins can reactivate a category");
}

async function testRlsAndMerge(): Promise<void> {
  console.log("\nPerson scoping and merge preservation");
  const [categoryA, categoryB] = (await dal.volunteerInterests.listAll(SYSTEM)).slice(0, 2);
  assert(Boolean(categoryA && categoryB), "active categories are available for relationship tests");

  const ownerPerson = await createPerson("owner");
  const otherPerson = await createPerson("other");
  const ownerUser = await dal.users.create(SYSTEM, { personId: ownerPerson.id, status: "active", kind: "supporter" });
  const otherUser = await dal.users.create(SYSTEM, { personId: otherPerson.id, status: "active", kind: "supporter" });
  fixtureUserIds.push(ownerUser.id, otherUser.id);
  const ownerCtx = { kind: "member" as const, userId: ownerUser.id };

  await dal.volunteerInterests.replaceForPerson(ownerCtx, ownerPerson.id, [categoryA!.id]);
  const restored = await dal.volunteerInterests.listOptionsForPerson(ownerCtx, ownerPerson.id);
  assert(restored.some((option) => option.id === categoryA!.id && option.selected), "member RLS permits own preferences");

  let crossPersonRejected = false;
  try {
    await dal.volunteerInterests.replaceForPerson(ownerCtx, otherPerson.id, [categoryB!.id]);
  } catch {
    crossPersonRejected = true;
  }
  assert(crossPersonRejected, "member data access rejects writes to another person's preferences");
  let crossPersonReadRejected = false;
  try {
    await dal.volunteerInterests.listOptionsForPerson(ownerCtx, otherPerson.id);
  } catch {
    crossPersonReadRejected = true;
  }
  assert(crossPersonReadRejected, "member data access rejects reads of another person's preferences");
  const otherPreferences = await dal.volunteerInterests.listOptionsForPerson(
    { kind: "member", userId: otherUser.id },
    otherPerson.id,
  );
  assert(!otherPreferences.some((option) => option.selected), "the rejected cross-person write changes nothing");

  const survivor = await createPerson("merge-survivor");
  const duplicate = await createPerson("merge-duplicate");
  mergedDuplicateIds.push(duplicate.id);
  await dal.volunteerInterests.replaceForPerson(SYSTEM, survivor.id, [categoryA!.id]);
  await dal.volunteerInterests.replaceForPerson(SYSTEM, duplicate.id, [categoryA!.id, categoryB!.id]);
  const mergeRows = await withDbContext(SYSTEM, (client) =>
    q<{ moved: { volunteerInterests: number } }>(
      client,
      `select merge_people($1, $2) as moved`,
      [duplicate.id, survivor.id],
    ),
  );
  assert(mergeRows[0]?.moved.volunteerInterests === 2, "merge reports the duplicate person's moved interests");
  const merged = await dal.volunteerInterests.listOptionsForPerson(SYSTEM, survivor.id);
  assert(
    merged.filter((option) => option.selected).map((option) => option.id).sort().join("|") ===
      [categoryA!.id, categoryB!.id].sort().join("|"),
    "person merge preserves and deduplicates both people's interests",
  );
}

async function testResponsiveUi(): Promise<void> {
  console.log("\nResponsive and client-gate checks");
  const browser = await chromium.launch({ headless: true, executablePath: chromiumExecutable() });
  try {
    const staffContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await applyCookieHeader(staffContext, staffCookie);
    const profile = await staffContext.newPage();
    await profile.goto(`${BROWSER_BASE}/profile`);
    await profile.getByRole("heading", { name: "Volunteer Interests" }).waitFor();
    const optionBoxes = await profile.locator(".supporter-interest-option").evaluateAll((nodes) =>
      nodes.map((node) => node.getBoundingClientRect().height),
    );
    assert(optionBoxes.length >= INITIAL_NAMES.length, "the mobile profile renders every active interest");
    assert(optionBoxes.every((height) => height >= 44), "mobile checkbox targets are at least 44px tall");
    assert(
      await profile.getByRole("button", { name: "Save volunteer interests" }).isVisible(),
      "the explicit save control is visible at 390px",
    );
    await staffContext.close();

    const approverContext = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    await applyCookieHeader(approverContext, approverCookie);
    const admin = await approverContext.newPage();
    await admin.goto(`${BROWSER_BASE}/admin/volunteer-categories`);
    assert(
      (await admin.getByRole("heading", { name: "Volunteer categories" }).count()) === 0,
      "the client gate hides volunteer-category management from staff approvers",
    );
    assert(
      (await admin.locator('a[href="/admin/volunteer-categories"]').count()) === 0,
      "the staff-approver admin navigation does not reveal the category route",
    );
    await approverContext.close();
  } finally {
    await browser.close();
  }
}

async function cleanup(): Promise<void> {
  try {
    if (staffCookie) {
      await request("/api/supporter/profile/volunteer-interests", {
        method: "PUT",
        cookie: staffCookie,
        body: { categoryIds: originalStaffInterests },
      });
    }
    await withDbContext(SYSTEM, async (client) => {
      if (fixtureCategoryId) {
        await client.query(`delete from person_volunteer_interests where category_id = $1`, [fixtureCategoryId]);
        await client.query(`delete from volunteer_categories where id = $1`, [fixtureCategoryId]);
      }
      if (fixtureUserIds.length > 0) {
        await client.query(`delete from users where id = any($1::uuid[])`, [fixtureUserIds]);
      }
      if (mergedDuplicateIds.length > 0) {
        await client.query(
          `delete from approval_events
            where entity_type = 'person' and entity_id = any($1::uuid[])`,
          [mergedDuplicateIds],
        );
      }
      if (fixturePersonIds.length > 0) {
        await client.query(`delete from people where id = any($1::uuid[])`, [fixturePersonIds]);
      }
    });
  } catch (err) {
    console.error("Fixture cleanup failed:", err);
  }
}

async function main(): Promise<void> {
  console.log("Volunteer interests regression test");
  try {
    await testSeedAndBoundaries();
    await testAdminAndProfileApi();
    await testRlsAndMerge();
    await testResponsiveUi();
    console.log("\nAll volunteer-interest checks passed.");
  } finally {
    await cleanup();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("\nFAIL:", err);
  process.exit(1);
});