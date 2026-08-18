/**
 * Integration test: quick login flow for all three seeded roles.
 *
 * Tests the full chain:
 *   POST /api/login/quick → Set-Cookie → GET /api/session → authenticated
 *
 * Also validates the verification table schema at the start so that a
 * migration that renames a column fails loudly here rather than in prod.
 *
 * Usage:
 *   NODE_ENV=development npx tsx scripts/test-quick-login.ts
 *
 * Exit 0 = all pass.  Exit 1 = at least one failure (details printed).
 */
import { pool } from "../server/db/client";

const BASE = "http://localhost:5000";

// ── helpers ─────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function pass(label: string): void {
  console.log(`  ✓  ${label}`);
  passed++;
}

function fail(label: string, detail?: string): void {
  console.error(`  ✗  ${label}`);
  if (detail) console.error(`       ${detail}`);
  failed++;
}

/** Parse all Set-Cookie header values out of a fetch Response. */
function parseCookies(res: Response): string[] {
  // Node's undici/fetch stores multiple Set-Cookie values in one header
  // joined by ", " which is ambiguous with date values.  The reliable path
  // is getSetCookie() (Node 18.14+) when available; fall back to the
  // raw header string split otherwise.
  const h = res.headers as unknown as {
    getSetCookie?: () => string[];
    get: (name: string) => string | null;
  };
  if (typeof h.getSetCookie === "function") return h.getSetCookie();
  const raw = h.get("set-cookie");
  return raw ? raw.split(/,(?=\s*\w+=)/) : [];
}

/** Build a Cookie: header string from an array of Set-Cookie values. */
function cookieHeader(setCookies: string[]): string {
  return setCookies.map((c) => c.split(";")[0]).join("; ");
}

// ── schema guard ─────────────────────────────────────────────────────────────

async function checkVerificationSchema(): Promise<void> {
  console.log("\nSchema guard — verification table columns:");

  const { rows } = await pool.query<{ column_name: string; data_type: string }>(`
    SELECT column_name, data_type
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'verification'
     ORDER BY ordinal_position
  `);

  const actual = new Map(rows.map((r) => [r.column_name, r.data_type]));

  const required: { name: string; expectedType: string }[] = [
    { name: "id",         expectedType: "text" },
    { name: "identifier", expectedType: "text" },
    { name: "value",      expectedType: "text" },
    { name: "expiresAt",  expectedType: "timestamp without time zone" },
    { name: "createdAt",  expectedType: "timestamp without time zone" },
    { name: "updatedAt",  expectedType: "timestamp without time zone" },
  ];

  for (const col of required) {
    if (!actual.has(col.name)) {
      fail(`column "${col.name}" exists`, `missing — table has: ${[...actual.keys()].join(", ")}`);
    } else if (actual.get(col.name) !== col.expectedType) {
      fail(
        `column "${col.name}" is ${col.expectedType}`,
        `actual type: ${actual.get(col.name)}`,
      );
    } else {
      pass(`column "${col.name}" exists with type ${col.expectedType}`);
    }
  }
}

// ── per-role flow ─────────────────────────────────────────────────────────────

const ROLES: { role: string; expectedEmail: string }[] = [
  { role: "staff_admin",    expectedEmail: "tiffany@defendingthecause.org" },
  { role: "staff_approver", expectedEmail: "approver@thealliance.example.org" },
  { role: "org_owner",      expectedEmail: "dana@heartsandhands.example.org" },
];

async function testRole(role: string, expectedEmail: string): Promise<void> {
  console.log(`\nRole: ${role}`);

  // ── 1. Quick login ──────────────────────────────────────────────────────
  let loginRes: Response;
  try {
    loginRes = await fetch(`${BASE}/api/login/quick`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
      redirect: "manual",
    });
  } catch (err) {
    fail("POST /api/login/quick reachable", String(err));
    return;
  }

  if (loginRes.status !== 200) {
    const body = await loginRes.text().catch(() => "(unreadable)");
    fail(`POST /api/login/quick → 200`, `got ${loginRes.status}: ${body}`);
    return;
  }
  pass("POST /api/login/quick → 200");

  let loginBody: { ok?: boolean; redirectTo?: string };
  try {
    loginBody = (await loginRes.json()) as typeof loginBody;
  } catch {
    fail("response body is valid JSON");
    return;
  }
  if (loginBody.ok !== true) fail('body.ok === true', JSON.stringify(loginBody));
  else pass("body.ok === true");

  // ── 2. Cookies present ──────────────────────────────────────────────────
  const setCookies = parseCookies(loginRes);
  const hasSession = setCookies.some(
    (c) =>
      c.startsWith("__Secure-better-auth.session_token") ||
      c.startsWith("better-auth.session_token"),
  );
  if (!hasSession) {
    fail("Set-Cookie contains session token", `got: ${setCookies.join(" | ") || "(none)"}`);
    return;
  }
  pass("Set-Cookie contains session token");

  // ── 3. Session endpoint confirms authentication ─────────────────────────
  let sessionRes: Response;
  try {
    sessionRes = await fetch(`${BASE}/api/session`, {
      headers: { Cookie: cookieHeader(setCookies) },
    });
  } catch (err) {
    fail("GET /api/session reachable", String(err));
    return;
  }

  if (sessionRes.status !== 200) {
    const body = await sessionRes.text().catch(() => "(unreadable)");
    fail(`GET /api/session → 200`, `got ${sessionRes.status}: ${body}`);
    return;
  }
  pass("GET /api/session → 200");

  let session: {
    authenticated?: boolean;
    user?: { email?: string };
    memberships?: unknown[];
  };
  try {
    session = (await sessionRes.json()) as typeof session;
  } catch {
    fail("session body is valid JSON");
    return;
  }

  if (session.authenticated !== true) {
    fail("session.authenticated === true", JSON.stringify(session));
    return;
  }
  pass("session.authenticated === true");

  const gotEmail = session.user?.email?.toLowerCase() ?? "";
  const wantEmail = expectedEmail.toLowerCase();
  if (gotEmail !== wantEmail) {
    fail(`session.user.email = ${expectedEmail}`, `got: ${gotEmail}`);
  } else {
    pass(`session.user.email = ${expectedEmail}`);
  }

  if (!Array.isArray(session.memberships) || session.memberships.length === 0) {
    fail("session.memberships non-empty array");
  } else {
    pass(`session.memberships has ${session.memberships.length} entry(ies)`);
  }
}

// ── entrypoint ───────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("Quick login integration test");
  console.log("============================");

  // Confirm quick login is enabled before running the per-role tests.
  let statusRes: Response;
  try {
    statusRes = await fetch(`${BASE}/api/login/quick/status`);
  } catch (err) {
    console.error(`Cannot reach ${BASE}: ${err}`);
    console.error("Is the server running? (npm run dev)");
    process.exit(1);
  }

  if (statusRes.status !== 200) {
    console.error(`Quick login is disabled (status ${statusRes.status}).`);
    console.error("Set NODE_ENV=development or QUICK_LOGIN_ENABLED=true and restart.");
    process.exit(1);
  }

  // Schema guard: catches column renames / type changes before touching HTTP.
  await checkVerificationSchema();

  // Per-role flows.
  for (const { role, expectedEmail } of ROLES) {
    await testRole(role, expectedEmail);
  }

  // ── summary ───────────────────────────────────────────────────────────────
  console.log(`\n${"─".repeat(44)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.error("\nSome checks failed — see details above.");
    process.exit(1);
  }
  console.log("\nAll checks passed.");
}

main()
  .catch((err: unknown) => {
    console.error("Fatal:", err);
    process.exit(1);
  })
  .finally(() => {
    pool.end().catch(() => undefined);
  });
