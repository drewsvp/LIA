/**
 * Server-startup database integrity checks.
 *
 * These checks run once at startup (non-blocking) and log loud ERROR warnings
 * when the production database is missing custom functions that were created in
 * migrations. A clean Replit publish can drop functions/triggers while keeping
 * table columns, so a 42883 "function not found" error can surface to users
 * without any visible deploy-time failure. Catching this here gives staff a
 * chance to run the repair migration before any public traffic is affected.
 *
 * The check MUST NOT throw or crash the server — it warns and continues.
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
