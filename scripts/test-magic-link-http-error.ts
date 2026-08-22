/**
 * Integration test: Task 288 — Better Auth's magic-link endpoint returns HTTP
 * 500 (not 200 OK) when the sendMagicLink callback throws.
 *
 * Task 286 confirmed that sendMagicLinkEmail() throws and leaves no email_log
 * row when finalizeHtml() cannot find the header slot marker. This test
 * exercises the HTTP layer: if Better Auth silently swallows the throw and
 * returns 200 {"status":true}, the browser sees a success message while no
 * email was dispatched. The test confirms that does NOT happen.
 *
 * Strategy: instantiate a local betterAuth instance whose sendMagicLink
 * callback unconditionally throws (the same control-flow outcome as a
 * finalizeHtml() failure). Call auth.handler() directly with a synthetic
 * POST Request — no running Express server required. The same DB pool used
 * by production handles the verification-value write that Better Auth makes
 * before calling sendMagicLink.
 *
 * Checks:
 *   1a. auth.handler() returns an HTTP Response (does not throw).
 *   1b. The response status is exactly 500 — not a silent 200 or any other
 *       code — confirming the unhandled sendMagicLink throw surfaces as an
 *       Internal Server Error.
 *   1c. The response body does not contain {"status":true} (the success
 *       marker Better Auth emits when sendMagicLink returns cleanly).
 *
 * Cleanup: any verification row that Better Auth inserted before the throw is
 * deleted from the verification table so repeated runs are idempotent.
 *
 * Usage:
 *   npm run test:magic-link-http-error
 *
 * Prerequisite: SESSION_SECRET must be set (as in all environments). The seed
 * does not need to have been run — the test uses a fixture email that never
 * reaches the app-level user lookup inside our custom sendMagicLinkEmail().
 */
import { betterAuth } from "better-auth";
import { magicLink } from "better-auth/plugins";
import { pool } from "../server/db/client";
import { appBaseUrl, authTrustedOrigins } from "../server/auth/auth";

// A fixture email that is syntactically valid but deliberately not seeded,
// so the test remains independent of the seed state. Better Auth calls
// sendMagicLink for any syntactically valid email regardless of whether the
// address belongs to a registered user — our application-level gate in
// sendMagicLinkEmail is bypassed here because we inject our own callback.
const FIXTURE_EMAIL = "zz.test-288@fixture.internal";

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string, detail?: unknown): void {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    const extra = detail !== undefined ? `: ${JSON.stringify(detail)}` : "";
    console.error(`  ✗ FAIL: ${label}${extra}`);
    failed++;
  }
}

/**
 * Delete any verification rows that Better Auth inserted for the fixture email
 * before the sendMagicLink callback threw. Better Auth stores {email, name}
 * as a JSON string in the value column; filter by email to scope the delete.
 */
async function cleanupVerificationRows(): Promise<void> {
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM verification
        WHERE value::jsonb->>'email' = $1`,
      [FIXTURE_EMAIL],
    );
    if ((rowCount ?? 0) > 0) {
      console.log(`  (cleaned up ${rowCount} verification row(s) for fixture email)`);
    }
  } catch {
    // Non-fatal: the value column may not be valid JSON in older rows; skip.
  }
}

async function main(): Promise<void> {
  console.log(
    "\nTask 288 — HTTP 500 returned when sendMagicLink callback throws\n",
  );

  // Better Auth requires SESSION_SECRET at instantiation time.
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    console.error(
      "  SKIP: SESSION_SECRET is not set — required to instantiate betterAuth",
    );
    process.exit(1);
  }

  // ── Build a broken auth instance ─────────────────────────────────────────
  // Identical configuration to production except sendMagicLink always throws,
  // reproducing the same abort path as a finalizeHtml() failure in auth.ts.
  const testAuth = betterAuth({
    database: pool,
    secret,
    baseURL: appBaseUrl(),
    trustedOrigins: authTrustedOrigins(),
    emailAndPassword: { enabled: false },
    plugins: [
      magicLink({
        expiresIn: 60 * 15,
        sendMagicLink: async (_params) => {
          throw new Error(
            "zz-test-288: header slot marker missing — sendMagicLink deliberately throws",
          );
        },
      }),
    ],
  });

  // ── Build the synthetic request ───────────────────────────────────────────
  // Better Auth's CSRF middleware checks Origin against trustedOrigins; use
  // appBaseUrl() so the check passes and the request reaches the endpoint.
  const base = appBaseUrl();
  const endpointUrl = `${base}/api/auth/sign-in/magic-link`;

  const req = new Request(endpointUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: base,
    },
    body: JSON.stringify({ email: FIXTURE_EMAIL }),
  });

  // ── Section 1: HTTP response status ───────────────────────────────────────
  console.log(
    "1. POST /api/auth/sign-in/magic-link — sendMagicLink throws\n",
  );

  let response: Response | null = null;

  try {
    response = await testAuth.handler(req);
  } catch (err) {
    // Better Auth is configured without onAPIError.throw, so the router is
    // expected to convert the error to an HTTP response. If it propagates the
    // throw instead, that is a test failure: the contract requires an HTTP
    // response that the browser can inspect, not an unhandled exception.
    failed++;
    console.error(
      `  ✗ FAIL: 1a: auth.handler() must return a Response, not throw`,
    );
    console.error(`         Thrown: ${err}`);
    console.log(`\n${passed + failed} checks — ${passed} passed, ${failed} failed`);
    await cleanupVerificationRows();
    await pool.end();
    process.exit(1);
  } finally {
    // Always clean up verification rows regardless of outcome.
    await cleanupVerificationRows();
  }

  const bodyText = await response.text();

  console.log(`  Response status : ${response.status}`);
  console.log(`  Response body   : ${bodyText.slice(0, 300)}`);
  console.log("");

  assert(
    response.status !== 200,
    `1a: auth.handler() returned a Response (not a throw)`,
  );

  assert(
    response.status === 500,
    `1b: HTTP status is exactly 500 — broken sendMagicLink surfaces as Internal Server Error, not a silent success`,
    { status: response.status },
  );

  // The success payload Better Auth emits when sendMagicLink succeeds is
  // {"status":true}. Confirm it is absent from the response body.
  const bodyLower = bodyText.toLowerCase();
  const looksLikeSuccess =
    bodyLower.includes('"status":true') ||
    bodyLower.includes('"status": true');

  assert(
    !looksLikeSuccess,
    `1c: response body does not contain {"status":true} — not a false success`,
    { body: bodyText.slice(0, 200) },
  );

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log(`\n${passed + failed} checks — ${passed} passed, ${failed} failed`);
  await pool.end();
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
