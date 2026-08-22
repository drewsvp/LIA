/**
 * Browser regression checks for the Automated Emails table row-expansion
 * interaction model.
 *
 * Covers:
 *   1. Clicking a non-auth row expands the editor section below the table.
 *   2. Clicking the same row again collapses the editor (toggle).
 *   3. The close (×) button collapses the editor and scrolls back.
 *   4. Auth-infrastructure rows are not clickable and do not expand.
 *   5. Clicking a status pill shows the inline confirm dialog.
 *   6. Cancel dismisses the confirm without changing state.
 *   7. Confirm calls the toggle and updates the pill label.
 *   8. Editing copy and switching rows shows a dirty-state guard dialog;
 *      "Keep editing" preserves the draft, "Discard changes" proceeds.
 *   9. Editing copy and clicking close (×) shows the same dirty-state guard;
 *      "Keep editing" keeps the editor open, "Discard changes" closes it.
 *  10. Restoring built-in copy syncs the draft — no phantom dirty flag on close.
 *
 * Usage:
 *   npm run test:email-row-expansion
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

async function loginCookie(): Promise<BrowserCookie> {
  const response = await fetch(`${BASE}/api/login/quick`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role: "staff_admin" }),
  });
  if (!response.ok)
    throw new Error(`Quick login failed: HTTP ${response.status}`);
  const getSetCookie = (
    response.headers as Headers & { getSetCookie?: () => string[] }
  ).getSetCookie;
  const values =
    typeof getSetCookie === "function" ? getSetCookie.call(response.headers) : [];
  const sessionCookie = values.find((v) => v.includes("session_token"));
  if (!sessionCookie)
    throw new Error("Quick login did not return a session cookie.");
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
    const cookie = await loginCookie();

    // ── Case 1: Non-auth row click expands the editor ──────────────────────
    await runCase(
      "clicking a non-auth row expands the editor section below the table",
      async () => {
        const ctx = await newCtx(browser, cookie);
        try {
          const page = await ctx.newPage();
          await page.goto(`${BASE}/admin/emails`, { waitUntil: "networkidle" });

          const rows = page.locator(".adm-row-clickable");
          const count = await rows.count();
          assert(count > 0, "page must have at least one clickable (non-auth) row", count);

          // Editor must not be visible before clicking
          assert(
            (await page.locator(".adm-email-editor").count()) === 0,
            "editor section is not rendered before any row is clicked",
          );

          await rows.first().click();

          const editor = page.locator(".adm-email-editor");
          await editor.waitFor({ state: "visible", timeout: 5_000 });

          assert(
            await editor.isVisible(),
            "editor section is visible after clicking a non-auth row",
          );
        } finally {
          await ctx.close();
        }
      },
    );

    // ── Case 2: Clicking the same row again collapses the editor ───────────
    await runCase(
      "clicking the same row a second time collapses the editor (toggle)",
      async () => {
        const ctx = await newCtx(browser, cookie);
        try {
          const page = await ctx.newPage();
          await page.goto(`${BASE}/admin/emails`, { waitUntil: "networkidle" });

          const row = page.locator(".adm-row-clickable").first();

          // First click — expand
          await row.click();
          await page.locator(".adm-email-editor").waitFor({ state: "visible", timeout: 5_000 });

          // Second click — collapse
          await row.click();
          await page.locator(".adm-email-editor").waitFor({ state: "hidden", timeout: 5_000 });

          assert(
            (await page.locator(".adm-email-editor").count()) === 0,
            "editor section is removed after clicking the selected row a second time",
          );
        } finally {
          await ctx.close();
        }
      },
    );

    // ── Case 3: Close (×) button collapses the editor ─────────────────────
    await runCase(
      "the close (×) button collapses the editor",
      async () => {
        const ctx = await newCtx(browser, cookie);
        try {
          const page = await ctx.newPage();
          await page.goto(`${BASE}/admin/emails`, { waitUntil: "networkidle" });

          // Open the editor
          await page.locator(".adm-row-clickable").first().click();
          await page.locator(".adm-email-editor").waitFor({ state: "visible", timeout: 5_000 });

          // Click the close button
          const closeBtn = page.locator('[aria-label="Close editor"]');
          await closeBtn.waitFor({ state: "visible", timeout: 3_000 });
          await closeBtn.click();

          await page.locator(".adm-email-editor").waitFor({ state: "hidden", timeout: 5_000 });

          assert(
            (await page.locator(".adm-email-editor").count()) === 0,
            "editor section is removed after clicking the close button",
          );
        } finally {
          await ctx.close();
        }
      },
    );

    // ── Case 4: Auth-infrastructure rows do not expand ────────────────────
    await runCase(
      "auth-infrastructure rows cannot be clicked and do not expand the editor",
      async () => {
        const ctx = await newCtx(browser, cookie);
        try {
          const page = await ctx.newPage();
          await page.goto(`${BASE}/admin/emails`, { waitUntil: "networkidle" });

          const authRows = page.locator(".adm-row-fixed");
          const authCount = await authRows.count();
          assert(
            authCount > 0,
            "page must have at least one auth-infrastructure row (adm-row-fixed)",
            authCount,
          );

          // Verify auth row shows "Always on" and no chevron
          const alwaysOn = authRows.first().locator(".adm-status-always-on");
          await alwaysOn.waitFor({ state: "visible", timeout: 3_000 });
          assert(
            (await authRows.first().locator(".adm-row-chevron").count()) === 0,
            "auth row has no expand chevron",
          );

          // Click the auth row — editor must NOT appear
          await authRows.first().click();

          // Allow a render cycle
          await page.waitForTimeout(500);

          assert(
            (await page.locator(".adm-email-editor").count()) === 0,
            "editor section does not appear after clicking an auth-infrastructure row",
          );
        } finally {
          await ctx.close();
        }
      },
    );

    // ── Case 5: Status pill click shows the inline confirm dialog ─────────
    await runCase(
      "clicking a status pill shows the inline confirm dialog",
      async () => {
        const ctx = await newCtx(browser, cookie);
        try {
          const page = await ctx.newPage();
          await page.goto(`${BASE}/admin/emails`, { waitUntil: "networkidle" });

          const pill = page.locator(".adm-status-pill").first();
          await pill.waitFor({ state: "visible", timeout: 5_000 });
          await pill.click();

          const confirm = page.locator(".adm-status-confirm");
          await confirm.waitFor({ state: "visible", timeout: 3_000 });

          // Confirm text should say "Turn off this email?" or "Turn on this email?"
          const confirmText = await page.locator(".adm-status-confirm-text").first().textContent();
          assert(
            confirmText?.includes("Turn") && confirmText.includes("this email?"),
            "confirm dialog shows the expected prompt text",
            confirmText,
          );

          // Editor should not have opened — pill click must stop propagation
          assert(
            (await page.locator(".adm-email-editor").count()) === 0,
            "editor section does not open when a status pill is clicked (stopPropagation)",
          );
        } finally {
          await ctx.close();
        }
      },
    );

    // ── Case 6: Cancel dismisses the confirm without changing state ────────
    await runCase(
      "Cancel dismisses the confirm dialog without changing the pill state",
      async () => {
        const ctx = await newCtx(browser, cookie);
        try {
          const page = await ctx.newPage();
          await page.goto(`${BASE}/admin/emails`, { waitUntil: "networkidle" });

          const pill = page.locator(".adm-status-pill").first();
          const originalLabel = (await pill.textContent())?.trim() ?? "";
          assert(
            originalLabel === "Enabled" || originalLabel === "Disabled",
            "status pill shows a known label before clicking",
            originalLabel,
          );

          await pill.click();
          await page.locator(".adm-status-confirm").waitFor({ state: "visible", timeout: 3_000 });

          // Click Cancel
          const cancelBtn = page.locator(".adm-status-confirm .adm-btn-outline.adm-btn-sm");
          await cancelBtn.waitFor({ state: "visible", timeout: 3_000 });
          await cancelBtn.click();

          // Confirm UI must disappear
          await page.locator(".adm-status-confirm").waitFor({ state: "hidden", timeout: 3_000 });

          // Pill must reappear with the original label
          const restoredPill = page.locator(".adm-status-pill").first();
          await restoredPill.waitFor({ state: "visible", timeout: 3_000 });
          const restoredLabel = (await restoredPill.textContent())?.trim() ?? "";
          assert(
            restoredLabel === originalLabel,
            "pill label is unchanged after Cancel",
            { originalLabel, restoredLabel },
          );
        } finally {
          await ctx.close();
        }
      },
    );

    // ── Case 8: Dirty-state guard fires when switching rows or closing with unsaved edits ──
    //
    // When a staff member edits the subject or body and then clicks a different
    // row (or the close button), the editor must show a guard dialog
    // (.adm-dirty-guard) before discarding the draft. The guard offers:
    //   • "Keep editing" — dismisses the dialog, leaves the current editor open
    //     with the unsaved edit still present.
    //   • "Discard changes" — proceeds with the row switch and resets the draft.
    await runCase(
      "editing copy and clicking a different row shows the dirty-state guard dialog",
      async () => {
        const ctx = await newCtx(browser, cookie);
        try {
          const page = await ctx.newPage();
          await page.goto(`${BASE}/admin/emails`, { waitUntil: "networkidle" });

          const rows = page.locator(".adm-row-clickable");
          const rowCount = await rows.count();
          assert(
            rowCount >= 2,
            "page must have at least two clickable rows to test row switching",
            rowCount,
          );

          // Open the first row's editor.
          await rows.first().click();
          await page.locator(".adm-email-editor").waitFor({ state: "visible", timeout: 5_000 });

          // Edit the subject field to make the draft dirty.
          // Use the label text to avoid accidentally targeting a recipients input
          // that appears before the subject when recipientsConfigurable is true.
          const subjectInput = page
            .locator(".adm-email-editor label")
            .filter({ hasText: /^Subject/ })
            .locator("input[type='text']");
          await subjectInput.waitFor({ state: "visible", timeout: 3_000 });
          const originalSubject = await subjectInput.inputValue();
          await subjectInput.fill(originalSubject + " UNSAVED_EDIT");

          const editedValue = await subjectInput.inputValue();
          assert(
            editedValue.includes("UNSAVED_EDIT"),
            "subject field contains the unsaved edit before row switch",
            editedValue,
          );

          // Click a different row — guard must appear.
          await rows.nth(1).click();

          const guard = page.locator(".adm-dirty-guard");
          await guard.waitFor({ state: "visible", timeout: 3_000 });
          assert(
            await guard.isVisible(),
            "dirty-state guard dialog appears after clicking a different row with unsaved edits",
          );

          // ── Sub-case A: "Keep editing" dismisses the guard and preserves the draft ──
          const keepBtn = guard.locator("text=Keep editing");
          await keepBtn.waitFor({ state: "visible", timeout: 3_000 });
          await keepBtn.click();

          await page.locator(".adm-dirty-guard").waitFor({ state: "hidden", timeout: 3_000 });
          assert(
            (await page.locator(".adm-dirty-guard").count()) === 0,
            "guard dialog is gone after clicking 'Keep editing'",
          );

          // Editor must still show the first row's unsaved edit.
          const stillEditing = await page
            .locator(".adm-email-editor label")
            .filter({ hasText: /^Subject/ })
            .locator("input[type='text']")
            .inputValue();
          assert(
            stillEditing.includes("UNSAVED_EDIT"),
            "'Keep editing' leaves the unsaved edit intact in the editor",
            { stillEditing },
          );

          // ── Sub-case B: "Discard changes" proceeds with the row switch ──
          // Click the second row again to re-trigger the guard.
          await rows.nth(1).click();
          const guard2 = page.locator(".adm-dirty-guard");
          await guard2.waitFor({ state: "visible", timeout: 3_000 });

          const discardBtn = guard2.locator("text=Discard changes");
          await discardBtn.waitFor({ state: "visible", timeout: 3_000 });
          await discardBtn.click();

          // Guard must disappear and the editor must now show the second row.
          await page.locator(".adm-dirty-guard").waitFor({ state: "hidden", timeout: 3_000 });
          await page
            .locator(".adm-email-editor")
            .waitFor({ state: "visible", timeout: 5_000 });

          const newSubjectValue = await page
            .locator(".adm-email-editor input[type='text']")
            .first()
            .inputValue();
          assert(
            !newSubjectValue.includes("UNSAVED_EDIT"),
            "'Discard changes' switches to the new row and the unsaved edit is gone",
            { newSubjectValue },
          );
        } finally {
          await ctx.close();
        }
      },
    );

    // ── Case 9: Dirty-state guard fires when clicking close (×) with unsaved edits ──
    //
    // The guard introduced for row switches (Case 8) also covers the close (×)
    // button. Clicking close with a dirty draft must show the .adm-dirty-guard
    // modal. "Keep editing" dismisses it and leaves the editor open with the
    // unsaved edit intact. "Discard changes" closes the editor and discards the
    // draft.
    await runCase(
      "editing copy and clicking close (×) shows the dirty-state guard dialog",
      async () => {
        const ctx = await newCtx(browser, cookie);
        try {
          const page = await ctx.newPage();
          await page.goto(`${BASE}/admin/emails`, { waitUntil: "networkidle" });

          // Open the first row's editor.
          await page.locator(".adm-row-clickable").first().click();
          await page.locator(".adm-email-editor").waitFor({ state: "visible", timeout: 5_000 });

          // Edit the subject field to make the draft dirty.
          const subjectInput = page
            .locator(".adm-email-editor label")
            .filter({ hasText: /^Subject/ })
            .locator("input[type='text']");
          await subjectInput.waitFor({ state: "visible", timeout: 3_000 });
          const originalSubject = await subjectInput.inputValue();
          await subjectInput.fill(originalSubject + " UNSAVED_CLOSE_EDIT");

          assert(
            (await subjectInput.inputValue()).includes("UNSAVED_CLOSE_EDIT"),
            "subject field contains the unsaved edit before clicking close",
          );

          // Click the close (×) button — guard must appear.
          const closeBtn = page.locator('[aria-label="Close editor"]');
          await closeBtn.waitFor({ state: "visible", timeout: 3_000 });
          await closeBtn.click();

          const guard = page.locator(".adm-dirty-guard");
          await guard.waitFor({ state: "visible", timeout: 3_000 });
          assert(
            await guard.isVisible(),
            "dirty-state guard dialog appears after clicking close with unsaved edits",
          );

          // ── Sub-case A: "Keep editing" dismisses the guard, editor stays open ──
          const keepBtn = guard.locator("text=Keep editing");
          await keepBtn.waitFor({ state: "visible", timeout: 3_000 });
          await keepBtn.click();

          await page.locator(".adm-dirty-guard").waitFor({ state: "hidden", timeout: 3_000 });
          assert(
            (await page.locator(".adm-email-editor").count()) > 0,
            "'Keep editing' leaves the editor open",
          );
          assert(
            (await page
              .locator(".adm-email-editor label")
              .filter({ hasText: /^Subject/ })
              .locator("input[type='text']")
              .inputValue()).includes("UNSAVED_CLOSE_EDIT"),
            "'Keep editing' leaves the unsaved edit intact",
          );

          // ── Sub-case B: "Discard changes" closes the editor ──
          await closeBtn.click();
          const guard2 = page.locator(".adm-dirty-guard");
          await guard2.waitFor({ state: "visible", timeout: 3_000 });

          const discardBtn = guard2.locator("text=Discard changes");
          await discardBtn.waitFor({ state: "visible", timeout: 3_000 });
          await discardBtn.click();

          await page.locator(".adm-dirty-guard").waitFor({ state: "hidden", timeout: 3_000 });
          assert(
            (await page.locator(".adm-email-editor").count()) === 0,
            "'Discard changes' closes the editor",
          );

          // Reopen the row to confirm the draft was discarded (not auto-saved).
          await page.locator(".adm-row-clickable").first().click();
          await page.locator(".adm-email-editor").waitFor({ state: "visible", timeout: 5_000 });
          const reopenedSubject = await page
            .locator(".adm-email-editor label")
            .filter({ hasText: /^Subject/ })
            .locator("input[type='text']")
            .inputValue();
          assert(
            !reopenedSubject.includes("UNSAVED_CLOSE_EDIT"),
            "after discard and reopen the subject shows the stored value, not the discarded draft",
            { reopenedSubject },
          );
        } finally {
          await ctx.close();
        }
      },
    );

    // ── Case 7: Confirm fires the toggle and updates the pill ─────────────
    await runCase(
      "Confirm fires the toggle and the pill label reflects the new state",
      async () => {
        const ctx = await newCtx(browser, cookie);
        try {
          const page = await ctx.newPage();
          await page.goto(`${BASE}/admin/emails`, { waitUntil: "networkidle" });

          const pill = page.locator(".adm-status-pill").first();
          await pill.waitFor({ state: "visible", timeout: 5_000 });
          const originalLabel = (await pill.textContent())?.trim() ?? "";
          const expectedLabel = originalLabel === "Enabled" ? "Disabled" : "Enabled";

          await pill.click();
          await page.locator(".adm-status-confirm").waitFor({ state: "visible", timeout: 3_000 });

          // Click Confirm
          const confirmBtn = page.locator(".adm-status-confirm .adm-btn.adm-btn-sm");
          await confirmBtn.waitFor({ state: "visible", timeout: 3_000 });
          await confirmBtn.click();

          // Wait for the list to re-fetch and the pill to reflect the new state
          const updatedPill = page.locator(".adm-status-pill").first();
          await page.waitForFunction(
            ([sel, expected]) => {
              const el = document.querySelector(sel as string);
              return el?.textContent?.trim() === expected;
            },
            [".adm-status-pill", expectedLabel] as [string, string],
            { timeout: 8_000 },
          );

          const updatedLabel = (await updatedPill.textContent())?.trim() ?? "";
          assert(
            updatedLabel === expectedLabel,
            "pill label toggles after Confirm",
            { originalLabel, updatedLabel, expectedLabel },
          );

          // Restore the original state so the test leaves the DB clean
          await updatedPill.click();
          await page.locator(".adm-status-confirm").waitFor({ state: "visible", timeout: 3_000 });
          await page.locator(".adm-status-confirm .adm-btn.adm-btn-sm").click();
          await page.waitForFunction(
            ([sel, restored]) => {
              const el = document.querySelector(sel as string);
              return el?.textContent?.trim() === restored;
            },
            [".adm-status-pill", originalLabel] as [string, string],
            { timeout: 8_000 },
          );
        } finally {
          await ctx.close();
        }
      },
    );
    // ── Case 10: Restoring built-in copy syncs the draft — no phantom dirty flag ──
    //
    // After clicking "Restore built-in copy", the editor must show the default
    // copy (not the old override), isDirty must be false (no guard on close),
    // and reopening the template must still show the default copy.
    await runCase(
      "restoring built-in copy syncs the editor draft and leaves no unsaved-edit guard on close",
      async () => {
        const ctx = await newCtx(browser, cookie);
        try {
          const page = await ctx.newPage();
          await page.goto(`${BASE}/admin/emails`, { waitUntil: "networkidle" });

          // Open the first clickable row.
          const rows = page.locator(".adm-row-clickable");
          await rows.first().click();
          await page.locator(".adm-email-editor").waitFor({ state: "visible", timeout: 5_000 });

          // Capture the default subject before any edits.
          const subjectLocator = page
            .locator(".adm-email-editor label")
            .filter({ hasText: /^Subject/ })
            .locator("input[type='text']");
          await subjectLocator.waitFor({ state: "visible", timeout: 3_000 });
          const defaultSubject = await subjectLocator.inputValue();

          // Save a custom override so "Restore built-in copy" appears.
          await subjectLocator.fill(defaultSubject + " OVERRIDE_FOR_RESTORE_TEST");
          const saveBtn = page.locator(".adm-email-editor .adm-btn-row .adm-btn").first();
          await saveBtn.waitFor({ state: "visible", timeout: 3_000 });
          await saveBtn.click();
          // Wait for the success message to confirm the save landed.
          await page.locator(".adm-result").waitFor({ state: "visible", timeout: 8_000 });

          // "Restore built-in copy" button must now be visible.
          const restoreBtn = page.locator("button", { hasText: "Restore built-in copy" });
          await restoreBtn.waitFor({ state: "visible", timeout: 5_000 });
          await restoreBtn.click();
          await page.locator(".adm-result").waitFor({ state: "visible", timeout: 8_000 });

          // The draft must now show the default subject, not the saved override.
          const restoredSubject = await subjectLocator.inputValue();
          assert(
            !restoredSubject.includes("OVERRIDE_FOR_RESTORE_TEST"),
            "draft subject shows default copy after restore, not the saved override",
            { restoredSubject },
          );
          assert(
            restoredSubject === defaultSubject,
            "draft subject matches the original default subject after restore",
            { restoredSubject, defaultSubject },
          );

          // isDirty must be false — clicking close must NOT show the guard.
          const closeBtn = page.locator('[aria-label="Close editor"]');
          await closeBtn.click();
          await page.waitForTimeout(400);
          assert(
            (await page.locator(".adm-dirty-guard").count()) === 0,
            "no dirty-state guard appears on close after restore — draft is clean",
          );
          await page.locator(".adm-email-editor").waitFor({ state: "hidden", timeout: 5_000 });

          // Reopen the row to confirm the override is truly gone server-side.
          await rows.first().click();
          await page.locator(".adm-email-editor").waitFor({ state: "visible", timeout: 5_000 });
          const reopenedSubject = await subjectLocator.inputValue();
          assert(
            !reopenedSubject.includes("OVERRIDE_FOR_RESTORE_TEST"),
            "reopening after restore still shows default copy — override was not re-applied",
            { reopenedSubject },
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
