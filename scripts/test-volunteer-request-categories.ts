/**
 * Integration coverage for volunteer-request category classification.
 *
 * Requires the development workflow, applied migrations, and seeded quick-login
 * accounts. Writes zz_fixture rows and removes them before exit.
 *
 * Usage: NODE_ENV=development npx tsx scripts/test-volunteer-request-categories.ts
 */
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright";
import { pool } from "../server/db/client";
import { approveRequest } from "../server/services/request-approval";

const BASE = "http://localhost:5000";
const BROWSER_BASE = process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : BASE;
const marker = `zz_fixture_volunteer_categories_${process.pid}`;
const requestIds: string[] = [];
const contactIds: string[] = [];
const categoryIds: string[] = [];
let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string, detail = ""): void {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

function cookies(res: Response): string {
  const headers = res.headers as unknown as { getSetCookie?: () => string[]; get: (name: string) => string | null };
  const raw =
    typeof headers.getSetCookie === "function"
      ? headers.getSetCookie()
      : (headers.get("set-cookie") ?? "").split(/,(?=\s*\w+=)/);
  return raw.map((value) => value.split(";")[0]).join("; ");
}

async function login(role: "staff_approver" | "org_owner"): Promise<string> {
  const res = await fetch(`${BASE}/api/login/quick`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role }),
  });
  if (!res.ok) throw new Error(`quick login ${role} failed: ${res.status}`);
  return cookies(res);
}

async function request(cookie: string, path: string, body?: unknown): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Cookie: cookie,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function main(): Promise<void> {
  console.log("\n[volunteer request category tests]\n");
  const member = await login("org_owner");
  const staff = await login("staff_approver");

  const context = await pool.query<{ orgId: string; memberUserId: string; staffUserId: string }>(
    `select o.id as "orgId", member_user.id as "memberUserId", staff_user.id as "staffUserId"
       from organizations o
       join org_memberships om on om.org_id = o.id and om.status = 'active'
       join users member_user on member_user.id = om.user_id
       join people member_person on member_person.id = member_user.person_id
       cross join users staff_user
       join people staff_person on staff_person.id = staff_user.person_id
      where o.kind = 'member_org' and o.status = 'approved'
        and lower(member_person.email) = 'dana@heartsandhands.example.org'
        and lower(staff_person.email) = 'approver@thealliance.example.org'
      limit 1`,
  );
  const fixture = context.rows[0];
  if (!fixture) throw new Error("Seeded organization owner or staff approver not found — run db:seed first.");

  const categories = await pool.query<{ id: string; name: string }>(
    `insert into volunteer_categories (name)
     values ($1), ($2), ($3)
     returning id, name`,
    [`${marker} Alpha`, `${marker} Zulu`, `${marker} Inactive`],
  );
  const alphaId = categories.rows.find((row) => row.name.endsWith(" Alpha"))!.id;
  const zuluId = categories.rows.find((row) => row.name.endsWith(" Zulu"))!.id;
  const inactiveId = categories.rows.find((row) => row.name.endsWith(" Inactive"))!.id;
  categoryIds.push(...categories.rows.map((row) => row.id));
  await pool.query(`update volunteer_categories set is_active = false where id = $1`, [inactiveId]);

  const publicList = await fetch(`${BASE}/api/dashboard/volunteer-categories`);
  assert(!publicList.ok, "the member category vocabulary is not exposed without an organization session");

  const optionsRes = await request(member, "/api/dashboard/volunteer-categories");
  const optionsBody = (await optionsRes.json()) as {
    categories?: Array<{ id: string; name: string; isActive: boolean }>;
  };
  const optionIds = optionsBody.categories?.map((category) => category.id) ?? [];
  const optionNames = optionsBody.categories?.map((category) => category.name.toLocaleLowerCase("en-US")) ?? [];
  assert(
    optionsRes.ok &&
      optionIds.includes(alphaId) &&
      optionIds.includes(zuluId) &&
      !optionIds.includes(inactiveId) &&
      optionNames.every((name, index) => index === 0 || optionNames[index - 1]!.localeCompare(name, "en-US") <= 0),
    "members receive only active categories in alphabetical order",
  );

  const browser = await chromium.launch({
    headless: true,
    executablePath:
      process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?.trim() ||
      execFileSync("which", ["chromium"], { encoding: "utf8" }).trim(),
  });
  try {
    const context = await browser.newContext();
    await context.addCookies(
      member.split("; ").map((pair) => {
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
    const page = await context.newPage();
    await page.goto(`${BROWSER_BASE}/dashboard/volunteer/new`);
    const categoryGroup = page.getByRole("group", { name: /Volunteer Categories/ });
    await categoryGroup.waitFor();
    const labels = await categoryGroup.locator(".mp10-category-option").allTextContents();
    assert(
      (await categoryGroup.getByRole("checkbox").count()) === optionsBody.categories?.length &&
        labels.some((label) => label.includes(`${marker} Alpha`)) &&
        labels.some((label) => label.includes(`${marker} Zulu`)) &&
        labels.every((label) => !label.includes(`${marker} Inactive`)),
      "the member form renders the active data-driven choices as one accessible checkbox group",
    );
    await page.getByRole("button", { name: /Continue to Adding Roles/ }).click();
    assert(
      await page.getByText("Select at least one volunteer category.").isVisible(),
      "the member form explains that at least one category is required",
    );
  } finally {
    await browser.close();
  }

  const validTitle = `${marker} valid`;
  const baseBody = {
    contactFirstName: "ZZ",
    contactLastName: "Category Fixture",
    contactEmail: `${validTitle.replaceAll(" ", ".")}@example.invalid`,
    contactPhone: "555-0117",
    deadlineType: "ongoing",
    deadlineDate: "",
    details: "Weekly shifts",
    title: validTitle,
    description: "Help families at a fixture event.",
    eventLocation: "Fixture site",
    peopleHelped: 4,
    categoryIds: [zuluId, alphaId],
  };
  const createRes = await request(member, "/api/dashboard/volunteers", baseBody);
  const createBody = (await createRes.json()) as { id?: string };
  if (createBody.id) requestIds.push(createBody.id);
  const created = createBody.id
    ? await pool.query<{ contactId: string; categoryNames: string[] }>(
        `select r.contact_person_id as "contactId",
                array_agg(vc.name order by lower(vc.name), vc.name) as "categoryNames"
           from volunteer_requests r
           join volunteer_request_categories vrc on vrc.volunteer_request_id = r.id
           join volunteer_categories vc on vc.id = vrc.category_id
          where r.id = $1
          group by r.id`,
        [createBody.id],
      )
    : { rows: [] };
  if (created.rows[0]?.contactId) contactIds.push(created.rows[0].contactId);
  assert(
    createRes.ok &&
      created.rows[0]?.categoryNames.join("|") === `${marker} Alpha|${marker} Zulu`,
    "member posting saves the draft and all selected categories together",
    `status ${createRes.status}`,
  );

  for (const scenario of [
    { suffix: "missing", categoryIds: [randomUUID()] },
    { suffix: "inactive", categoryIds: [inactiveId] },
    { suffix: "duplicate", categoryIds: [alphaId, alphaId] },
  ]) {
    const title = `${marker} ${scenario.suffix}`;
    const email = `${title.replaceAll(" ", ".")}@example.invalid`;
    const response = await request(member, "/api/dashboard/volunteers", {
      ...baseBody,
      title,
      contactEmail: email,
      categoryIds: scenario.categoryIds,
    });
    const stored = await pool.query<{ requests: number; contacts: number }>(
      `select
         (select count(*)::int from volunteer_requests where title = $1) as requests,
         (select count(*)::int from people where lower(email) = lower($2)) as contacts`,
      [title, email],
    );
    assert(
      response.status === 400 &&
        stored.rows[0]?.requests === 0 &&
        stored.rows[0]?.contacts === 0,
      `${scenario.suffix} category identifiers reject the entire member draft transaction`,
      `status ${response.status}, stored ${JSON.stringify(stored.rows[0])}`,
    );
  }

  const validId = createBody.id;
  if (!validId) throw new Error("Valid member draft was not created.");
  const role = await pool.query<{ id: string }>(
    `insert into volunteer_roles (volunteer_request_id, name, description, quantity_needed, sort_order)
     values ($1, 'Fixture role', 'Fixture role description', 2, 0)
     returning id`,
    [validId],
  );
  const roleId = role.rows[0]!.id;
  await pool.query(
    `update volunteer_requests set status = 'pending', submitted_at = now() where id = $1`,
    [validId],
  );
  await pool.query(
    `insert into approval_events (entity_type, entity_id, from_status, to_status, actor_user_id, note)
     values ('volunteer_request', $1, 'draft', 'pending', $2, $3)`,
    [validId, fixture.memberUserId, marker],
  );

  const memberAdminDetail = await request(member, `/api/admin/requests/volunteer/${validId}`);
  assert(memberAdminDetail.status === 404, "organization members cannot read staff category assignments");

  const detailRes = await request(staff, `/api/admin/requests/volunteer/${validId}`);
  const detailBody = (await detailRes.json()) as {
    categories?: Array<{ id: string; name: string; isActive: boolean; selected: boolean }>;
  };
  const selectedNames = detailBody.categories?.filter((category) => category.selected).map((category) => category.name);
  assert(
    detailRes.ok && selectedNames?.join("|") === `${marker} Alpha|${marker} Zulu`,
    "Admin detail reloads assigned categories alphabetically",
  );

  const staffEditBody = {
    title: `${marker} corrected`,
    description: "Corrected volunteer description",
    details: "Corrected volunteer details",
    eventLocation: "Corrected fixture site",
    contactFirstName: "ZZ",
    contactLastName: "Category Fixture",
    contactEmail: baseBody.contactEmail,
    contactPhone: "555-0118",
    deadlineType: "ongoing",
    deadlineDate: null,
    peopleHelped: 6,
    categoryIds: [alphaId],
    children: [
      {
        id: roleId,
        name: "Corrected fixture role",
        description: "Corrected role description",
        quantityNeeded: 3,
      },
    ],
  };
  const editRes = await request(staff, `/api/admin/requests/volunteer/${validId}/edit`, staffEditBody);
  const afterEdit = await pool.query<{ title: string; categoryIds: string[]; roleName: string }>(
    `select r.title,
            array_agg(vrc.category_id order by vrc.category_id)::text[] as "categoryIds",
            min(vr.name) as "roleName"
       from volunteer_requests r
       join volunteer_roles vr on vr.volunteer_request_id = r.id
       join volunteer_request_categories vrc on vrc.volunteer_request_id = r.id
      where r.id = $1
      group by r.id`,
    [validId],
  );
  assert(
    editRes.ok &&
      afterEdit.rows[0]?.title === staffEditBody.title &&
      afterEdit.rows[0]?.categoryIds.join("|") === alphaId &&
      afterEdit.rows[0]?.roleName === "Corrected fixture role",
    "staff edits save request details, roles, and category assignments atomically",
    `status ${editRes.status}`,
  );

  const tamperedEdit = await request(staff, `/api/admin/requests/volunteer/${validId}/edit`, {
    ...staffEditBody,
    title: `${marker} must roll back`,
    children: [{ ...staffEditBody.children[0], name: "Must roll back" }],
    categoryIds: [randomUUID()],
  });
  const afterTamper = await pool.query<{ title: string; roleName: string; categoryIds: string[] }>(
    `select r.title, min(vr.name) as "roleName",
            array_agg(vrc.category_id order by vrc.category_id)::text[] as "categoryIds"
       from volunteer_requests r
       join volunteer_roles vr on vr.volunteer_request_id = r.id
       join volunteer_request_categories vrc on vrc.volunteer_request_id = r.id
      where r.id = $1 group by r.id`,
    [validId],
  );
  assert(
    tamperedEdit.status === 409 &&
      afterTamper.rows[0]?.title === staffEditBody.title &&
      afterTamper.rows[0]?.roleName === "Corrected fixture role" &&
      afterTamper.rows[0]?.categoryIds.join("|") === alphaId,
    "a tampered staff category rolls back request, role, and assignment changes",
    `status ${tamperedEdit.status}`,
  );

  await pool.query(`update volunteer_categories set is_active = false where id = $1`, [alphaId]);
  const inactiveDetail = await request(staff, `/api/admin/requests/volunteer/${validId}`);
  const inactiveDetailBody = (await inactiveDetail.json()) as {
    categories?: Array<{ id: string; isActive: boolean; selected: boolean }>;
  };
  assert(
    inactiveDetailBody.categories?.some(
      (category) => category.id === alphaId && category.selected && !category.isActive,
    ) === true,
    "an assigned category remains identifiable after deactivation",
  );

  const preserveInactive = await request(staff, `/api/admin/requests/volunteer/${validId}/edit`, staffEditBody);
  assert(preserveInactive.ok, "staff can preserve a currently assigned inactive category");
  const removeInactive = await request(staff, `/api/admin/requests/volunteer/${validId}/edit`, {
    ...staffEditBody,
    categoryIds: [],
  });
  const readdInactive = await request(staff, `/api/admin/requests/volunteer/${validId}/edit`, {
    ...staffEditBody,
    title: `${marker} inactive must not return`,
    categoryIds: [alphaId],
  });
  const afterInactive = await pool.query<{ title: string; categoryCount: number }>(
    `select r.title,
            (select count(*)::int from volunteer_request_categories vrc
              where vrc.volunteer_request_id = r.id) as "categoryCount"
       from volunteer_requests r where r.id = $1`,
    [validId],
  );
  assert(
    removeInactive.ok &&
      readdInactive.status === 409 &&
      afterInactive.rows[0]?.title === staffEditBody.title &&
      afterInactive.rows[0]?.categoryCount === 0,
    "staff can remove an inactive assignment but cannot add it back",
  );

  const blockedApproval = await request(staff, `/api/admin/requests/volunteer/${validId}/approve`, {});
  const blockedApprovalBody = (await blockedApproval.json()) as { message?: string };
  const statusAfterBlockedApproval = await pool.query<{ status: string }>(
    `select status from volunteer_requests where id = $1`,
    [validId],
  );
  assert(
    blockedApproval.status === 409 &&
      blockedApprovalBody.message?.includes("active volunteer category") === true &&
      statusAfterBlockedApproval.rows[0]?.status === "pending",
    "an uncategorized legacy request is blocked at approval with a clear explanation",
    blockedApprovalBody.message,
  );

  const assignActive = await request(staff, `/api/admin/requests/volunteer/${validId}/edit`, {
    ...staffEditBody,
    categoryIds: [zuluId],
  });
  const approved = assignActive.ok
    ? await approveRequest({ kind: "volunteer", requestId: validId, staffUserId: fixture.staffUserId })
    : null;
  assert(
    assignActive.ok && approved?.request.status === "active",
    "a staff-assigned active category allows approval to complete",
    `edit status ${assignActive.status}`,
  );

  const legacy = await pool.query<{ id: string }>(
    `insert into volunteer_requests
       (org_id, title, description, details, event_location, people_helped,
        deadline_type, contact_person_id, status, created_by)
     values ($1, $2, 'Legacy description', 'Legacy details', 'Legacy site', 1,
             'ongoing', $3, 'draft', $4)
     returning id`,
    [fixture.orgId, `${marker} uncategorized submission`, contactIds[0], fixture.memberUserId],
  );
  const legacyId = legacy.rows[0]!.id;
  requestIds.push(legacyId);
  await pool.query(
    `insert into volunteer_roles (volunteer_request_id, name, description, quantity_needed, sort_order)
     values ($1, 'Legacy role', 'Legacy role description', 1, 0)`,
    [legacyId],
  );
  const blockedSubmit = await request(member, `/api/dashboard/volunteers/${legacyId}/submit`, {});
  const legacyStatus = await pool.query<{ status: string; events: number }>(
    `select r.status,
            (select count(*)::int from approval_events ae
              where ae.entity_type = 'volunteer_request' and ae.entity_id = r.id) as events
       from volunteer_requests r where r.id = $1`,
    [legacyId],
  );
  assert(
    blockedSubmit.status === 400 &&
      legacyStatus.rows[0]?.status === "draft" &&
      legacyStatus.rows[0]?.events === 0,
    "direct submission cannot move an uncategorized volunteer request into review",
    `status ${blockedSubmit.status}`,
  );

  const blockedEditSubmit = await request(member, `/api/dashboard/volunteers/${legacyId}/edit/request`, {
    title: `${marker} edit submission must roll back`,
    description: "Changed legacy description",
    details: "Changed legacy details",
    eventLocation: "Changed legacy site",
    peopleHelped: 2,
    deadlineType: "ongoing",
    deadlineDate: null,
    contactFirstName: "ZZ",
    contactLastName: "Category Fixture",
    contactEmail: baseBody.contactEmail,
    contactPhone: "555-0199",
    statusTo: "pending",
  });
  const legacyAfterEditSubmit = await pool.query<{ title: string; status: string; events: number; emails: number }>(
    `select r.title, r.status,
            (select count(*)::int from approval_events ae
              where ae.entity_type = 'volunteer_request' and ae.entity_id = r.id) as events,
            (select count(*)::int from email_log el
              where el.entity_type = 'volunteer_request' and el.entity_id = r.id) as emails
       from volunteer_requests r where r.id = $1`,
    [legacyId],
  );
  assert(
    blockedEditSubmit.status === 400 &&
      legacyAfterEditSubmit.rows[0]?.title === `${marker} uncategorized submission` &&
      legacyAfterEditSubmit.rows[0]?.status === "draft" &&
      legacyAfterEditSubmit.rows[0]?.events === 0 &&
      legacyAfterEditSubmit.rows[0]?.emails === 0,
    "member request editing cannot move an uncategorized legacy draft into review",
    `status ${blockedEditSubmit.status}, stored ${JSON.stringify(legacyAfterEditSubmit.rows[0])}`,
  );

  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exitCode = 1;
}

async function cleanup(): Promise<void> {
  if (requestIds.length > 0) {
    await pool.query(`delete from approval_events where entity_id = any($1::uuid[])`, [requestIds]);
    await pool.query(`delete from email_log where entity_id = any($1::uuid[])`, [requestIds]);
    await pool.query(`delete from volunteer_requests where id = any($1::uuid[])`, [requestIds]);
  }
  if (contactIds.length > 0) {
    await pool.query(`delete from people where id = any($1::uuid[])`, [contactIds]);
  }
  if (categoryIds.length > 0) {
    await pool.query(`delete from volunteer_categories where id = any($1::uuid[])`, [categoryIds]);
  }
  await pool.end();
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(cleanup);