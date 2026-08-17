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
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { pool } from "./client";

const BASELINE_FILE = "0001_initial_schema.sql";

async function main(): Promise<void> {
  const dir = path.resolve(import.meta.dirname, "../../migrations");
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  if (files.length === 0) throw new Error(`no .sql files found in ${dir}`);

  await pool.query(`create table if not exists schema_migrations (
    filename   text primary key,
    sha256     text not null,
    applied_at timestamptz not null default now()
  )`);

  const recordedRows = await pool.query(`select filename, sha256 from schema_migrations`);
  const recorded = new Map<string, string>(
    recordedRows.rows.map((r): [string, string] => [String(r.filename), String(r.sha256)]),
  );

  for (const filename of files) {
    const sql = readFileSync(path.join(dir, filename), "utf8");
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

    if (filename === BASELINE_FILE) {
      const probe = await pool.query(`select to_regclass('public.people') is not null as present`);
      if (probe.rows[0]?.present === true) {
        await pool.query(`insert into schema_migrations (filename, sha256) values ($1, $2)`, [filename, sha]);
        console.log(`  ${filename} — schema already present (pre-runner database); recorded without running`);
        continue;
      }
    }

    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(sql);
      await client.query(`insert into schema_migrations (filename, sha256) values ($1, $2)`, [filename, sha]);
      await client.query("commit");
      console.log(`  ${filename} — applied`);
    } catch (err) {
      try {
        await client.query("rollback");
      } catch {
        /* the original error is the one that matters */
      }
      throw new Error(`${filename} failed: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
    } finally {
      client.release();
    }
  }

  const total = await pool.query(`select count(*)::int as n from schema_migrations`);
  console.log(`migrations up to date (${Number(total.rows[0].n)} recorded).`);
  await pool.end();
}

main().catch((err) => {
  console.error("apply-migrations failed:", err);
  process.exit(1);
});
