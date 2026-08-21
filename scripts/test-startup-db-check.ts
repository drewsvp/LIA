/**
 * Regression checks for the startup DB check utilities.
 *
 * Test 1 — connection-failure guard (no real DB access)
 *   Stubs pool.connect to reject and asserts that checkRequiredDbFunctions()
 *   swallows the error, logs "[db-check] Could not connect", and returns
 *   normally without throwing.
 *
 * Test 2 — missing-function warning
 *   Temporarily drops item_request_expired_on from the database, runs
 *   checkRequiredDbFunctions(), and asserts that console.error was called with
 *   the function name and the repair migration filename. The function is
 *   restored in a finally block so the database is never left in a broken
 *   state.
 *
 * Usage: NODE_ENV=development npx tsx scripts/test-startup-db-check.ts
 * Exit 0 = pass.
 */
import { pool } from "../server/db/client";
import { checkRequiredDbFunctions } from "../server/db/startup-checks";

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

const FUNCTION_NAME = "item_request_expired_on";
const MIGRATION_FILE = "0044_repair_item_request_expiry_functions.sql";

/**
 * The CREATE OR REPLACE body from migrations/0044 — used to restore the
 * function after the test drops it. Must match the canonical definition so
 * the trigger that calls it continues to work after the test exits.
 */
const RESTORE_SQL = `
  create or replace function item_request_expired_on(
    p_deadline_type text,
    p_deadline_date date,
    p_expires_on date,
    p_today date
  ) returns boolean
  language sql
  immutable
  as $$
    select
      (p_expires_on is not null and p_expires_on < p_today)
      or (
        p_deadline_type = 'date_specific'
        and p_deadline_date is not null
        and p_deadline_date < p_today
      );
  $$
`;

/**
 * Test 1 — connection-failure guard.
 *
 * Stubs pool.connect so it rejects immediately, then calls
 * checkRequiredDbFunctions() and asserts:
 *   - the function returns normally (does not throw)
 *   - console.error was called with the "[db-check] Could not connect" message
 *
 * The real database is never contacted; no cleanup is needed.
 */
async function testConnectionFailure(): Promise<void> {
  console.log("startup-db-check: connection-failure guard\n");

  const capturedErrors: string[] = [];
  const realConsoleError = console.error;
  console.error = (...args: unknown[]) => {
    capturedErrors.push(args.map(String).join(" "));
  };

  // Replace pool.connect with a stub that simulates an unreachable database.
  const realConnect = pool.connect.bind(pool);
  (pool as any).connect = (): Promise<never> =>
    Promise.reject(new Error("ECONNREFUSED — simulated unreachable DB"));

  let threw = false;
  try {
    await checkRequiredDbFunctions();
  } catch {
    threw = true;
  } finally {
    // Restore both before asserting so assert() output goes to real stderr.
    (pool as any).connect = realConnect;
    console.error = realConsoleError;
  }

  const combined = capturedErrors.join("\n");

  console.log("--- warnings captured ---");
  console.log(combined || "(none)");
  console.log("-------------------------\n");

  assert(
    !threw,
    "checkRequiredDbFunctions() does not throw when pool.connect rejects",
  );
  assert(
    capturedErrors.some((m) => m.includes("[db-check] Could not connect")),
    'console.error includes "[db-check] Could not connect"',
    combined,
  );
}

async function main(): Promise<void> {
  await testConnectionFailure();

  console.log("\nstartup-db-check: missing-function warning\n");

  // Intercept console.error so we can assert on the messages it receives.
  const capturedErrors: string[] = [];
  const realConsoleError = console.error;
  console.error = (...args: unknown[]) => {
    capturedErrors.push(args.map(String).join(" "));
  };

  try {
    // Remove the function so the check sees it as absent.
    // item_request_expired_on is a SQL-language function; the PL/pgSQL trigger
    // function that calls it does not create a pg_depend entry, so the plain
    // DROP (no CASCADE) succeeds without touching the trigger.
    await pool.query(
      "DROP FUNCTION IF EXISTS item_request_expired_on(text, date, date, date)",
    );

    // Run the startup check — it should emit a console.error for every absent
    // function it finds, including the one we just dropped.
    await checkRequiredDbFunctions();
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
    capturedErrors.some((m) => m.includes(FUNCTION_NAME)),
    `console.error includes the missing function name "${FUNCTION_NAME}"`,
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
      "FATAL: could not restore item_request_expired_on — run " +
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
