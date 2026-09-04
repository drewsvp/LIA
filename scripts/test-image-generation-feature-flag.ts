/**
 * Browser coverage for the image-generation site flag on ADMIN-02.
 *
 * The request list/detail and site-settings responses are intercepted so this
 * is deterministic and does not create requests or invoke image generation.
 * A development server and seeded quick-login accounts are required.
 *
 * Usage: npm run test:image-generation-feature-flag
 */
import { execFileSync } from "node:child_process";
import { chromium, type BrowserContext } from "playwright";

const BASE = process.env.REPLIT_DEV_DOMAIN
  ? `https://${process.env.REPLIT_DEV_DOMAIN}`
  : "http://127.0.0.1:5000";
const STORED_IMAGE = "https://example.invalid/fixture-image.png";
const DIAGNOSTIC = "fixture provider failed";

type Kind = "item" | "volunteer";
type Mode = "generated" | "pending";
type BrowserCookie = Parameters<BrowserContext["addCookies"]>[0][number];

let passed = 0;
let failed = 0;

function assert(condition: unknown, label: string): asserts condition {
  if (!condition) throw new Error(label);
}

function chromiumExecutable(): string {
  return (
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?.trim() ||
    execFileSync("which", ["chromium"], { encoding: "utf8" }).trim()
  );
}

function parseCookie(setCookie: string): BrowserCookie {
  const [pair] = setCookie.split(";");
  const separator = pair!.indexOf("=");
  return {
    name: pair!.slice(0, separator),
    value: pair!.slice(separator + 1),
    url: BASE,
    httpOnly: /;\s*httponly/i.test(setCookie),
    secure: /;\s*secure/i.test(setCookie),
    sameSite: "Lax",
  };
}

async function quickLoginCookie(): Promise<BrowserCookie> {
  const response = await fetch(`${BASE}/api/login/quick`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role: "staff_approver" }),
  });
  if (!response.ok) throw new Error(`Quick login failed: HTTP ${response.status}`);
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const cookies = typeof headers.getSetCookie === "function"
    ? headers.getSetCookie()
    : (headers.get("set-cookie") ?? "").split(/,(?=\s*\w+=)/);
  const session = cookies.find((value) => value.includes("session_token"));
  if (!session) throw new Error("Quick login did not return a session cookie.");
  return parseCookie(session);
}

function requestFixture(kind: Kind, id: string, mode: Mode) {
  const title = `${kind} image flag fixture`;
  const hasStoredImage = mode === "generated";
  return {
    type: kind,
    request: {
      id,
      title,
      description: "Minimal fixture request.",
      ...(kind === "volunteer" ? { details: "Minimal volunteer details." } : {}),
      imageUrl: hasStoredImage ? STORED_IMAGE : null,
      imageGenerated: hasStoredImage,
      imageGenStatus: mode === "generated" ? "failed" : "pending",
      imageGenError: mode === "generated" ? DIAGNOSTIC : null,
      peopleHelped: 1,
      deadlineType: "ongoing",
      deadlineDate: null,
      expiresOn: null,
      status: "pending",
      submittedAt: "2025-01-01T00:00:00.000Z",
      approvedAt: null,
      archivedReason: null,
    },
    organization: { id: "fixture-org", name: "Fixture Organization", city: null, status: "approved" },
    orgContact: null,
    creator: null,
    requestContact: null,
    children: [],
    latestReturn: null,
    editability: { editable: true, reason: null, unapprovable: false, unapprovalReason: null },
    categories: [],
    revisions: [],
  };
}

async function installFixtures(
  context: BrowserContext,
  kind: Kind,
  id: string,
  mode: Mode,
  imageGenerationEnabled: boolean,
): Promise<void> {
  const title = `${kind} image flag fixture`;
  const json = (body: unknown) => ({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
  await context.route("**/api/site-settings", (route) =>
    route.fulfill(json({
      siteName: "Fixture Site",
      contactEmail: "fixture@example.invalid",
      responseTimeLanguage: "1-3 business days",
      imageGenerationEnabled,
      directorName: "Fixture Director",
      directorEmail: "director@example.invalid",
    })),
  );
  await context.route(/\/api\/admin\/requests\?status=pending$/, (route) =>
    route.fulfill(json({
      requests: [{
        type: kind,
        id,
        title,
        status: "pending",
        submittedAt: "2025-01-01T00:00:00.000Z",
        createdAt: "2025-01-01T00:00:00.000Z",
        deadlineType: "ongoing",
        deadlineDate: null,
        expiresOn: null,
        orgId: "fixture-org",
        orgName: "Fixture Organization",
        orgCity: null,
        orgStatus: "approved",
        childCount: 0,
      }],
    })),
  );
  await context.route(new RegExp(`/api/admin/requests/${kind}/${id}$`), (route) =>
    route.fulfill(json(requestFixture(kind, id, mode))),
  );
  await context.route(new RegExp(`/api/admin/requests/${kind}/${id}/participants$`), (route) =>
    route.fulfill(json({ participants: [], counterTotal: 0, canManage: false })),
  );
}

async function visible(page: Awaited<ReturnType<BrowserContext["newPage"]>>, text: string): Promise<boolean> {
  return page.getByText(text, { exact: true }).isVisible();
}

async function runCase(
  browser: Awaited<ReturnType<typeof chromium.launch>>,
  cookie: BrowserCookie,
  kind: Kind,
  mode: Mode,
  imageGenerationEnabled: boolean,
): Promise<void> {
  const id = `fixture-${kind}-${mode}-${imageGenerationEnabled ? "on" : "off"}`;
  const title = `${kind} image flag fixture`;
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addCookies([cookie]);
  try {
    await installFixtures(context, kind, id, mode, imageGenerationEnabled);
    const page = await context.newPage();
    await page.goto(`${BASE}/admin/requests`, { waitUntil: "domcontentloaded" });
    await page.getByRole("row", { name: new RegExp(title) }).click();
    await page.locator("#adm-request-image").waitFor({ state: "visible", timeout: 8_000 });

    assert(await page.getByRole("img", { name: title }).count() === (mode === "generated" ? 1 : 0),
      `${kind}/${mode}: stored image rendering matches fixture`);
    assert(await page.locator("#adm-request-image").isVisible(),
      `${kind}/${mode}: ordinary file upload remains visible`);

    const aiLabel = await visible(page, "AI-generated image.");
    const findButton = await page.getByRole("button", { name: "Find an image automatically" }).isVisible();
    const regenerateButton = await page.getByRole("button", { name: "Regenerate auto image" }).isVisible();
    const removeButton = await page.getByRole("button", { name: "Remove auto image" }).isVisible();
    const pending = await visible(page, "An image is being sourced automatically…");
    const failure = await visible(page, `Automatic image sourcing failed: ${DIAGNOSTIC}`);

    if (imageGenerationEnabled) {
      assert(
        mode === "generated"
          ? aiLabel && regenerateButton && removeButton && failure && !findButton && !pending
          : findButton && pending && !aiLabel && !regenerateButton && !removeButton && !failure,
        `${kind}/${mode}: enabled flag shows the applicable AI controls and status`,
      );
    } else {
      assert(!aiLabel && !findButton && !regenerateButton && !removeButton && !pending && !failure,
        `${kind}/${mode}: disabled flag hides every AI control, label, and diagnostic`);
    }
  } finally {
    await context.close();
  }
}

async function main(): Promise<void> {
  const browser = await chromium.launch({ headless: true, executablePath: chromiumExecutable() });
  const cookie = await quickLoginCookie();
  try {
    for (const kind of ["item", "volunteer"] as const) {
      for (const imageGenerationEnabled of [false, true]) {
        for (const mode of ["generated", "pending"] as const) {
          const label = `${kind}/${mode} with image generation ${imageGenerationEnabled ? "enabled" : "disabled"}`;
          try {
            await runCase(browser, cookie, kind, mode, imageGenerationEnabled);
            console.log(`  ✓ ${label}`);
            passed += 1;
          } catch (error) {
            console.error(`  ✗ ${label}: ${error instanceof Error ? error.message : String(error)}`);
            failed += 1;
          }
        }
      }
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