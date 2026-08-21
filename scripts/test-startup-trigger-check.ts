/**
 * Regression check for the missing-trigger startup warning.
 *
 * For each entry in TRIGGER_CASES, temporarily drops the trigger from the
 * database, runs checkRequiredDbTriggers(), and asserts that console.error was
 * called with the trigger name and the repair migration filename. Each trigger
 * is restored immediately after its case so the database is never left in a
 * broken state.
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

interface TriggerCase {
  name: string;
  table: string;
  migration: string;
  /** SQL that (re-)creates the trigger after the test drops it. */
  restoreSql: string;
}

const TRIGGER_CASES: TriggerCase[] = [
  {
    name: "item_pledges_reject_expired_request",
    table: "item_pledges",
    migration: "0045_restore_routine_parity.sql",
    restoreSql: `
      drop trigger if exists item_pledges_reject_expired_request on item_pledges;
      create trigger item_pledges_reject_expired_request
        before insert on item_pledges
        for each row execute function reject_expired_item_pledge()
    `,
  },
  {
    name: "items_guard_counters",
    table: "items",
    migration: "0045_restore_routine_parity.sql",
    restoreSql: `
      drop trigger if exists items_guard_counters on items;
      create trigger items_guard_counters
        before update on items
        for each row execute function guard_counter_columns()
    `,
  },
  {
    name: "volunteer_roles_guard_counters",
    table: "volunteer_roles",
    migration: "0045_restore_routine_parity.sql",
    restoreSql: `
      drop trigger if exists volunteer_roles_guard_counters on volunteer_roles;
      create trigger volunteer_roles_guard_counters
        before update on volunteer_roles
        for each row execute function guard_counter_columns()
    `,
  },
];

async function runCase(tc: TriggerCase): Promise<void> {
  console.log(`\n--- ${tc.name} on ${tc.table} ---`);

  const capturedErrors: string[] = [];
  const realConsoleError = console.error;
  console.error = (...args: unknown[]) => {
    capturedErrors.push(args.map(String).join(" "));
  };

  try {
    await pool.query(`DROP TRIGGER IF EXISTS ${tc.name} ON ${tc.table}`);
    await checkRequiredDbTriggers();
  } finally {
    console.error = realConsoleError;
  }

  const combined = capturedErrors.join("\n");
  console.log("warnings captured:");
  console.log(combined || "(none)");

  assert(
    capturedErrors.some((m) => m.includes(tc.name)),
    `console.error includes the missing trigger name "${tc.name}"`,
    combined,
  );
  assert(
    capturedErrors.some((m) => m.includes(tc.migration)),
    `console.error includes the repair migration filename "${tc.migration}"`,
    combined,
  );
  assert(
    capturedErrors.some((m) => m.includes("[db-check]")),
    "console.error uses the [db-check] prefix",
    combined,
  );

  // Restore immediately so later cases and the application are unaffected.
  try {
    await pool.query(tc.restoreSql);
    console.log(`  (restored ${tc.name})`);
  } catch (err) {
    console.error(
      `FATAL: could not restore ${tc.name} on ${tc.table} — apply the repair migration manually:`,
      err,
    );
    process.exitCode = 1;
  }
}

async function main(): Promise<void> {
  console.log("startup-db-check: missing-trigger warnings\n");

  for (const tc of TRIGGER_CASES) {
    await runCase(tc);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
