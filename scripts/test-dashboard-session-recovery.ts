/**
 * Authenticated Preview-origin browser checks for dashboard access recovery.
 *
 * The development server must already be running. API guard responses are
 * intercepted after real Better Auth session minting so the checks are
 * deterministic and do not mutate memberships or form data.
 *
 * Usage: npm run test:dashboard-session-recovery
 */
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { auth } from "../server/auth/auth";
import { pool } from "../server/db/client";

const BASE =
  process.env.TEST_BASE_URL ??
  (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : "http://127.0.0.1:5000");

type Session = {
  authenticated: boolean;
  memberships: Array<{ orgId: string; orgName: string }>;
  activeOrgId: string | null;
  isStaff: boolean;
  organizationContext: unknown;
  [key: string]: unknown;
};
type AuthState = Awaited<ReturnType<BrowserContext["storageState"]>>;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`  ✓ ${message}`);
}

function chromiumExecutable(): string {
  return execFileSync("which", ["chromium"], { encoding: "utf8" }).trim();
}

function cookies(response: Response): string[] {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  return typeof headers.getSetCookie === "function"
    ? headers.getSetCookie()
    : (headers.get("set-cookie") ?? "").split(/,(?=\s*\w+=)/);
}

function parseCookie(value: string): Parameters<BrowserContext["addCookies"]>[0][number] {
  const parts = value.split(";").map((part) => part.trim());
  const nameValue = parts.shift();
  assert(nameValue, "Better Auth returned a non-empty Set-Cookie header");
  const separator = nameValue.indexOf("=");
  assert(separator > 0, `Better Auth returned a valid Set-Cookie header: ${nameValue}`);

  const cookie: Parameters<BrowserContext["addCookies"]>[0][number] = {
    name: nameValue.slice(0, separator),
    value: nameValue.slice(separator + 1),
    url: BASE,
  };
  for (const part of parts) {
    const [rawName, ...rawValue] = part.split("=");
    const attribute = rawName?.toLowerCase();
    const attributeValue = rawValue.join("=");
    if (attribute === "httponly") cookie.httpOnly = true;
    if (attribute === "secure") cookie.secure = true;
    if (attribute === "expires" && attributeValue) {
      const expires = Date.parse(attributeValue);
      if (Number.isFinite(expires)) cookie.expires = Math.floor(expires / 1_000);
    }
    if (attribute === "max-age" && attributeValue) {
      const maxAge = Number.parseInt(attributeValue, 10);
      if (Number.isFinite(maxAge)) cookie.expires = Math.floor(Date.now() / 1_000) + maxAge;
    }
    if (attribute === "samesite") {
      const sameSite = attributeValue.toLowerCase();
      if (sameSite === "strict") cookie.sameSite = "Strict";
      if (sameSite === "lax") cookie.sameSite = "Lax";
      if (sameSite === "none") cookie.sameSite = "None";
    }
  }
  return cookie;
}

async function mintSessionState(
  browser: Browser,
  email: string,
): Promise<{ state: AuthState; session: Session }> {
  // Use Better Auth directly instead of the shared quick-login endpoint. This
  // keeps concurrent browser checks out of the app-wide quick-login bucket while
  // still creating sessions through Better Auth's real cookie and hook path.
  const token = randomBytes(24).toString("base64url");
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
      query: { token, callbackURL: "/dashboard" },
      headers: new Headers(),
      asResponse: true,
    });
  } finally {
    await pool.query(`delete from verification where identifier = $1`, [token]);
  }

  assert(
    response.ok || response.status === 302,
    `Better Auth session minting for ${email} succeeds (got ${response.status}: ${await response.text()})`,
  );
  const location = response.headers.get("location");
  assert(location !== null, `Better Auth session minting for ${email} returns a redirect location`);
  assert(
    new URL(location, BASE).pathname === "/dashboard",
    `Better Auth session minting for ${email} redirects to /dashboard`,
  );

  const setCookies = cookies(response).filter(Boolean);
  assert(
    setCookies.some((value) => /^(?:__Secure-)?better-auth\.session_token=/.test(value)),
    `Better Auth session minting for ${email} returns a session cookie`,
  );

  const context = await browser.newContext();
  try {
    await context.addCookies(setCookies.map(parseCookie));
    const state = await context.storageState();
    const cookie = setCookies.map((value) => value.split(";")[0]).join("; ");
    const sessionResponse = await fetch(`${BASE}/api/session`, { headers: { Cookie: cookie } });
    assert(sessionResponse.ok, `authenticated session snapshot for ${email} loads`);
    return { state, session: (await sessionResponse.json()) as Session };
  } finally {
    await context.close();
  }
}

async function newContext(
  browser: Browser,
  authState: AuthState,
): Promise<BrowserContext> {
  return browser.newContext({
    viewport: { width: 1280, height: 900 },
    storageState: authState,
  });
}

async function fillItemRequest(page: Page, title: string): Promise<void> {
  await page.locator("#mp7-contact-first").fill("Preview");
  await page.getByLabel("Contact last name").fill("Tester");
  await page.locator("#mp7-contact-email").fill("preview@example.org");
  await page.locator("#mp7-contact-phone").fill("555-0100");
  await page.locator("#mp7-deadline-ongoing").check();
  await page.locator("#mp7-people").fill("1");
  await page.locator("#mp7-title").fill(title);
  await page.locator("#mp7-description").fill("A request used only for browser recovery verification.");
}

async function assertStableDashboardLogin(
  browser: Browser,
  role: "staff_admin" | "staff_approver",
  authState: AuthState,
  width: number,
): Promise<void> {
  const context = await browser.newContext({
    viewport: { width, height: 900 },
    storageState: authState,
  });
  const page = await context.newPage();
  let sessionRequests = 0;

  context.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/session") sessionRequests += 1;
  });
  try {
    const loginSessionRequests = sessionRequests;
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    await page.waitForURL(`${BASE}/dashboard`);
    await page.getByRole("heading", { name: "MY ORGANIZATION DASHBOARD" }).waitFor();
    const dashboardElement = await page.locator(".mp4-page").elementHandle();
    assert(dashboardElement !== null, `${role} dashboard root is mounted`);
    await page.waitForTimeout(1_000);

    assert(sessionRequests - loginSessionRequests === 1, `${role} dashboard boot makes exactly one session request`);
    assert(
      new URL(page.url()).pathname === "/dashboard",
      `${role} post-login redirect lands on /dashboard`,
    );
    assert(
      await dashboardElement.evaluate((node) => node.isConnected && node === document.querySelector(".mp4-page")),
      `${role} dashboard stays mounted after login`,
    );

    await page.getByRole("button", { name: "Edit My Organization" }).click();
    await page.waitForURL(`${BASE}/dashboard/organization`);
    await page.locator(".mp5-back").click();
    await page.waitForURL(`${BASE}/dashboard`);
    await page.getByRole("heading", { name: "MY ORGANIZATION DASHBOARD" }).waitFor();
    await page.waitForTimeout(500);
    assert(
      sessionRequests - loginSessionRequests === 1,
      `${role} dashboard route changes do not refetch the shared session`,
    );
  } finally {
    await context.close();
  }
}

async function main(): Promise<void> {
  const browser = await chromium.launch({ headless: true, executablePath: chromiumExecutable() });
  try {
    const staffAdmin = await mintSessionState(browser, "tiffany@defendingthecause.org");
    const staffApprover = await mintSessionState(browser, "approver@thealliance.example.org");
    const owner = await mintSessionState(browser, "dana@heartsandhands.example.org");
    const { session } = owner;
    assert(session.memberships.length > 0, "organization owner has an organization membership");

    console.log("\nStable post-login dashboard:");
    await assertStableDashboardLogin(browser, "staff_admin", staffAdmin.state, 1280);
    await assertStableDashboardLogin(browser, "staff_approver", staffApprover.state, 390);

    console.log("\nRead form recovery:");
    const readContext = await newContext(browser, owner.state);
    let readRejected = false;
    let readSessionRequests = 0;
    await readContext.route("**/api/session", async (route) => {
      readSessionRequests += 1;
      if (!readRejected) {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ...session,
          memberships: [],
          activeOrgId: null,
          isStaff: false,
          organizationContext: null,
        }),
      });
    });
    await readContext.route("**/api/dashboard/organization", async (route) => {
      readRejected = true;
      await route.fulfill({
        status: 403,
        contentType: "application/json",
        body: JSON.stringify({ message: "No active organization membership" }),
      });
    });
    const readPage = await readContext.newPage();
    await readPage.goto(`${BASE}/dashboard/organization`, { waitUntil: "networkidle" });
    await readPage.getByText("not yet an active member of an organization").waitFor();
    await readPage.waitForTimeout(500);
    assert(
      (await readPage.locator(".mp5-load-error").count()) === 0,
      "read access failure returns to pending approval instead of showing a load error",
    );
    assert(readSessionRequests === 2, "read access failure performs one bounded session recovery");
    await readContext.close();

    console.log("\nUnchanged background verification:");
    const unchangedContext = await newContext(browser, owner.state);
    let releaseRecovery!: () => void;
    const recoveryHeld = new Promise<void>((resolve) => {
      releaseRecovery = resolve;
    });
    let unchangedSessionRequests = 0;
    await unchangedContext.route("**/api/session", async (route) => {
      unchangedSessionRequests += 1;
      if (unchangedSessionRequests > 1) await recoveryHeld;
      await route.continue();
    });
    await unchangedContext.route("**/api/dashboard/overview", async (route) => {
      await route.fulfill({
        status: 403,
        contentType: "application/json",
        body: JSON.stringify({ message: "Verify the unchanged session" }),
      });
    });
    const unchangedPage = await unchangedContext.newPage();
    await unchangedPage.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" });
    await unchangedPage.getByRole("heading", { name: "MY ORGANIZATION DASHBOARD" }).waitFor();
    const unchangedDashboard = await unchangedPage.locator(".mp4-page").elementHandle();
    assert(unchangedDashboard !== null, "dashboard is mounted while background verification is held");
    releaseRecovery();
    await unchangedPage.waitForLoadState("networkidle");
    assert(
      await unchangedDashboard.evaluate(
        (node) => node.isConnected && node === document.querySelector(".mp4-page"),
      ),
      "an unchanged background session verification keeps the dashboard mounted",
    );
    assert(unchangedSessionRequests === 2, "unchanged access recovery performs one session refetch");
    await unchangedContext.close();

    console.log("\nStaggered access-failure recovery:");
    const staggeredContext = await newContext(browser, owner.state);
    let staggeredRejected = false;
    let staggeredSessionRequests = 0;
    await staggeredContext.route("**/api/session", async (route) => {
      staggeredSessionRequests += 1;
      if (!staggeredRejected) {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ...session,
          memberships: [],
          activeOrgId: null,
          isStaff: false,
          organizationContext: null,
        }),
      });
    });
    await staggeredContext.route("**/api/dashboard/supporters/donors", async (route) => {
      staggeredRejected = true;
      await route.fulfill({
        status: 403,
        contentType: "application/json",
        body: JSON.stringify({ message: "No active organization membership" }),
      });
    });
    await staggeredContext.route("**/api/dashboard/supporters/volunteers", async (route) => {
      staggeredRejected = true;
      await new Promise((resolve) => setTimeout(resolve, 300));
      await route.fulfill({
        status: 403,
        contentType: "application/json",
        body: JSON.stringify({ message: "No active organization membership" }),
      });
    });
    const staggeredPage = await staggeredContext.newPage();
    await staggeredPage.goto(`${BASE}/dashboard/supporters`, { waitUntil: "networkidle" });
    await staggeredPage.getByText("not yet an active member of an organization").waitFor();
    await staggeredPage.waitForTimeout(500);
    assert(
      staggeredSessionRequests === 2,
      "staggered dashboard failures from one session generation share one recovery",
    );
    await staggeredContext.close();

    console.log("\nSave form recovery:");
    const saveContext = await newContext(browser, owner.state);
    let selectionRequired = false;
    await saveContext.route("**/api/session", async (route) => {
      if (!selectionRequired) {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ...session, activeOrgId: null, organizationContext: null }),
      });
    });
    await saveContext.route("**/api/dashboard/items", async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      selectionRequired = true;
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({ message: "Select an organization to continue", code: "ORG_SELECTION_REQUIRED" }),
      });
    });
    const savePage = await saveContext.newPage();
    await savePage.goto(`${BASE}/dashboard/items/new`, { waitUntil: "networkidle" });
    await fillItemRequest(savePage, "Session recovery request");
    await savePage.getByRole("button", { name: "Continue to Add Items" }).click();
    await savePage.getByRole("button", { name: session.memberships[0]!.orgName }).waitFor();
    assert(
      (await savePage.getByText("Something went wrong and your request wasn't saved").count()) === 0,
      "organization-selection response opens the chooser instead of showing a save error",
    );
    await saveContext.close();

    console.log("\nGenuine save failure:");
    const failureContext = await newContext(browser, owner.state);
    await failureContext.route("**/api/dashboard/items", async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({ message: "A form-specific conflict" }),
      });
    });
    const failurePage = await failureContext.newPage();
    await failurePage.goto(`${BASE}/dashboard/items/new`, { waitUntil: "networkidle" });
    const retainedTitle = "Keep this entered title";
    await fillItemRequest(failurePage, retainedTitle);
    await failurePage.getByRole("button", { name: "Continue to Add Items" }).click();
    await failurePage.getByText("Something went wrong and your request wasn't saved").waitFor();
    assert(
      (await failurePage.locator("#mp7-title").inputValue()) === retainedTitle,
      "a genuine save conflict keeps the form and entered data",
    );
    await failureContext.close();
  } finally {
    await browser.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});