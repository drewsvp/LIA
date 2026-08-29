/**
 * Direct staff-admin organization edit regression coverage.
 *
 * Requires the development server. Fixtures use a zz. marker and are removed.
 * The browser checks below deliberately intercept saves, so UI coverage does
 * not add extra mutations beyond the direct API cases.
 */
import { execFileSync } from "node:child_process";
import { pool } from "../server/db/client";
import { chromium, type BrowserContext } from "playwright";

const BASE =
  process.env.TEST_BASE_URL ??
  (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : "http://127.0.0.1:5000");
const marker = `zz.admin-org-edit.${process.pid}`;
const organizationIds: string[] = [];
const personIds: string[] = [];
type BrowserCookie = Parameters<BrowserContext["addCookies"]>[0][number];

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

function browserCookie(cookieHeader: string): BrowserCookie {
  const pair = cookieHeader.split(";").find((part) => part.includes("session_token="))?.trim();
  if (!pair) throw new Error("Session cookie header did not contain session_token.");
  const separator = pair.indexOf("=");
  return {
    name: pair.slice(0, separator),
    value: pair.slice(separator + 1),
    url: BASE,
    httpOnly: true,
    secure: BASE.startsWith("https://"),
    sameSite: "Lax",
  };
}

async function login(role: "staff_admin" | "staff_approver"): Promise<{ cookie: string; userId: string }> {
  const response = await fetch(`${BASE}/api/login/quick`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role }),
  });
  assert(response.ok, `${role} quick login succeeds`);
  const cookie = cookies(response);
  const sessionResponse = await fetch(`${BASE}/api/session`, { headers: { Cookie: cookie } });
  const session = (await sessionResponse.json()) as { user?: { id?: string } };
  assert(typeof session.user?.id === "string", `${role} session has a user`);
  return { cookie, userId: session.user.id };
}

async function createPerson(suffix: string): Promise<{ id: string; email: string }> {
  const email = `${marker}.${suffix}@example.org`;
  const result = await pool.query<{ id: string }>(
    `insert into people (first_name, last_name, email, phone, source_note)
     values ('Before', $1, $2, '555-0100', 'zz_fixture admin organization edit')
     returning id`,
    [suffix, email],
  );
  const id = result.rows[0]!.id;
  personIds.push(id);
  return { id, email };
}

async function createOrganization(
  status: "pending" | "approved" | "disabled",
  suffix: string,
  contactPersonId: string,
  populationId: string,
): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `insert into organizations
       (kind, name, slug, website_url, mission, phone, city, status, primary_contact_person_id)
     values
       ('member_org', $1, $2, 'https://before.example.org/', 'Before mission', '555-0100', 'Before City', $3, $4)
     returning id`,
    [`${marker} ${suffix}`, `${marker.replace(/\./g, "-")}-${suffix}`, status, contactPersonId],
  );
  const id = result.rows[0]!.id;
  organizationIds.push(id);
  await pool.query(
    `insert into organization_populations (org_id, population_id) values ($1, $2)`,
    [id, populationId],
  );
  return id;
}

function editBody(input: {
  name: string;
  email: string;
  populationIds: string[];
  logo?: Blob;
}): FormData {
  const body = new FormData();
  body.append("name", input.name);
  body.append("websiteUrl", "after.example.org");
  body.append("mission", "After mission");
  body.append("phone", "555-0199");
  body.append("addressLine1", "123 Test Street");
  body.append("addressLine2", "Suite 4");
  body.append("city", "After City");
  body.append("state", "CA");
  body.append("postalCode", "90001");
  for (const id of input.populationIds) body.append("populationIds", id);
  body.append("firstName", "After");
  body.append("lastName", "Contact");
  body.append("email", input.email);
  body.append("contactPhone", "555-0198");
  if (input.logo) body.append("logo", input.logo, "not-an-image.txt");
  return body;
}

async function update(cookie: string, orgId: string, body: FormData): Promise<Response> {
  return fetch(`${BASE}/api/admin/organizations/${orgId}`, {
    method: "PUT",
    headers: { Cookie: cookie },
    body,
  });
}

async function cleanup(): Promise<void> {
  if (organizationIds.length > 0) {
    await pool.query(`delete from organization_context_actions where organization_id = any($1::uuid[])`, [organizationIds]);
    await pool.query(
      `delete from approval_events
        where context_organization_id = any($1::uuid[])
           or entity_id = any($1::uuid[])`,
      [organizationIds],
    );
    await pool.query(`delete from admin_organization_contexts where organization_id = any($1::uuid[])`, [organizationIds]);
    await pool.query(`delete from organization_revisions where organization_id = any($1::uuid[])`, [organizationIds]);
    await pool.query(`delete from organization_populations where org_id = any($1::uuid[])`, [organizationIds]);
    await pool.query(`delete from organizations where id = any($1::uuid[])`, [organizationIds]);
  }
  if (personIds.length > 0) {
    await pool.query(`delete from people where id = any($1::uuid[])`, [personIds]);
  }
}

async function checkBrowserEditor(
  admin: { cookie: string },
  approver: { cookie: string },
  organizationId: string,
  expectedName: string,
): Promise<void> {
  const browser = await chromium.launch({
    headless: true,
    executablePath: execFileSync("which", ["chromium"], { encoding: "utf8" }).trim(),
  });

  const openEditor = async (page: import("playwright").Page): Promise<void> => {
    await page.goto(`${BASE}/admin/organizations`, { waitUntil: "networkidle" });
    const row = page.locator("tr.adm-row").filter({ hasText: expectedName });
    await row.waitFor({ state: "visible" });
    await row.click();
    await page.getByRole("heading", { name: expectedName, exact: true }).waitFor();
    await page.getByRole("button", { name: "Edit organization", exact: true }).click();
    await page.locator("form.adm-org-edit").waitFor({ state: "visible" });
  };

  try {
    const desktop = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await desktop.addCookies([browserCookie(admin.cookie)]);
    const page = await desktop.newPage();
    await openEditor(page);

    assert(
      (await page.getByLabel("Organization name", { exact: true }).inputValue()) === expectedName,
      "staff admin opens the editor with the existing organization name prefilled",
    );
    assert(
      (await page.getByLabel("Website", { exact: true }).inputValue()) === "https://after.example.org/",
      "staff admin sees the existing website prefilled",
    );
    assert(
      (await page.locator("label").filter({ hasText: "Mission statement" }).locator("textarea").inputValue()) === "After mission",
      "staff admin sees the existing mission prefilled",
    );
    assert(
      (await page.getByLabel("City", { exact: true }).inputValue()) === "After City",
      "staff admin sees the existing address fields prefilled",
    );
    assert(
      (await page.getByLabel("First name", { exact: true }).inputValue()) === "After",
      "staff admin sees the existing contact fields prefilled",
    );

    const editorRoute = `**/api/admin/organizations/${organizationId}`;
    const failureHandler = async (route: import("playwright").Route): Promise<void> => {
      if (route.request().method() === "PUT") {
        await route.fulfill({
          status: 422,
          contentType: "application/json",
          body: JSON.stringify({ message: "The organization could not be saved in this test." }),
        });
      } else {
        await route.continue();
      }
    };
    await page.route(editorRoute, failureHandler);
    const enteredName = `${marker} browser entered`;
    const enteredMission = "Mission entered before the failed save";
    await page.getByLabel("Organization name", { exact: true }).fill(enteredName);
    const missionField = page.locator("label").filter({ hasText: "Mission statement" }).locator("textarea");
    await missionField.fill(enteredMission);
    await page.getByRole("button", { name: "Save organization", exact: true }).click();
    await page.getByText("The organization could not be saved in this test.", { exact: true }).waitFor();
    assert(
      (await page.getByLabel("Organization name", { exact: true }).inputValue()) === enteredName &&
        (await missionField.inputValue()) === enteredMission,
      "a failed save keeps the values entered in the form",
    );
    assert(
      (await page.getByText("The organization could not be saved in this test.", { exact: true }).count()) === 1,
      "a failed save shows the server error",
    );
    await page.unroute(editorRoute, failureHandler);

    let putRequestCount: number = 0;
    let submittedBody = "";
    const observedPutRequestCount = (): number => putRequestCount;
    const requestListener = (request: import("playwright").Request): void => {
      if (request.method() === "PUT" && request.url().includes(`/api/admin/organizations/${organizationId}`)) {
        putRequestCount += 1;
      }
    };
    page.on("request", requestListener);
    const changedEmail = `${marker}.confirmed@example.org`;
    await page.getByLabel("Email", { exact: true }).fill(changedEmail);
    await page.getByRole("button", { name: "Save organization", exact: true }).click();
    await page.getByRole("alertdialog", { name: "Confirm contact email change" }).waitFor();
    assert(observedPutRequestCount() === 0, "changing contact email does not send the save before confirmation");
    assert(
      (await page.getByLabel("Email", { exact: true }).inputValue()) === changedEmail,
      "email confirmation keeps the changed address in the form",
    );

    const emailSaveHandler = async (route: import("playwright").Route): Promise<void> => {
      if (route.request().method() === "PUT") {
        submittedBody = route.request().postData() ?? "";
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ message: "Organization updated." }),
        });
      } else {
        await route.continue();
      }
    };
    await page.route(editorRoute, emailSaveHandler);
    await page.getByRole("button", { name: "Confirm email change", exact: true }).click();
    await page.getByText("Organization updated.", { exact: true }).waitFor();
    assert(observedPutRequestCount() === 1, "confirming the contact email change sends exactly one save request");
    assert(submittedBody.includes(changedEmail), "the confirmed save request contains the changed contact email");
    page.off("request", requestListener);
    await page.unroute(editorRoute, emailSaveHandler);

    await page.getByRole("button", { name: "Edit organization", exact: true }).click();
    await page.locator("form.adm-org-edit").waitFor({ state: "visible" });
    assert(
      (await page.getByText("Organization updated.", { exact: true }).count()) === 0,
      "starting another edit clears the previous success message",
    );
    await desktop.close();

    const mobile = await browser.newContext({ viewport: { width: 375, height: 800 } });
    await mobile.addCookies([browserCookie(admin.cookie)]);
    const mobilePage = await mobile.newPage();
    await openEditor(mobilePage);
    const mobileLayout = await mobilePage.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
      form: document.querySelector("form.adm-org-edit")?.getBoundingClientRect() ?? null,
      saveButton: document.querySelector<HTMLButtonElement>('button[type="submit"]')?.getBoundingClientRect() ?? null,
    }));
    assert(
      mobileLayout.documentWidth <= mobileLayout.viewportWidth,
      `the organization editor has no horizontal overflow at mobile width (${JSON.stringify(mobileLayout)})`,
    );
    assert(
      mobileLayout.form !== null &&
        mobileLayout.form.left >= 0 &&
        mobileLayout.form.right <= mobileLayout.viewportWidth + 1 &&
        mobileLayout.saveButton !== null &&
        mobileLayout.saveButton.right <= mobileLayout.viewportWidth + 1,
      `the mobile editor and save control stay within the viewport (${JSON.stringify(mobileLayout)})`,
    );
    assert(
      await mobilePage.getByLabel("Organization name", { exact: true }).isVisible(),
      "the mobile organization editor keeps its fields usable",
    );
    await mobile.close();

    const approverContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await approverContext.addCookies([browserCookie(approver.cookie)]);
    const approverPage = await approverContext.newPage();
    await approverPage.goto(`${BASE}/admin/organizations`, { waitUntil: "networkidle" });
    await approverPage.locator("tr.adm-row").filter({ hasText: expectedName }).click();
    await approverPage.getByRole("heading", { name: expectedName, exact: true }).waitFor();
    assert(
      (await approverPage.getByRole("button", { name: "Edit organization", exact: true }).count()) === 0,
      "staff approvers never see the organization edit affordance",
    );
    await approverContext.close();
  } finally {
    await browser.close();
  }
}

async function main(): Promise<void> {
  const populations = await pool.query<{ id: string }>(
    `select id from populations where is_active order by sort_order, name limit 2`,
  );
  assert(populations.rows.length === 2, "two active population fixtures are available");
  const [firstPopulation, secondPopulation] = populations.rows;
  const admin = await login("staff_admin");
  const approver = await login("staff_approver");

  try {
    for (const status of ["pending", "approved", "disabled"] as const) {
      const contact = await createPerson(status);
      const orgId = await createOrganization(status, status, contact.id, firstPopulation!.id);
      const name = `${marker} updated ${status}`;
      const response = await update(
        admin.cookie,
        orgId,
        editBody({ name, email: contact.email, populationIds: [secondPopulation!.id] }),
      );
      assert(response.ok, `staff admin edits a ${status} organization`);
      const saved = await pool.query<{
        name: string;
        status: string;
        addressLine1: string | null;
        actorUserId: string;
        changedFields: Record<string, { before: unknown; after: unknown }>;
      }>(
        `select o.name, o.status, o.address_line1 as "addressLine1",
                r.actor_user_id as "actorUserId", r.changed_fields as "changedFields"
           from organizations o
           join lateral (
             select actor_user_id, changed_fields
               from organization_revisions
              where organization_id = o.id
              order by created_at desc limit 1
           ) r on true
          where o.id = $1`,
        [orgId],
      );
      assert(saved.rows[0]?.name === name, `${status} organization fields were saved`);
      assert(saved.rows[0]?.status === status, `${status} lifecycle status did not change`);
      assert(saved.rows[0]?.addressLine1 === "123 Test Street", `${status} structured address was saved`);
      assert(saved.rows[0]?.actorUserId === admin.userId, `${status} edit records the real admin actor`);
      assert(saved.rows[0]?.changedFields.name?.after === name, `${status} audit records before/after fields`);
    }

    const protectedOrgId = organizationIds[0]!;
    const protectedBefore = await pool.query<{ name: string; revisionCount: number }>(
      `select o.name,
              (select count(*)::int from organization_revisions r where r.organization_id = o.id) as "revisionCount"
         from organizations o where o.id = $1`,
      [protectedOrgId],
    );
    const protectedContact = await pool.query<{ email: string }>(
      `select p.email from organizations o join people p on p.id = o.primary_contact_person_id where o.id = $1`,
      [protectedOrgId],
    );
    const approverResponse = await update(
      approver.cookie,
      protectedOrgId,
      editBody({
        name: `${marker} forbidden`,
        email: protectedContact.rows[0]!.email,
        populationIds: [firstPopulation!.id],
      }),
    );
    assert(approverResponse.status === 404, "staff approver cannot discover the edit mutation");
    const protectedAfter = await pool.query<{ name: string; revisionCount: number }>(
      `select o.name,
              (select count(*)::int from organization_revisions r where r.organization_id = o.id) as "revisionCount"
         from organizations o where o.id = $1`,
      [protectedOrgId],
    );
    assert(protectedAfter.rows[0]?.name === protectedBefore.rows[0]?.name, "approver denial leaves the record unchanged");
    assert(
      protectedAfter.rows[0]?.revisionCount === protectedBefore.rows[0]?.revisionCount,
      "approver denial writes no audit row",
    );

    const platformOwner = await pool.query<{ id: string; name: string; email: string }>(
      `select o.id, o.name, p.email
         from organizations o
         left join people p on p.id = o.primary_contact_person_id
        where o.kind = 'platform_owner' limit 1`,
    );
    assert(platformOwner.rows[0], "platform-owner organization exists");
    const platformResponse = await update(
      admin.cookie,
      platformOwner.rows[0].id,
      editBody({
        name: platformOwner.rows[0].name,
        email: platformOwner.rows[0].email ?? `${marker}.platform@example.org`,
        populationIds: [firstPopulation!.id],
      }),
    );
    assert(platformResponse.status === 404, "platform-owner organization cannot be edited");

    const adminIdentity = await pool.query<{ personId: string; email: string }>(
      `select u.person_id as "personId", p.email
         from users u join people p on p.id = u.person_id
        where u.id = $1`,
      [admin.userId],
    );
    const identityOrgId = await createOrganization(
      "approved",
      "identity",
      adminIdentity.rows[0]!.personId,
      firstPopulation!.id,
    );
    const identityBefore = await pool.query<{ name: string }>(`select name from organizations where id = $1`, [identityOrgId]);
    const identityResponse = await update(
      admin.cookie,
      identityOrgId,
      editBody({
        name: `${marker} identity changed`,
        email: `${marker}.moved@example.org`,
        populationIds: [secondPopulation!.id],
      }),
    );
    assert(identityResponse.status === 409, "a linked login identity email change is blocked");
    const identityAfter = await pool.query<{ name: string }>(`select name from organizations where id = $1`, [identityOrgId]);
    assert(identityAfter.rows[0]?.name === identityBefore.rows[0]?.name, "identity collision rolls back the whole save");

    const invalidLogoResponse = await update(
      admin.cookie,
      protectedOrgId,
      editBody({
        name: `${marker} invalid logo`,
        email: protectedContact.rows[0]!.email,
        populationIds: [firstPopulation!.id],
        logo: new Blob(["not an image"], { type: "text/plain" }),
      }),
    );
    assert(invalidLogoResponse.status === 400, "non-image logo replacement is rejected");
    const afterInvalidLogo = await pool.query<{ name: string }>(`select name from organizations where id = $1`, [protectedOrgId]);
    assert(afterInvalidLogo.rows[0]?.name === protectedBefore.rows[0]?.name, "failed logo validation changes nothing");

    await checkBrowserEditor(admin, approver, organizationIds[0]!, `${marker} updated pending`);

    const approvedOrgId = organizationIds[1]!;
    const contextResponse = await fetch(`${BASE}/api/admin/organization-context`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: admin.cookie },
      body: JSON.stringify({ organizationId: approvedOrgId }),
    });
    assert(contextResponse.ok, "existing Login As organization workflow remains available");

    console.log("Direct admin organization edit regression checks passed.");
  } finally {
    await cleanup();
    await pool.end();
  }
}

main().catch(async (error: unknown) => {
  console.error(error);
  await cleanup().catch(() => undefined);
  await pool.end().catch(() => undefined);
  process.exit(1);
});