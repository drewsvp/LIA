/**
 * CSS regression checks for the softened admin area styles.
 *
 * Verifies that the rounded-corner and box-shadow treatment added to match the
 * public site is still present on representative admin surfaces. A future CSS
 * edit that removes border-radius or box-shadow from key selectors will cause
 * this script to fail before staff see a broken layout.
 *
 * Covered surfaces
 *   /admin/organizations — org approval queue (adm-nav, adm-heading, tabs,
 *                          table and detail panel when data is present)
 *   /admin/requests      — request queue (adm-filterbtn type filter)
 *   /admin/email         — email log (adm-filter inputs, adm-email-detail)
 *
 * Usage:
 *   npm run test:admin-styles
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
    const message = detail !== undefined ? `${label}: ${JSON.stringify(detail)}` : label;
    throw new Error(message);
  }
}

function pass(label: string): void {
  passed += 1;
  console.log(`  ✓ ${label}`);
}

function fail(label: string, error: unknown): void {
  failed += 1;
  const message = error instanceof Error ? error.message : String(error);
  console.error(`  ✗ ${label}`);
  console.error(`    ${message.replace(/\n/g, "\n    ")}`);
}

function check(label: string, fn: () => void): void {
  try {
    fn();
    pass(label);
  } catch (error) {
    fail(label, error);
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

async function loginCookie(): Promise<Parameters<BrowserContext["addCookies"]>[0][number]> {
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
  const getSetCookie = (response.headers as Headers & { getSetCookie?: () => string[] })
    .getSetCookie;
  const values = typeof getSetCookie === "function" ? getSetCookie.call(response.headers) : [];
  const sessionCookie = values.find((v) => v.includes("session_token"));
  if (!sessionCookie) throw new Error("Quick login did not return a session cookie.");
  return parseCookie(sessionCookie);
}

type StyleResult = {
  exists: boolean;
  borderRadius: string;
  boxShadow: string;
  textTransform: string;
  borderColor: string;
  borderStyle: string;
};

/**
 * Extract computed style properties for a CSS selector. Returns exists=false
 * when the selector matches no element (data-dependent surfaces).
 */
async function getComputedStyles(page: Page, selector: string): Promise<StyleResult> {
  return page.evaluate((sel) => {
    const el = document.querySelector<HTMLElement>(sel);
    if (!el) {
      return {
        exists: false,
        borderRadius: "",
        boxShadow: "",
        textTransform: "",
        borderColor: "",
        borderStyle: "",
      };
    }
    const s = window.getComputedStyle(el);
    return {
      exists: true,
      borderRadius: s.borderRadius,
      boxShadow: s.boxShadow,
      textTransform: s.textTransform,
      borderColor: s.borderColor,
      borderStyle: s.borderStyle,
    };
  }, selector);
}

/**
 * Parse the first pixel value out of a computed border-radius string.
 * "8px 8px 8px 8px" → 8, "6px" → 6, "" → 0.
 */
function parseBorderRadius(value: string): number {
  const match = /^([\d.]+)px/.exec(value.trim());
  return match ? parseFloat(match[1]!) : 0;
}

async function checkOrganizationsPage(page: Page): Promise<void> {
  console.log("\nOrganizations page (/admin/organizations)");
  await page.goto(`${BASE}/admin/organizations`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".adm-nav", { state: "visible", timeout: 15_000 });

  // The heading must not carry text-transform: uppercase — the softened admin
  // style removed that decoration. This assertion will catch any accidental
  // revert to the old uppercased page titles.
  const headingStyles = await getComputedStyles(page, ".adm-heading");
  check("adm-heading is present", () => {
    assert(headingStyles.exists, "Expected an .adm-heading element on the organizations page.");
  });
  check("adm-heading has no text-transform: uppercase", () => {
    assert(
      headingStyles.textTransform !== "uppercase",
      "adm-heading must not have text-transform: uppercase — the softened admin style removed this.",
      { textTransform: headingStyles.textTransform },
    );
  });

  // Left-nav sidebar: the softened design adds a subtle right-edge shadow.
  const navStyles = await getComputedStyles(page, ".adm-nav");
  check("adm-nav has box-shadow (soft side shadow)", () => {
    assert(navStyles.exists, "Expected an .adm-nav element.");
    assert(
      navStyles.boxShadow !== "none" && navStyles.boxShadow !== "",
      "adm-nav must have a box-shadow — it was added as part of the visual softening.",
      { boxShadow: navStyles.boxShadow },
    );
  });

  // Tab bar always renders on the organizations page (Pending / Approved / Disabled).
  const tabStyles = await getComputedStyles(page, ".adm-tab-current");
  check("adm-tab-current is present", () => {
    assert(tabStyles.exists, "Expected an active .adm-tab-current element.");
  });

  // Data-dependent: the approval queue table only renders when there are orgs.
  const tableStyles = await getComputedStyles(page, ".adm-table");
  if (tableStyles.exists) {
    check("adm-table has border-radius >= 6px", () => {
      const radius = parseBorderRadius(tableStyles.borderRadius);
      assert(
        radius >= 6,
        "adm-table must have border-radius ≥ 6px — rounded corners were added as part of the visual softening.",
        { borderRadius: tableStyles.borderRadius },
      );
    });
    check("adm-table has box-shadow", () => {
      assert(
        tableStyles.boxShadow !== "none" && tableStyles.boxShadow !== "",
        "adm-table must have a box-shadow — it was added as part of the visual softening.",
        { boxShadow: tableStyles.boxShadow },
      );
    });
  } else {
    console.log("  – adm-table not present (no seeded rows visible); skipping table checks.");
  }

  // Data-dependent: detail panel renders only when a row is selected.
  const detailStyles = await getComputedStyles(page, ".adm-detail");
  if (detailStyles.exists) {
    check("adm-detail has border-radius >= 6px", () => {
      const radius = parseBorderRadius(detailStyles.borderRadius);
      assert(
        radius >= 6,
        "adm-detail must have border-radius ≥ 6px.",
        { borderRadius: detailStyles.borderRadius },
      );
    });
    check("adm-detail has box-shadow", () => {
      assert(
        detailStyles.boxShadow !== "none" && detailStyles.boxShadow !== "",
        "adm-detail must have a box-shadow.",
        { boxShadow: detailStyles.boxShadow },
      );
    });
  }
}

async function checkRequestsPage(page: Page): Promise<void> {
  console.log("\nRequests page (/admin/requests)");
  await page.goto(`${BASE}/admin/requests`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".adm-nav", { state: "visible", timeout: 15_000 });

  // The type filter buttons (All / Item / Volunteer) are always rendered
  // regardless of queue size. Their border-radius is a key part of the
  // softened filter pill style.
  const filterbtnStyles = await getComputedStyles(page, ".adm-filterbtn");
  check("adm-filterbtn is present", () => {
    assert(filterbtnStyles.exists, "Expected .adm-filterbtn elements in the type filter group.");
  });
  check("adm-filterbtn has border-radius >= 4px", () => {
    const radius = parseBorderRadius(filterbtnStyles.borderRadius);
    assert(
      radius >= 4,
      "adm-filterbtn must have border-radius ≥ 4px — rounded filter pills are part of the softened admin style.",
      { borderRadius: filterbtnStyles.borderRadius },
    );
  });

  // Action buttons when a row is selected.
  const btnStyles = await getComputedStyles(page, ".adm-btn");
  if (btnStyles.exists) {
    check("adm-btn has border-radius >= 4px", () => {
      const radius = parseBorderRadius(btnStyles.borderRadius);
      assert(
        radius >= 4,
        "adm-btn must have border-radius ≥ 4px.",
        { borderRadius: btnStyles.borderRadius },
      );
    });
  }

  // Request queue table (data-dependent).
  const tableStyles = await getComputedStyles(page, ".adm-table");
  if (tableStyles.exists) {
    check("adm-table has border-radius >= 6px (requests page)", () => {
      const radius = parseBorderRadius(tableStyles.borderRadius);
      assert(
        radius >= 6,
        "adm-table must have border-radius ≥ 6px.",
        { borderRadius: tableStyles.borderRadius },
      );
    });
    check("adm-table has box-shadow (requests page)", () => {
      assert(
        tableStyles.boxShadow !== "none" && tableStyles.boxShadow !== "",
        "adm-table must have a box-shadow.",
        { boxShadow: tableStyles.boxShadow },
      );
    });
  } else {
    console.log("  – adm-table not present (no seeded rows visible); skipping table checks.");
  }
}

async function checkEmailLogPage(page: Page): Promise<void> {
  console.log("\nEmail log page (/admin/email)");
  await page.goto(`${BASE}/admin/email`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".adm-nav", { state: "visible", timeout: 15_000 });

  // The adm-heading on the email page must not be uppercase.
  const headingStyles = await getComputedStyles(page, ".adm-heading");
  check("adm-heading has no text-transform: uppercase (email page)", () => {
    assert(headingStyles.exists, "Expected an .adm-heading on the email log page.");
    assert(
      headingStyles.textTransform !== "uppercase",
      "adm-heading must not have text-transform: uppercase on the email log page.",
      { textTransform: headingStyles.textTransform },
    );
  });

  // The filter row (Template / Status / Recipient / From / To selects and inputs)
  // is always rendered. The softened style gives them a warm-gray border instead
  // of the default browser border.
  const filterSelectStyles = await getComputedStyles(page, ".adm-filter select");
  check("adm-filter select is present", () => {
    assert(filterSelectStyles.exists, "Expected a <select> inside .adm-filter on the email log page.");
  });
  check("adm-filter select has explicit border-style (not browser default)", () => {
    assert(
      filterSelectStyles.borderStyle === "solid",
      "adm-filter select must have an explicit solid border — the softened admin style sets border: 1px solid #c8c4bc.",
      { borderStyle: filterSelectStyles.borderStyle },
    );
  });
  check("adm-filter select border-color is not pure black", () => {
    // Pure black "rgb(0, 0, 0)" would indicate the default unstyled browser
    // border fell through; the softened style sets a warm-gray #c8c4bc.
    assert(
      filterSelectStyles.borderColor !== "rgb(0, 0, 0)",
      "adm-filter select must not use a pure-black border — the softened style sets a warm-gray border color.",
      { borderColor: filterSelectStyles.borderColor },
    );
  });

  const filterInputStyles = await getComputedStyles(page, ".adm-filter input");
  if (filterInputStyles.exists) {
    check("adm-filter input has explicit solid border", () => {
      assert(
        filterInputStyles.borderStyle === "solid",
        "adm-filter input must have a solid border.",
        { borderStyle: filterInputStyles.borderStyle },
      );
    });
    check("adm-filter input border-color is not pure black", () => {
      assert(
        filterInputStyles.borderColor !== "rgb(0, 0, 0)",
        "adm-filter input must not use a pure-black border.",
        { borderColor: filterInputStyles.borderColor },
      );
    });
  }

  // Email detail panel (data-dependent: renders when a row is selected).
  const emailDetailStyles = await getComputedStyles(page, ".adm-email-detail");
  if (emailDetailStyles.exists) {
    check("adm-email-detail has border-radius >= 4px", () => {
      const radius = parseBorderRadius(emailDetailStyles.borderRadius);
      assert(
        radius >= 4,
        "adm-email-detail must have border-radius ≥ 4px.",
        { borderRadius: emailDetailStyles.borderRadius },
      );
    });
    check("adm-email-detail has box-shadow", () => {
      assert(
        emailDetailStyles.boxShadow !== "none" && emailDetailStyles.boxShadow !== "",
        "adm-email-detail must have a box-shadow.",
        { boxShadow: emailDetailStyles.boxShadow },
      );
    });
  }
}

async function main(): Promise<void> {
  const browser = await chromium.launch({
    headless: true,
    executablePath: chromiumExecutable(),
  });

  try {
    const cookie = await loginCookie();
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.addCookies([cookie]);
    const page = await context.newPage();

    await checkOrganizationsPage(page);
    await checkRequestsPage(page);
    await checkEmailLogPage(page);

    await context.close();
  } finally {
    await browser.close();
  }

  console.log(`\n${passed + failed} checks — ${passed} passed, ${failed} failed`);

  if (failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
