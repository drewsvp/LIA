/**
 * Round-trip checks for the Settings admin page (ADMIN-13).
 *
 * Covers:
 *   1. staff_admin PUT /api/admin/site-settings with changed values; then
 *      GET /api/site-settings (public, cache-only) immediately returns the
 *      new values — cache invalidation works.
 *   2. POST /api/admin/site-settings/reset restores hardcoded defaults.
 *   3. The Settings nav link is visible for staff_admin and absent for
 *      staff_approver on the admin shell.
 *   4. PUT /api/admin/site-settings returns 400 when contactEmail is not a
 *      valid email address.
 *
 * Usage:
 *   npm run test:site-settings
 *
 * The development server must be running. Uses the quick-login endpoint which
 * is only active in NODE_ENV=development.
 */
import { execFileSync } from "node:child_process";
import { chromium, type BrowserContext } from "playwright";

const BASE = process.env.REPLIT_DEV_DOMAIN
  ? `https://${process.env.REPLIT_DEV_DOMAIN}`
  : "http://127.0.0.1:5000";

/** Hardcoded defaults from server/dal/site-settings.ts — must match exactly. */
const DEFAULTS = {
  siteName: "Love in Action Database",
  contactEmail: "info@defendingthecause.org",
  responseTimeLanguage: "1-3 business days",
};

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

type QuickLoginRole = "staff_admin" | "staff_approver";

async function quickLoginCookie(role: QuickLoginRole): Promise<BrowserCookie> {
  const MAX_ATTEMPTS = 4;
  let lastStatus = 0;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const response = await fetch(`${BASE}/api/login/quick`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    });
    if (response.ok) {
      const getSetCookie = (
        response.headers as Headers & { getSetCookie?: () => string[] }
      ).getSetCookie;
      const values =
        typeof getSetCookie === "function" ? getSetCookie.call(response.headers) : [];
      const sessionCookie = values.find((v) => v.includes("session_token"));
      if (!sessionCookie)
        throw new Error(`Quick login as ${role} did not return a session cookie.`);
      return parseCookie(sessionCookie);
    }
    lastStatus = response.status;
    if (response.status === 429 && attempt < MAX_ATTEMPTS) {
      const waitMs = 2_000 * 2 ** (attempt - 1);
      console.log(`  (rate-limited on quick-login; retrying in ${waitMs / 1000}s…)`);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      continue;
    }
    break;
  }
  throw new Error(`Quick login as ${role} failed: HTTP ${lastStatus}`);
}

/** Build a fetch-compatible cookie header string from a BrowserCookie. */
function cookieHeader(cookie: BrowserCookie): string {
  return `${cookie.name}=${cookie.value}`;
}

async function newCtx(
  browser: Awaited<ReturnType<typeof chromium.launch>>,
  cookie: BrowserCookie,
): Promise<BrowserContext> {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addCookies([cookie]);
  return ctx;
}

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

  const adminCookie = await quickLoginCookie("staff_admin");
  const approverCookie = await quickLoginCookie("staff_approver");

  try {
    // ── Case 1: PUT saves values; public GET /api/site-settings reflects them ──
    //
    // The public endpoint reads from an in-process cache that the PUT handler
    // updates immediately. This confirms the round-trip: DB write → cache
    // invalidation → public endpoint returns new values.
    await runCase(
      "PUT /api/admin/site-settings saves values and GET /api/site-settings reflects them",
      async () => {
        const testValues = {
          siteName: "Test Platform Name",
          contactEmail: "test@example.com",
          responseTimeLanguage: "2-4 weeks",
        };

        // Save via the admin endpoint.
        const putRes = await fetch(`${BASE}/api/admin/site-settings`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Cookie: cookieHeader(adminCookie),
          },
          body: JSON.stringify(testValues),
        });
        assert(putRes.ok, "PUT /api/admin/site-settings returned non-2xx", putRes.status);
        const putBody = await putRes.json() as { ok: boolean; settings: unknown };
        assert(putBody.ok === true, "PUT response body must have ok: true", putBody);

        // Public endpoint must immediately reflect the new values.
        const getRes = await fetch(`${BASE}/api/site-settings`);
        assert(getRes.ok, "GET /api/site-settings returned non-2xx after save", getRes.status);
        const getBody = await getRes.json() as Record<string, unknown>;
        assert(
          getBody.siteName === testValues.siteName,
          "siteName must reflect saved value",
          { got: getBody.siteName, want: testValues.siteName },
        );
        assert(
          getBody.contactEmail === testValues.contactEmail,
          "contactEmail must reflect saved value",
          { got: getBody.contactEmail, want: testValues.contactEmail },
        );
        assert(
          getBody.responseTimeLanguage === testValues.responseTimeLanguage,
          "responseTimeLanguage must reflect saved value",
          { got: getBody.responseTimeLanguage, want: testValues.responseTimeLanguage },
        );
      },
    );

    // ── Case 1b: Browser confirms "Last saved by …" after a PUT ──────────────
    //
    // After Case 1 persisted custom values, loading /admin/settings in a real
    // browser must show a "Last saved by <name> on <date>" paragraph instead
    // of the "Using built-in defaults" fallback.  The admin GET endpoint joins
    // users → people to resolve the display name; this confirms that join
    // works and that the UI renders it correctly.
    await runCase(
      "Browser: /admin/settings shows 'Last saved by <name> on <date>' after a PUT",
      async () => {
        const ctx = await newCtx(browser, adminCookie);
        try {
          const page = await ctx.newPage();
          await page.goto(`${BASE}/admin/settings`, { waitUntil: "networkidle" });

          // Confirm the page loaded before checking the metadata paragraph.
          const heading = page.locator("h1.adm-heading", { hasText: "Settings" });
          await heading.waitFor({ state: "visible", timeout: 8_000 });

          // The "Last saved" paragraph is a p.adm-muted element that contains
          // the updatedByName and a formatted date returned by the admin API.
          const lastSavedPara = page.locator("p.adm-muted", { hasText: "Last saved by" });
          await lastSavedPara.waitFor({ state: "visible", timeout: 8_000 });
          const text = (await lastSavedPara.textContent()) ?? "";

          // Must start with the expected prefix.
          assert(
            text.includes("Last saved by"),
            "paragraph must contain 'Last saved by'",
            text,
          );

          // The name between "Last saved by " and " on " must be non-empty.
          const nameMatch = text.match(/Last saved by (.+?) on /);
          assert(
            nameMatch !== null && nameMatch[1]!.trim().length > 0,
            "name between 'Last saved by' and 'on' must be non-empty",
            text,
          );

          // Must contain a formatted date such as "Aug 23, 2026".
          assert(
            / on [A-Z][a-z]+ \d{1,2}, \d{4}/.test(text),
            "paragraph must contain 'on <Mon D, YYYY>' formatted date",
            text,
          );
        } finally {
          await ctx.close();
        }
      },
    );

    // ── Case 2: POST /api/admin/site-settings/reset restores defaults ─────────
    //
    // After the previous cases set custom values, a reset must overwrite them
    // with the hardcoded defaults and the public endpoint must reflect them.
    await runCase(
      "POST /api/admin/site-settings/reset restores defaults and GET reflects them",
      async () => {
        const resetRes = await fetch(`${BASE}/api/admin/site-settings/reset`, {
          method: "POST",
          headers: { Cookie: cookieHeader(adminCookie) },
        });
        assert(
          resetRes.ok,
          "POST /api/admin/site-settings/reset returned non-2xx",
          resetRes.status,
        );
        const resetBody = await resetRes.json() as { ok: boolean; settings: unknown };
        assert(resetBody.ok === true, "reset response body must have ok: true", resetBody);

        // Public endpoint must immediately reflect the restored defaults.
        const getRes = await fetch(`${BASE}/api/site-settings`);
        assert(getRes.ok, "GET /api/site-settings returned non-2xx after reset", getRes.status);
        const getBody = await getRes.json() as Record<string, unknown>;
        assert(
          getBody.siteName === DEFAULTS.siteName,
          "siteName must be restored to default",
          { got: getBody.siteName, want: DEFAULTS.siteName },
        );
        assert(
          getBody.contactEmail === DEFAULTS.contactEmail,
          "contactEmail must be restored to default",
          { got: getBody.contactEmail, want: DEFAULTS.contactEmail },
        );
        assert(
          getBody.responseTimeLanguage === DEFAULTS.responseTimeLanguage,
          "responseTimeLanguage must be restored to default",
          { got: getBody.responseTimeLanguage, want: DEFAULTS.responseTimeLanguage },
        );
      },
    );

    // ── Case 3a: Settings nav link is visible for staff_admin ─────────────────
    await runCase(
      "Settings nav link is visible for staff_admin in the admin shell",
      async () => {
        const ctx = await newCtx(browser, adminCookie);
        try {
          const page = await ctx.newPage();
          await page.goto(`${BASE}/admin/settings`, { waitUntil: "networkidle" });

          // Page heading confirms the page loaded.
          const heading = page.locator("h1.adm-heading", { hasText: "Settings" });
          await heading.waitFor({ state: "visible", timeout: 8_000 });
          assert(await heading.isVisible(), "staff_admin sees the Settings heading");

          // The Settings nav link must be present in the admin nav.
          const navLink = page.locator(".adm-nav-link", { hasText: "Settings" });
          assert(
            await navLink.isVisible(),
            "staff_admin sees the Settings nav link in the admin nav",
          );
        } finally {
          await ctx.close();
        }
      },
    );

    // ── Case 3b: Settings nav link is absent for staff_approver ───────────────
    //
    // staff_approver is a lower-privilege role — ADMIN-13 is in
    // STAFF_ADMIN_ONLY_SURFACES, so the nav link is filtered out and the page
    // itself shows the not-found heading.
    await runCase(
      "Settings nav link is absent for staff_approver and /admin/settings shows not-found",
      async () => {
        const ctx = await newCtx(browser, approverCookie);
        try {
          const page = await ctx.newPage();
          await page.goto(`${BASE}/admin/settings`, { waitUntil: "networkidle" });

          // SPA router shows the not-found heading for staff-admin-only pages.
          const notFound = page.locator("h1", { hasText: "Page not found" });
          await notFound.waitFor({ state: "visible", timeout: 8_000 });
          assert(
            await notFound.isVisible(),
            "staff_approver sees not-found heading at /admin/settings",
          );

          // The Settings link must not appear in the nav for approvers.
          const navLink = page.locator(".adm-nav-link", { hasText: "Settings" });
          assert(
            !(await navLink.isVisible()),
            "staff_approver must not see the Settings nav link",
          );
        } finally {
          await ctx.close();
        }
      },
    );

    // ── Case 4: invalid email returns 400 ─────────────────────────────────────
    //
    // The server-side validator must reject contactEmail values that do not
    // match the EMAILISH_RE pattern and return HTTP 400 with an error list.
    await runCase(
      "PUT /api/admin/site-settings returns 400 when contactEmail is not a valid email",
      async () => {
        const res = await fetch(`${BASE}/api/admin/site-settings`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Cookie: cookieHeader(adminCookie),
          },
          body: JSON.stringify({
            siteName: "Valid Name",
            contactEmail: "not-an-email",
            responseTimeLanguage: "1-3 business days",
          }),
        });
        assert(
          res.status === 400,
          "server must return 400 for an invalid contactEmail",
          res.status,
        );
        const body = await res.json() as { message?: string; errors?: string[] };
        assert(
          Array.isArray(body.errors) && body.errors.length > 0,
          "response must include a non-empty errors array",
          body,
        );
        // Confirm the error mentions the email field.
        const emailError = body.errors!.some((e) =>
          e.toLowerCase().includes("email"),
        );
        assert(
          emailError,
          "errors must mention the email field",
          body.errors,
        );
      },
    );

    // ── Case 5: member /signup renders updated siteName after admin save ────────
    //
    // Confirms the full browser chain: admin PUT → server cache → client fetch
    // → page render. The /signup intro paragraph renders siteSettings.siteName
    // (e.g. "Welcome to The Alliance's Love in Action Database!"). A fresh
    // navigation (empty query cache) forces a guaranteed refetch so we can
    // assert the new value is actually rendered, not just returned by the API.
    //
    // The test also confirms that a subsequent reset brings the default site
    // name back — the cleanup path exercises the same refetch/render chain.
    await runCase(
      "member /signup renders updated siteName after admin save and navigation",
      async () => {
        const ctx = await newCtx(browser, adminCookie);
        try {
          const page = await ctx.newPage();
          const NEW_NAME = "Test Platform Name";

          // Step 1: baseline — /signup intro must currently show the default
          // site name in the "Welcome to The Alliance's …!" paragraph.
          await page.goto(`${BASE}/signup`, { waitUntil: "networkidle" });
          const introPara = page.locator("p.mp3-intro", { hasText: "Welcome to" });
          await introPara.waitFor({ state: "visible", timeout: 8_000 });
          const initialText = await introPara.textContent();
          assert(
            initialText !== null && initialText.includes(DEFAULTS.siteName),
            "/signup must initially show the default siteName",
            { got: initialText, want: DEFAULTS.siteName },
          );

          // Step 2: admin saves a new site name via the API.
          const putRes = await fetch(`${BASE}/api/admin/site-settings`, {
            method: "PUT",
            headers: {
              "Content-Type": "application/json",
              Cookie: cookieHeader(adminCookie),
            },
            body: JSON.stringify({
              siteName: NEW_NAME,
              contactEmail: DEFAULTS.contactEmail,
              responseTimeLanguage: DEFAULTS.responseTimeLanguage,
            }),
          });
          assert(
            putRes.ok,
            "PUT /api/admin/site-settings must succeed before the browser check",
            putRes.status,
          );

          // Step 3: navigate to /signup again. The React app starts with an
          // empty query cache (fresh page load) and fetches /api/site-settings,
          // which now returns the new siteName — the intro paragraph must show it.
          await page.goto(`${BASE}/signup`, { waitUntil: "networkidle" });
          const updatedPara = page.locator("p.mp3-intro", { hasText: "Welcome to" });
          await updatedPara.waitFor({ state: "visible", timeout: 8_000 });
          const updatedText = await updatedPara.textContent();
          assert(
            updatedText !== null && updatedText.includes(NEW_NAME),
            "/signup must render the new siteName after admin save and navigation",
            { got: updatedText, want: NEW_NAME },
          );

          // Step 4: reset to defaults and confirm /signup reverts to the
          // default site name.
          const resetRes = await fetch(`${BASE}/api/admin/site-settings/reset`, {
            method: "POST",
            headers: { Cookie: cookieHeader(adminCookie) },
          });
          assert(
            resetRes.ok,
            "POST /api/admin/site-settings/reset must succeed during cleanup",
            resetRes.status,
          );

          await page.goto(`${BASE}/signup`, { waitUntil: "networkidle" });
          const restoredPara = page.locator("p.mp3-intro", { hasText: "Welcome to" });
          await restoredPara.waitFor({ state: "visible", timeout: 8_000 });
          const restoredText = await restoredPara.textContent();
          assert(
            restoredText !== null && restoredText.includes(DEFAULTS.siteName),
            "/signup must show the default siteName after reset and navigation",
            { got: restoredText, want: DEFAULTS.siteName },
          );
        } finally {
          await ctx.close();
        }
      },
    );
    // ── Case 6: /signup duplicate-org error reflects updated contactEmail ────
    //
    // The 409 response body is built server-side using
    // getCachedSiteSettings().contactEmail (public.ts), so a cache update
    // must appear in the next rendered error without any client-side refresh
    // beyond a normal page navigation. This confirms the full chain:
    // admin PUT → server cache → 409 message → browser render.
    //
    // The test also confirms the client-side DUPLICATE_COPY fallback path
    // works when the server 409 includes a pre-rendered message — because the
    // client uses `body?.message ?? DUPLICATE_COPY`, the server-built string
    // wins and must contain the live contactEmail.
    await runCase(
      "/signup duplicate-org error shows updated contactEmail after admin change",
      async () => {
        const NEW_EMAIL = "zz.test.contact@example.com";
        // "Hearts & Hands Family Services" is inserted by the seed script and
        // will always trigger a 409 on re-submission.
        const DUPLICATE_ORG = "Hearts & Hands Family Services";

        // Minimal 1×1 transparent PNG (67 bytes) — satisfies the logo
        // file-type guard without depending on the filesystem.
        const TINY_PNG = Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIA" +
            "BQAABjE+ibYAAAAASUVORK5CYII=",
          "base64",
        );

        type Page = Awaited<ReturnType<BrowserContext["newPage"]>>;

        // Fill every required field and click Submit. A fresh goto ensures the
        // React query cache starts empty so /api/site-settings is always
        // re-fetched. The function is called twice (before and after the email
        // change) so the duplicate-org 409 fires both times.
        async function fillAndSubmit(page: Page): Promise<void> {
          await page.goto(`${BASE}/signup`, { waitUntil: "networkidle" });

          // Wait for population checkboxes rendered by the async query.
          await page.waitForSelector(".mp3-check input[type='checkbox']", {
            timeout: 8_000,
          });

          await page.fill("#mp3-name", DUPLICATE_ORG);
          await page.fill("#mp3-website", "https://example.org");
          await page.fill("#mp3-city", "Sacramento");
          await page.fill("#mp3-phone", "916-555-0100");
          await page.fill("#mp3-mission", "Serving families in our community.");

          // Check the first available population.
          await page.locator(".mp3-check input[type='checkbox']").first().check();

          // Provide a logo programmatically (bypasses the file-picker dialog).
          await page.setInputFiles("#mp3-logo", {
            name: "logo.png",
            mimeType: "image/png",
            buffer: TINY_PNG,
          });

          await page.fill("#mp3-first", "Test");
          await page.fill("#mp3-last", "User");
          await page.fill("#mp3-email", "zz.tester@example.com");
          await page.fill("#mp3-contact-phone", "916-555-0101");

          await page.click(".mp3-submit");
        }

        const ctx = await newCtx(browser, adminCookie);
        try {
          const page = await ctx.newPage();
          const errorLocator = page.locator(".mp3-server-error[role='alert']");

          // ── Step 1: baseline — error must contain the default contactEmail ─
          await fillAndSubmit(page);
          await errorLocator.waitFor({ state: "visible", timeout: 10_000 });
          const firstError = (await errorLocator.textContent()) ?? "";
          assert(
            firstError.includes(DEFAULTS.contactEmail),
            "duplicate-org error must contain the default contactEmail",
            { got: firstError, want: DEFAULTS.contactEmail },
          );

          // ── Step 2: admin changes the contactEmail ──────────────────────────
          const putRes = await fetch(`${BASE}/api/admin/site-settings`, {
            method: "PUT",
            headers: {
              "Content-Type": "application/json",
              Cookie: cookieHeader(adminCookie),
            },
            body: JSON.stringify({
              siteName: DEFAULTS.siteName,
              contactEmail: NEW_EMAIL,
              responseTimeLanguage: DEFAULTS.responseTimeLanguage,
            }),
          });
          assert(
            putRes.ok,
            "PUT /api/admin/site-settings must succeed before resubmission check",
            putRes.status,
          );

          // ── Step 3: fresh navigation + resubmit → new email must appear ────
          await fillAndSubmit(page);
          await errorLocator.waitFor({ state: "visible", timeout: 10_000 });
          const secondError = (await errorLocator.textContent()) ?? "";
          assert(
            secondError.includes(NEW_EMAIL),
            "duplicate-org error must contain the new contactEmail after admin change",
            { got: secondError, want: NEW_EMAIL },
          );
          assert(
            !secondError.includes(DEFAULTS.contactEmail),
            "duplicate-org error must NOT still contain the old contactEmail",
            { got: secondError, old: DEFAULTS.contactEmail },
          );
        } finally {
          // Always restore defaults so subsequent runs and manual tests start
          // from a clean state.
          await fetch(`${BASE}/api/admin/site-settings/reset`, {
            method: "POST",
            headers: { Cookie: cookieHeader(adminCookie) },
          });
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
