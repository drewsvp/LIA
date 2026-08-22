/**
 * Browser regression test — Task 292.
 *
 * Confirms the login page shows a visible error message when the magic-link
 * endpoint returns an HTTP error, rather than silently freezing or showing
 * a false "check your email" success message.
 *
 * Strategy: use Playwright's route interception to stub
 * /api/login/magic-link without touching the real server or DB. Two cases
 * are exercised:
 *
 *   Case A — 500 with a JSON body containing "message": the page renders
 *             that message verbatim inside the alert element.
 *   Case B — 500 with an empty body (no JSON): the page falls back to the
 *             generic "Something went wrong…" copy.
 *
 * In both cases the test also confirms:
 *   • The "Check your email" success state is NOT shown.
 *   • The submit button returns to its idle label ("Send Login Link"), i.e.
 *     the spinner clears and the form is not frozen.
 *
 * Usage:
 *   npm run test:login-error-ui
 *
 * Requires the development server to be running. Does not require the seed
 * to have been run — the login page is public and the endpoint is intercepted
 * before any real network call is made.
 */
import { execFileSync } from "node:child_process";
import { chromium } from "playwright";

const BASE = process.env.REPLIT_DEV_DOMAIN
  ? `https://${process.env.REPLIT_DEV_DOMAIN}`
  : "http://127.0.0.1:5000";

let passed = 0;
let failed = 0;

function pass(label: string): void {
  console.log(`  ✓ ${label}`);
  passed++;
}

function fail(label: string, detail?: unknown): void {
  const extra = detail !== undefined ? `: ${JSON.stringify(detail)}` : "";
  console.error(`  ✗ FAIL: ${label}${extra}`);
  failed++;
}

function assert(condition: unknown, label: string, detail?: unknown): void {
  if (condition) {
    pass(label);
  } else {
    fail(label, detail);
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

// Selector constants derived from LoginPage.tsx class names.
const SEL_FORM = ".mp1-form";
const SEL_EMAIL_INPUT = "#mp1-email";
const SEL_SUBMIT_BTN = ".mp1-submit";
const SEL_ERROR = ".mp1-error[role='alert']";
const SEL_SENT = ".mp1-sent[role='status']";

const FIXTURE_EMAIL = "zz.test-292@fixture.internal";

async function main(): Promise<void> {
  console.log(
    "\nTask 292 — Login page shows error message on magic-link send failure\n",
  );

  const browser = await chromium.launch({
    executablePath: chromiumExecutable(),
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    // ── Case A: 500 with a server-provided message ─────────────────────────
    console.log("Case A: 500 response with a JSON message field\n");

    const ctxA = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const pageA = await ctxA.newPage();

    // Intercept the magic-link POST before navigating so any preflight is
    // also caught. Return 500 with a specific message to confirm the component
    // reads body.message instead of treating every non-2xx as a silent error.
    await pageA.route("**/api/login/magic-link", async (route) => {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ message: "Email service is temporarily unavailable." }),
      });
    });

    await pageA.goto(`${BASE}/login`, { waitUntil: "networkidle" });

    // Confirm the form renders (page is public, not redirected).
    const formA = pageA.locator(SEL_FORM);
    await formA.waitFor({ state: "visible", timeout: 10_000 });
    pass("Case A: login form renders on page load");

    // Fill and submit.
    await pageA.locator(SEL_EMAIL_INPUT).fill(FIXTURE_EMAIL);
    await pageA.locator(SEL_SUBMIT_BTN).click();

    // Wait for the button to leave the submitting state.
    await pageA
      .locator(SEL_SUBMIT_BTN)
      .filter({ hasText: "Send Login Link" })
      .waitFor({ state: "visible", timeout: 8_000 });

    // Assert: error alert is visible with the server message.
    const errorElA = pageA.locator(SEL_ERROR);
    const errorTextA = await errorElA.textContent({ timeout: 5_000 }).catch(() => null);
    assert(
      typeof errorTextA === "string" && errorTextA.trim().length > 0,
      "Case A: error alert element is visible after 500",
      { text: errorTextA },
    );
    assert(
      errorTextA?.includes("Email service is temporarily unavailable."),
      "Case A: server-provided message is rendered verbatim",
      { text: errorTextA },
    );

    // Assert: success state is NOT shown.
    const sentVisibleA = await pageA.locator(SEL_SENT).isVisible().catch(() => false);
    assert(!sentVisibleA, "Case A: success 'Check your email' message is not shown");

    // Assert: submit button returned to idle state (not frozen).
    const btnLabelA = await pageA.locator(SEL_SUBMIT_BTN).textContent().catch(() => "");
    assert(
      btnLabelA?.trim() === "Send Login Link",
      "Case A: submit button returns to idle 'Send Login Link' label",
      { label: btnLabelA },
    );

    // Assert: submit button is no longer disabled.
    const btnDisabledA = await pageA.locator(SEL_SUBMIT_BTN).isDisabled().catch(() => true);
    assert(!btnDisabledA, "Case A: submit button is re-enabled after error");

    await ctxA.close();
    console.log("");

    // ── Case B: 500 with no usable body ────────────────────────────────────
    console.log("Case B: 500 response with empty body (generic fallback)\n");

    const ctxB = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const pageB = await ctxB.newPage();

    await pageB.route("**/api/login/magic-link", async (route) => {
      await route.fulfill({
        status: 500,
        contentType: "text/plain",
        body: "",
      });
    });

    await pageB.goto(`${BASE}/login`, { waitUntil: "networkidle" });
    await pageB.locator(SEL_FORM).waitFor({ state: "visible", timeout: 10_000 });
    pass("Case B: login form renders on page load");

    await pageB.locator(SEL_EMAIL_INPUT).fill(FIXTURE_EMAIL);
    await pageB.locator(SEL_SUBMIT_BTN).click();

    await pageB
      .locator(SEL_SUBMIT_BTN)
      .filter({ hasText: "Send Login Link" })
      .waitFor({ state: "visible", timeout: 8_000 });

    const errorElB = pageB.locator(SEL_ERROR);
    const errorTextB = await errorElB.textContent({ timeout: 5_000 }).catch(() => null);
    assert(
      typeof errorTextB === "string" && errorTextB.trim().length > 0,
      "Case B: error alert element is visible after 500 with empty body",
      { text: errorTextB },
    );
    assert(
      errorTextB?.includes("Something went wrong"),
      "Case B: generic fallback message is shown when body has no message field",
      { text: errorTextB },
    );

    // Assert: success state is NOT shown.
    const sentVisibleB = await pageB.locator(SEL_SENT).isVisible().catch(() => false);
    assert(!sentVisibleB, "Case B: success 'Check your email' message is not shown");

    // Assert: submit button returned to idle state.
    const btnLabelB = await pageB.locator(SEL_SUBMIT_BTN).textContent().catch(() => "");
    assert(
      btnLabelB?.trim() === "Send Login Link",
      "Case B: submit button returns to idle 'Send Login Link' label",
      { label: btnLabelB },
    );

    await ctxB.close();
    console.log("");

    // ── Case C: network error (fetch throws) ───────────────────────────────
    // Confirms the catch-branch also shows an error rather than a freeze.
    console.log("Case C: network-level failure (abort)\n");

    const ctxC = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const pageC = await ctxC.newPage();

    await pageC.route("**/api/login/magic-link", async (route) => {
      await route.abort("failed");
    });

    await pageC.goto(`${BASE}/login`, { waitUntil: "networkidle" });
    await pageC.locator(SEL_FORM).waitFor({ state: "visible", timeout: 10_000 });
    pass("Case C: login form renders on page load");

    await pageC.locator(SEL_EMAIL_INPUT).fill(FIXTURE_EMAIL);
    await pageC.locator(SEL_SUBMIT_BTN).click();

    await pageC
      .locator(SEL_SUBMIT_BTN)
      .filter({ hasText: "Send Login Link" })
      .waitFor({ state: "visible", timeout: 8_000 });

    const errorElC = pageC.locator(SEL_ERROR);
    const errorTextC = await errorElC.textContent({ timeout: 5_000 }).catch(() => null);
    assert(
      typeof errorTextC === "string" && errorTextC.trim().length > 0,
      "Case C: error alert element is visible after network failure",
      { text: errorTextC },
    );
    assert(
      errorTextC?.includes("Something went wrong"),
      "Case C: generic fallback message is shown on network error",
      { text: errorTextC },
    );

    const sentVisibleC = await pageC.locator(SEL_SENT).isVisible().catch(() => false);
    assert(!sentVisibleC, "Case C: success 'Check your email' message is not shown");

    // Assert: submit button returned to idle state (not frozen as "Sending Link…").
    const btnLabelC = await pageC.locator(SEL_SUBMIT_BTN).textContent().catch(() => "");
    assert(
      btnLabelC?.trim() === "Send Login Link",
      "Case C: submit button returns to idle 'Send Login Link' label",
      { label: btnLabelC },
    );

    // Assert: submit button is re-enabled.
    const btnDisabledC = await pageC.locator(SEL_SUBMIT_BTN).isDisabled().catch(() => true);
    assert(!btnDisabledC, "Case C: submit button is re-enabled after network error");

    await ctxC.close();
    console.log("");
  } finally {
    await browser.close();
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log(`${passed + failed} checks — ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
