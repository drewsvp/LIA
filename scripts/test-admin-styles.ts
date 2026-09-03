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

async function loginCookie(
  role: "staff_admin" | "org_owner" = "staff_admin",
): Promise<Parameters<BrowserContext["addCookies"]>[0][number]> {
  const response = await fetch(`${BASE}/api/login/quick`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role }),
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

async function assertCenteredAction(page: Page, selector: string, label: string): Promise<void> {
  await page.waitForSelector(selector, { state: "visible", timeout: 15_000 });
  const layout = await page.locator(selector).first().evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const parentRect = element.parentElement!.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return {
      display: style.display,
      minHeight: style.minHeight,
      buttonCenter: rect.left + rect.width / 2,
      parentCenter: parentRect.left + parentRect.width / 2,
    };
  });
  check(label, () => {
    assert(layout.display === "flex", "Centered form action must remain block-level flex.", layout);
    assert(parseFloat(layout.minHeight) >= 40, "Centered form action must keep the shared hit target.", layout);
    assert(Math.abs(layout.buttonCenter - layout.parentCenter) <= 2, "Form action must remain horizontally centered.", layout);
  });
}

async function actionGroupLayout(page: Page, selector: string): Promise<{
  display: string;
  flexWrap: string;
  gap: number;
  buttonCount: number;
  labels: string[];
  separated: boolean;
  contained: boolean;
}> {
  await page.locator(selector).first().waitFor({ state: "visible", timeout: 15_000 });
  return page.locator(selector).first().evaluate((element) => {
    const style = window.getComputedStyle(element);
    const groupRect = element.getBoundingClientRect();
    const buttons = Array.from(element.children).filter(
      (child): child is HTMLElement => child instanceof HTMLElement && child.matches("button, a"),
    );
    const rects = buttons.map((button) => button.getBoundingClientRect());
    return {
      display: style.display,
      flexWrap: style.flexWrap,
      gap: parseFloat(style.columnGap || style.gap),
      buttonCount: buttons.length,
      labels: buttons.map((button) => button.textContent?.trim() ?? ""),
      separated: rects.every((current, index) => {
        if (index === 0) return true;
        const previous = rects[index - 1]!;
        return current.left - previous.right >= 8 || current.top - previous.bottom >= 8;
      }),
      contained:
        groupRect.left >= -1 &&
        groupRect.right <= window.innerWidth + 1 &&
        rects.every((rect) => rect.left >= groupRect.left - 1 && rect.right <= groupRect.right + 1),
    };
  });
}

function checkActionGroup(
  label: string,
  layout: Awaited<ReturnType<typeof actionGroupLayout>>,
  minimumButtons = 2,
): void {
  check(label, () => {
    assert(layout.display === "flex" || layout.display === "inline-flex", "Action group must use flex layout.", layout);
    assert(layout.flexWrap === "wrap", "Action group must wrap.", layout);
    assert(layout.gap >= 8, "Action group must keep a visible gap.", layout);
    assert(layout.buttonCount >= minimumButtons, "Action group must contain representative adjacent actions.", layout);
    assert(layout.separated, "Adjacent actions must not touch.", layout);
    assert(layout.contained, "Action group and its buttons must stay inside the viewport.", layout);
  });
}

async function checkCenteredMemberActions(browser: Awaited<ReturnType<typeof chromium.launch>>): Promise<void> {
  console.log("\nCentered member form actions");

  const anonymous = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const publicPage = await anonymous.newPage();
  await publicPage.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await assertCenteredAction(publicPage, ".mp1-submit", "login submit remains centered with shared geometry");
  await publicPage.goto(`${BASE}/signup`, { waitUntil: "domcontentloaded" });
  await assertCenteredAction(publicPage, ".mp3-submit", "signup submit remains centered with shared geometry");
  await anonymous.close();

  const owner = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await owner.addCookies([await loginCookie("org_owner")]);
  const memberPage = await owner.newPage();
  await memberPage.goto(`${BASE}/dashboard/organization`, { waitUntil: "domcontentloaded" });
  await assertCenteredAction(memberPage, ".mp5-submit", "member settings submit remains centered with shared geometry");
  const removableOption = memberPage.locator(".mp5-team-select option").filter({ hasNotText: "Click to see" }).first();
  if (await removableOption.count() > 0) {
    await memberPage.locator(".mp5-team-select").selectOption(await removableOption.getAttribute("value") ?? "");
    const removeButton = memberPage.getByRole("button", { name: "Remove User", exact: true });
    if (await removeButton.isEnabled()) {
      await removeButton.click();
      const memberConfirm = await actionGroupLayout(memberPage, ".mp5-confirm-actions");
      checkActionGroup("member removal confirmation keeps shared spacing", memberConfirm);
      await memberPage.getByRole("button", { name: "Cancel", exact: true }).click();
    } else {
      console.log("  – no removable seeded member; skipping member confirmation layout check.");
    }
  }
  await owner.close();
}

type StyleResult = {
  exists: boolean;
  borderRadius: string;
  boxShadow: string;
  textTransform: string;
  borderColor: string;
  borderStyle: string;
  display: string;
  minHeight: string;
  fontSize: string;
  fontWeight: string;
  letterSpacing: string;
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
        display: "",
        minHeight: "",
        fontSize: "",
        fontWeight: "",
        letterSpacing: "",
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
      display: s.display,
      minHeight: s.minHeight,
      fontSize: s.fontSize,
      fontWeight: s.fontWeight,
      letterSpacing: s.letterSpacing,
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

  // The editor is a data-dependent surface. When a seeded row is available,
  // open it so layout regressions in the actual form are covered as well as
  // the read-only detail panel.
  const firstRow = page.locator("tr.adm-row").first();
  if (await firstRow.count() > 0) {
    await firstRow.click();
    await page.getByRole("button", { name: "Edit organization", exact: true }).waitFor({ state: "visible" });
    await page.getByRole("button", { name: "Edit organization", exact: true }).click();
    await page.locator("form.adm-org-edit").waitFor({ state: "visible" });

    const editorStyles = await getComputedStyles(page, ".adm-org-edit");
    check("organization editor is present", () => {
      assert(editorStyles.exists, "Expected the organization editor after opening a seeded organization.");
    });

    const editGridLayout = await page.locator(".adm-edit-grid").first().evaluate((element) => {
      const style = window.getComputedStyle(element);
      return { display: style.display, gridTemplateColumns: style.gridTemplateColumns };
    });
    check("organization editor fields use a grid layout", () => {
      assert(editGridLayout.display === "grid", "Organization editor fields should remain a CSS grid.", editGridLayout);
    });

    const populationStyles = await getComputedStyles(page, ".adm-edit-populations");
    check("population editor has rounded fieldset styling", () => {
      assert(populationStyles.exists, "Expected the populations fieldset inside the organization editor.");
      assert(parseBorderRadius(populationStyles.borderRadius) >= 4, "Population fieldset should retain rounded corners.", {
        borderRadius: populationStyles.borderRadius,
      });
    });

    await page.setViewportSize({ width: 375, height: 800 });
    const mobileEditor = await page.evaluate(() => {
      const form = document.querySelector<HTMLElement>("form.adm-org-edit");
      const grid = document.querySelector<HTMLElement>(".adm-edit-grid");
      return {
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
        formRight: form?.getBoundingClientRect().right ?? null,
        gridColumns: grid ? window.getComputedStyle(grid).gridTemplateColumns.trim().split(/\s+/).length : 0,
      };
    });
    check("organization editor collapses to one column without mobile overflow", () => {
      assert(mobileEditor.documentWidth <= mobileEditor.viewportWidth, "Organization editor must not overflow at mobile width.", mobileEditor);
      assert(mobileEditor.formRight !== null && mobileEditor.formRight <= mobileEditor.viewportWidth + 1, "Organization editor must stay inside the mobile viewport.", mobileEditor);
      assert(mobileEditor.gridColumns === 1, "Organization editor fields must use one column at mobile width.", mobileEditor);
    });
    await page.setViewportSize({ width: 1280, height: 900 });
  } else {
    console.log("  – organization editor not present (no seeded rows visible); skipping editor checks.");
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
  check("request filters use the shared header-button contract", () => {
    assert(
      filterbtnStyles.display === "inline-flex" || filterbtnStyles.display === "flex",
      "Request filters must use the shared flex button layout.",
      filterbtnStyles,
    );
    assert(parseFloat(filterbtnStyles.minHeight) >= 40, "Request filters must retain a 40px minimum hit area.", filterbtnStyles);
    assert(filterbtnStyles.fontWeight === "700", "Request filters must use the compact bold button type.", filterbtnStyles);
    assert(filterbtnStyles.textTransform === "uppercase", "Request filters must use uppercase button labels.", filterbtnStyles);
  });

  const desktopFilterLayout = await page.evaluate(() => {
    const group = document.querySelector<HTMLElement>('.adm-filter[role="group"]');
    const buttons = Array.from(document.querySelectorAll<HTMLElement>(".adm-filterbtn"));
    const groupRect = group?.getBoundingClientRect();
    const style = group ? window.getComputedStyle(group) : null;
    return {
      groupWidth: groupRect?.width ?? 0,
      contentWidth: group?.parentElement?.getBoundingClientRect().width ?? 0,
      buttonWidths: buttons.map((button) => button.getBoundingClientRect().width),
      gap: style ? parseFloat(style.columnGap || style.gap) : 0,
      flexDirection: style?.flexDirection ?? "",
      flexWrap: style?.flexWrap ?? "",
    };
  });
  check("request filters are content-width buttons with visible gaps", () => {
    assert(desktopFilterLayout.flexDirection === "row", "Request filters must lay out in a row.", desktopFilterLayout);
    assert(desktopFilterLayout.flexWrap === "wrap", "Request filters must be allowed to wrap.", desktopFilterLayout);
    assert(desktopFilterLayout.gap >= 8, "Request filters must have a visible gap.", desktopFilterLayout);
    assert(
      desktopFilterLayout.groupWidth < desktopFilterLayout.contentWidth * 0.75,
      "Request filter group must not stretch across the page.",
      desktopFilterLayout,
    );
    assert(
      desktopFilterLayout.buttonWidths.every((width) => width < desktopFilterLayout.contentWidth * 0.5),
      "Each request filter must stay content-sized rather than rendering as a bar.",
      desktopFilterLayout,
    );
  });

  await page.locator(".adm-filterbtn").first().focus();
  const focusStyle = await page.locator(".adm-filterbtn").first().evaluate((element) => {
    const style = window.getComputedStyle(element);
    return { outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth, outlineOffset: style.outlineOffset };
  });
  check("request filters retain a visible keyboard focus ring", () => {
    assert(focusStyle.outlineStyle !== "none", "Focused request filter must have an outline.", focusStyle);
    assert(parseFloat(focusStyle.outlineWidth) >= 3, "Focused request filter outline must be at least 3px.", focusStyle);
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

  const requestRows = page.locator("tr.adm-row");
  assert(await requestRows.count() > 0, "Seeded pending requests are required for the action-spacing regression check.");
  let fourButtonRowFound = false;
  for (let index = 0; index < await requestRows.count(); index += 1) {
    await requestRows.nth(index).click();
    const actionRow = page.locator(".adm-detail .adm-actions").first();
    await actionRow.waitFor({ state: "visible", timeout: 10_000 });
    const labels = await actionRow.locator(":scope > .adm-btn").allTextContents();
    if (["Edit Request", "Approve", "Return to draft", "Archive"].every((label) => labels.some((text) => text.trim() === label))) {
      fourButtonRowFound = true;
      break;
    }
  }
  assert(fourButtonRowFound, "Expected a seeded pending request with Edit Request, Approve, Return to draft, and Archive.");

  const desktopActions = await actionGroupLayout(page, ".adm-detail .adm-actions");
  checkActionGroup("reported four-button request row has deliberate spacing and wrapping", desktopActions, 4);
  check("reported request row contains all four lifecycle actions", () => {
    assert(
      ["Edit Request", "Approve", "Return to draft", "Archive"].every((label) => desktopActions.labels.includes(label)),
      "The representative request row must exercise all four reported actions.",
      desktopActions,
    );
  });

  await page.getByRole("button", { name: "Archive", exact: true }).click();
  const desktopConfirm = await actionGroupLayout(page, ".adm-confirm .adm-btn-row");
  checkActionGroup("request destructive confirmation uses the shared action row", desktopConfirm);

  await page.setViewportSize({ width: 375, height: 800 });
  const mobileActions = await actionGroupLayout(page, ".adm-detail .adm-actions");
  checkActionGroup("request action row wraps and remains contained on mobile", mobileActions, 4);
  const mobileConfirm = await actionGroupLayout(page, ".adm-confirm .adm-btn-row");
  checkActionGroup("request confirmation wraps and remains contained on mobile", mobileConfirm);
  const mobileLayout = await page.evaluate(() => {
    const group = document.querySelector<HTMLElement>('.adm-filter[role="group"]');
    const actions = document.querySelector<HTMLElement>(".adm-detail .adm-actions");
    return {
      viewportWidth: window.innerWidth,
      groupLeft: group?.getBoundingClientRect().left ?? 0,
      groupRight: group?.getBoundingClientRect().right ?? 0,
      actionsLeft: actions?.getBoundingClientRect().left ?? 0,
      actionsRight: actions?.getBoundingClientRect().right ?? 0,
    };
  });
  check("request filters and actions do not overflow on mobile", () => {
    assert(mobileLayout.groupLeft >= 0, "Request filters must not overflow the left edge.", mobileLayout);
    assert(mobileLayout.groupRight <= mobileLayout.viewportWidth + 1, "Request filters must stay in the viewport.", mobileLayout);
    assert(
      mobileLayout.actionsRight === 0 ||
        (mobileLayout.actionsLeft >= 0 && mobileLayout.actionsRight <= mobileLayout.viewportWidth + 1),
      "Request action group must stay in the viewport.",
      mobileLayout,
    );
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole("button", { name: "Cancel", exact: true }).click();

  // Restore keyboard modality after the pointer-driven request checks so
  // Chromium applies :focus-visible when the synthetic pager receives focus.
  await page.keyboard.press("Tab");
  const compactPager = await page.evaluate(() => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ui-btn ui-btn-secondary ui-btn-compact mp12-pager-btn";
    button.textContent = "←";
    document.body.append(button);
    button.focus();
    const style = window.getComputedStyle(button);
    const result = {
      minHeight: style.minHeight,
      height: button.getBoundingClientRect().height,
      borderRadius: style.borderRadius,
      fontSize: style.fontSize,
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
    };
    button.remove();
    return result;
  });
  check("member volunteer pager uses the compact shared button contract", () => {
    assert(parseFloat(compactPager.minHeight) >= 40, "Pager must keep a 40px minimum hit target.", compactPager);
    assert(compactPager.height >= 40, "Pager rendered height must be at least 40px.", compactPager);
    assert(parseBorderRadius(compactPager.borderRadius) >= 5, "Pager must use the shared rounded geometry.", compactPager);
    assert(parseFloat(compactPager.fontSize) <= 12, "Compact pager must use compact button typography.", compactPager);
    assert(compactPager.outlineStyle !== "none", "Focused pager must have an outline.", compactPager);
    assert(parseFloat(compactPager.outlineWidth) >= 3, "Focused pager outline must be at least 3px.", compactPager);
  });

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

async function checkSubscriberActions(page: Page): Promise<void> {
  console.log("\nSubscriber actions (/admin/subscribers)");
  await page.goto(`${BASE}/admin/subscribers`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".adm-nav", { state: "visible", timeout: 15_000 });

  const exportButton = page.getByRole("button", { name: "Export", exact: true });
  await exportButton.waitFor({ state: "visible", timeout: 15_000 });
  const exportStyles = await getComputedStyles(page, "button.adm-btn");
  check("subscriber export uses shared action geometry", () => {
    assert(exportStyles.exists, "Expected the subscriber Export action to use .adm-btn.", exportStyles);
    assert(parseFloat(exportStyles.minHeight) >= 40, "Subscriber Export must have a 40px minimum hit target.", exportStyles);
    assert(exportStyles.fontWeight === "700", "Subscriber Export must use shared bold typography.", exportStyles);
    assert(exportStyles.textTransform === "uppercase", "Subscriber Export must use shared uppercase typography.", exportStyles);
  });

  await exportButton.focus();
  const exportFocus = await exportButton.evaluate((element) => {
    const style = window.getComputedStyle(element);
    return { outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth };
  });
  check("subscriber export retains shared keyboard focus feedback", () => {
    assert(exportFocus.outlineStyle !== "none", "Focused subscriber Export must have an outline.", exportFocus);
    assert(parseFloat(exportFocus.outlineWidth) >= 3, "Subscriber Export outline must be at least 3px.", exportFocus);
  });

  const unsubscribe = page.getByRole("button", { name: "Unsubscribe", exact: true }).first();
  if (await unsubscribe.count() > 0) {
    const styles = await unsubscribe.evaluate((element) => {
      const style = window.getComputedStyle(element);
      return { color: style.color, borderColor: style.borderColor, minHeight: style.minHeight };
    });
    check("subscriber unsubscribe remains visually destructive", () => {
      assert(styles.color === "rgb(164, 38, 44)", "Unsubscribe must use the destructive red treatment.", styles);
      assert(styles.borderColor === "rgb(164, 38, 44)", "Unsubscribe must use a destructive red border.", styles);
      assert(parseFloat(styles.minHeight) >= 40, "Unsubscribe must retain the shared hit target.", styles);
    });
  }
}

async function main(): Promise<void> {
  const browser = await chromium.launch({
    headless: true,
    executablePath: chromiumExecutable(),
  });

  try {
    await checkCenteredMemberActions(browser);
    const cookie = await loginCookie();
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.addCookies([cookie]);
    const page = await context.newPage();

    await checkOrganizationsPage(page);
    await checkRequestsPage(page);
    await checkEmailLogPage(page);
    await checkSubscriberActions(page);

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
