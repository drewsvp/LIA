/**
 * DOM-inspection regression checks for admin tab labels and the active-tab
 * underline indicator.
 *
 * The admin tab bar lost `text-transform: uppercase` during a visual softening
 * pass. Tab labels now render in whatever case they are written in source. This
 * script verifies that:
 *
 *   1. Every tab label is present and correctly cased (Title Case or Sentence
 *      case as authored) — no accidental all-lowercase output.
 *   2. The active tab receives the `adm-tab-current` class.
 *   3. The teal underline (border-bottom-color: rgb(2, 146, 143)) is visible on
 *      the active tab and absent on inactive ones.
 *   4. Clicking each tab switches the `adm-tab-current` class to the target and
 *      applies the teal underline there.
 *
 * Covered admin sections: Organizations, Members, Requests.
 *
 * Usage:
 *   npm run test:admin-tabs
 *
 * The development server must be running.
 */
import { execFileSync } from "node:child_process";
import { chromium, type Page, type BrowserContext } from "playwright";

const BASE = process.env.REPLIT_DEV_DOMAIN
  ? `https://${process.env.REPLIT_DEV_DOMAIN}`
  : "http://127.0.0.1:5000";

const TEAL = "rgb(2, 146, 143)";
const TRANSPARENT = "rgba(0, 0, 0, 0)";

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
 * Collect label text and computed styles for every .adm-tab on the page,
 * along with which ones carry the `adm-tab-current` class.
 */
async function collectTabs(
  page: Page,
): Promise<Array<{ label: string; current: boolean; borderColor: string; textTransform: string }>> {
  return page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>(".adm-tab"));
    return buttons.map((btn) => {
      const style = window.getComputedStyle(btn);
      return {
        label: btn.textContent?.trim() ?? "",
        current: btn.classList.contains("adm-tab-current"),
        borderColor: style.borderBottomColor,
        textTransform: style.textTransform,
      };
    });
  });
}

/**
 * Assert that every tab in the group has the expected label text, that exactly
 * one tab is active, that the active tab carries `adm-tab-current` and the
 * teal underline, and that all other tabs do NOT carry the teal underline.
 * Then click each inactive tab in turn and repeat the same assertions.
 */
async function assertTabGroup(
  page: Page,
  url: string,
  expectedLabels: readonly string[],
): Promise<void> {
  await page.goto(`${BASE}${url}`, { waitUntil: "networkidle" });
  await page.waitForSelector(".adm-tabs");

  const initial = await collectTabs(page);

  assert(
    initial.length === expectedLabels.length,
    `${url}: expected ${expectedLabels.length} tab(s), found ${initial.length}`,
    initial.map((t) => t.label),
  );

  // ── Label casing and no text-transform override ───────────────────────────
  for (let i = 0; i < expectedLabels.length; i++) {
    assert(
      initial[i]!.label === expectedLabels[i],
      `${url}: tab ${i + 1} label wrong`,
      { expected: expectedLabels[i], actual: initial[i]!.label },
    );
    // Computed textTransform must be "none" — if text-transform: uppercase were
    // re-applied in CSS the label text would still match textContent but the
    // rendered characters would be uppercase-forced.
    assert(
      initial[i]!.textTransform === "none",
      `${url}: tab "${initial[i]!.label}" has text-transform: ${initial[i]!.textTransform} — labels must render in their authored case`,
    );
  }

  // ── Exactly one active tab on load ────────────────────────────────────────
  const activeTabs = initial.filter((t) => t.current);
  assert(activeTabs.length === 1, `${url}: expected exactly 1 active tab on load, found ${activeTabs.length}`);

  // ── Active tab has teal underline; inactive tabs do not ───────────────────
  for (const tab of initial) {
    if (tab.current) {
      assert(
        tab.borderColor === TEAL,
        `${url}: active tab "${tab.label}" must have teal border-bottom-color`,
        { expected: TEAL, actual: tab.borderColor },
      );
    } else {
      assert(
        tab.borderColor === TRANSPARENT,
        `${url}: inactive tab "${tab.label}" must have transparent border-bottom-color`,
        { expected: TRANSPARENT, actual: tab.borderColor },
      );
    }
  }

  // ── Click each tab and confirm indicator moves correctly ──────────────────
  for (const label of expectedLabels) {
    const btn = page.locator(".adm-tab").filter({ hasText: new RegExp(`^\\s*${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`) });
    await btn.click();
    // Wait for React to re-render (class update is synchronous but give it a
    // frame to flush).
    await page.waitForTimeout(150);

    const after = await collectTabs(page);

    const targetTab = after.find((t) => t.label === label);
    assert(
      targetTab !== undefined,
      `${url}: tab "${label}" disappeared after click`,
    );
    assert(
      targetTab.current,
      `${url}: tab "${label}" should be current after clicking it`,
    );
    assert(
      targetTab.borderColor === TEAL,
      `${url}: tab "${label}" should have teal underline after clicking it`,
      { expected: TEAL, actual: targetTab.borderColor },
    );

    const otherActive = after.filter((t) => t.current && t.label !== label);
    assert(
      otherActive.length === 0,
      `${url}: ${otherActive.length} other tab(s) still marked current after clicking "${label}"`,
      otherActive.map((t) => t.label),
    );

    for (const tab of after.filter((t) => t.label !== label)) {
      assert(
        tab.borderColor === TRANSPARENT,
        `${url}: inactive tab "${tab.label}" must lose teal underline after clicking "${label}"`,
        { expected: TRANSPARENT, actual: tab.borderColor },
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

    // ── Organizations ─────────────────────────────────────────────────────────
    console.log("\nOrganizations tabs");
    await runCase(
      "labels are Title Case and active-tab underline is correct for all tabs",
      async () => {
        const ctx = await newCtx(browser, cookie);
        try {
          const page = await ctx.newPage();
          await assertTabGroup(page, "/admin/organizations", ["Pending", "Approved", "Disabled"] as const);
        } finally {
          await ctx.close();
        }
      },
    );

    // ── Members ───────────────────────────────────────────────────────────────
    console.log("\nMembers tabs");
    await runCase(
      "labels are Title Case and active-tab underline is correct for all tabs",
      async () => {
        const ctx = await newCtx(browser, cookie);
        try {
          const page = await ctx.newPage();
          await assertTabGroup(page, "/admin/members", ["Pending", "Active", "Removed"] as const);
        } finally {
          await ctx.close();
        }
      },
    );

    // ── Requests ──────────────────────────────────────────────────────────────
    console.log("\nRequests tabs");
    await runCase(
      "labels are correctly cased and active-tab underline is correct for all tabs",
      async () => {
        const ctx = await newCtx(browser, cookie);
        try {
          const page = await ctx.newPage();
          await assertTabGroup(
            page,
            "/admin/requests",
            ["Pending", "Active", "Archived", "Returned for changes"] as const,
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
