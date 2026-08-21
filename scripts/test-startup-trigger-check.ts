/**
 * Regression check for the missing-trigger startup warning.
 *
 * Temporarily drops item_pledges_reject_expired_request from the database,
 * runs checkRequiredDbTriggers(), and asserts that console.error was called
 * with the trigger name and the repair migration filename. The trigger is
 * restored in a finally block so the database is never left in a broken state.
 *
 * Usage: NODE_ENV=development npx tsx scripts/test-startup-trigger-check.ts
 * Exit 0 = pass.
 */
import { pool } from "../server/db/client";
import { checkRequiredDbTriggers } from "../server/db/startup-checks";

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string, detail = ""): void {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed += 1;
  } else {
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
    failed += 1;
  }
}

const TRIGGER_NAME = "item_pledges_reject_expired_request";
const TRIGGER_TABLE = "item_pledges";
const MIGRATION_FILE = "0044_repair_item_request_expiry_functions.sql";

/**
 * The CREATE TRIGGER statement from migrations/0044 — used to restore the
 * trigger after the test drops it. Must match the canonical definition so
 * pledge inserts continue to be guarded after the test exits.
 */
const RESTORE_SQL = `
  drop trigger if exists item_pledges_reject_expired_request on item_pledges;
  create trigger item_pledges_reject_expired_request
    before insert on item_pledges
    for each row execute function reject_expired_item_pledge()
`;

async function main(): Promise<void> {
  console.log("startup-db-check: missing-trigger warning\n");

  // Intercept console.error so we can assert on the messages it receives.
  const capturedErrors: string[] = [];
  const realConsoleError = console.error;
  console.error = (...args: unknown[]) => {
    capturedErrors.push(args.map(String).join(" "));
  };

  try {
    // Remove the trigger so the check sees it as absent.
    // The underlying reject_expired_item_pledge() function is left in place so
    // we can recreate the trigger without re-creating its function.
    await pool.query(
      `DROP TRIGGER IF EXISTS ${TRIGGER_NAME} ON ${TRIGGER_TABLE}`,
    );

    // Run the startup check — it should emit a console.error for every absent
    // trigger it finds, including the one we just dropped.
    await checkRequiredDbTriggers();
  } finally {
    // Restore console.error before asserting so that assert() failures are
    // printed to the real stderr and visible in the terminal.
    console.error = realConsoleError;
  }

  const combined = capturedErrors.join("\n");

  console.log("--- warnings captured ---");
  console.log(combined || "(none)");
  console.log("-------------------------\n");

  assert(
    capturedErrors.some((m) => m.includes(TRIGGER_NAME)),
    `console.error includes the missing trigger name "${TRIGGER_NAME}"`,
    combined,
  );
  assert(
    capturedErrors.some((m) => m.includes(MIGRATION_FILE)),
    `console.error includes the repair migration filename "${MIGRATION_FILE}"`,
    combined,
  );
  assert(
    capturedErrors.some((m) => m.includes("[db-check]")),
    "console.error uses the [db-check] prefix",
    combined,
  );

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

async function restore(): Promise<void> {
  try {
    await pool.query(RESTORE_SQL);
  } catch (err) {
    console.error(
      "FATAL: could not restore item_pledges_reject_expired_request — run " +
        "migrations/0044_repair_item_request_expiry_functions.sql manually:",
      err,
    );
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(restore);
