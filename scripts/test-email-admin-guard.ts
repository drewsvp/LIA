/**
 * Access-control regression checks for the Automated Emails admin page
 * (ADMIN-10, /admin/emails).
 *
 * Covers:
 *   1. staff_approver navigating to /admin/emails sees "Page not found", not
 *      the email templates table.
 *   2. org_owner navigating to /admin/emails sees "Page not found", not the
 *      email templates table.
 *   3. staff_approver calling the /api/admin/email-templates API directly
 *      receives a 404 (not the template list).
 *   4. org_owner calling /api/admin/email-templates directly receives a
 *      non-200 response (session treated as unauthenticated staff-admin).
 *   5. staff_approver calling PUT /api/admin/email-templates/:key (save copy)
 *      receives a 404 — write endpoint is also guard-blocked.
 *   6. org_owner calling PUT /api/admin/email-templates/:key receives a 404.
 *   7. staff_approver calling POST /api/admin/email-templates/:key/enabled
 *      (toggle on/off) receives a 404.
 *   8. org_owner calling POST /api/admin/email-templates/:key/enabled receives
 *      a 404.
 *
 * Usage:
 *   npm run test:email-admin-guard
 *
 * The development server must be running. Uses the quick-login endpoint which
 * is only active in NODE_ENV=development.
 */
import { execFileSync } from "node:child_process";
import { chromium, type BrowserContext } from "playwright";

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

type QuickLoginRole = "staff_approver" | "org_owner" | "staff_admin";

async function quickLoginCookie(role: QuickLoginRole): Promise<BrowserCookie> {
  // Retry up to 4 times with exponential backoff when the quick-login rate
  // limiter returns 429 (can happen when the test suite is run repeatedly in
  // a short window during CI or code review).
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
      const waitMs = 2_000 * 2 ** (attempt - 1); // 2 s, 4 s, 8 s
      console.log(`  (rate-limited on quick-login; retrying in ${waitMs / 1000}s…)`);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      continue;
    }
    break;
  }
  throw new Error(`Quick login as ${role} failed: HTTP ${lastStatus}`);
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

  // Acquire one session cookie per role upfront so every case reuses the same
  // authenticated session. This avoids hitting the quick-login rate limiter
  // when running all eight cases in sequence. Logins are sequential so they
  // don't burst the per-IP limiter simultaneously.
  const approverCookie = await quickLoginCookie("staff_approver");
  const ownerCookie = await quickLoginCookie("org_owner");

  try {
    // ── Case 1: staff_approver is denied the page in the browser ──────────
    await runCase(
      "staff_approver navigating to /admin/emails sees not-found, not the template table",
      async () => {
        const ctx = await newCtx(browser, approverCookie);
        try {
          const page = await ctx.newPage();
          await page.goto(`${BASE}/admin/emails`, { waitUntil: "networkidle" });

          // The page must show the not-found heading
          const heading = page.locator("h1", { hasText: "Page not found" });
          await heading.waitFor({ state: "visible", timeout: 5_000 });
          assert(
            await heading.isVisible(),
            "staff_approver sees the not-found heading at /admin/emails",
          );

          // No email template rows must be present
          const clickableRows = await page.locator(".adm-row-clickable").count();
          assert(
            clickableRows === 0,
            "staff_approver does not see any clickable email template rows",
            clickableRows,
          );
        } finally {
          await ctx.close();
        }
      },
    );

    // ── Case 2: org_owner is denied the page in the browser ───────────────
    await runCase(
      "org_owner navigating to /admin/emails sees not-found, not the template table",
      async () => {
        const ctx = await newCtx(browser, ownerCookie);
        try {
          const page = await ctx.newPage();
          await page.goto(`${BASE}/admin/emails`, { waitUntil: "networkidle" });

          // The page must show the not-found heading
          const heading = page.locator("h1", { hasText: "Page not found" });
          await heading.waitFor({ state: "visible", timeout: 5_000 });
          assert(
            await heading.isVisible(),
            "org_owner sees the not-found heading at /admin/emails",
          );

          // No email template rows must be present
          const clickableRows = await page.locator(".adm-row-clickable").count();
          assert(
            clickableRows === 0,
            "org_owner does not see any clickable email template rows",
            clickableRows,
          );
        } finally {
          await ctx.close();
        }
      },
    );

    // ── Case 3: staff_approver API call returns 404 ────────────────────────
    //
    // Tests the server-side requireStaffAdmin guard directly. The browser SPA
    // gate is client-only; this confirms the API itself refuses non-admin staff.
    await runCase(
      "staff_approver calling /api/admin/email-templates receives a 404",
      async () => {
        const ctx = await newCtx(browser, approverCookie);
        try {
          // Use a browser page so the session cookie is sent with the request
          const page = await ctx.newPage();
          const response = await page.request.get(`${BASE}/api/admin/email-templates`);
          assert(
            response.status() === 404,
            "staff_approver API call returns 404",
            response.status(),
          );
        } finally {
          await ctx.close();
        }
      },
    );

    // ── Case 4: org_owner API call is also denied ──────────────────────────
    await runCase(
      "org_owner calling /api/admin/email-templates is not granted access (non-200)",
      async () => {
        const ctx = await newCtx(browser, ownerCookie);
        try {
          const page = await ctx.newPage();
          const response = await page.request.get(`${BASE}/api/admin/email-templates`);
          assert(
            response.status() !== 200,
            "org_owner API call does not return 200 (template list)",
            response.status(),
          );
        } finally {
          await ctx.close();
        }
      },
    );

    // ── Case 5: staff_approver PUT (save copy) returns 404 ────────────────
    //
    // requireStaffAdmin fires before any key/body validation, so the guard
    // must return 404 for a valid template key regardless of the payload.
    await runCase(
      "staff_approver calling PUT /api/admin/email-templates/:key receives a 404",
      async () => {
        const ctx = await newCtx(browser, approverCookie);
        try {
          const page = await ctx.newPage();
          const response = await page.request.put(
            `${BASE}/api/admin/email-templates/staff_new_org`,
            {
              headers: { "Content-Type": "application/json" },
              data: { copy: null },
            },
          );
          assert(
            response.status() === 404,
            "staff_approver PUT email template returns 404",
            response.status(),
          );
        } finally {
          await ctx.close();
        }
      },
    );

    // ── Case 6: org_owner PUT (save copy) returns 404 ─────────────────────
    await runCase(
      "org_owner calling PUT /api/admin/email-templates/:key receives a 404",
      async () => {
        const ctx = await newCtx(browser, ownerCookie);
        try {
          const page = await ctx.newPage();
          const response = await page.request.put(
            `${BASE}/api/admin/email-templates/staff_new_org`,
            {
              headers: { "Content-Type": "application/json" },
              data: { copy: null },
            },
          );
          assert(
            response.status() === 404,
            "org_owner PUT email template returns 404",
            response.status(),
          );
        } finally {
          await ctx.close();
        }
      },
    );

    // ── Case 7: staff_approver POST /enabled (toggle) returns 404 ─────────
    await runCase(
      "staff_approver calling POST /api/admin/email-templates/:key/enabled receives a 404",
      async () => {
        const ctx = await newCtx(browser, approverCookie);
        try {
          const page = await ctx.newPage();
          const response = await page.request.post(
            `${BASE}/api/admin/email-templates/staff_new_org/enabled`,
            {
              headers: { "Content-Type": "application/json" },
              data: { enabled: false },
            },
          );
          assert(
            response.status() === 404,
            "staff_approver POST email template /enabled returns 404",
            response.status(),
          );
        } finally {
          await ctx.close();
        }
      },
    );

    // ── Case 8: org_owner POST /enabled (toggle) returns 404 ─────────────
    await runCase(
      "org_owner calling POST /api/admin/email-templates/:key/enabled receives a 404",
      async () => {
        const ctx = await newCtx(browser, ownerCookie);
        try {
          const page = await ctx.newPage();
          const response = await page.request.post(
            `${BASE}/api/admin/email-templates/staff_new_org/enabled`,
            {
              headers: { "Content-Type": "application/json" },
              data: { enabled: false },
            },
          );
          assert(
            response.status() === 404,
            "org_owner POST email template /enabled returns 404",
            response.status(),
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
