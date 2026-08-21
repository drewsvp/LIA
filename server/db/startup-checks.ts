/**
 * Server-startup database integrity checks.
 *
 * These checks run once at startup (non-blocking) and log loud ERROR warnings
 * when the production database is missing custom functions or triggers that
 * were created in migrations. A clean Replit publish can drop
 * functions/triggers while keeping table columns, so a 42883 "function not
 * found" error (or a silently bypassed trigger) can surface to users without
 * any visible deploy-time failure. Catching this here gives staff a chance to
 * run the repair migration before any public traffic is affected.
 *
 * The checks MUST NOT throw or crash the server — they warn and continue.
 */
import { pool } from "./client";

/**
 * Custom PostgreSQL functions that must be present in the database.
 * Each entry names the function and the migration that (re-)creates it so
 * the error message points staff to the right repair step.
 *
 * When a new migration adds a custom function, add a corresponding entry here.
 */
const REQUIRED_FUNCTIONS: ReadonlyArray<{
  /** pg_proc.proname — unqualified function name */
  name: string;
  /** Migration file that creates or repairs the function */
  migration: string;
}> = [
  {
    name: "guard_counter_columns",
    migration: "0034_split_counter_trigger_branches.sql",
  },
  {
    name: "item_request_expired_on",
    migration: "0044_repair_item_request_expiry_functions.sql",
  },
  {
    name: "item_request_current_la_date",
    migration: "0044_repair_item_request_expiry_functions.sql",
  },
  {
    name: "reject_expired_item_pledge",
    migration: "0044_repair_item_request_expiry_functions.sql",
  },
];

/**
 * Custom PostgreSQL triggers that must be present in the database.
 * Each entry names the trigger, the table it fires on, and the migration that
 * (re-)creates it so the error message points staff to the right repair step.
 *
 * When a new migration adds a custom trigger, add a corresponding entry here.
 */
const REQUIRED_TRIGGERS: ReadonlyArray<{
  /** pg_trigger.tgname — unqualified trigger name */
  name: string;
  /** pg_class.relname — table the trigger is attached to */
  table: string;
  /** Migration file that creates or repairs the trigger */
  migration: string;
}> = [
  {
    name: "item_pledges_reject_expired_request",
    table: "item_pledges",
    migration: "0044_repair_item_request_expiry_functions.sql",
  },
];

/**
 * Query pg_proc for every function listed in REQUIRED_FUNCTIONS and log an
 * ERROR for each one that is absent. Returns without throwing even on DB error.
 */
export async function checkRequiredDbFunctions(): Promise<void> {
  if (REQUIRED_FUNCTIONS.length === 0) return;

  let client;
  try {
    client = await pool.connect();
  } catch (err) {
    // DB not yet reachable — skip; other startup paths will surface the error.
    console.error("[db-check] Could not connect to database for function check:", err);
    return;
  }

  try {
    const names = REQUIRED_FUNCTIONS.map((f) => f.name);
    const res = await client.query<{ proname: string }>(
      "SELECT proname FROM pg_proc WHERE proname = ANY($1::text[])",
      [names],
    );
    const present = new Set(res.rows.map((r) => r.proname));

    for (const { name, migration } of REQUIRED_FUNCTIONS) {
      if (!present.has(name)) {
        console.error(
          `[db-check] ✖  Required database function is missing: "${name}"\n` +
            `           This can happen after a clean publish that did not replay all migrations.\n` +
            `           Fix: apply the repair migration → psql $DATABASE_URL -f migrations/${migration}`,
        );
      }
    }
  } catch (err) {
    console.error("[db-check] Function-presence check failed (non-fatal):", err);
  } finally {
    client.release();
  }
}

/**
 * Query pg_trigger for every trigger listed in REQUIRED_TRIGGERS and log an
 * ERROR for each one that is absent. Returns without throwing even on DB error.
 */
export async function checkRequiredDbTriggers(): Promise<void> {
  if (REQUIRED_TRIGGERS.length === 0) return;

  let client;
  try {
    client = await pool.connect();
  } catch (err) {
    // DB not yet reachable — skip; other startup paths will surface the error.
    console.error("[db-check] Could not connect to database for trigger check:", err);
    return;
  }

  try {
    // Join pg_trigger → pg_class to match both trigger name and table name so
    // a trigger with the same name on a different table does not pass the check.
    const res = await client.query<{ tgname: string; relname: string }>(
      `SELECT t.tgname, c.relname
         FROM pg_trigger t
         JOIN pg_class  c ON c.oid = t.tgrelid
        WHERE t.tgname  = ANY($1::text[])
          AND c.relname = ANY($2::text[])
          AND NOT t.tgisinternal`,
      [
        REQUIRED_TRIGGERS.map((t) => t.name),
        REQUIRED_TRIGGERS.map((t) => t.table),
      ],
    );

    // Build a set of "name|table" keys for O(1) lookup.
    const present = new Set(res.rows.map((r) => `${r.tgname}|${r.relname}`));

    for (const { name, table, migration } of REQUIRED_TRIGGERS) {
      if (!present.has(`${name}|${table}`)) {
        console.error(
          `[db-check] ✖  Required database trigger is missing: "${name}" on "${table}"\n` +
            `           This can happen after a clean publish that did not replay all migrations.\n` +
            `           Fix: apply the repair migration → psql $DATABASE_URL -f migrations/${migration}`,
        );
      }
    }
  } catch (err) {
    console.error("[db-check] Trigger-presence check failed (non-fatal):", err);
  } finally {
    client.release();
  }
}
