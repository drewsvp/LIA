/**
 * Browser regression checks for the responsive global navigation.
 *
 * Covers signed-out, staff-admin and ordinary-member states at the two mobile
 * widths used for manual verification plus one pixel above the desktop
 * breakpoint.
 *
 * Usage:
 *   npm run test:responsive-nav
 *
 * The application must already be running in development mode. The script
 * creates a clearly marked, temporary organization so the seeded staff admin
 * has two memberships and therefore renders the real organization switcher.
 * That fixture is removed in a finally block, including after a failed check.
 */
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from "playwright";
import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { auth } from "../server/auth/auth";
import { SYSTEM, pool, q, withDbContext } from "../server/db/client";
import * as organizations from "../server/dal/organizations";
import * as memberships from "../server/dal/memberships";
import * as users from "../server/dal/users";

const BASE_URL =
  process.env.TEST_BASE_URL ??
  (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : "http://127.0.0.1:5000");
const STAFF_EMAIL = "tiffany@defendingthecause.org";
// A seeded organization owner: authenticated, one membership, no staff role —
// the ordinary member header (DASHBOARD and the user menu, no ADMIN, no
// switcher) that the staff-admin case cannot exercise.
const MEMBER_EMAIL = "dana@heartsandhands.example.org";
const ALLIANCE_HOMEPAGE = "https://www.defendingthecause.org";
const VIEWPORT_HEIGHT = 900;
const WIDTHS = [390, 719, 721] as const;
const PUBLIC_SIGNED_OUT = [
  { text: "ABOUT", href: "/about" },
  { text: "ALLIANCE HOMEPAGE", href: ALLIANCE_HOMEPAGE },
  { text: "MEMBER LOGIN", href: "/login" },
  { text: "PROVIDE AN ITEM", href: "/items" },
  { text: "VOLUNTEER", href: "/volunteer" },
] as const;
const PUBLIC_AUTHENTICATED = PUBLIC_SIGNED_OUT.filter(({ text }) => text !== "MEMBER LOGIN");

type AuthState = Awaited<ReturnType<BrowserContext["storageState"]>>;
type SessionExpectation =
  | { authenticated: false }
  // Validation runs can overlap, so staff may temporarily see another run's
  // isolated switcher fixture in addition to the membership this run creates.
  | { authenticated: true; staffRole: string | null; memberships: number; allowExtraMemberships?: boolean };
/** What the header must offer a given session. */
type NavExpectation = {
  /** Staff sessions get the ADMIN link; ordinary members must not. */
  admin: boolean;
  /** The organization name the switcher must list, or null when a single
   *  membership means no switcher renders at all. */
  switcherName: string | null;
};
type BrowserCookie = Parameters<BrowserContext["addCookies"]>[0][number];
type Fixture = {
  organizationId: string;
  membershipId: string;
  name: string;
  slug: string;
};

let passed = 0;
let failed = 0;

function assertThat(condition: boolean, message: string, detail?: string): asserts condition {
  if (!condition) {
    throw new Error(detail ? `${message}\n${detail}` : message);
  }
}

function exactText(text: string): RegExp {
  const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^\\s*${escaped}\\s*$`);
}

function chromiumExecutable(): string {
  const configured = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?.trim();
  if (configured) return configured;
  try {
    const detected = execFileSync("which", ["chromium"], { encoding: "utf8" }).trim();
    assertThat(detected !== "", "The configured Chromium executable path is empty.");
    return detected;
  } catch {
    throw new Error("Chromium is unavailable. Ensure the Replit system package `chromium` is installed.");
  }
}

async function waitForApplication(timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastFailure = "no response";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BASE_URL}/api/session`, {
        cache: "no-store",
        signal: AbortSignal.timeout(3_000),
      });
      if (response.ok) return;
      lastFailure = `HTTP ${response.status}`;
    } catch (error) {
      lastFailure = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Application did not become ready within ${timeoutMs / 1_000}s (${lastFailure}).`);
}

async function cleanupSwitcherFixture(fixture: Fixture): Promise<void> {
  await withDbContext(SYSTEM, async (client) => {
    const fixtureOrganizations = await q<{ id: string; name: string }>(
      client,
      `select id, name from organizations where id = $1 and slug = $2`,
      [fixture.organizationId, fixture.slug],
    );
    const organization = fixtureOrganizations[0];
    if (!organization) return;
    assertThat(
      organization.name === fixture.name,
      "Refusing to remove a fixture organization whose name changed during the run.",
      `Expected ${JSON.stringify(fixture.name)}, got ${JSON.stringify(organization.name)}.`,
    );

    const fixtureMemberships = await q<{ id: string }>(
      client,
      `select id from org_memberships where id = $1 and org_id = $2`,
      [fixture.membershipId, fixture.organizationId],
    );
    assertThat(
      fixtureMemberships.length === 1,
      "The responsive-navigation fixture membership disappeared or changed organizations during the run.",
    );

    await client.query(
      `delete from approval_events
        where (entity_type = 'org_membership' and entity_id = $1)
           or (entity_type = 'organization' and entity_id = $2)`,
      [fixture.membershipId, fixture.organizationId],
    );
    await client.query(`delete from org_memberships where id = $1 and org_id = $2`, [
      fixture.membershipId,
      fixture.organizationId,
    ]);
    await client.query(`delete from organizations where id = $1 and slug = $2`, [
      fixture.organizationId,
      fixture.slug,
    ]);
  });
}

async function createSwitcherFixture(): Promise<Fixture> {
  const staffUser = await users.findByEmail(SYSTEM, STAFF_EMAIL);
  assertThat(staffUser !== null, `Seeded staff admin ${STAFF_EMAIL} was not found. Run npm run db:seed first.`);
  const runId = randomUUID();
  const name = `zz_fixture Responsive navigation ${runId}`;
  const slug = `zz-fixture-responsive-navigation-${runId}`;

  return withDbContext(SYSTEM, async (client) => {
    const organization = await organizations.createInTx(client, {
      name,
      slug,
      mission: "Temporary browser-test fixture.",
    });
    await organizations.approveInTx(client, organization.id, staffUser.id);

    const membership = await memberships.createInTx(client, {
      orgId: organization.id,
      userId: staffUser.id,
      role: "member",
      invitedBy: staffUser.id,
    });
    await memberships.activateInTx(client, membership.id, staffUser.id);

    return { organizationId: organization.id, membershipId: membership.id, name, slug };
  });
}

async function waitForSession(page: Page, expected: SessionExpectation): Promise<void> {
  const sessionResponsePromise = page.waitForResponse((response) => {
    try {
      return new URL(response.url()).pathname === "/api/session";
    } catch {
      return false;
    }
  });

  const pageResponse = await page.goto(`${BASE_URL}/`, { waitUntil: "domcontentloaded" });
  assertThat(pageResponse !== null && pageResponse.ok(), "The application home page did not load successfully.");

  const sessionResponse = await sessionResponsePromise;
  assertThat(sessionResponse.ok(), `/api/session returned ${sessionResponse.status()}.`);
  const session = (await sessionResponse.json()) as {
    authenticated?: boolean;
    memberships?: unknown[];
    staffRole?: string | null;
  };

  assertThat(
    session.authenticated === expected.authenticated,
    `Expected authenticated=${expected.authenticated}, got ${JSON.stringify(session.authenticated)}.`,
  );
  if (expected.authenticated) {
    assertThat(
      (session.staffRole ?? null) === expected.staffRole,
      `Expected staffRole=${expected.staffRole ?? "none"}, got ${session.staffRole ?? "none"}.`,
    );
    const memberships = Array.isArray(session.memberships) ? session.memberships.length : 0;
    const membershipCountMatches = expected.allowExtraMemberships
      ? memberships >= expected.memberships
      : memberships === expected.memberships;
    assertThat(
      membershipCountMatches,
      expected.allowExtraMemberships
        ? `Expected at least ${expected.memberships} membership(s) for this fixture, got ${memberships}.`
        : `Expected ${expected.memberships} membership(s) for this fixture, got ${memberships}.`,
    );
    await page.waitForSelector(".site-nav-user-trigger", { state: "attached" });
  } else {
    await page.waitForSelector('.site-nav a[href="/login"]', { state: "attached" });
  }
}

async function assertNoHorizontalOverflow(page: Page, label: string): Promise<void> {
  const dimensions = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
    navigation: document.querySelector<HTMLElement>(".site-nav")?.scrollWidth ?? 0,
  }));
  const widest = Math.max(dimensions.document, dimensions.body, dimensions.navigation);
  assertThat(
    widest <= dimensions.viewport + 1,
    `${label} has horizontal overflow.`,
    `viewport=${dimensions.viewport}, document=${dimensions.document}, body=${dimensions.body}, navigation=${dimensions.navigation}`,
  );
}

async function assertLogoDoesNotOverlapControls(page: Page, label: string): Promise<void> {
  const layout = await page.evaluate(() => {
    const header = document.querySelector<HTMLElement>(".site-nav");
    const logo = document.querySelector<HTMLElement>(".site-nav-logo");
    if (!header || !logo) return null;

    const logoRect = logo.getBoundingClientRect();
    const controls = Array.from(header.querySelectorAll<HTMLElement>("a, button, select"))
      .filter((element) => !element.matches(".site-nav-logo") && element.closest(".site-nav-logo") === null)
      .filter((element) => {
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
      })
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          text: element.getAttribute("aria-label") ?? element.textContent?.trim() ?? element.tagName,
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
        };
      });

    return {
      logo: {
        left: logoRect.left,
        right: logoRect.right,
        top: logoRect.top,
        bottom: logoRect.bottom,
      },
      controls,
      viewport: window.innerWidth,
    };
  });

  assertThat(layout !== null, `${label} is missing the navigation header or logo.`);
  for (const control of layout.controls) {
    const overlaps =
      layout.logo.left < control.right - 0.5 &&
      layout.logo.right > control.left + 0.5 &&
      layout.logo.top < control.bottom - 0.5 &&
      layout.logo.bottom > control.top + 0.5;
    assertThat(
      !overlaps,
      `${label} logo overlaps ${JSON.stringify(control.text)}.`,
      `logo=${JSON.stringify(layout.logo)}, control=${JSON.stringify(control)}`,
    );
    assertThat(
      control.left >= -0.5 && control.right <= layout.viewport + 0.5,
      `${label} control ${JSON.stringify(control.text)} extends outside the viewport.`,
      `control=${JSON.stringify(control)}, viewport=${layout.viewport}`,
    );
  }
}

async function visibleTextCount(page: Page, text: string): Promise<number> {
  return page
    .locator(".site-nav a:visible, .site-nav button:visible")
    .filter({ hasText: exactText(text) })
    .count();
}

async function assertExactlyOneVisible(page: Page, text: string): Promise<void> {
  const count = await visibleTextCount(page, text);
  assertThat(count === 1, `Expected exactly one visible ${text} control, found ${count}.`);
}

async function assertPublicDestinations(page: Page, authenticated: boolean, mobile: boolean): Promise<void> {
  const expected = authenticated ? PUBLIC_AUTHENTICATED : PUBLIC_SIGNED_OUT;

  for (const destination of expected) {
    const link = page
      .locator(".site-nav a:visible")
      .filter({ hasText: exactText(destination.text) });
    assertThat(
      (await link.count()) === 1,
      `Expected exactly one visible ${destination.text} link.`,
    );
    assertThat(
      (await link.getAttribute("href")) === destination.href,
      `${destination.text} must target ${destination.href}.`,
      `Got ${JSON.stringify(await link.getAttribute("href"))}.`,
    );
    if (destination.text === "ALLIANCE HOMEPAGE") {
      assertThat((await link.getAttribute("target")) === "_blank", "ALLIANCE HOMEPAGE must open in a new tab.");
    }
  }

  if (mobile) {
    const panelItems = await page.locator(".site-nav-panel > a.site-nav-panel-item:visible").allTextContents();
    const actualOrder = panelItems.map((item) => item.trim());
    const expectedOrder = expected.map(({ text }) => text);
    assertThat(
      JSON.stringify(actualOrder) === JSON.stringify(expectedOrder),
      "Mobile public destinations are in the wrong order.",
      `Expected ${JSON.stringify(expectedOrder)}, got ${JSON.stringify(actualOrder)}.`,
    );
    return;
  }

  const topOrder = (await page.locator(".site-nav-top > a.site-nav-btn-cta:visible").allTextContents()).map((item) =>
    item.trim(),
  );
  const expectedTopOrder = authenticated ? [] : ["PROVIDE AN ITEM", "VOLUNTEER"];
  assertThat(
    JSON.stringify(topOrder) === JSON.stringify(expectedTopOrder),
    "Desktop primary public destinations are in the wrong order.",
    `Expected ${JSON.stringify(expectedTopOrder)}, got ${JSON.stringify(topOrder)}.`,
  );
  const rightOrder = (await page.locator(".site-nav-right > a.site-nav-link:visible").allTextContents()).map((item) =>
    item.trim(),
  );
  // Authenticated, the two public destinations move down into this row as
  // plain links because the floating row above now carries portal controls.
  const expectedRightOrder = authenticated
    ? ["ABOUT", "ALLIANCE HOMEPAGE", "PROVIDE AN ITEM", "VOLUNTEER"]
    : ["ABOUT", "ALLIANCE HOMEPAGE", "MEMBER LOGIN"];
  assertThat(
    JSON.stringify(rightOrder) === JSON.stringify(expectedRightOrder),
    "Desktop secondary public destinations are in the wrong order.",
    `Expected ${JSON.stringify(expectedRightOrder)}, got ${JSON.stringify(rightOrder)}.`,
  );
}

async function openMobileMenu(page: Page): Promise<void> {
  const hamburger = page.locator(".site-nav-mobile-controls > .site-nav-hamburger:visible");
  assertThat((await hamburger.count()) === 1, "Expected one visible mobile menu button.");
  assertThat((await hamburger.getAttribute("aria-expanded")) === "false", "Mobile menu should start closed.");
  await hamburger.click();
  await page.waitForSelector(".site-nav-panel");
  assertThat((await hamburger.getAttribute("aria-expanded")) === "true", "Mobile menu did not report its open state.");
}

async function assertSignedOutNavigation(page: Page, width: number): Promise<void> {
  const mobile = width <= 720;

  assertThat((await page.locator(".site-nav-user-trigger:visible").count()) === 0, "Signed-out navigation shows a user menu.");
  assertThat((await page.locator(".site-nav-switcher:visible").count()) === 0, "Signed-out navigation shows an org switcher.");

  if (mobile) {
    assertThat((await page.locator(".site-nav-stack:visible").count()) === 0, "Desktop navigation is visible at a mobile width.");
    await openMobileMenu(page);
  } else {
    assertThat((await page.locator(".site-nav-stack:visible").count()) === 1, "Desktop navigation is hidden above the breakpoint.");
    assertThat(
      (await page.locator(".site-nav-mobile-controls:visible").count()) === 0,
      "Mobile controls are visible above the breakpoint.",
    );
  }

  await assertPublicDestinations(page, false, mobile);
}

async function assertAuthenticatedNavigation(page: Page, width: number, expected: NavExpectation): Promise<void> {
  const mobile = width <= 720;
  const memberLoginCount = await page
    .locator(".site-nav a")
    .filter({ hasText: exactText("MEMBER LOGIN") })
    .count();
  assertThat(memberLoginCount === 0, `Authenticated navigation contains ${memberLoginCount} MEMBER LOGIN link(s).`);

  if (mobile) {
    assertThat((await page.locator(".site-nav-stack:visible").count()) === 0, "Desktop navigation is visible at a mobile width.");
    assertThat(
      (await page.locator(".site-nav-mobile-controls > a:visible").filter({ hasText: exactText("DASHBOARD") }).count()) === 1,
      "DASHBOARD is not in the mobile control row.",
    );
    assertThat(
      (await page.locator(".site-nav-mobile-controls > a:visible").filter({ hasText: exactText("ADMIN") }).count()) ===
        (expected.admin ? 1 : 0),
      expected.admin ? "ADMIN is not in the mobile control row." : "ADMIN is offered to a non-staff member.",
    );

    await openMobileMenu(page);
    assertThat(
      (await page.locator(".site-nav-panel > .site-nav-switcher-mobile:visible").count()) ===
        (expected.switcherName === null ? 0 : 1),
      expected.switcherName === null
        ? "A single-membership session renders an organization switcher."
        : "Organization switcher is not in the mobile panel.",
    );
    assertThat(
      (await page.locator(".site-nav-panel > .site-nav-user:visible").count()) === 1,
      "User menu is not in the mobile panel.",
    );
  } else {
    assertThat((await page.locator(".site-nav-stack:visible").count()) === 1, "Desktop navigation is hidden above the breakpoint.");
    assertThat(
      (await page.locator(".site-nav-mobile-controls:visible").count()) === 0,
      "Mobile controls are visible above the breakpoint.",
    );
    assertThat(
      (await page.locator(".site-nav-right > .site-nav-switcher:visible").count()) ===
        (expected.switcherName === null ? 0 : 1),
      expected.switcherName === null
        ? "A single-membership session renders an organization switcher."
        : "Organization switcher is not in the desktop utility row.",
    );
    // Authenticated, the portal controls live in the floating top row — the
    // same place the two public CTAs occupy when signed out.
    assertThat(
      (await page.locator(".site-nav-top > a:visible").filter({ hasText: exactText("DASHBOARD") }).count()) === 1,
      "DASHBOARD is not in the desktop top row.",
    );
    assertThat(
      (await page.locator(".site-nav-top > a:visible").filter({ hasText: exactText("ADMIN") }).count()) ===
        (expected.admin ? 1 : 0),
      expected.admin ? "ADMIN is not in the desktop top row." : "ADMIN is offered to a non-staff member.",
    );
    assertThat(
      (await page.locator(".site-nav-top > .site-nav-user:visible").count()) === 1,
      "User menu is not in the desktop top row.",
    );
    assertThat(
      (await page.locator(".site-nav-right > a:visible").filter({ hasText: exactText("DASHBOARD") }).count()) === 0,
      "DASHBOARD is still duplicated in the desktop utility row.",
    );
    assertThat(
      (await page.locator(".site-nav-right > a:visible").filter({ hasText: exactText("ADMIN") }).count()) === 0,
      "ADMIN is still duplicated in the desktop utility row.",
    );
    assertThat(
      (await page.locator(".site-nav-right > .site-nav-user:visible").count()) === 0,
      "The user menu is still duplicated in the desktop utility row.",
    );
  }

  const switcher = page.locator(".site-nav-switcher:visible");
  if (expected.switcherName === null) {
    assertThat((await switcher.count()) === 0, "A single-membership session renders an organization switcher.");
  } else {
    assertThat((await switcher.count()) === 1, "Expected exactly one visible organization switcher.");
    const optionLabels = await switcher.locator("option").allTextContents();
    assertThat(
      optionLabels.some((label) => label.trim() === expected.switcherName),
      `Organization switcher does not contain ${expected.switcherName}.`,
    );
  }
  assertThat((await page.locator(".site-nav-user-trigger:visible").count()) === 1, "Expected exactly one visible user menu.");
  await assertPublicDestinations(page, true, mobile);
  const dashboard = page.locator('.site-nav a:visible[href="/dashboard"]').filter({ hasText: exactText("DASHBOARD") });
  assertThat((await dashboard.count()) === 1, "DASHBOARD must appear exactly once and target /dashboard.");
  const admin = page
    .locator('.site-nav a:visible[href="/admin/organizations"]')
    .filter({ hasText: exactText("ADMIN") });
  assertThat(
    (await admin.count()) === (expected.admin ? 1 : 0),
    expected.admin
      ? "ADMIN must appear exactly once and target /admin/organizations."
      : "ADMIN is offered to a non-staff member.",
  );
  await assertExactlyOneVisible(page, "DASHBOARD");
  if (expected.admin) await assertExactlyOneVisible(page, "ADMIN");
}

function parseSetCookie(setCookie: string): BrowserCookie {
  const parts = setCookie.split(";").map((part) => part.trim());
  const nameValue = parts.shift();
  assertThat(nameValue !== undefined, "Authentication returned an empty Set-Cookie header.");
  const separator = nameValue.indexOf("=");
  assertThat(separator > 0, `Authentication returned an invalid Set-Cookie header: ${nameValue}`);

  const cookie: BrowserCookie = {
    name: nameValue.slice(0, separator),
    value: nameValue.slice(separator + 1),
    url: BASE_URL,
  };

  for (const part of parts) {
    const [rawName, ...rawValue] = part.split("=");
    const attribute = rawName?.toLowerCase();
    const value = rawValue.join("=");
    if (attribute === "httponly") cookie.httpOnly = true;
    if (attribute === "secure") cookie.secure = true;
    if (attribute === "expires" && value) {
      const expires = Date.parse(value);
      if (Number.isFinite(expires)) cookie.expires = Math.floor(expires / 1_000);
    }
    if (attribute === "max-age" && value) {
      const maxAge = Number.parseInt(value, 10);
      if (Number.isFinite(maxAge)) cookie.expires = Math.floor(Date.now() / 1_000) + maxAge;
    }
    if (attribute === "samesite") {
      const sameSite = value.toLowerCase();
      if (sameSite === "strict") cookie.sameSite = "Strict";
      if (sameSite === "lax") cookie.sameSite = "Lax";
      if (sameSite === "none") cookie.sameSite = "None";
    }
  }
  return cookie;
}

async function mintSessionState(browser: Browser, email: string): Promise<AuthState> {
  // Mint through Better Auth's own provider API, not the HTTP quick-login
  // route. This preserves real session cookies and hooks without consuming the
  // app-wide IP rate-limit bucket shared by parallel validation workflows.
  const token = randomBytes(24).toString("base64url");
  await pool.query(
    `insert into verification (id, identifier, value, "expiresAt", "createdAt", "updatedAt")
     values (gen_random_uuid(), $1, $2, now() + interval '2 minutes', now(), now())`,
    [token, JSON.stringify({ email })],
  );

  type MagicLinkApi = {
    magicLinkVerify(input: {
      query: { token: string; callbackURL: string };
      headers: Headers;
      asResponse: true;
    }): Promise<Response>;
  };

  let setCookies: string[];
  try {
    const response = await (auth.api as unknown as MagicLinkApi).magicLinkVerify({
      query: { token, callbackURL: "/dashboard" },
      headers: new Headers(),
      asResponse: true,
    });
    assertThat(
      response.ok || response.status === 302,
      `Better Auth session minting for ${email} failed with ${response.status}: ${await response.text()}`,
    );
    const headers = response.headers as Headers & { getSetCookie?: () => string[] };
    setCookies = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [];
  } finally {
    await pool.query(`delete from verification where identifier = $1`, [token]);
  }

  const context = await browser.newContext();
  try {
    await context.addCookies(setCookies.map(parseSetCookie));
    const state = await context.storageState();
    assertThat(
      state.cookies.some((cookie) => cookie.name.includes("better-auth.session_token")),
      "Better Auth did not produce a session cookie.",
    );
    return state;
  } finally {
    await context.close();
  }
}

async function runCase(
  browser: Browser,
  state: "signed out" | "staff admin" | "member",
  width: number,
  authState: AuthState | null,
  fixtureName: string,
): Promise<void> {
  const label = `${state} at ${width}px`;
  // The staff admin holds the seeded membership plus the switcher fixture; the
  // ordinary member holds one membership and no staff role.
  const session: SessionExpectation =
    state === "signed out"
      ? { authenticated: false }
      : state === "staff admin"
        ? { authenticated: true, staffRole: "staff_admin", memberships: 2, allowExtraMemberships: true }
        : { authenticated: true, staffRole: null, memberships: 1 };
  let context: BrowserContext | null = null;
  try {
    context = await browser.newContext({
      viewport: { width, height: VIEWPORT_HEIGHT },
      storageState: authState ?? undefined,
    });
    const page = await context.newPage();
    await waitForSession(page, session);

    if (state === "signed out") {
      const sessionCookies = (await context.cookies()).filter((cookie) =>
        cookie.name.includes("better-auth.session_token"),
      );
      assertThat(sessionCookies.length === 0, "Signed-out context inherited an authenticated session cookie.");
      await assertSignedOutNavigation(page, width);
    } else if (state === "staff admin") {
      await assertAuthenticatedNavigation(page, width, { admin: true, switcherName: fixtureName });
    } else {
      await assertAuthenticatedNavigation(page, width, { admin: false, switcherName: null });
    }

    await assertNoHorizontalOverflow(page, label);
    await assertLogoDoesNotOverlapControls(page, label);
    console.log(`  ✓ ${label}`);
    passed += 1;
  } catch (error) {
    console.error(`  ✗ ${label}`);
    console.error(`    ${error instanceof Error ? error.message.replace(/\n/g, "\n    ") : String(error)}`);
    failed += 1;
  } finally {
    await context?.close();
  }
}

/**
 * Nav-flash regression: asserts that no session-dependent slot renders while
 * the session query is in-flight after a hard reload.
 *
 * The fix gates every session-dependent slot on `!isLoading` in NavBar.tsx. A
 * future edit that removes or bypasses that gate would re-introduce the flash
 * where authenticated users briefly see the public CTAs (or vice-versa). This
 * check catches that regression before it ships.
 *
 * Technique: Playwright's route interception holds the /api/session response
 * indefinitely while the React app is mounted and rendering. That freezes the
 * component in the isLoading=true state so we can inspect the DOM without a
 * race against a fast local response.
 */
async function runNavFlashCase(
  browser: Browser,
  state: "staff admin" | "member",
  authState: AuthState,
): Promise<void> {
  const label = `nav flash — ${state}`;
  let context: BrowserContext | null = null;
  try {
    context = await browser.newContext({
      // Desktop width; both mobile and desktop gate on the same isLoading flag
      // but a single width is sufficient to confirm the guard is present.
      viewport: { width: 1280, height: VIEWPORT_HEIGHT },
      storageState: authState,
    });
    const page = await context.newPage();

    // Hold /api/session until we have inspected the loading-window DOM.
    let releaseSession!: () => void;
    const sessionHeld = new Promise<void>((resolve) => {
      releaseSession = resolve;
    });

    let signalRequestReceived!: () => void;
    const requestReceived = new Promise<void>((resolve) => {
      signalRequestReceived = resolve;
    });

    await page.route("**/api/session", async (route) => {
      // Tell the test that the app has issued its session fetch (isLoading=true).
      signalRequestReceived();
      // Block here until the test has finished its loading-window assertions.
      await sessionHeld;
      await route.continue();
    });

    // Navigate; the app mounts and immediately fires the session fetch.
    await page.goto(`${BASE_URL}/`, { waitUntil: "domcontentloaded" });

    // Wait until the intercept has fired, confirming isLoading=true.
    await requestReceived;

    // ── Assert: nothing session-dependent is visible during loading ─────────
    //
    // Public CTAs (PROVIDE AN ITEM, VOLUNTEER teal buttons):
    //   showMemberLogin = !isLoading && !authenticated  →  false while loading
    assertThat(
      (await page.locator(".site-nav .site-nav-btn-cta:visible").count()) === 0,
      `${label}: teal CTA buttons (PROVIDE AN ITEM / VOLUNTEER) are visible during the session loading window.`,
    );
    // MEMBER LOGIN link (unauthenticated-only):
    assertThat(
      (await page.locator(".site-nav a[href='/login']:visible").count()) === 0,
      `${label}: MEMBER LOGIN link is visible during the session loading window.`,
    );
    // DASHBOARD link (authenticated-only):
    //   showDashboard = !isLoading && authenticated && memberships ≥ 1
    assertThat(
      (await page.locator(".site-nav a[href='/dashboard']:visible").count()) === 0,
      `${label}: DASHBOARD link is visible during the session loading window.`,
    );
    // ADMIN link (staff-authenticated-only):
    //   showAdmin = !isLoading && staffRole != null
    assertThat(
      (await page.locator(".site-nav a[href='/admin/organizations']:visible").count()) === 0,
      `${label}: ADMIN link is visible during the session loading window.`,
    );
    // User menu chip (authenticated-only):
    //   showUserMenu = !isLoading && authenticated
    assertThat(
      (await page.locator(".site-nav-user-trigger:visible").count()) === 0,
      `${label}: user menu chip is visible during the session loading window.`,
    );

    // Release the held /api/session response so the session resolves.
    releaseSession();

    // ── Sanity-check: expected controls appear after session resolves ────────
    await page.waitForSelector(".site-nav-user-trigger", { state: "attached", timeout: 10_000 });
    assertThat(
      (await page.locator(".site-nav-user-trigger:visible").count()) === 1,
      `${label}: user menu not visible after the session resolved.`,
    );
    assertThat(
      (await page.locator(".site-nav a[href='/login']:visible").count()) === 0,
      `${label}: MEMBER LOGIN still visible after the session resolved for an authenticated user.`,
    );

    console.log(`  ✓ ${label}`);
    passed += 1;
  } catch (error) {
    console.error(`  ✗ ${label}`);
    console.error(`    ${error instanceof Error ? error.message.replace(/\n/g, "\n    ") : String(error)}`);
    failed += 1;
  } finally {
    await context?.close();
  }
}

async function main(): Promise<void> {
  console.log("Responsive navigation browser checks");
  console.log(`Base URL: ${BASE_URL}`);

  let browser: Browser | null = null;
  let fixture: Fixture | null = null;
  try {
    await waitForApplication();
    fixture = await createSwitcherFixture();
    console.log(`Fixture ready: ${fixture.organizationId}/${fixture.membershipId}`);

    browser = await chromium.launch({ headless: true, executablePath: chromiumExecutable() });
    const staffState = await mintSessionState(browser, STAFF_EMAIL);
    const memberState = await mintSessionState(browser, MEMBER_EMAIL);

    for (const width of WIDTHS) {
      await runCase(browser, "signed out", width, null, fixture.name);
    }
    for (const width of WIDTHS) {
      await runCase(browser, "staff admin", width, staffState, fixture.name);
    }
    for (const width of WIDTHS) {
      await runCase(browser, "member", width, memberState, fixture.name);
    }

    // Nav-flash regression: verify that no session-dependent slot flashes
    // during the window between a hard reload and the session query resolving.
    console.log("\nNav flash regression checks");
    await runNavFlashCase(browser, "staff admin", staffState);
    await runNavFlashCase(browser, "member", memberState);
  } finally {
    await browser?.close();
    if (fixture !== null) await cleanupSwitcherFixture(fixture);
    await pool.end();
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error("Fatal:", error);
  process.exitCode = 1;
});