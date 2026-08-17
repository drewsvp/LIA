/**
 * Applies server/auth/auth-schema.sql (idempotent).
 * Run: npm run db:apply-auth-schema
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { pool } from "../db/client";

async function main(): Promise<void> {
  const file = path.resolve(import.meta.dirname, "auth-schema.sql");
  const sql = readFileSync(file, "utf8");
  await pool.query(sql);
  const rows = await pool.query(
    `select table_name from information_schema.tables
      where table_schema = 'public' and table_name in ('user','session','account','verification')
      order by table_name`,
  );
  if (rows.rows.length !== 4) {
    throw new Error(`Expected 4 auth tables, found: ${rows.rows.map((r) => String(r.table_name)).join(", ")}`);
  }
  console.log("Better Auth tables ready: account, session, user, verification.");
  await pool.end();
}

main().catch((err) => {
  console.error("apply-auth-schema failed:", err);
  process.exit(1);
});
