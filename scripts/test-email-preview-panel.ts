/**
 * Integration test: Task 248 — email preview panel shows the right content
 * for renderable and unavailable rows.
 *
 * Section 1 — API endpoint checks (fetch + DAL, no browser):
 *   1a. Product template row with valid payload.vars → { subject, html } non-empty
 *   1b. auth_magic_link row → { previewUnavailable: true, reason mentions single-use tokens }
 *   1c. Product template row with missing payload.vars → { previewUnavailable: true }
 *   1d. Product template row whose payload.vars omits one required field → previewUnavailable, reason names the missing var
 *   1e. Product template row whose payload.vars has all required fields but one is an empty string → previewUnavailable
 *
 * Section 2 — Browser panel checks (Playwright):
 *   2a. Clicking a renderable row and switching to "Preview email" renders
 *       subject line and an iframe with a non-empty srcDoc
 *   2b. Clicking an auth_magic_link row and switching to "Preview email"
 *       renders the unavailable message and no subject/iframe
 *
 * Usage:
 *   npm run test:email-preview-panel
 *
 * The development server must be running. Uses the quick-login endpoint which
 * is only active in NODE_ENV=development.
 * All rows use the zz_fixture payload key so the email sweep ignores them.
 * Rows are deleted at the end regardless of pass/fail.
 */
import { execFileSync } from "node:child_process";
import { chromium, type BrowserContext } from "playwright";
import * as emailLog from "../server/dal/email-log";
import { SYSTEM, pool } from "../server/db/client";

const BASE = process.env.REPLIT_DEV_DOMAIN
  ? `https://${process.env.REPLIT_DEV_DOMAIN}`
  : "http://127.0.0.1:5000";

let passed = 0;
let failed = 0;
const insertedIds: string[] = [];

function assert(condition: boolean, label: string, detail?: unknown): void {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    const extra = detail !== undefined ? `: ${JSON.stringify(detail)}` : "";
    console.error(`  ✗ FAIL: ${label}${extra}`);
    failed++;
  }
}

async function cleanup(): Promise<void> {
  if (insertedIds.length === 0) return;
  await pool.query(`delete from email_log where id = any($1::uuid[])`, [insertedIds]);
  insertedIds.length = 0;
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

async function quickLogin(): Promise<{ cookie: BrowserCookie; cookieHeader: string }> {
  const response = await fetch(`${BASE}/api/login/quick`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role: "staff_admin" }),
  });
  if (!response.ok) throw new Error(`Quick login failed: HTTP ${response.status}`);
  const getSetCookie = (response.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
  const values = typeof getSetCookie === "function" ? getSetCookie.call(response.headers) : [];
  const sessionCookie = values.find((v) => v.includes("session_token"));
  if (!sessionCookie) throw new Error("Quick login did not return a session cookie.");
  const [pair] = sessionCookie.split(";");
  return { cookie: parseCookie(sessionCookie), cookieHeader: pair! };
}

async function apiGet(path: string, cookieHeader: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${BASE}${path}`, { headers: { Cookie: cookieHeader } });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function runCase(label: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`  ✓ ${label}`);
    passed++;
  } catch (error) {
    console.error(`  ✗ ${label}`);
    console.error(
      `    ${error instanceof Error ? error.message.replace(/\n/g, "\n    ") : String(error)}`,
    );
    failed++;
  }
}

async function main(): Promise<void> {
  console.log("\nTask 248 — email preview panel integration test\n");

  const { cookie, cookieHeader } = await quickLogin();

  // Unique addresses so the once-only index never conflicts across runs.
  const PRODUCT_EMAIL = "zz.preview-product@example.test";
  const AUTH_EMAIL = "zz.preview-auth@example.test";
  const EMPTY_VARS_EMAIL = "zz.preview-empty-vars@example.test";
  const PARTIAL_VARS_EMAIL = "zz.preview-partial-vars@example.test";
  const EMPTY_VAL_EMAIL = "zz.preview-empty-val@example.test";

  // Fictitious entity IDs using a reserved nil-prefix UUID block (ffff) that
  // will never exist in real data, so the once-only index can't collide.
  const ENTITY_ID_PRODUCT = "00000000-0000-0000-ffff-000000000101";
  const ENTITY_ID_EMPTY = "00000000-0000-0000-ffff-000000000103";
  const ENTITY_ID_PARTIAL = "00000000-0000-0000-ffff-000000000104";
  const ENTITY_ID_EMPTY_VAL = "00000000-0000-0000-ffff-000000000105";

  // org_approved required vars: organizationName, organizationPrimaryContact,
  // organizationPrimaryContactEmail, dashboardUrl
  const productVars = {
    organizationName: "Fixture Preview Org",
    orgAddress: null,
    orgPhoneNumber: null,
    websiteUrl: null,
    missionStatement: null,
    primaryPopulationServed: null,
    organizationPrimaryContact: "Fixture Contact",
    organizationPrimaryContactEmail: "contact@fixture.test",
    organizationPrimaryContactPhone: null,
    dashboardUrl: "https://fixture.test/dashboard",
  };

  // Pre-clean any leftover rows from a prior aborted run so the once-only
  // index doesn't block the fresh insert below.
  await pool.query(
    `delete from email_log
      where to_email = any($1::text[])
        and (payload->>'zz_fixture')::boolean is true`,
    [[PRODUCT_EMAIL, AUTH_EMAIL, EMPTY_VARS_EMAIL, PARTIAL_VARS_EMAIL, EMPTY_VAL_EMAIL]],
  );

  let productRowId: string;
  let authRowId: string;
  let emptyVarsRowId: string;
  let partialVarsRowId: string;
  let emptyValRowId: string;

  // Insert all five rows in a single transaction.
  const client = await pool.connect();
  try {
    await client.query("begin");

    const r1 = await emailLog.insertQueuedInTx(client, {
      templateKey: "org_approved",
      toEmail: PRODUCT_EMAIL,
      entityType: "organization",
      entityId: ENTITY_ID_PRODUCT,
      payload: { zz_fixture: true, vars: productVars },
    });
    productRowId = r1.id;
    insertedIds.push(r1.id);

    // auth_magic_link is NOT a product template — it goes through the
    // unavailable path in the preview endpoint.
    // Its entity_type and entity_id are null, so the once-only index
    // (which uses a partial condition on non-null entity_id) does not apply.
    const r2 = await emailLog.insertQueuedInTx(client, {
      templateKey: "auth_magic_link",
      toEmail: AUTH_EMAIL,
      entityType: null,
      entityId: null,
      payload: { zz_fixture: true },
    });
    authRowId = r2.id;
    insertedIds.push(r2.id);

    // Product template row but with no vars key in the payload, so the
    // endpoint returns previewUnavailable for the missing-vars reason.
    const r3 = await emailLog.insertQueuedInTx(client, {
      templateKey: "org_approved",
      toEmail: EMPTY_VARS_EMAIL,
      entityType: "organization",
      entityId: ENTITY_ID_EMPTY,
      payload: { zz_fixture: true },
    });
    emptyVarsRowId = r3.id;
    insertedIds.push(r3.id);

    // Product template row with partial vars — required field dashboardUrl is
    // intentionally omitted. The preview endpoint must detect it via
    // unresolvedVariables and return previewUnavailable with the var name.
    const r4 = await emailLog.insertQueuedInTx(client, {
      templateKey: "org_approved",
      toEmail: PARTIAL_VARS_EMAIL,
      entityType: "organization",
      entityId: ENTITY_ID_PARTIAL,
      payload: {
        zz_fixture: true,
        vars: {
          organizationName: "Fixture Partial Org",
          orgAddress: null,
          orgPhoneNumber: null,
          websiteUrl: null,
          missionStatement: null,
          primaryPopulationServed: null,
          organizationPrimaryContact: "Fixture Contact",
          organizationPrimaryContactEmail: "contact@fixture.test",
          organizationPrimaryContactPhone: null,
          // dashboardUrl intentionally omitted — required field missing
        },
      },
    });
    partialVarsRowId = r4.id;
    insertedIds.push(r4.id);

    // Product template row with all required fields present but one value is
    // an empty string. unresolvedVariables treats "" as unresolved (same gate
    // the send pipeline uses), so the preview endpoint must return
    // previewUnavailable even though the key exists in the vars object.
    const r5 = await emailLog.insertQueuedInTx(client, {
      templateKey: "org_approved",
      toEmail: EMPTY_VAL_EMAIL,
      entityType: "organization",
      entityId: ENTITY_ID_EMPTY_VAL,
      payload: {
        zz_fixture: true,
        vars: {
          organizationName: "Fixture EmptyVal Org",
          orgAddress: null,
          orgPhoneNumber: null,
          websiteUrl: null,
          missionStatement: null,
          primaryPopulationServed: null,
          organizationPrimaryContact: "Fixture Contact",
          organizationPrimaryContactEmail: "contact@fixture.test",
          organizationPrimaryContactPhone: null,
          dashboardUrl: "",  // empty string — treated as unresolved
        },
      },
    });
    emptyValRowId = r5.id;
    insertedIds.push(r5.id);

    await client.query("commit");
  } catch (err) {
    await client.query("rollback").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }

  // ── Section 1: API endpoint checks ────────────────────────────────────────
  console.log("1. Preview endpoint — API responses");

  // 1a. Valid product template row with complete payload.vars
  const r1res = await apiGet(`/api/admin/email/${productRowId}/preview`, cookieHeader);
  const r1body = r1res.body as Record<string, unknown> | null;
  assert(r1res.status === 200, "1a: HTTP 200 for renderable product-template row");
  assert(
    typeof r1body?.subject === "string" && (r1body.subject as string).length > 0,
    "1a: subject is a non-empty string",
    r1body?.subject,
  );
  assert(
    typeof r1body?.html === "string" && (r1body.html as string).length > 100,
    "1a: html is non-trivially populated (>100 chars)",
    typeof r1body?.html === "string" ? (r1body.html as string).length : r1body?.html,
  );
  assert(
    !r1body?.previewUnavailable,
    "1a: previewUnavailable absent on successful render",
  );

  // 1b. auth_magic_link row — non-product template
  const r2res = await apiGet(`/api/admin/email/${authRowId}/preview`, cookieHeader);
  const r2body = r2res.body as Record<string, unknown> | null;
  assert(r2res.status === 200, "1b: HTTP 200 for auth_magic_link row (not a 4xx)");
  assert(r2body?.previewUnavailable === true, "1b: previewUnavailable: true for auth_magic_link");
  assert(
    typeof r2body?.reason === "string" &&
      (r2body.reason as string).toLowerCase().includes("single-use token"),
    "1b: reason mentions single-use tokens",
    r2body?.reason,
  );
  assert(
    r2body?.subject === undefined && r2body?.html === undefined,
    "1b: no subject or html fields on unavailable response",
  );

  // 1c. Product template row with missing payload.vars
  const r3res = await apiGet(`/api/admin/email/${emptyVarsRowId}/preview`, cookieHeader);
  const r3body = r3res.body as Record<string, unknown> | null;
  assert(r3res.status === 200, "1c: HTTP 200 for row with missing payload.vars");
  assert(r3body?.previewUnavailable === true, "1c: previewUnavailable: true for missing vars");
  assert(
    typeof r3body?.reason === "string" && (r3body.reason as string).length > 0,
    "1c: reason is a non-empty string",
    r3body?.reason,
  );

  // 1d. Product template row whose payload.vars omits one required field
  // (dashboardUrl is absent). unresolvedVariables catches the gap and the
  // endpoint must name the offending variable in its reason string.
  const r4res = await apiGet(`/api/admin/email/${partialVarsRowId}/preview`, cookieHeader);
  const r4body = r4res.body as Record<string, unknown> | null;
  assert(r4res.status === 200, "1d: HTTP 200 for row with partial payload.vars");
  assert(r4body?.previewUnavailable === true, "1d: previewUnavailable: true for partial vars");
  assert(
    typeof r4body?.reason === "string" && (r4body.reason as string).includes("dashboardUrl"),
    "1d: reason names the missing variable (dashboardUrl)",
    r4body?.reason,
  );
  assert(
    r4body?.subject === undefined && r4body?.html === undefined,
    "1d: no subject or html fields on unavailable response",
  );

  // 1e. Product template row with all required fields present but one value is
  // an empty string (""). unresolvedVariables treats "" as unresolved, so the
  // endpoint must return previewUnavailable even though the key exists.
  const r5res = await apiGet(`/api/admin/email/${emptyValRowId}/preview`, cookieHeader);
  const r5body = r5res.body as Record<string, unknown> | null;
  assert(r5res.status === 200, "1e: HTTP 200 for row with empty-string required var");
  assert(r5body?.previewUnavailable === true, "1e: previewUnavailable: true for empty-string var");
  assert(
    typeof r5body?.reason === "string" && (r5body.reason as string).includes("dashboardUrl"),
    "1e: reason names the empty-string variable (dashboardUrl)",
    r5body?.reason,
  );
  assert(
    r5body?.subject === undefined && r5body?.html === undefined,
    "1e: no subject or html fields on unavailable response",
  );

  // ── Section 2: Browser panel checks (Playwright) ──────────────────────────
  console.log("\n2. Preview panel — browser UI");

  const browser = await chromium.launch({
    headless: true,
    executablePath: chromiumExecutable(),
  });

  try {
    // 2a. Renderable row → subject line + iframe in the panel
    await runCase(
      "panel renders subject line and iframe when preview data is present",
      async () => {
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
        await ctx.addCookies([cookie]);
        try {
          const page = await ctx.newPage();
          // Navigate with recipient filter so only our fixture row appears
          await page.goto(
            `${BASE}/admin/email?recipient=${encodeURIComponent(PRODUCT_EMAIL)}`,
            { waitUntil: "networkidle" },
          );

          const row = page.locator("table.adm-table tbody tr").first();
          await row.waitFor({ state: "visible", timeout: 8_000 });
          await row.click();

          const detail = page.locator(".adm-email-detail");
          await detail.waitFor({ state: "visible", timeout: 5_000 });

          // Switch to "Preview email" tab
          const previewTab = detail.locator("button", { hasText: "Preview email" });
          await previewTab.waitFor({ state: "visible", timeout: 3_000 });
          await previewTab.click();

          const previewPanel = page.locator(".adm-email-log-preview");
          await previewPanel.waitFor({ state: "visible", timeout: 5_000 });

          // Subject must appear in a <dd> inside adm-detail-list
          const subjectDd = previewPanel.locator("dl.adm-detail-list dd").first();
          await subjectDd.waitFor({ state: "visible", timeout: 8_000 });
          const subjectText = (await subjectDd.textContent()) ?? "";
          if (subjectText.trim().length === 0) {
            throw new Error(`Subject is empty, got: ${JSON.stringify(subjectText)}`);
          }

          // The iframe must be present and its srcDoc must be non-empty
          const iframe = previewPanel.locator("iframe[title='Email preview']");
          await iframe.waitFor({ state: "visible", timeout: 5_000 });
          const srcDoc = await iframe.getAttribute("srcdoc");
          if (!srcDoc || srcDoc.trim().length === 0) {
            throw new Error("iframe srcDoc is empty or missing");
          }

          // No error or unavailable message should appear
          const errorMsg = previewPanel.locator("p.adm-result.adm-result-fail");
          if (await errorMsg.count() > 0) {
            throw new Error(
              `Unexpected error message in panel: ${await errorMsg.textContent()}`,
            );
          }
        } finally {
          await ctx.close();
        }
      },
    );

    // 2b. auth_magic_link row → unavailable message, no subject/iframe
    await runCase(
      "panel renders the unavailable message for auth_magic_link rows (no iframe)",
      async () => {
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
        await ctx.addCookies([cookie]);
        try {
          const page = await ctx.newPage();
          await page.goto(
            `${BASE}/admin/email?recipient=${encodeURIComponent(AUTH_EMAIL)}`,
            { waitUntil: "networkidle" },
          );

          const row = page.locator("table.adm-table tbody tr").first();
          await row.waitFor({ state: "visible", timeout: 8_000 });
          await row.click();

          const detail = page.locator(".adm-email-detail");
          await detail.waitFor({ state: "visible", timeout: 5_000 });

          const previewTab = detail.locator("button", { hasText: "Preview email" });
          await previewTab.waitFor({ state: "visible", timeout: 3_000 });
          await previewTab.click();

          const previewPanel = page.locator(".adm-email-log-preview");
          await previewPanel.waitFor({ state: "visible", timeout: 5_000 });

          // Wait for the preview query to settle: "Loading preview…" disappears
          // and the actual unavailable reason appears. Both use p.adm-muted, so
          // we wait until the text stops being the loading placeholder.
          await page.waitForFunction(
            () => {
              const el = document.querySelector(".adm-email-log-preview p.adm-muted");
              return el !== null && el.textContent !== "Loading preview…";
            },
            { timeout: 10_000 },
          );
          const mutedMsg = previewPanel.locator("p.adm-muted");
          const msgText = (await mutedMsg.textContent()) ?? "";
          if (!msgText.toLowerCase().includes("single-use token")) {
            throw new Error(
              `Expected reason mentioning single-use tokens, got: ${JSON.stringify(msgText)}`,
            );
          }

          // No subject list or iframe should be present
          const subjectList = previewPanel.locator("dl.adm-detail-list");
          if (await subjectList.count() > 0) {
            throw new Error("Unexpected subject/html panel rendered for unavailable preview");
          }
          const iframeEl = previewPanel.locator("iframe");
          if (await iframeEl.count() > 0) {
            throw new Error("Unexpected iframe rendered for unavailable preview");
          }
        } finally {
          await ctx.close();
        }
      },
    );

    // 2c. partial-vars row → unavailable message naming "dashboardUrl", no subject/iframe
    await runCase(
      "panel renders the unavailable message for partial-vars rows and names the missing variable",
      async () => {
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
        await ctx.addCookies([cookie]);
        try {
          const page = await ctx.newPage();
          await page.goto(
            `${BASE}/admin/email?recipient=${encodeURIComponent(PARTIAL_VARS_EMAIL)}`,
            { waitUntil: "networkidle" },
          );

          const row = page.locator("table.adm-table tbody tr").first();
          await row.waitFor({ state: "visible", timeout: 8_000 });
          await row.click();

          const detail = page.locator(".adm-email-detail");
          await detail.waitFor({ state: "visible", timeout: 5_000 });

          const previewTab = detail.locator("button", { hasText: "Preview email" });
          await previewTab.waitFor({ state: "visible", timeout: 3_000 });
          await previewTab.click();

          const previewPanel = page.locator(".adm-email-log-preview");
          await previewPanel.waitFor({ state: "visible", timeout: 5_000 });

          // Wait for the preview query to settle: "Loading preview…" disappears
          // and the actual unavailable reason (naming dashboardUrl) appears.
          await page.waitForFunction(
            () => {
              const el = document.querySelector(".adm-email-log-preview p.adm-muted");
              return el !== null && el.textContent !== "Loading preview…";
            },
            { timeout: 10_000 },
          );
          const mutedMsg = previewPanel.locator("p.adm-muted");
          const msgText = (await mutedMsg.textContent()) ?? "";
          if (!msgText.includes("dashboardUrl")) {
            throw new Error(
              `Expected reason mentioning dashboardUrl, got: ${JSON.stringify(msgText)}`,
            );
          }

          // No subject list or iframe should be present
          const subjectList = previewPanel.locator("dl.adm-detail-list");
          if (await subjectList.count() > 0) {
            throw new Error("Unexpected subject/html panel rendered for unavailable preview");
          }
          const iframeEl = previewPanel.locator("iframe");
          if (await iframeEl.count() > 0) {
            throw new Error("Unexpected iframe rendered for unavailable preview");
          }
        } finally {
          await ctx.close();
        }
      },
    );
  } finally {
    await browser.close();
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────
  await cleanup();
  await pool.end();

  console.log(`\n${"─".repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.error("\nTest failures detected — see ✗ lines above.");
    process.exit(1);
  } else {
    console.log("\nAll checks passed.");
  }
}

main().catch((err) => {
  console.error("Test script error:", err);
  void cleanup().finally(() => pool.end());
  process.exit(1);
});
