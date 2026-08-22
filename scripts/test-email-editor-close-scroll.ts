/**
 * Scroll-restoration regression check for the email editor close button.
 *
 * When staff click the × button to close the inline email editor, the page
 * must call scrollIntoView on the EXACT table row they previously selected,
 * even when that row is off-screen. This is implemented with a rowRefs map
 * and requestAnimationFrame in handleClose.
 *
 * The spy patches HTMLElement.prototype.scrollIntoView and records each
 * TR's index within the table body, so a regression that accidentally scrolls
 * a DIFFERENT row would still fail the test.
 *
 * Covered scenarios
 *   1. Row off-screen above the fold — the editor's own open-scroll
 *      (scrollIntoView block:start) pushes the selected row above the viewport.
 *      The test asserts the row is genuinely off-screen before close is pressed.
 *   2. Row off-screen after an additional scroll — after the editor opens, the
 *      page is scrolled further down so the selected row is even further above
 *      the viewport, then close is pressed (Playwright auto-scrolls to the close
 *      button via scrollIntoViewIfNeeded, which is NOT captured by the spy).
 *
 * Usage:
 *   npm run test:email-editor-close-scroll
 *
 * The application must already be running in development mode with the seed
 * data applied (npm run db:seed).
 */
import { execFileSync } from "node:child_process";
import { chromium, type BrowserContext, type Page } from "playwright";

const BASE =
  process.env.TEST_BASE_URL ??
  (process.env.REPLIT_DEV_DOMAIN
    ? `https://${process.env.REPLIT_DEV_DOMAIN}`
    : "http://127.0.0.1:5000");

let passed = 0;
let failed = 0;

function assert(condition: unknown, label: string, detail?: unknown): asserts condition {
  if (!condition) {
    const message =
      detail !== undefined ? `${label}: ${JSON.stringify(detail)}` : label;
    throw new Error(message);
  }
}

function pass(label: string): void {
  passed += 1;
  console.log(`  ✓ ${label}`);
}

function fail(label: string, error: unknown): void {
  failed += 1;
  const msg = error instanceof Error ? error.message : String(error);
  console.error(`  ✗ ${label}`);
  console.error(`    ${msg.replace(/\n/g, "\n    ")}`);
}

async function check(label: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    pass(label);
  } catch (err) {
    fail(label, err);
  }
}

function chromiumExecutable(): string {
  const configured = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?.trim();
  if (configured) return configured;
  return execFileSync("which", ["chromium"], { encoding: "utf8" }).trim();
}

function parseCookie(
  setCookie: string,
): Parameters<BrowserContext["addCookies"]>[0][number] {
  const [pair] = setCookie.split(";");
  const separator = pair!.indexOf("=");
  const cookie: Parameters<BrowserContext["addCookies"]>[0][number] = {
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

async function loginCookie(): Promise<
  Parameters<BrowserContext["addCookies"]>[0][number]
> {
  const response = await fetch(`${BASE}/api/login/quick`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role: "staff_admin" }),
  });
  if (!response.ok) {
    throw new Error(
      `Quick login failed with HTTP ${response.status}. ` +
        "Ensure the seed has been applied (npm run db:seed) and the app is running.",
    );
  }
  const getSetCookie = (
    response.headers as Headers & { getSetCookie?: () => string[] }
  ).getSetCookie;
  const values =
    typeof getSetCookie === "function"
      ? getSetCookie.call(response.headers)
      : [];
  const sessionCookie = values.find((v) => v.includes("session_token"));
  if (!sessionCookie)
    throw new Error("Quick login did not return a session cookie.");
  return parseCookie(sessionCookie);
}

type ScrollCall = { tag: string; rowIndex: number };

/**
 * Patch scrollIntoView on the page. For TR elements the spy records the
 * row's index within .adm-table tbody so we can assert the CORRECT row was
 * scrolled, not just any TR. scrollIntoViewIfNeeded (used by Playwright
 * internally) is a distinct method and is NOT patched.
 */
async function attachScrollSpy(page: Page): Promise<void> {
  await page.evaluate(() => {
    (
      window as unknown as { __scrollCalls: ScrollCall[] }
    ).__scrollCalls = [];
    const original = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = function (
      options?: boolean | ScrollIntoViewOptions,
    ): void {
      if (this.tagName === "TR") {
        const all = Array.from(
          document.querySelectorAll<HTMLTableRowElement>(
            ".adm-table tbody tr",
          ),
        );
        const rowIndex = all.indexOf(this as HTMLTableRowElement);
        (
          window as unknown as { __scrollCalls: ScrollCall[] }
        ).__scrollCalls.push({ tag: "TR", rowIndex });
      }
      original.call(this, options);
    };
  });
}

async function readScrollCalls(page: Page): Promise<ScrollCall[]> {
  return page.evaluate(
    () =>
      (window as unknown as { __scrollCalls?: ScrollCall[] }).__scrollCalls ??
      [],
  );
}

async function clearScrollCalls(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { __scrollCalls: ScrollCall[] }).__scrollCalls = [];
  });
}

/**
 * Return the index of the first clickable row within the table body, plus a
 * bounding-rect snapshot so callers can assert its viewport position.
 */
async function getFirstClickableRowInfo(
  page: Page,
): Promise<{ rowIndex: number; rect: { top: number; bottom: number } }> {
  return page.evaluate(() => {
    const all = Array.from(
      document.querySelectorAll<HTMLTableRowElement>(".adm-table tbody tr"),
    );
    const target = document.querySelector<HTMLTableRowElement>(
      ".adm-row-clickable",
    );
    if (!target) throw new Error("No clickable row found in the email templates table.");
    const rowIndex = all.indexOf(target);
    const { top, bottom } = target.getBoundingClientRect();
    return { rowIndex, rect: { top, bottom } };
  });
}

/**
 * Return the bounding rect of the row at the given table-body index.
 */
async function getRowRect(
  page: Page,
  rowIndex: number,
): Promise<{ top: number; bottom: number }> {
  return page.evaluate((idx) => {
    const all = Array.from(
      document.querySelectorAll<HTMLTableRowElement>(".adm-table tbody tr"),
    );
    const row = all[idx];
    if (!row) throw new Error(`No row at index ${idx}`);
    const { top, bottom } = row.getBoundingClientRect();
    return { top, bottom };
  }, rowIndex);
}

/**
 * Scenario 1 — row above the fold (editor-scroll pushes it off-screen).
 *
 * After clicking a row the app fires requestAnimationFrame(() =>
 * editorRef.current.scrollIntoView({ block: "start" })), which scrolls the
 * editor to the top of the viewport and pushes the selected row above the
 * visible area. In headless Chromium smooth-scroll can settle asynchronously,
 * so after the editor is visible the test explicitly scrolls the editor to the
 * top of the viewport using window.scrollTo (not scrollIntoView, so the spy
 * does not capture it), then asserts the row is genuinely off-screen before
 * pressing close.
 */
async function checkRowAboveFold(page: Page): Promise<void> {
  await page.goto(`${BASE}/admin/emails`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".adm-row-clickable", {
    state: "visible",
    timeout: 15_000,
  });

  // Install spy before any clicks.
  await attachScrollSpy(page);

  // Record which row (by table-body index) we are about to click.
  const { rowIndex } = await getFirstClickableRowInfo(page);

  await page.locator(".adm-row-clickable").first().click();
  await page.waitForSelector(".adm-email-editor", {
    state: "visible",
    timeout: 10_000,
  });

  // Use window.scrollTo (not scrollIntoView, so the spy is unaffected) to
  // reliably place the editor at the top of the viewport regardless of how
  // far the app's smooth-scroll animation has progressed.
  await page.evaluate(() => {
    const editor = document.querySelector<HTMLElement>(".adm-email-editor");
    if (!editor) return;
    const editorTop = editor.getBoundingClientRect().top + window.scrollY;
    window.scrollTo({ top: editorTop, behavior: "instant" });
  });
  await page.waitForTimeout(100);

  // Now assert the selected row is genuinely above the viewport.
  const rectAfterScroll = await getRowRect(page, rowIndex);
  assert(
    rectAfterScroll.bottom < 0,
    "Pre-condition: selected row must be above the viewport after scrolling the editor to the top",
    { rect: rectAfterScroll, viewportHeight: 400 },
  );

  // Reset the spy so only the close-triggered scroll is captured.
  await clearScrollCalls(page);

  // The editor is now at the top of the viewport; the close button is visible
  // so Playwright does not need to auto-scroll to reach it.
  await page.locator('[aria-label="Close editor"]').click();

  // Give the requestAnimationFrame callback time to fire.
  await page.waitForTimeout(300);

  const calls = await readScrollCalls(page);
  const correctCall = calls.find(
    (c) => c.tag === "TR" && c.rowIndex === rowIndex,
  );
  assert(
    correctCall !== undefined,
    "scrollIntoView must be called on the exact selected row (by table-body index) after the close button is pressed",
    { calls, expectedRowIndex: rowIndex },
  );
}

/**
 * Scenario 2 — off-screen after an additional page scroll.
 *
 * After the editor opens (row already above the fold), the page is scrolled
 * further down (past the editor) to increase the distance between the selected
 * row and the viewport. Playwright clicks the close button via
 * scrollIntoViewIfNeeded — a distinct method that is NOT captured by the spy —
 * leaving the app's own scrollIntoView call as the sole TR entry in the log.
 */
async function checkOffScreenAfterScroll(page: Page): Promise<void> {
  await page.goto(`${BASE}/admin/emails`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".adm-row-clickable", {
    state: "visible",
    timeout: 15_000,
  });

  await attachScrollSpy(page);

  const { rowIndex } = await getFirstClickableRowInfo(page);

  await page.locator(".adm-row-clickable").first().click();
  await page.waitForSelector(".adm-email-editor", {
    state: "visible",
    timeout: 10_000,
  });

  // Scroll to the very bottom of the page. The selected row is now even
  // further outside the viewport (above the fold, negative bounding rect).
  await page.evaluate(() =>
    window.scrollTo({ top: document.body.scrollHeight, behavior: "instant" }),
  );
  await page.waitForTimeout(100);

  // Confirm the row is off-screen before proceeding.
  const rectAfterScroll = await getRowRect(page, rowIndex);
  assert(
    rectAfterScroll.bottom < 0,
    "Pre-condition: selected row must be above the viewport after scrolling to page bottom",
    { rect: rectAfterScroll },
  );

  await clearScrollCalls(page);

  // Playwright's click() calls scrollIntoViewIfNeeded internally (not captured
  // by the spy) to reveal the close button before dispatching the mouse event.
  await page.locator('[aria-label="Close editor"]').click();
  await page.waitForTimeout(300);

  const calls = await readScrollCalls(page);
  const correctCall = calls.find(
    (c) => c.tag === "TR" && c.rowIndex === rowIndex,
  );
  assert(
    correctCall !== undefined,
    "scrollIntoView must be called on the exact selected row (by table-body index) even after scrolling past the editor",
    { calls, expectedRowIndex: rowIndex },
  );
}

async function main(): Promise<void> {
  const browser = await chromium.launch({
    headless: true,
    executablePath: chromiumExecutable(),
  });

  try {
    const cookie = await loginCookie();

    // 400 px viewport height: tall enough to show the table rows before
    // clicking, short enough that the editor (which opens below the table and
    // scrolls into view) reliably pushes the selected row above the fold.
    const context = await browser.newContext({
      viewport: { width: 1280, height: 400 },
    });
    await context.addCookies([cookie]);
    const page = await context.newPage();

    console.log(
      "\nEmail editor close button — scroll restoration (/admin/emails)",
    );

    await check(
      "row above the fold: scrollIntoView fires on the correct row after the editor pushes it off-screen",
      () => checkRowAboveFold(page),
    );

    await check(
      "off-screen after scroll: scrollIntoView fires on the correct row even after scrolling past the editor",
      () => checkOffScreenAfterScroll(page),
    );

    await context.close();
  } finally {
    await browser.close();
  }

  console.log(
    `\n${passed + failed} checks — ${passed} passed, ${failed} failed`,
  );

  if (failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
