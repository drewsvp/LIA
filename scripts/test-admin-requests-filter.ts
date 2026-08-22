/**
 * DOM-inspection regression check for the Requests page type-filter bar.
 *
 * The admin Requests page renders three secondary filter buttons
 * (All / Items / Volunteer) with `.adm-filterbtn` and `.adm-filterbtn-on`.
 * This script verifies that:
 *
 *   1. All three filter buttons are present with the correct labels.
 *   2. Exactly one button carries `.adm-filterbtn-on` at any time.
 *   3. The active button's background is the expected navy colour
 *      (rgb(22, 58, 95) — #163a5f) and inactive buttons have a white
 *      background (rgb(255, 255, 255)).
 *   4. Clicking each button in turn moves the `.adm-filterbtn-on` class
 *      (and navy background) to the clicked button and removes it from the
 *      others.
 *
 * Usage:
 *   npm run test:admin-requests-filter
 *
 * The development server must be running.
 */
import { execFileSync } from "node:child_process";
import { chromium, type Page, type BrowserContext } from "playwright";

const BASE = process.env.REPLIT_DEV_DOMAIN
  ? `https://${process.env.REPLIT_DEV_DOMAIN}`
  : "http://127.0.0.1:5000";

const NAVY = "rgb(22, 58, 95)";
const WHITE = "rgb(255, 255, 255)";

let passed = 0;
let failed = 0;

function assert(condition: unknown, label: string, detail?: unknown): asserts condition {
  if (!condition) {
    throw new Error(
      `FAIL: ${label}${detail !== undefined ? `\n  detail: ${JSON.stringify(detail)}` : ""}`,
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
  if (!response.ok) throw new Error(`Quick login failed: HTTP ${response.status}`);
  const getSetCookie = (
    response.headers as Headers & { getSetCookie?: () => string[] }
  ).getSetCookie;
  const values =
    typeof getSetCookie === "function" ? getSetCookie.call(response.headers) : [];
  const sessionCookie = values.find((v) => v.includes("session_token"));
  if (!sessionCookie) throw new Error("Quick login did not return a session cookie.");
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
 * Collect label text, active class, and computed background colour for every
 * `.adm-filterbtn` on the page.
 */
async function collectFilterBtns(
  page: Page,
): Promise<Array<{ label: string; active: boolean; bgColor: string }>> {
  return page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>(".adm-filterbtn"));
    return buttons.map((btn) => {
      const style = window.getComputedStyle(btn);
      return {
        label: btn.textContent?.trim() ?? "",
        active: btn.classList.contains("adm-filterbtn-on"),
        bgColor: style.backgroundColor,
      };
    });
  });
}

/**
 * Navigate to the Requests page, verify the initial filter-button state, then
 * click each button in turn and assert that only the clicked button carries
 * `.adm-filterbtn-on` and the navy background.
 */
async function assertFilterButtons(page: Page): Promise<void> {
  const url = "/admin/requests";
  const expectedLabels = ["All", "Items", "Volunteer"] as const;

  await page.goto(`${BASE}${url}`, { waitUntil: "networkidle" });
  await page.waitForSelector(".adm-filterbtn");

  const initial = await collectFilterBtns(page);

  // ── Correct number of buttons ─────────────────────────────────────────────
  assert(
    initial.length === expectedLabels.length,
    `expected ${expectedLabels.length} filter button(s), found ${initial.length}`,
    initial.map((b) => b.label),
  );

  // ── Correct labels ────────────────────────────────────────────────────────
  for (let i = 0; i < expectedLabels.length; i++) {
    assert(
      initial[i]!.label === expectedLabels[i],
      `filter button ${i + 1} label wrong`,
      { expected: expectedLabels[i], actual: initial[i]!.label },
    );
  }

  // ── Exactly one active button on load ─────────────────────────────────────
  const activeBtns = initial.filter((b) => b.active);
  assert(
    activeBtns.length === 1,
    `expected exactly 1 active filter button on load, found ${activeBtns.length}`,
    activeBtns.map((b) => b.label),
  );

  // ── Active button has navy background; inactive buttons have white ─────────
  for (const btn of initial) {
    if (btn.active) {
      assert(
        btn.bgColor === NAVY,
        `active filter button "${btn.label}" must have navy background`,
        { expected: NAVY, actual: btn.bgColor },
      );
    } else {
      assert(
        btn.bgColor === WHITE,
        `inactive filter button "${btn.label}" must have white background`,
        { expected: WHITE, actual: btn.bgColor },
      );
    }
  }

  // ── Click each button and confirm the highlight moves correctly ───────────
  for (const label of expectedLabels) {
    const btn = page
      .locator(".adm-filterbtn")
      .filter({ hasText: new RegExp(`^\\s*${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`) });
    await btn.click();
    // Allow React one frame to flush the class update.
    await page.waitForTimeout(150);

    const after = await collectFilterBtns(page);

    const targetBtn = after.find((b) => b.label === label);
    assert(targetBtn !== undefined, `filter button "${label}" disappeared after click`);
    assert(
      targetBtn.active,
      `filter button "${label}" should carry adm-filterbtn-on after clicking it`,
    );
    assert(
      targetBtn.bgColor === NAVY,
      `filter button "${label}" should have navy background after clicking it`,
      { expected: NAVY, actual: targetBtn.bgColor },
    );

    const otherActive = after.filter((b) => b.active && b.label !== label);
    assert(
      otherActive.length === 0,
      `${otherActive.length} other filter button(s) still marked active after clicking "${label}"`,
      otherActive.map((b) => b.label),
    );

    for (const other of after.filter((b) => b.label !== label)) {
      assert(
        other.bgColor === WHITE,
        `inactive filter button "${other.label}" must have white background after clicking "${label}"`,
        { expected: WHITE, actual: other.bgColor },
      );
    }
  }
}

async function main(): Promise<void> {
  const browser = await chromium.launch({
    headless: true,
    executablePath: chromiumExecutable(),
  });

  try {
    const cookie = await loginCookie();

    console.log("\nRequests type-filter buttons");
    await runCase(
      "each filter button highlights correctly when clicked (All / Items / Volunteer)",
      async () => {
        const ctx = await newCtx(browser, cookie);
        try {
          const page = await ctx.newPage();
          await assertFilterButtons(page);
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
