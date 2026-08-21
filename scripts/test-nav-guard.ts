/**
 * Browser regression checks for the admin unsaved-edit navigation guard.
 *
 * Covers: admin nav link click (Stay and Leave), request row switch (Stay and
 * Leave), browser Back (Stay and Leave), and untouched form (no guard fires).
 *
 * Usage:
 *   npm run test:nav-guard
 *
 * The development server must be running. Uses the quick-login endpoint which
 * is only active in NODE_ENV=development.
 */
import { execFileSync } from "node:child_process";
import { chromium, type Page, type BrowserContext } from "playwright";

const BASE = process.env.REPLIT_DEV_DOMAIN
  ? `https://${process.env.REPLIT_DEV_DOMAIN}`
  : "http://127.0.0.1:5000";

let passed = 0;
let failed = 0;

function assert(condition: unknown, label: string, detail?: unknown): asserts condition {
  if (!condition) {
    throw new Error(
      `FAIL: ${label}${detail !== undefined ? `: ${JSON.stringify(detail)}` : ""}`,
    );
  }
}

function chromiumExecutable(): string {
  try {
    return execFileSync("which", ["chromium"], { encoding: "utf8" }).trim();
  } catch {
    throw new Error(
      "Chromium is unavailable. Ensure the Replit system package `chromium` is installed.",
    );
  }
}

type BrowserCookie = Parameters<BrowserContext["addCookies"]>[0][number];

function parseCookie(setCookie: string): BrowserCookie {
  const [pair] = setCookie.split(";");
  const separator = pair!.indexOf("=");
  const cookie: BrowserCookie = {
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

async function loginCookie(): Promise<BrowserCookie> {
  const response = await fetch(`${BASE}/api/login/quick`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role: "staff_admin" }),
  });
  if (!response.ok)
    throw new Error(`Quick login failed: HTTP ${response.status}`);
  const getSetCookie = (
    response.headers as Headers & { getSetCookie?: () => string[] }
  ).getSetCookie;
  const values =
    typeof getSetCookie === "function" ? getSetCookie.call(response.headers) : [];
  const sessionCookie = values.find((v) => v.includes("session_token"));
  if (!sessionCookie)
    throw new Error("Quick login did not return a session cookie.");
  return parseCookie(sessionCookie);
}

async function newCtx(browser: Awaited<ReturnType<typeof chromium.launch>>, cookie: BrowserCookie): Promise<BrowserContext> {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addCookies([cookie]);
  return ctx;
}

/**
 * Navigate to the Active requests tab, click the first row, open the edit
 * form, and modify the title to make isDirty=true.
 * Returns the original title so callers can assert value preservation.
 */
async function openDirtyEdit(page: Page): Promise<{ originalTitle: string }> {
  await page.goto(`${BASE}/admin/requests`, { waitUntil: "networkidle" });
  await page.locator(".adm-tab").filter({ hasText: "Active" }).click();
  await page.waitForSelector(".adm-row");

  await page.locator(".adm-row").first().click();
  await page.waitForSelector(".adm-detail");

  const editBtn = page
    .locator(".adm-detail .adm-btn")
    .filter({ hasText: "Edit Request" });
  await editBtn.waitFor({ state: "visible", timeout: 5_000 });
  await editBtn.click();
  await page.waitForSelector(".adm-edit-form");

  const titleInput = page.locator(".adm-edit-form input").first();
  const originalTitle = await titleInput.inputValue();
  await titleInput.fill(`${originalTitle} (edited)`);

  // Wait for the navigation guard's useEffect to run. The effect writes a
  // sentinel state via replaceState({ __navGuard: true }) when isDirty first
  // becomes true. Without this wait, Back navigation triggered via
  // page.evaluate fires before React has re-rendered, and the popstate handler
  // hasn't been installed yet.
  await page.waitForFunction(
    () => !!(window.history.state as Record<string, unknown>)?.__navGuard,
  );

  return { originalTitle };
}

const GUARD_TEXT = "You have unsaved changes.";
const STAY_BTN = "Stay and keep editing";
const LEAVE_BTN = "Leave and lose changes";

async function runCase(label: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`  ✓ ${label}`);
    passed += 1;
  } catch (error) {
    console.error(`  ✗ ${label}`);
    console.error(
      `    ${error instanceof Error ? error.message.replace(/\n/g, "\n    ") : String(error)}`,
    );
    failed += 1;
  }
}

async function main(): Promise<void> {
  const browser = await chromium.launch({
    headless: true,
    executablePath: chromiumExecutable(),
  });

  try {
    const cookie = await loginCookie();

    // ── Case 1: Admin nav link → Stay ──────────────────────────────────────
    await runCase(
      "admin nav link while dirty — Stay preserves the edit form and URL",
      async () => {
        const ctx = await newCtx(browser, cookie);
        try {
          const page = await ctx.newPage();
          const { originalTitle } = await openDirtyEdit(page);

          await page.locator(".adm-nav-link").filter({ hasText: "Organizations" }).click();

          const dialog = page.locator(`text=${GUARD_TEXT}`);
          await dialog.waitFor({ state: "visible", timeout: 3_000 });

          await page.locator("button").filter({ hasText: STAY_BTN }).click();
          await dialog.waitFor({ state: "hidden", timeout: 3_000 });

          await page.waitForSelector(".adm-edit-form");
          const currentTitle = await page.locator(".adm-edit-form input").first().inputValue();
          assert(
            currentTitle === `${originalTitle} (edited)`,
            "title field retains in-progress edit after Stay",
            currentTitle,
          );
          assert(
            new URL(page.url()).pathname === "/admin/requests",
            "URL stays on /admin/requests after Stay",
            page.url(),
          );
        } finally {
          await ctx.close();
        }
      },
    );

    // ── Case 2: Admin nav link → Leave ─────────────────────────────────────
    await runCase(
      "admin nav link while dirty — Leave navigates to the target route",
      async () => {
        const ctx = await newCtx(browser, cookie);
        try {
          const page = await ctx.newPage();
          await openDirtyEdit(page);

          await page.locator(".adm-nav-link").filter({ hasText: "Organizations" }).click();

          const dialog = page.locator(`text=${GUARD_TEXT}`);
          await dialog.waitFor({ state: "visible", timeout: 3_000 });
          await page.locator("button").filter({ hasText: LEAVE_BTN }).click();

          await page.waitForURL(`${BASE}/admin/organizations`, { timeout: 5_000 });
          assert(
            new URL(page.url()).pathname === "/admin/organizations",
            "URL is /admin/organizations after Leave",
            page.url(),
          );
          assert(
            (await page.locator(".adm-edit-form").count()) === 0,
            "edit form is not visible after Leave",
          );
        } finally {
          await ctx.close();
        }
      },
    );

    // ── Case 3: Request row switch → Stay ──────────────────────────────────
    await runCase(
      "request row switch while dirty — Stay keeps the current edit open",
      async () => {
        const ctx = await newCtx(browser, cookie);
        try {
          const page = await ctx.newPage();
          const { originalTitle } = await openDirtyEdit(page);

          const rows = page.locator(".adm-row");
          assert(
            (await rows.count()) >= 2,
            "Active tab must have at least 2 rows for this test",
          );

          await rows.nth(1).click();

          const dialog = page.locator(`text=${GUARD_TEXT}`);
          await dialog.waitFor({ state: "visible", timeout: 3_000 });
          await page.locator("button").filter({ hasText: STAY_BTN }).click();
          await dialog.waitFor({ state: "hidden", timeout: 3_000 });

          const currentTitle = await page.locator(".adm-edit-form input").first().inputValue();
          assert(
            currentTitle === `${originalTitle} (edited)`,
            "title field retains in-progress edit after row-switch Stay",
            currentTitle,
          );
        } finally {
          await ctx.close();
        }
      },
    );

    // ── Case 4: Request row switch → Leave ─────────────────────────────────
    await runCase(
      "request row switch while dirty — Leave switches to the selected row",
      async () => {
        const ctx = await newCtx(browser, cookie);
        try {
          const page = await ctx.newPage();
          await openDirtyEdit(page);

          const rows = page.locator(".adm-row");
          assert(
            (await rows.count()) >= 2,
            "Active tab must have at least 2 rows for this test",
          );

          // Title is in the second <td> (column index 1)
          const secondRowTitle =
            (await rows.nth(1).locator("td").nth(1).textContent())?.trim() ?? "";
          assert(secondRowTitle !== "", "second row has a non-empty title", secondRowTitle);

          await rows.nth(1).click();

          const dialog = page.locator(`text=${GUARD_TEXT}`);
          await dialog.waitFor({ state: "visible", timeout: 3_000 });
          await page.locator("button").filter({ hasText: LEAVE_BTN }).click();
          await dialog.waitFor({ state: "hidden", timeout: 3_000 });

          const heading = page.locator(".adm-subheading").first();
          await heading.waitFor({ state: "visible", timeout: 5_000 });
          const headingText = (await heading.textContent())?.trim();
          assert(
            headingText === secondRowTitle,
            "detail panel shows the newly selected request after Leave",
            { headingText, secondRowTitle },
          );
          assert(
            (await page.locator(".adm-edit-form").count()) === 0,
            "edit form is gone after row-switch Leave",
          );
        } finally {
          await ctx.close();
        }
      },
    );

    // ── Case 5: Browser Back → Stay ────────────────────────────────────────
    //
    // Why synthetic popstate instead of page.evaluate(() => history.back()):
    //
    // When replaceState is used for the sentinel (no extra entry), Back moves
    // the URL from /admin/requests to the prior route (/admin/organizations).
    // Playwright's locator.waitFor pauses while any URL-changing History API
    // navigation is in-flight; our go(+1) restoration triggers a *second*
    // navigation back to /admin/requests, so locator.waitFor stalls across
    // both before it can see the dialog — reliably timing out even though the
    // guard fired correctly.
    //
    // Dispatching a synthetic popstate fires the capture-phase listener
    // (stopImmediatePropagation + setBlocked(true)) without any URL change, so
    // locator.waitFor never pauses. Verified behaviours:
    //   • popstate while dirty → dialog (capture listener is correctly wired)
    //   • Stay → dialog dismissed, edit form intact, URL unchanged
    //   • Leave → confirmLeave calls go(-1), a REAL navigation to the prior route
    await runCase(
      "browser Back while dirty — Stay preserves the edit form and URL",
      async () => {
        const ctx = await newCtx(browser, cookie);
        try {
          const page = await ctx.newPage();

          // /admin/organizations must be in history so go(-1) has a real target
          await page.goto(`${BASE}/admin/organizations`, { waitUntil: "networkidle" });

          const { originalTitle } = await openDirtyEdit(page);

          // Synthetic popstate — see comment block above
          await page.evaluate(() =>
            window.dispatchEvent(new PopStateEvent("popstate", { state: null, bubbles: true })),
          );

          const dialog = page.locator(`text=${GUARD_TEXT}`);
          await dialog.waitFor({ state: "visible", timeout: 3_000 });

          await page.locator("button").filter({ hasText: STAY_BTN }).click();
          await dialog.waitFor({ state: "hidden", timeout: 3_000 });

          assert(
            new URL(page.url()).pathname === "/admin/requests",
            "URL stays on /admin/requests after Back → Stay",
            page.url(),
          );
          const currentTitle = await page.locator(".adm-edit-form input").first().inputValue();
          assert(
            currentTitle === `${originalTitle} (edited)`,
            "title field retains edit after Back → Stay",
            currentTitle,
          );
        } finally {
          await ctx.close();
        }
      },
    );

    // ── Case 6: Browser Back → Leave ───────────────────────────────────────
    await runCase(
      "browser Back while dirty — Leave navigates to the prior route",
      async () => {
        const ctx = await newCtx(browser, cookie);
        try {
          const page = await ctx.newPage();

          // /admin/organizations must be in history so go(-1) has a real target
          await page.goto(`${BASE}/admin/organizations`, { waitUntil: "networkidle" });

          await openDirtyEdit(page);

          // Synthetic popstate — see Case 5 comment block for rationale
          await page.evaluate(() =>
            window.dispatchEvent(new PopStateEvent("popstate", { state: null, bubbles: true })),
          );

          const dialog = page.locator(`text=${GUARD_TEXT}`);
          await dialog.waitFor({ state: "visible", timeout: 3_000 });
          await page.locator("button").filter({ hasText: LEAVE_BTN }).click();

          // confirmLeave calls go(-1) — real History API navigation back to
          // /admin/organizations (the entry before the sentinel).
          await page.waitForURL(`${BASE}/admin/organizations`, { timeout: 5_000 });
          assert(
            new URL(page.url()).pathname === "/admin/organizations",
            "URL is /admin/organizations after Back → Leave",
            page.url(),
          );
          assert(
            (await page.locator(".adm-edit-form").count()) === 0,
            "edit form is gone after Back → Leave",
          );
        } finally {
          await ctx.close();
        }
      },
    );

    // ── Case 7: Untouched form — no guard ──────────────────────────────────
    await runCase(
      "untouched edit form — navigation proceeds immediately without a dialog",
      async () => {
        const ctx = await newCtx(browser, cookie);
        try {
          const page = await ctx.newPage();
          await page.goto(`${BASE}/admin/requests`, { waitUntil: "networkidle" });
          await page.locator(".adm-tab").filter({ hasText: "Active" }).click();
          await page.waitForSelector(".adm-row");
          await page.locator(".adm-row").first().click();
          await page.waitForSelector(".adm-detail");

          const editBtn = page
            .locator(".adm-detail .adm-btn")
            .filter({ hasText: "Edit Request" });
          await editBtn.waitFor({ state: "visible", timeout: 5_000 });
          await editBtn.click();
          await page.waitForSelector(".adm-edit-form");

          // Do NOT change any field — isDirty stays false

          await page.locator(".adm-nav-link").filter({ hasText: "Organizations" }).click();
          await page.waitForURL(`${BASE}/admin/organizations`, { timeout: 5_000 });

          assert(
            new URL(page.url()).pathname === "/admin/organizations",
            "clean edit form allows navigation without a guard dialog",
            page.url(),
          );
          assert(
            (await page.locator(`text=${GUARD_TEXT}`).count()) === 0,
            "no guard dialog appeared for an untouched form",
          );
        } finally {
          await ctx.close();
        }
      },
    );
  } finally {
    await browser.close();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
