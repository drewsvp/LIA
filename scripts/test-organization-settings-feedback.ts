/**
 * Browser regression coverage for the MP-05 and MP-06 save confirmations.
 *
 * MP-05 is exercised with a mocked settings API so this check can safely
 * verify the rendered client states without modifying a seeded organization.
 * The session and route guards still come from the running application.
 *
 * Usage:
 *   NODE_ENV=development npx tsx scripts/test-organization-settings-feedback.ts
 */
import { execFileSync } from "node:child_process";
import { chromium, type BrowserContext, type Page } from "playwright";

const BASE = process.env.REPLIT_DEV_DOMAIN
  ? `https://${process.env.REPLIT_DEV_DOMAIN}`
  : "http://127.0.0.1:5000";

const SAVE_SUCCESS = "Your organization has been updated.";
const SAVE_FAILURE = "That didn't save. Please check the form and try again.";
const INVITE_SUCCESS = "Success! Your new user has been submitted for approval.";
const UPDATED_NAME = "Updated Fixture Organization";

const populationId = "00000000-0000-4000-8000-000000000001";

type Settings = {
  org: {
    name: string;
    websiteUrl: string;
    city: string;
    phone: string;
    mission: string;
    populationsOther: string | null;
    logoUrl: string | null;
  };
  populationIds: string[];
  populationOptions: { id: string; name: string; slug: string }[];
  contact: { firstName: string; lastName: string; email: string; phone: string } | null;
  members: never[];
};

function chromiumExecutable(): string {
  return execFileSync("which", ["chromium"], { encoding: "utf8" }).trim();
}

function cookieHeader(response: Response): string {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const values =
    typeof headers.getSetCookie === "function"
      ? headers.getSetCookie()
      : (headers.get("set-cookie") ?? "").split(/,(?=\s*\w+=)/);
  return values.map((value) => value.split(";")[0]).join("; ");
}

async function addSessionCookie(context: BrowserContext): Promise<void> {
  const response = await fetch(`${BASE}/api/login/quick`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role: "org_owner" }),
  });
  if (!response.ok) throw new Error(`quick login failed: ${response.status}`);

  const cookies = cookieHeader(response)
    .split("; ")
    .map((cookie) => {
      const separator = cookie.indexOf("=");
      return { name: cookie.slice(0, separator), value: cookie.slice(separator + 1) };
    })
    .filter((cookie) => cookie.name !== "");
  const url = new URL(BASE);
  await context.addCookies(
    cookies.map((cookie) => ({
      ...cookie,
      domain: url.hostname,
      path: "/",
      secure: url.protocol === "https:",
    })),
  );
}

function fixtureSettings(name = "Original Fixture Organization"): Settings {
  return {
    org: {
      name,
      websiteUrl: "https://original.example.org",
      city: "Roseville",
      phone: "555-0100",
      mission: "A fixture mission.",
      populationsOther: null,
      logoUrl: null,
    },
    populationIds: [populationId],
    populationOptions: [{ id: populationId, name: "Families in Crisis", slug: "families-in-crisis" }],
    contact: {
      firstName: "Fixture",
      lastName: "Contact",
      email: "fixture@example.org",
      phone: "555-0101",
    },
    members: [],
  };
}

async function waitForValue(page: Page, selector: string, expected: string): Promise<void> {
  await page.waitForFunction(
    ({ selector: currentSelector, expected: currentExpected }) =>
      (document.querySelector(currentSelector) as HTMLInputElement | null)?.value === currentExpected,
    { selector, expected },
  );
}

async function waitForRoleText(page: Page, role: string, expected: string): Promise<void> {
  await page.waitForFunction(
    ({ role: currentRole, expected: currentExpected }) =>
      [...document.querySelectorAll(`[role="${currentRole}"]`)].some(
        (element) => element.textContent?.trim() === currentExpected,
      ),
    { role, expected },
  );
}

async function main(): Promise<void> {
  const browser = await chromium.launch({ headless: true, executablePath: chromiumExecutable() });
  const context = await browser.newContext();
  try {
    await addSessionCookie(context);
    const page = await context.newPage();

    let settings = fixtureSettings();
    let updateCount = 0;
    await context.route("**/api/dashboard/organization", async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(settings),
        });
        return;
      }

      updateCount += 1;
      if (updateCount === 1) {
        settings = fixtureSettings(UPDATED_NAME);
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true }),
        });
        return;
      }

      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ message: SAVE_FAILURE }),
      });
    });

    await page.goto(`${BASE}/dashboard/organization`, { waitUntil: "domcontentloaded" });
    await waitForValue(page, "#mp5-name", "Original Fixture Organization");

    await page.locator("#mp5-name").fill(UPDATED_NAME);
    await page.getByRole("button", { name: "Submit", exact: true }).click();
    await waitForRoleText(page, "status", SAVE_SUCCESS);
    if ((await page.getByText(/submitted for approval/i).count()) !== 0) {
      throw new Error("MP-05 success state unexpectedly contains approval wording");
    }

    // A full reload must use the refreshed server values, not only the
    // component's pre-submit state.
    await page.reload({ waitUntil: "domcontentloaded" });
    await waitForValue(page, "#mp5-name", UPDATED_NAME);

    await page.locator("#mp5-name").fill("Failed Fixture Organization");
    await page.getByRole("button", { name: "Submit", exact: true }).click();
    await waitForRoleText(page, "alert", SAVE_FAILURE);
    await waitForValue(page, "#mp5-name", "Failed Fixture Organization");

    await context.route("**/api/dashboard/overview", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ org: { name: UPDATED_NAME } }),
      });
    });
    await context.route("**/api/dashboard/members", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      });
    });

    await page.goto(`${BASE}/dashboard/members/new`, { waitUntil: "domcontentloaded" });
    await page.locator("#mp6-first").fill("Invited");
    await page.locator("#mp6-last").fill("Fixture");
    await page.locator("#mp6-email").fill("invited.fixture@example.org");
    await page.locator("#mp6-phone").fill("555-0102");
    await page.getByRole("button", { name: "Submit for Approval", exact: true }).click();
    await waitForRoleText(page, "status", INVITE_SUCCESS);

    console.log("MP-05 and MP-06 feedback regression checks passed.");
  } finally {
    await browser.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});