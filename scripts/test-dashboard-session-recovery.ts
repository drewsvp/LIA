/**
 * Authenticated Preview-origin browser checks for dashboard access recovery.
 *
 * The development server must already be running. API guard responses are
 * intercepted after a real quick-login so the checks are deterministic and do
 * not mutate memberships, sessions, or form data.
 *
 * Usage: npm run test:dashboard-session-recovery
 */
import { execFileSync } from "node:child_process";
import { chromium, type BrowserContext, type Page } from "playwright";

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

function browserCookies(response: Response): Parameters<BrowserContext["addCookies"]>[0] {
  return cookies(response)
    .filter(Boolean)
    .map((value) => {
      const [pair] = value.split(";");
      const separator = pair!.indexOf("=");
      return {
        name: pair!.slice(0, separator),
        value: pair!.slice(separator + 1),
        url: BASE,
        httpOnly: /;\s*httponly/i.test(value),
        secure: /;\s*secure/i.test(value),
        sameSite: "Lax" as const,
      };
    });
}

async function login(): Promise<{ response: Response; session: Session }> {
  const response = await fetch(`${BASE}/api/login/quick`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role: "org_owner" }),
  });
  assert(response.ok, "organization owner quick login succeeds");
  const cookie = cookies(response)
    .filter(Boolean)
    .map((value) => value.split(";")[0])
    .join("; ");
  const sessionResponse = await fetch(`${BASE}/api/session`, { headers: { Cookie: cookie } });
  assert(sessionResponse.ok, "authenticated session snapshot loads");
  return { response, session: (await sessionResponse.json()) as Session };
}

async function newContext(
  browser: Awaited<ReturnType<typeof chromium.launch>>,
  loginResponse: Response,
): Promise<BrowserContext> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addCookies(browserCookies(loginResponse));
  return context;
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

async function main(): Promise<void> {
  const { response: loginResponse, session } = await login();
  assert(session.memberships.length > 0, "quick-login owner has an organization membership");

  const browser = await chromium.launch({ headless: true, executablePath: chromiumExecutable() });
  try {
    console.log("\nRead form recovery:");
    const readContext = await newContext(browser, loginResponse);
    let readRejected = false;
    await readContext.route("**/api/session", async (route) => {
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
    assert(
      (await readPage.locator(".mp5-load-error").count()) === 0,
      "read access failure returns to pending approval instead of showing a load error",
    );
    await readContext.close();

    console.log("\nSave form recovery:");
    const saveContext = await newContext(browser, loginResponse);
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
    const failureContext = await newContext(browser, loginResponse);
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