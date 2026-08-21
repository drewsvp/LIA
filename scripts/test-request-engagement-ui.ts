/**
 * Responsive and keyboard regression checks for request analytics.
 * Requires the development workflow and seeded quick-login accounts.
 */
import { execFileSync } from "node:child_process";
import { chromium, type BrowserContext } from "playwright";

const BASE = process.env.REPLIT_DEV_DOMAIN
  ? `https://${process.env.REPLIT_DEV_DOMAIN}`
  : "http://127.0.0.1:5000";
let passed = 0;

function assert(condition: unknown, label: string, detail?: unknown): asserts condition {
  if (!condition) throw new Error(`${label}${detail === undefined ? "" : `: ${JSON.stringify(detail)}`}`);
  passed += 1;
  console.log(`PASS ${label}`);
}

function chromiumExecutable(): string {
  return execFileSync("which", ["chromium"], { encoding: "utf8" }).trim();
}

function parseCookie(setCookie: string): Parameters<BrowserContext["addCookies"]>[0][number] {
  const [pair] = setCookie.split(";");
  const separator = pair!.indexOf("=");
  const cookie: Parameters<BrowserContext["addCookies"]>[0][number] = {
    name: pair!.slice(0, separator),
    value: pair!.slice(separator + 1),
    url: BASE,
    httpOnly: /;\s*httponly/i.test(setCookie),
    secure: /;\s*secure/i.test(setCookie),
  };
  if (/;\s*samesite=lax/i.test(setCookie)) cookie.sameSite = "Lax";
  else if (/;\s*samesite=strict/i.test(setCookie)) cookie.sameSite = "Strict";
  else if (/;\s*samesite=none/i.test(setCookie)) cookie.sameSite = "None";
  return cookie;
}

async function loginCookie(role: "staff_admin" | "org_owner") {
  const response = await fetch(`${BASE}/api/login/quick`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role }),
  });
  assert(response.ok, `${role} quick login succeeds`, response.status);
  const getSetCookie = (response.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
  const values = typeof getSetCookie === "function" ? getSetCookie.call(response.headers) : [];
  const sessionCookie = values.find((value) => value.includes("session_token"));
  assert(sessionCookie !== undefined, `${role} quick login returns a session cookie`);
  return parseCookie(sessionCookie);
}

async function assertContained(page: import("playwright").Page, selector: string, label: string): Promise<void> {
  const sizes = await page.locator(selector).evaluate((element) => ({
    client: element.clientWidth,
    scroll: element.scrollWidth,
    viewport: document.documentElement.clientWidth,
    body: document.body.scrollWidth,
  }));
  assert(sizes.body <= sizes.viewport + 1, `${label} does not overflow the viewport`, sizes);
  assert(sizes.scroll >= sizes.client, `${label} wide content stays inside its scroll container`, sizes);
}

async function main(): Promise<void> {
  const browser = await chromium.launch({ headless: true, executablePath: chromiumExecutable() });
  try {
    const adminCookie = await loginCookie("staff_admin");
    const adminContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await adminContext.addCookies([adminCookie]);
    const adminPage = await adminContext.newPage();
    const outreachFixture = {
      userId: "11111111-1111-4111-8111-111111111111",
      firstName: "Preview",
      lastName: "Supporter",
      email: "preview-supporter@example.test",
      requestKind: "item",
      requestId: "22222222-2222-4222-8222-222222222222",
      requestTitle: "School supply drive",
      orgName: "Fixture Organization",
      lastViewedAt: new Date().toISOString(),
    };
    await adminPage.route("**/api/admin/analytics/audience?*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ rows: [outreachFixture], page: 1, pageSize: 25, total: 1, totalPages: 1 }),
      });
    });
    await adminPage.route("**/api/admin/analytics/outreach/preview", async (route) => {
      const body = route.request().postDataJSON() as { action: "email" | "export"; subject?: string; message?: string };
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          action: body.action,
          request: {
            kind: outreachFixture.requestKind,
            id: outreachFixture.requestId,
            title: outreachFixture.requestTitle,
            orgName: outreachFixture.orgName,
          },
          recipients: [outreachFixture],
          requestedCount: 1,
          eligibleCount: 1,
          ineligibleCount: 0,
          preferenceExcludedCount: 0,
          confirmationToken: "signed-preview-fixture",
          ...(body.action === "email" ? { subject: body.subject, message: body.message } : {}),
        }),
      });
    });
    await adminPage.goto(`${BASE}/admin/analytics`, { waitUntil: "networkidle" });
    assert(await adminPage.getByRole("heading", { name: "Analytics", exact: true }).isVisible(), "mobile admin analytics loads");
    assert(await adminPage.getByRole("img", { name: /bar chart/i }).isVisible(), "daily chart has an accessible image label");
    const conversionsSort = adminPage.getByRole("button", { name: /Sort by Conversions/ });
    await conversionsSort.focus();
    const before = await conversionsSort.locator("xpath=..").getAttribute("aria-sort");
    await adminPage.keyboard.press("Enter");
    const after = await conversionsSort.locator("xpath=..").getAttribute("aria-sort");
    assert(before !== after, "performance table sorting works from the keyboard", { before, after });
    await assertContained(adminPage, '[aria-label="Engagement report"] .adm-table-wrap', "mobile performance table");
    assert(
      await adminPage.getByRole("heading", { name: /Signed-In Viewers/ }).isVisible(),
      "viewed-but-not-converted audience state is visible",
    );
    await adminPage.getByRole("checkbox", { name: /Select Preview Supporter/ }).check();
    await adminPage.getByLabel("Email subject").fill("A request you viewed");
    await adminPage.getByLabel("Email message").fill("Would you like more information about this request?");
    await adminPage.getByRole("button", { name: "Review email" }).click();
    await adminPage.getByRole("heading", { name: "Review email outreach" }).waitFor();
    assert(
      await adminPage.getByRole("heading", { name: "Review email outreach" }).isVisible() &&
        await adminPage.getByRole("button", { name: "Confirm send to 1" }).isVisible(),
      "email outreach has a distinct preview and confirmation step",
    );
    assert(
      await adminPage.getByLabel("Email subject").isDisabled() &&
        await adminPage.getByLabel("Email message").isDisabled(),
      "reviewed email copy cannot change before confirmation",
    );
    await assertContained(adminPage, ".anl-outreach-confirm", "mobile outreach confirmation");
    await adminPage.getByRole("button", { name: "Cancel" }).click();
    await adminPage.getByRole("button", { name: "Review export" }).click();
    await adminPage.getByRole("heading", { name: "Review export" }).waitFor();
    assert(
      await adminPage.getByRole("heading", { name: "Review export" }).isVisible() &&
        await adminPage.getByRole("button", { name: "Confirm download of 1" }).isVisible(),
      "export has a distinct preview and confirmation step",
    );
    await adminPage.getByRole("button", { name: "Cancel" }).click();

    const publicRequests = (await (await fetch(`${BASE}/api/public/item-requests`)).json()) as {
      requests: Array<{ id: string }>;
    };
    const publicVolunteerRequests = (await (await fetch(`${BASE}/api/public/volunteer-requests`)).json()) as {
      requests: Array<{ id: string }>;
    };
    assert(publicRequests.requests.length > 1, "two public item requests are available for interaction checks");
    assert(publicVolunteerRequests.requests.length > 0, "a public volunteer request is available for card interaction checks");
    const reported: Array<{ eventType?: string; requestKind?: string; requestId?: string }> = [];
    await adminPage.route("**/api/public/engagement", async (route) => {
      reported.push(route.request().postDataJSON() as { eventType?: string; requestKind?: string; requestId?: string });
      await route.fulfill({ status: 202, contentType: "application/json", body: '{"accepted":true}' });
    });
    await adminPage.goto(`${BASE}/items`, { waitUntil: "networkidle" });
    await adminPage.locator(".pb-grid .btn-teal").first().click();
    await adminPage.waitForURL(`**/items/${publicRequests.requests[0]!.id}`);
    assert(
      reported.some(
        (event) =>
          event.eventType === "card_click" &&
          event.requestKind === "item" &&
          event.requestId === publicRequests.requests[0]!.id,
      ),
      "item card navigation records a card click",
      reported,
    );
    await adminPage.goto(`${BASE}/volunteer`, { waitUntil: "networkidle" });
    await adminPage.locator(".pb-grid .btn-teal").first().click();
    await adminPage.waitForURL(`**/volunteer/${publicVolunteerRequests.requests[0]!.id}`);
    assert(
      reported.some(
        (event) =>
          event.eventType === "card_click" &&
          event.requestKind === "volunteer" &&
          event.requestId === publicVolunteerRequests.requests[0]!.id,
      ),
      "volunteer card navigation records a card click",
      reported,
    );
    // Let the destination page's independent detail-view lifecycle report
    // settle before starting the direct-navigation assertions below.
    await adminPage.waitForTimeout(100);
    reported.length = 0;
    const detailUrl = `${BASE}/items/${publicRequests.requests[0]!.id}`;
    await adminPage.goto(detailUrl, { waitUntil: "networkidle" });
    assert(
      reported.filter((event) => event.eventType === "detail_view").length === 1,
      "Strict Mode records one detail view per route visit",
      reported,
    );
    await adminPage.getByLabel("First name").focus();
    await adminPage.waitForTimeout(100);
    await adminPage.getByLabel("Last name").focus();
    assert(
      reported.filter((event) => event.eventType === "form_start").length === 1,
      "moving between form fields records one form start",
      reported,
    );

    const secondPath = `/items/${publicRequests.requests[1]!.id}`;
    const secondDetailResponse = adminPage.waitForResponse((response) =>
      new URL(response.url()).pathname.includes(publicRequests.requests[1]!.id),
    );
    await adminPage.evaluate((path) => {
      window.history.pushState(null, "", path);
      window.dispatchEvent(new PopStateEvent("popstate"));
    }, secondPath);
    await secondDetailResponse;
    await adminPage.getByLabel("First name").focus();
    await adminPage.waitForTimeout(100);
    assert(
      reported.filter((event) => event.eventType === "detail_view").length === 2 &&
        reported.filter((event) => event.eventType === "form_start").length === 2,
      "direct request-to-request navigation records a fresh view and form start",
      reported,
    );

    await adminPage.goto(`${BASE}/items`, { waitUntil: "domcontentloaded" });
    await adminPage.goto(detailUrl, { waitUntil: "networkidle" });
    await adminPage.getByLabel("Last name").focus();
    await adminPage.waitForTimeout(100);
    assert(
      reported.filter((event) => event.eventType === "detail_view").length === 3 &&
        reported.filter((event) => event.eventType === "form_start").length === 3,
      "a later SPA revisit records a fresh view and form start",
      reported,
    );
    await adminContext.close();

    const ownerCookie = await loginCookie("org_owner");
    const memberContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await memberContext.addCookies([ownerCookie]);
    const memberPage = await memberContext.newPage();
    await memberPage.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
    assert(
      !(await memberPage.getByRole("heading", { name: "REQUEST ENGAGEMENT", exact: true }).isVisible()),
      "mobile organization dashboard does not expose the engagement report to members",
    );
    assert(
      !(await memberPage.locator(".mp4-engagement-region").isVisible()),
      "engagement section is absent from the member dashboard",
    );
    await memberContext.close();
  } finally {
    await browser.close();
  }
  console.log(`\n${passed} passed, 0 failed`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});