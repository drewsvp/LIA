/**
 * Applies server/db/rls-policies.sql (idempotent). Run: npm run db:apply-rls
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { pool } from "./client";

async function main(): Promise<void> {
  const file = path.resolve(import.meta.dirname, "rls-policies.sql");
  const sql = readFileSync(file, "utf8");
  await pool.query(sql);
  const rows = await pool.query(
    `select relname, relrowsecurity, relforcerowsecurity
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and relkind = 'r'
        and relname not in ('user','session','account','verification','schema_migrations')
      order by relname`,
  );
  const missing = rows.rows.filter((r) => !(r.relrowsecurity && r.relforcerowsecurity));
  if (missing.length > 0) {
    throw new Error(`RLS not forced on: ${missing.map((r) => String(r.relname)).join(", ")}`);
  }
  console.log(`RLS enabled and forced on ${rows.rows.length} application tables.`);
  await pool.end();
}

main().catch((err) => {
  console.error("apply-rls failed:", err);
  process.exit(1);
});
