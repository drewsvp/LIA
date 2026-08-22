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
  const response = await fetch(`${BASE}/api/login/quick`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role }),
  });
  if (!response.ok)
    throw new Error(`Quick login as ${role} failed: HTTP ${response.status}`);
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

  try {
    // ── Case 1: staff_approver is denied the page in the browser ──────────
    await runCase(
      "staff_approver navigating to /admin/emails sees not-found, not the template table",
      async () => {
        const cookie = await quickLoginCookie("staff_approver");
        const ctx = await newCtx(browser, cookie);
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
        const cookie = await quickLoginCookie("org_owner");
        const ctx = await newCtx(browser, cookie);
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
        const cookie = await quickLoginCookie("staff_approver");
        const ctx = await newCtx(browser, cookie);
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
        const cookie = await quickLoginCookie("org_owner");
        const ctx = await newCtx(browser, cookie);
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
