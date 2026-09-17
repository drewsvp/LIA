/**
 * Regression coverage for the production quick-login boundary.
 *
 * Usage:
 *   npm run test:production-quick-login
 *
 * Requires the development server for the browser check. The production API
 * checks run against an isolated, ephemeral Express server.
 */
import { execFileSync } from "node:child_process";
import express from "express";
import { chromium } from "playwright";
import { readFile } from "node:fs/promises";
import { registerRoutes, isQuickLoginEnabled } from "../server/routes/index";

const DEV_BASE =
  process.env.TEST_BASE_URL ??
  (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : "http://127.0.0.1:5000");
const NOT_FOUND = { message: "Not found" };

let passed = 0;

function assert(condition: unknown, label: string): asserts condition {
  if (!condition) throw new Error(label);
  console.log(`  ✓ ${label}`);
  passed += 1;
}

function chromiumExecutable(): string {
  return (
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?.trim() ||
    execFileSync("which", ["chromium"], { encoding: "utf8" }).trim()
  );
}

async function verifyProductionApi(): Promise<void> {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousOverride = process.env.QUICK_LOGIN_ENABLED;
  process.env.NODE_ENV = "production";
  process.env.QUICK_LOGIN_ENABLED = "true";

  const app = express();
  app.use(express.json());
  registerRoutes(app);
  const server = app.listen(0, "127.0.0.1");

  try {
    await new Promise<void>((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
    assert(!isQuickLoginEnabled(), "production ignores QUICK_LOGIN_ENABLED=true");

    const address = server.address();
    assert(typeof address === "object" && address !== null, "isolated production server starts");
    const base = `http://127.0.0.1:${address.port}`;

    for (const [label, path, method, body] of [
      ["status", "/api/login/quick/status", "GET", undefined],
      ["login", "/api/login/quick", "POST", { role: "staff_admin" }],
      ["rate-limit reset", "/api/dev/reset-rate-limits", "POST", undefined],
    ] as const) {
      const response = await fetch(`${base}${path}`, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        redirect: "manual",
      });
      assert(response.status === 404, `production ${label} request returns 404`);
      assert(
        JSON.stringify(await response.json()) === JSON.stringify(NOT_FOUND),
        `production ${label} response matches an unknown API`,
      );
      assert(!response.headers.has("set-cookie"), `production ${label} creates no session cookie`);
    }
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousOverride === undefined) delete process.env.QUICK_LOGIN_ENABLED;
    else process.env.QUICK_LOGIN_ENABLED = previousOverride;
  }
}

async function verifyDeploymentConfig(): Promise<void> {
  const config = await readFile(".replit", "utf8");
  const productionSection = config.match(/\[userenv\.production\]([\s\S]*?)(?=\n\[|$)/)?.[1] ?? "";
  assert(
    !/^\s*QUICK_LOGIN_ENABLED\s*=/m.test(productionSection),
    "production deployment configuration has no quick-login override",
  );
}

async function verifyProductionLoginUi(): Promise<void> {
  const browser = await chromium.launch({ headless: true, executablePath: chromiumExecutable() });
  try {
    const context = await browser.newContext();
    await context.route("**/api/login/quick/status", (route) =>
      route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify(NOT_FOUND) }),
    );
    const page = await context.newPage();
    await page.goto(`${DEV_BASE}/login`, { waitUntil: "networkidle" });
    assert(await page.locator(".mp1-form").isVisible(), "production login form remains visible");
    assert(
      (await page.locator(".mp1-quick-section").count()) === 0,
      "production login page does not render quick-login controls",
    );
    await context.close();
  } finally {
    await browser.close();
  }
}

async function main(): Promise<void> {
  console.log("Production quick-login regression test\n");
  await verifyDeploymentConfig();
  await verifyProductionApi();
  await verifyProductionLoginUi();
  console.log(`\n${passed} checks passed`);
}

main().catch((error) => {
  console.error(`\n✗ ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});