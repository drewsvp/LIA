/**
 * Happy-path access checks for every staff-admin-only surface.
 *
 * The set of surfaces under test is derived directly from STAFF_ADMIN_ONLY_SURFACES
 * and SURFACE_ROUTES in shared/routes.ts so that any newly added surface is
 * automatically included in the next run.
 *
 * Per-surface assertion metadata (which element confirms the page loaded) is
 * keyed by surface ID. Every admin page renders an h1.adm-heading with its
 * title text; ADMIN-10 additionally checks for clickable template rows.
 *
 * The staff_admin session cookie is minted once and reused across isolated
 * browser contexts for all route checks, keeping quick-login consumption to
 * a single call regardless of how many surfaces are in the set.
 *
 * This is the companion to scripts/test-email-admin-guard.ts, which checks
 * that the wrong roles are denied. Together they confirm the guard never
 * breaks the happy path for staff_admin.
 *
 * Usage:
 *   npm run test:staff-admin-access
 *
 * The development server must be running. Uses the quick-login endpoint
 * which is only active in NODE_ENV=development.
 */
import { execFileSync } from "node:child_process";
import { chromium, type BrowserContext } from "playwright";
import { SURFACE_ROUTES, STAFF_ADMIN_ONLY_SURFACES } from "../shared/routes.js";

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

async function quickLoginCookie(role: "staff_admin"): Promise<BrowserCookie> {
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

/**
 * Per-surface assertion metadata keyed by surface ID.
 *
 * authSelector  — CSS selector for the element that confirms the authorised
 *                 page actually loaded (not just that the 404 was skipped).
 * authText      — optional text filter applied to authSelector. When omitted
 *                 the first matching element is used.
 *
 * Every admin page renders an h1.adm-heading with its stable page title, so
 * that is the default assertion element. ADMIN-10 additionally checks for
 * clickable template rows (the heading loads before data; the rows prove the
 * API call also succeeded).
 */
const SURFACE_ASSERTIONS: Record<
  string,
  { authSelector: string; authText?: string }
> = {
  "ADMIN-04": { authSelector: "h1.adm-heading", authText: "People review" },
  "ADMIN-05": { authSelector: "h1.adm-heading", authText: "Populations" },
  "ADMIN-08": { authSelector: "h1.adm-heading", authText: "Subscribers" },
  "ADMIN-09": { authSelector: "h1.adm-heading", authText: "Roles" },
  "ADMIN-10": { authSelector: ".adm-row-clickable" },
  "ADMIN-11": { authSelector: "h1.adm-heading", authText: "Volunteer categories" },
  "ADMIN-12": { authSelector: "h1.adm-heading", authText: "Analytics" },
};

async function main(): Promise<void> {
  // Derive the surfaces under test from the shared definitions so that any
  // newly added staff-admin-only surface is automatically included.
  const staffAdminRoutes = SURFACE_ROUTES.filter((r) =>
    STAFF_ADMIN_ONLY_SURFACES.has(r.id),
  );

  // Warn at startup if a surface has no assertion metadata — the test will
  // still run but use the heading as a fallback so it does not silently pass
  // with no real check.
  for (const route of staffAdminRoutes) {
    if (!SURFACE_ASSERTIONS[route.id]) {
      console.warn(
        `  ⚠ No assertion metadata for ${route.id} (${route.path}); falling back to page heading.`,
      );
    }
  }

  const browser = await chromium.launch({
    headless: true,
    executablePath: chromiumExecutable(),
  });

  try {
    // Mint the session cookie once and reuse it for every route check. This
    // keeps quick-login consumption to a single call regardless of how many
    // surfaces are in STAFF_ADMIN_ONLY_SURFACES.
    const cookie = await quickLoginCookie("staff_admin");

    for (const route of staffAdminRoutes) {
      const assertion = SURFACE_ASSERTIONS[route.id] ?? {
        authSelector: "h1.adm-heading",
        authText: route.title,
      };

      await runCase(
        `staff_admin can reach ${route.id} ${route.path} and sees authorised content`,
        async () => {
          // Each route check runs in its own isolated browser context so that
          // one page's state cannot interfere with another, while sharing the
          // single session cookie.
          const ctx = await newCtx(browser, cookie);
          try {
            const page = await ctx.newPage();
            await page.goto(`${BASE}${route.path}`, { waitUntil: "networkidle" });

            // (a) The guard must NOT have 404'd the request.
            const notFound = page.locator("h1", { hasText: "Page not found" });
            assert(
              !(await notFound.isVisible()),
              `staff_admin must NOT see the not-found heading at ${route.path}`,
            );

            // (b) A stable authorised UI element must be visible.
            const authEl = assertion.authText
              ? page.locator(assertion.authSelector, { hasText: assertion.authText })
              : page.locator(assertion.authSelector);

            await authEl.first().waitFor({ state: "visible", timeout: 8_000 });
            assert(
              await authEl.first().isVisible(),
              `staff_admin sees authorised content at ${route.path} (${assertion.authSelector})`,
            );
          } finally {
            await ctx.close();
          }
        },
      );
    }
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
