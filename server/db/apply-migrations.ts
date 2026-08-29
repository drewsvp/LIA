/**
 * Migration runner — applies every migrations/*.sql exactly once per database.
 * Run: npm run db:apply-migrations (safe on fresh AND existing databases).
 *
 * Bookkeeping lives in schema_migrations (filename primary key + sha256).
 * Each pending migration runs in ONE transaction together with its
 * bookkeeping row: a failure rolls back both, a success records both.
 * Re-running no-ops on recorded files and FAILS LOUDLY if a recorded file's
 * content changed after it was applied — applied migrations are immutable.
 *
 * Baseline: databases initialized before this runner existed already have
 * 0001_initial_schema.sql applied (the people table proves it). When
 * schema_migrations has no row for 0001 but the schema is present, the
 * runner records 0001 as applied WITHOUT running it and says so. Only 0001
 * is ever baselined this way.
 *
 * Second baseline — the 2026-08-21 production ledger drift:
 * production's schema is kept in step by Replit's publish diff, which carries
 * tables and columns but not the ledger, so these files were never recorded
 * there even though their objects exist. Re-running one fails on "already
 * exists" and takes the whole deploy down. Each file in PUBLISH_SYNCED below
 * was checked against production before being listed — see that comment. A
 * duplicate-object failure on one of them is recorded and skipped, loudly.
 * Every other file gets no tolerance: a duplicate-object error there is a
 * real conflict and must fail.
 */
import { createHash } from "node:crypto";
import { pool } from "./client";
import {
  readMigrationFiles,
  withoutTopLevelTransactionControl,
} from "./migration-files";

const BASELINE_FILE = "0001_initial_schema.sql";

/**
 * The exact files unrecorded in production on 2026-08-21, when the deploy
 * build first ran this runner there. Before listing them, development and
 * production were compared object by object — columns, constraints, indexes,
 * row-security flags and policies were identical, the one email_schedules
 * seed row was present, and digest_runs was empty so its backfill had nothing
 * to do. The only genuine gap was functions and triggers, which
 * 0045_restore_routine_parity.sql recreates.
 *
 * This list is closed. Never add to it: a new migration must apply cleanly,
 * and a duplicate-object error in one is a real conflict.
 */
const PUBLISH_SYNCED = new Set([
  "0008_email_template_overrides.sql",
  "0008_item_image_generation.sql",
  "0009_digest_runs.sql",
  "0009_email_template_overrides_updated_by.sql",
  "0010_digest_run_needs_snapshot.sql",
  "0011_image_gen_retries.sql",
  "0012_digest_exclusions.sql",
  "0012_email_log_failure_structured.sql",
  "0013_digest_exclusions_simpler_key.sql",
  "0014_supporter_user_kind.sql",
  "0034_split_counter_trigger_branches.sql",
  "0035_volunteer_image_generation.sql",
  "0036_item_request_deadline_expiry.sql",
  "0037_email_schedules.sql",
  "0037_volunteer_interests.sql",
  "0038_digest_run_occurrences.sql",
  "0038_volunteer_request_categories.sql",
  "0039_matching_volunteer_alerts.sql",
  "0040_request_analytics_parent_ownership_keys.sql",
  "0041_request_engagement.sql",
  "0042_engagement_child_ownership.sql",
  "0043_request_revisions.sql",
  "0043_volunteer_signup_expiry_check.sql",
  "0044_repair_item_request_expiry_functions.sql",
]);

/**
 * Postgres "this object already exists" error codes: duplicate_table (which
 * also covers indexes and sequences), duplicate_object, duplicate_column,
 * duplicate_function, duplicate_schema.
 */
const DUPLICATE_OBJECT_CODES = new Set(["42P07", "42710", "42701", "42723", "42P06"]);

function isAlreadyMaterialized(filename: string, err: unknown): boolean {
  if (!PUBLISH_SYNCED.has(filename)) return false;
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === "string" && DUPLICATE_OBJECT_CODES.has(code);
}

export async function applyMigrations(): Promise<void> {
  const files = readMigrationFiles();
  const client = await pool.connect();
  let transactionStarted = false;

  try {
    await client.query("begin");
    transactionStarted = true;
    // Serialize startup/build-tool invocations. The lock is transaction-local,
    // so it is released on either commit or rollback.
    await client.query(`select pg_advisory_xact_lock(hashtext('lia-schema-migrations'))`);
    await client.query(`create table if not exists schema_migrations (
      filename   text primary key,
      sha256     text not null,
      applied_at timestamptz not null default now()
    )`);

    const recordedRows = await client.query(`select filename, sha256 from schema_migrations`);
    const recorded = new Map<string, string>(
      recordedRows.rows.map((r): [string, string] => [String(r.filename), String(r.sha256)]),
    );

    for (const { filename, sql } of files) {
      const sha = createHash("sha256").update(sql).digest("hex");
      const prior = recorded.get(filename);

      if (prior !== undefined) {
        if (prior !== sha) {
          throw new Error(
            `${filename} changed after it was applied (recorded ${prior.slice(0, 12)}…, on disk ${sha.slice(0, 12)}…). ` +
              `Applied migrations are immutable — write a new migration instead.`,
          );
        }
        console.log(`  ${filename} — already applied`);
        continue;
      }

      await client.query("savepoint migration_file");
      try {
        if (filename === BASELINE_FILE) {
          const probe = await client.query(
            `select to_regclass('public.people') is not null as present`,
          );
          if (probe.rows[0]?.present === true) {
            await client.query(
              `insert into schema_migrations (filename, sha256) values ($1, $2)`,
              [filename, sha],
            );
            await client.query("release savepoint migration_file");
            console.log(
              `  ${filename} — schema already present (pre-runner database); recorded without running`,
            );
            recorded.set(filename, sha);
            continue;
          }
        }

        // Set the RLS context GUCs locally so migrations that write to
        // FORCE ROW LEVEL SECURITY tables pass the system/staff policies.
        await client.query(
          `select set_config('app.context', 'system', true),
                  set_config('app.user_id', '', true)`,
        );
        await client.query(withoutTopLevelTransactionControl(sql));
        await client.query(
          `insert into schema_migrations (filename, sha256) values ($1, $2)`,
          [filename, sha],
        );
        await client.query("release savepoint migration_file");
        console.log(`  ${filename} — applied`);
        recorded.set(filename, sha);
      } catch (err) {
        try {
          await client.query("rollback to savepoint migration_file");
          await client.query("release savepoint migration_file");
        } catch {
          /* the original error is the one that matters */
        }
        if (isAlreadyMaterialized(filename, err)) {
          // The objects are already there (publish synced the tables without
          // the ledger). Keep this exception closed and explicit: anything
          // beyond those objects in this file did not run.
          await client.query(
            `insert into schema_migrations (filename, sha256) values ($1, $2)`,
            [filename, sha],
          );
          console.warn(
            `  ${filename} — objects already exist (${(err as { code?: string }).code}); recorded WITHOUT running. ` +
              `Anything else in this file did not run.`,
          );
          recorded.set(filename, sha);
          continue;
        }
        throw new Error(
          `${filename} failed: ${err instanceof Error ? err.message : String(err)}`,
          { cause: err },
        );
      }
    }

    await client.query("commit");
    transactionStarted = false;
    console.log(`migrations up to date (${recorded.size} recorded).`);
  } catch (err) {
    if (transactionStarted) {
      try {
        await client.query("rollback");
      } catch {
        /* the original error is the one that matters */
      }
    }
    throw err;
  } finally {
    client.release();
  }
}

async function main(): Promise<void> {
  try {
    await applyMigrations();
  } finally {
    await pool.end();
  }
}

if (process.argv[1]?.endsWith("apply-migrations.ts")) {
  main().catch((err) => {
    console.error("apply-migrations failed:", err);
    process.exit(1);
  });
}
