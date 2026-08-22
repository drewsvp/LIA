/**
 * Integration test: seeded quick-login roles plus the supporter magic-link flow.
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
import { randomBytes } from "node:crypto";
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

type SupporterFixture = {
  created: boolean;
  personId?: string;
  userId?: string;
  providerUserExisted: boolean;
};

/**
 * The development seed normally provides this account. Create it only when a
 * partially seeded local database is missing it, then remove every row this
 * test creates after the suite finishes.
 */
async function ensureSupporterFixture(): Promise<SupporterFixture> {
  const email = "supporter@example.org";
  const { rows: existingAppUsers } = await pool.query<{
    userId: string;
    personId: string;
    kind: string;
    status: string;
  }>(
    `SELECT u.id AS "userId", u.person_id AS "personId", u.kind, u.status
       FROM users u
       JOIN people p ON p.id = u.person_id
      WHERE lower(p.email) = lower($1)
      LIMIT 1`,
    [email],
  );
  const existingAppUser = existingAppUsers[0];
  if (existingAppUser) {
    if (existingAppUser.kind !== "supporter" || existingAppUser.status !== "active") {
      throw new Error(
        `supporter fixture has kind=${existingAppUser.kind}, status=${existingAppUser.status}; expected active supporter`,
      );
    }
    return { created: false, providerUserExisted: true };
  }

  const { rows: existingProviderUsers } = await pool.query<{ id: string }>(
    `SELECT id FROM "user" WHERE lower(email) = lower($1) LIMIT 1`,
    [email],
  );
  const { rows: people } = await pool.query<{ id: string }>(
    `INSERT INTO people (first_name, last_name, email, source_note)
     VALUES ('Alex', 'Rivera', $1, 'zz_fixture_login_integration')
     RETURNING id`,
    [email],
  );
  const person = people[0];
  if (!person) throw new Error("supporter fixture person was not created");

  try {
    const { rows: users } = await pool.query<{ id: string }>(
      `INSERT INTO users (person_id, status, kind)
       VALUES ($1, 'active', 'supporter')
       RETURNING id`,
      [person.id],
    );
    const user = users[0];
    if (!user) throw new Error("supporter fixture user was not created");
    return {
      created: true,
      personId: person.id,
      userId: user.id,
      providerUserExisted: existingProviderUsers.length > 0,
    };
  } catch (err) {
    await pool.query(`DELETE FROM people WHERE id = $1`, [person.id]);
    throw err;
  }
}

async function cleanupSupporterFixture(fixture: SupporterFixture): Promise<void> {
  if (!fixture.created || !fixture.personId || !fixture.userId) return;

  if (!fixture.providerUserExisted) {
    await pool.query(
      `DELETE FROM session
        WHERE "userId" IN (SELECT id FROM "user" WHERE lower(email) = lower($1))`,
      ["supporter@example.org"],
    );
    await pool.query(
      `DELETE FROM account
        WHERE "userId" IN (SELECT id FROM "user" WHERE lower(email) = lower($1))`,
      ["supporter@example.org"],
    );
    await pool.query(`DELETE FROM "user" WHERE lower(email) = lower($1)`, ["supporter@example.org"]);
  }
  await pool.query(`DELETE FROM users WHERE id = $1`, [fixture.userId]);
  await pool.query(`DELETE FROM people WHERE id = $1`, [fixture.personId]);
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

const ROLES: { role: string; expectedEmail: string; expectedRedirect: string }[] = [
  { role: "staff_admin",    expectedEmail: "tiffany@defendingthecause.org",         expectedRedirect: "/dashboard" },
  { role: "staff_approver", expectedEmail: "approver@thealliance.example.org",      expectedRedirect: "/dashboard" },
  { role: "org_owner",      expectedEmail: "dana@heartsandhands.example.org",       expectedRedirect: "/dashboard" },
];

async function testRole(
  role: string,
  expectedEmail: string,
  expectedRedirect: string,
): Promise<void> {
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

  if (loginBody.redirectTo !== expectedRedirect) {
    fail(
      `body.redirectTo === "${expectedRedirect}"`,
      `got: ${JSON.stringify(loginBody.redirectTo)}`,
    );
  } else {
    pass(`body.redirectTo === "${expectedRedirect}"`);
  }

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

/**
 * Supporter-specific flow: kind='supporter' accounts have no memberships and
 * must be redirected to /profile, not /dashboard.
 */
async function testSupporterRole(): Promise<void> {
  const role = "supporter";
  const expectedEmail = "supporter@example.org";
  const expectedRedirect = "/profile";

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
  if (loginBody.ok !== true) {
    fail("body.ok === true", JSON.stringify(loginBody));
  } else {
    pass("body.ok === true");
  }

  // Core assertion: supporters must land on /profile, not /dashboard.
  if (loginBody.redirectTo !== expectedRedirect) {
    fail(
      `body.redirectTo === "${expectedRedirect}" (supporter must not land on /dashboard)`,
      `got: ${JSON.stringify(loginBody.redirectTo)}`,
    );
  } else {
    pass(`body.redirectTo === "${expectedRedirect}"`);
  }

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

  // Supporters legitimately have zero memberships — this is not an error.
  if (!Array.isArray(session.memberships)) {
    fail("session.memberships is an array", JSON.stringify(session.memberships));
  } else {
    pass(`session.memberships is an array (${session.memberships.length} entries — zero is valid for supporters)`);
  }
}

/**
 * Supporter-specific magic-link flow: mint the same verification row that the
 * email sign-in path consumes, then confirm it through the application route.
 * This deliberately does not use quick login so the two redirect branches
 * remain independently covered.
 */
async function testSupporterMagicLink(): Promise<void> {
  const expectedEmail = "supporter@example.org";
  const expectedRedirect = "/profile";
  const token = `zz-magic-link-supporter-${randomBytes(18).toString("base64url")}`;

  console.log("\nMagic-link role: supporter");

  await pool.query(
    `INSERT INTO verification (id, identifier, value, "expiresAt", "createdAt", "updatedAt")
     VALUES (gen_random_uuid(), $1, $2, NOW() + INTERVAL '2 minutes', NOW(), NOW())`,
    [token, JSON.stringify({ email: expectedEmail })],
  );

  try {
    let verifyRes: Response;
    try {
      verifyRes = await fetch(`${BASE}/api/login/magic-link/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
        redirect: "manual",
      });
    } catch (err) {
      fail("POST /api/login/magic-link/verify reachable", String(err));
      return;
    }

    if (verifyRes.status !== 200) {
      const body = await verifyRes.text().catch(() => "(unreadable)");
      fail(
        "POST /api/login/magic-link/verify → 200",
        `got ${verifyRes.status}: ${body}`,
      );
      return;
    }
    pass("POST /api/login/magic-link/verify → 200");

    let verifyBody: { ok?: boolean; redirectTo?: string };
    try {
      verifyBody = (await verifyRes.json()) as typeof verifyBody;
    } catch {
      fail("magic-link response body is valid JSON");
      return;
    }

    if (verifyBody.ok !== true) {
      fail("magic-link body.ok === true", JSON.stringify(verifyBody));
    } else {
      pass("magic-link body.ok === true");
    }

    if (verifyBody.redirectTo !== expectedRedirect) {
      fail(
        `magic-link body.redirectTo === "${expectedRedirect}" (supporter must not land on /dashboard)`,
        `got: ${JSON.stringify(verifyBody.redirectTo)}`,
      );
    } else {
      pass(`magic-link body.redirectTo === "${expectedRedirect}"`);
    }

    const setCookies = parseCookies(verifyRes);
    const hasSession = setCookies.some(
      (c) =>
        c.startsWith("__Secure-better-auth.session_token") ||
        c.startsWith("better-auth.session_token"),
    );
    if (!hasSession) {
      fail(
        "magic-link Set-Cookie contains session token",
        `got: ${setCookies.join(" | ") || "(none)"}`,
      );
    } else {
      pass("magic-link Set-Cookie contains session token");
    }
  } finally {
    // confirmMagicLink restores the row to preserve the token's replay window;
    // remove the test row so this script never leaves auth fixtures behind.
    await pool.query(`DELETE FROM verification WHERE identifier = $1`, [token]);
  }
}

// ── entrypoint ───────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("Login integration test");
  console.log("======================");

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

  // Reset rate-limit buckets for this IP so repeated validation runs don't
  // exhaust the 15-minute window and produce spurious 429s on later roles.
  await fetch(`${BASE}/api/dev/reset-rate-limits`, { method: "POST" }).catch(() => undefined);

  const supporterFixture = await ensureSupporterFixture();
  try {
    // Schema guard: catches column renames / type changes before touching HTTP.
    await checkVerificationSchema();

    // Per-role flows.
    for (const { role, expectedEmail, expectedRedirect } of ROLES) {
      await testRole(role, expectedEmail, expectedRedirect);
    }

    // Supporter role: must redirect to /profile, not /dashboard.
    await testSupporterRole();

    // Magic-link supporter flow has its own redirect branch and must stay on
    // /profile as well.
    await testSupporterMagicLink();
  } finally {
    await cleanupSupporterFixture(supporterFixture);
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
