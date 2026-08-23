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

    // ── Case 2: POST /api/admin/site-settings/reset restores defaults ─────────
    //
    // After the previous case set custom values, a reset must overwrite them
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
