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
 *
 * After the checks run, their result is stored in a module-level cache so it
 * can be served via GET /api/admin/db-health without re-querying the database
 * on every request.
 */
import { pool } from "./client";

/**
 * Custom PostgreSQL functions that must be present in the public schema.
 * Each entry names the function and the migration that (re-)creates it so
 * the error message points staff to the right repair step.
 *
 * Nine functions — the full set restored by migration 0045.
 */
const REQUIRED_FUNCTIONS: ReadonlyArray<{
  /** pg_proc.proname — unqualified function name */
  name: string;
  /** Migration file that creates or repairs the function */
  migration: string;
}> = [
  { name: "guard_counter_columns",            migration: "0045_restore_routine_parity.sql" },
  { name: "guard_member_request_transitions", migration: "0045_restore_routine_parity.sql" },
  { name: "item_request_current_la_date",     migration: "0045_restore_routine_parity.sql" },
  { name: "item_request_expired_on",          migration: "0045_restore_routine_parity.sql" },
  { name: "merge_people",                     migration: "0045_restore_routine_parity.sql" },
  { name: "record_item_pledge",               migration: "0045_restore_routine_parity.sql" },
  { name: "record_volunteer_signup",          migration: "0045_restore_routine_parity.sql" },
  { name: "reject_expired_item_pledge",       migration: "0045_restore_routine_parity.sql" },
  { name: "set_updated_at",                   migration: "0045_restore_routine_parity.sql" },
];

/**
 * Custom PostgreSQL triggers that must be present in the database.
 * Each entry names the trigger, the table it fires on, and the migration that
 * (re-)creates it so the error message points staff to the right repair step.
 *
 * Sixteen triggers — the full set restored by migration 0045.
 */
const REQUIRED_TRIGGERS: ReadonlyArray<{
  /** pg_trigger.tgname — unqualified trigger name */
  name: string;
  /** pg_class.relname — table the trigger is attached to */
  table: string;
  /** Migration file that creates or repairs the trigger */
  migration: string;
}> = [
  { name: "item_pledges_reject_expired_request",            table: "item_pledges",                    migration: "0045_restore_routine_parity.sql" },
  { name: "item_pledges_set_updated_at",                    table: "item_pledges",                    migration: "0045_restore_routine_parity.sql" },
  { name: "item_requests_guard_member_transitions",         table: "item_requests",                   migration: "0045_restore_routine_parity.sql" },
  { name: "item_requests_set_updated_at",                   table: "item_requests",                   migration: "0045_restore_routine_parity.sql" },
  { name: "items_guard_counters",                           table: "items",                           migration: "0045_restore_routine_parity.sql" },
  { name: "items_set_updated_at",                           table: "items",                           migration: "0045_restore_routine_parity.sql" },
  { name: "org_memberships_set_updated_at",                 table: "org_memberships",                 migration: "0045_restore_routine_parity.sql" },
  { name: "organizations_set_updated_at",                   table: "organizations",                   migration: "0045_restore_routine_parity.sql" },
  { name: "people_set_updated_at",                          table: "people",                          migration: "0045_restore_routine_parity.sql" },
  { name: "users_set_updated_at",                           table: "users",                           migration: "0045_restore_routine_parity.sql" },
  { name: "volunteer_alert_preferences_set_updated_at",     table: "volunteer_alert_preferences",     migration: "0045_restore_routine_parity.sql" },
  { name: "volunteer_requests_guard_member_transitions",    table: "volunteer_requests",              migration: "0045_restore_routine_parity.sql" },
  { name: "volunteer_requests_set_updated_at",              table: "volunteer_requests",              migration: "0045_restore_routine_parity.sql" },
  { name: "volunteer_roles_guard_counters",                 table: "volunteer_roles",                 migration: "0045_restore_routine_parity.sql" },
  { name: "volunteer_roles_set_updated_at",                 table: "volunteer_roles",                 migration: "0045_restore_routine_parity.sql" },
  { name: "volunteer_signups_set_updated_at",               table: "volunteer_signups",               migration: "0045_restore_routine_parity.sql" },
];

// ---------------------------------------------------------------------------
// Result cache — populated once at startup, read by GET /api/admin/db-health.
// ---------------------------------------------------------------------------

export type DbRoutineCheckResult = {
  /**
   * "pending" — startup check has not yet completed (server just started).
   * "ok"      — every required function and trigger was found.
   * "missing" — one or more routines were absent (see missingFunctions/missingTriggers).
   * "error"   — the catalog query itself failed; parity is unverified (see errorMessage).
   *
   * A consumer must treat "error" as not-ok, never as "all present". An
   * "error" result means the database is reachable but the pg_proc/pg_trigger
   * queries could not complete — the same failure mode that would hide a
   * missing routine from a naive "return empty on error" approach.
   */
  status: "pending" | "ok" | "missing" | "error";
  /** Convenience alias: true only when status === "ok". */
  ok: boolean;
  /** ISO timestamp of the completed check, or null when status is "pending". */
  checkedAt: string | null;
  /** Names of public-schema functions not found in pg_proc. Empty unless status === "missing". */
  missingFunctions: string[];
  /** Triggers not found in pg_trigger. Empty unless status === "missing". */
  missingTriggers: Array<{ name: string; table: string }>;
  /** Total required counts — confirms the check ran against the full list. */
  requiredFunctionCount: number;
  requiredTriggerCount: number;
  /** Diagnostic set when status === "error". */
  errorMessage?: string;
};

let _checkResult: DbRoutineCheckResult = {
  status: "pending",
  ok: false,
  checkedAt: null,
  missingFunctions: [],
  missingTriggers: [],
  requiredFunctionCount: REQUIRED_FUNCTIONS.length,
  requiredTriggerCount: REQUIRED_TRIGGERS.length,
};

/**
 * Return the result of the most recent startup check.
 *
 * `status === "pending"` means the server started so recently that the check
 * has not yet finished. Callers must treat "pending" as unverified, not ok.
 */
export function getDbRoutineCheckResult(): DbRoutineCheckResult {
  return _checkResult;
}

// ---------------------------------------------------------------------------
// Internal check result types — used within this module and in tests.
// ---------------------------------------------------------------------------

/** Internal outcome of the pg_proc catalog query. */
type FunctionCheckOutcome =
  | { checkFailed: false; missing: string[] }
  | { checkFailed: true; error: string };

/** Internal outcome of the pg_trigger catalog query. */
type TriggerCheckOutcome =
  | { checkFailed: false; missing: Array<{ name: string; table: string }> }
  | { checkFailed: true; error: string };

// ---------------------------------------------------------------------------
// Individual checks — exported for regression-test scripts.
// ---------------------------------------------------------------------------

/**
 * Query pg_proc for every function listed in REQUIRED_FUNCTIONS, scoped to
 * the public schema, and log an ERROR for each one that is absent.
 *
 * Returns a discriminated outcome: `checkFailed: true` when the DB connection
 * or the catalog query itself fails (the check could not determine parity),
 * `checkFailed: false` with a possibly-empty `missing` list otherwise.
 *
 * Never throws.
 */
export async function checkRequiredDbFunctions(): Promise<FunctionCheckOutcome> {
  if (REQUIRED_FUNCTIONS.length === 0) return { checkFailed: false, missing: [] };

  let client;
  try {
    client = await pool.connect();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[db-check] Could not connect to database for function check:", err);
    return { checkFailed: true, error: `Connection failed: ${message}` };
  }

  try {
    const names = REQUIRED_FUNCTIONS.map((f) => f.name);
    // Scope to the public schema so a same-named function in another schema
    // does not falsely satisfy the check.
    const res = await client.query<{ proname: string }>(
      `SELECT p.proname
         FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE p.proname = ANY($1::text[])
          AND n.nspname = 'public'`,
      [names],
    );
    const present = new Set(res.rows.map((r) => r.proname));
    const missing: string[] = [];

    for (const { name, migration } of REQUIRED_FUNCTIONS) {
      if (!present.has(name)) {
        missing.push(name);
        console.error(
          `[db-check] ✖  Required database function is missing: "${name}"\n` +
            `           This can happen after a clean publish that did not replay all migrations.\n` +
            `           Fix: apply the repair migration → psql $DATABASE_URL -f migrations/${migration}`,
        );
      }
    }

    return { checkFailed: false, missing };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[db-check] Function-presence catalog query failed (non-fatal):", err);
    return { checkFailed: true, error: `Catalog query failed: ${message}` };
  } finally {
    client.release();
  }
}

/**
 * Query pg_trigger for every trigger listed in REQUIRED_TRIGGERS and log an
 * ERROR for each one that is absent.
 *
 * Returns a discriminated outcome: `checkFailed: true` when the DB connection
 * or the catalog query fails, `checkFailed: false` with a possibly-empty
 * `missing` list otherwise.
 *
 * Never throws.
 */
export async function checkRequiredDbTriggers(): Promise<TriggerCheckOutcome> {
  if (REQUIRED_TRIGGERS.length === 0) return { checkFailed: false, missing: [] };

  let client;
  try {
    client = await pool.connect();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[db-check] Could not connect to database for trigger check:", err);
    return { checkFailed: true, error: `Connection failed: ${message}` };
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
    const missing: Array<{ name: string; table: string }> = [];

    for (const { name, table, migration } of REQUIRED_TRIGGERS) {
      if (!present.has(`${name}|${table}`)) {
        missing.push({ name, table });
        console.error(
          `[db-check] ✖  Required database trigger is missing: "${name}" on "${table}"\n` +
            `           This can happen after a clean publish that did not replay all migrations.\n` +
            `           Fix: apply the repair migration → psql $DATABASE_URL -f migrations/${migration}`,
        );
      }
    }

    return { checkFailed: false, missing };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[db-check] Trigger-presence catalog query failed (non-fatal):", err);
    return { checkFailed: true, error: `Catalog query failed: ${message}` };
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Combined runner — called at startup; populates the module-level cache.
// ---------------------------------------------------------------------------

/**
 * Run both the function check and the trigger check, store the combined result
 * in the module-level cache, and log a summary.
 *
 * If either catalog query fails, the cached status is set to "error" so that
 * GET /api/admin/db-health and the admin shell banner communicate "check could
 * not run" rather than silently claiming all routines are present.
 *
 * This is the entry point used by server/index.ts. The caller should
 * `.catch(() => {})` to swallow any unexpected rejection.
 */
export async function runDbRoutineChecks(): Promise<void> {
  const [fnOutcome, tgOutcome] = await Promise.all([
    checkRequiredDbFunctions(),
    checkRequiredDbTriggers(),
  ]);

  const now = new Date().toISOString();

  if (fnOutcome.checkFailed || tgOutcome.checkFailed) {
    // One or both catalog queries could not complete — we cannot assert parity.
    const errors = [
      fnOutcome.checkFailed ? fnOutcome.error : null,
      tgOutcome.checkFailed ? tgOutcome.error : null,
    ]
      .filter(Boolean)
      .join("; ");

    _checkResult = {
      status: "error",
      ok: false,
      checkedAt: now,
      missingFunctions: [],
      missingTriggers: [],
      requiredFunctionCount: REQUIRED_FUNCTIONS.length,
      requiredTriggerCount: REQUIRED_TRIGGERS.length,
      errorMessage: errors,
    };

    console.error(
      `[db-check] ✖  DB routine check could not complete — catalog queries failed. ` +
        `Routine parity is unverified. Check GET /api/admin/db-health for details.`,
    );
    return;
  }

  const missingFunctions = fnOutcome.missing;
  const missingTriggers = tgOutcome.missing;
  const anyMissing = missingFunctions.length > 0 || missingTriggers.length > 0;

  _checkResult = {
    status: anyMissing ? "missing" : "ok",
    ok: !anyMissing,
    checkedAt: now,
    missingFunctions,
    missingTriggers,
    requiredFunctionCount: REQUIRED_FUNCTIONS.length,
    requiredTriggerCount: REQUIRED_TRIGGERS.length,
  };

  if (!anyMissing) {
    console.log(
      `[db-check] ✓  All ${REQUIRED_FUNCTIONS.length} required functions and ` +
        `${REQUIRED_TRIGGERS.length} required triggers are present.`,
    );
  } else {
    console.error(
      `[db-check] ✖  DB routine check complete: ` +
        `${missingFunctions.length} function(s) and ${missingTriggers.length} trigger(s) missing. ` +
        `Run GET /api/admin/db-health as a staff user to see the full list.`,
    );
  }
}
