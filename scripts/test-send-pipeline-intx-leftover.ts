/**
 * Integration test: Task 284 — queueProductEmailInTx throws EmailConfigError
 * and leaves no orphaned email_log row when the rendered output still contains
 * a literal placeholder token (the leftoverPlaceholders check).
 *
 * Verifies that the leftover-placeholder throw site inside queueProductEmailInTx
 * — which fires after render() but before the email_log INSERT — aborts the
 * caller's transaction cleanly, leaving no orphaned row. This is the InTx
 * counterpart of the non-transactional leftover test in
 * scripts/test-send-pipeline-leftover.ts.
 *
 * The trick: organizationName is set to "Fixture {leftoverVar} Org". fillText
 * is single-pass, so after substituting {organizationName} the rendered subject
 * still contains "{leftoverVar}" literally. Because leftoverVar is also a key
 * in vars, leftoverPlaceholders detects the surviving token and throws
 * EmailConfigError with "literal placeholder" in the message before any
 * email_log INSERT, aborting the caller's transaction cleanly.
 *
 * Checks:
 *   1a. The call throws EmailConfigError (not a generic Error).
 *   1b. The error message names the leftover key (leftoverVar).
 *   1c. The error message contains "literal placeholder".
 *   2a. No email_log row exists for the test entity after rollback.
 *
 * Usage:
 *   npm run test:send-pipeline-intx-leftover
 *
 * The development server must be running. No rows are written (the throw fires
 * before the INSERT), so there is nothing to clean up.
 */
import { pool } from "../server/db/client";
import { queueProductEmailInTx, EmailConfigError } from "../server/email/send";

const LEFTOVER_INTX_EMAIL = "zz.send-intx-leftover@example.test";
// Reserved nil-prefix UUID block (ffff) — will never collide with real data.
const ENTITY_ID = "00000000-0000-0000-ffff-000000000284";

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

async function cleanup(): Promise<void> {
  await pool.query(
    `delete from email_log where to_email = $1 and entity_id = $2::uuid`,
    [LEFTOVER_INTX_EMAIL, ENTITY_ID],
  );
}

async function main(): Promise<void> {
  console.log("\nTask 284 — queueProductEmailInTx leftover-placeholder → no orphaned row\n");

  // Pre-clean any rows from a prior aborted run (the throw should prevent any
  // row from being written, but clean up defensively in case of test drift).
  await cleanup();

  // All required fields for org_approved are present and non-empty, but
  // organizationName embeds a literal {leftoverVar} token. fillText is
  // single-pass: after substituting {organizationName} the rendered output
  // still contains "{leftoverVar}" literally. Because leftoverVar is also a
  // key in vars, leftoverPlaceholders fires and queueProductEmailInTx throws
  // EmailConfigError before any email_log INSERT, aborting the caller's
  // transaction cleanly.
  const vars = {
    organizationName: "Fixture {leftoverVar} Org", // embeds a literal token
    orgAddress: null,
    orgPhoneNumber: null,
    websiteUrl: null,
    missionStatement: null,
    primaryPopulationServed: null,
    organizationPrimaryContact: "Fixture Contact",
    organizationPrimaryContactEmail: "contact@fixture.test",
    organizationPrimaryContactPhone: null,
    dashboardUrl: "https://fixture.test/dashboard",
    leftoverVar: "orphaned", // key present → leftoverPlaceholders fires
  };

  // ── Section 1: throw behaviour ────────────────────────────────────────────
  console.log("1. queueProductEmailInTx — leftover-placeholder throw aborts transaction");

  let thrownError: unknown = null;
  const client = await pool.connect();
  try {
    await client.query("begin");
    await queueProductEmailInTx(client, {
      key: "org_approved",
      entityId: ENTITY_ID,
      entityType: "organization",
      toEmail: LEFTOVER_INTX_EMAIL,
      vars,
    });
    // Should never reach here — roll back the no-op transaction.
    await client.query("rollback");
  } catch (err) {
    thrownError = err;
    await client.query("rollback").catch(() => undefined);
  } finally {
    client.release();
  }

  assert(
    thrownError instanceof EmailConfigError,
    "1a: throws EmailConfigError (not a generic Error)",
    thrownError instanceof Error
      ? `${thrownError.name}: ${thrownError.message}`
      : String(thrownError),
  );
  assert(
    thrownError instanceof EmailConfigError &&
      thrownError.message.includes("leftoverVar"),
    "1b: error message names the leftover key (leftoverVar)",
    thrownError instanceof Error ? thrownError.message : undefined,
  );
  assert(
    thrownError instanceof EmailConfigError &&
      thrownError.message.toLowerCase().includes("literal placeholder"),
    "1c: error message contains 'literal placeholder'",
    thrownError instanceof Error ? thrownError.message : undefined,
  );

  // ── Section 2: no row written ─────────────────────────────────────────────
  console.log("\n2. No email_log row written after transaction rollback");

  const { rows } = await pool.query<{ count: string }>(
    `select count(*)::text as count
       from email_log
      where to_email = $1
        and entity_id = $2::uuid`,
    [LEFTOVER_INTX_EMAIL, ENTITY_ID],
  );
  const rowCount = parseInt(rows[0]!.count, 10);
  assert(
    rowCount === 0,
    "2a: no email_log row exists for the test entity after rollback",
    { rowCount },
  );

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log(`\n${passed + failed} checks — ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
