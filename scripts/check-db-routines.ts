/**
 * Post-publish database routine parity check.
 *
 * Connects to the database (via DATABASE_URL) and confirms that all required
 * custom functions and triggers are present. Run this immediately after
 * publishing to verify that migrations/0045_restore_routine_parity.sql
 * landed correctly.
 *
 * Usage:
 *   DATABASE_URL=<prod-url> npx tsx scripts/check-db-routines.ts
 *
 * Exit 0 — all routines present.
 * Exit 1 — one or more routines missing (names are printed).
 */

import { Pool } from "pg";

// ---------------------------------------------------------------------------
// Required routines — keep in sync with server/db/startup-checks.ts.
// ---------------------------------------------------------------------------

const REQUIRED_FUNCTIONS: ReadonlyArray<{ name: string }> = [
  { name: "guard_counter_columns" },
  { name: "guard_member_request_transitions" },
  { name: "item_request_current_la_date" },
  { name: "item_request_expired_on" },
  { name: "merge_people" },
  { name: "record_item_pledge" },
  { name: "record_volunteer_signup" },
  { name: "reject_expired_item_pledge" },
  { name: "set_updated_at" },
];

const REQUIRED_TRIGGERS: ReadonlyArray<{ name: string; table: string }> = [
  { name: "item_pledges_reject_expired_request",              table: "item_pledges" },
  { name: "item_pledges_set_updated_at",                      table: "item_pledges" },
  { name: "item_requests_guard_member_transitions",           table: "item_requests" },
  { name: "item_requests_set_updated_at",                     table: "item_requests" },
  { name: "items_guard_counters",                             table: "items" },
  { name: "items_set_updated_at",                             table: "items" },
  { name: "org_memberships_set_updated_at",                   table: "org_memberships" },
  { name: "organizations_set_updated_at",                     table: "organizations" },
  { name: "people_set_updated_at",                            table: "people" },
  { name: "users_set_updated_at",                             table: "users" },
  { name: "volunteer_alert_preferences_set_updated_at",       table: "volunteer_alert_preferences" },
  { name: "volunteer_requests_guard_member_transitions",      table: "volunteer_requests" },
  { name: "volunteer_requests_set_updated_at",               table: "volunteer_requests" },
  { name: "volunteer_roles_guard_counters",                   table: "volunteer_roles" },
  { name: "volunteer_roles_set_updated_at",                   table: "volunteer_roles" },
  { name: "volunteer_signups_set_updated_at",                 table: "volunteer_signups" },
];

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("ERROR: DATABASE_URL is not set.");
    process.exit(1);
  }

  const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false } });
  let anyMissing = false;

  try {
    const client = await pool.connect();
    try {
      // ---- Functions --------------------------------------------------------
      console.log(`\nChecking ${REQUIRED_FUNCTIONS.length} required functions…\n`);
      const fnNames = REQUIRED_FUNCTIONS.map((f) => f.name);
      // Scope to the public schema so a same-named function in another schema
      // does not falsely satisfy the check.
      const fnRes = await client.query<{ proname: string }>(
        `SELECT p.proname
           FROM pg_proc p
           JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE p.proname = ANY($1::text[])
            AND n.nspname = 'public'`,
        [fnNames],
      );
      const presentFns = new Set(fnRes.rows.map((r) => r.proname));

      for (const { name } of REQUIRED_FUNCTIONS) {
        if (presentFns.has(name)) {
          console.log(`  ✓  function  ${name}`);
        } else {
          console.error(`  ✖  function  ${name}  ← MISSING`);
          anyMissing = true;
        }
      }

      // ---- Triggers ---------------------------------------------------------
      console.log(`\nChecking ${REQUIRED_TRIGGERS.length} required triggers…\n`);
      const tRes = await client.query<{ tgname: string; relname: string }>(
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
      const presentTriggers = new Set(tRes.rows.map((r) => `${r.tgname}|${r.relname}`));

      for (const { name, table } of REQUIRED_TRIGGERS) {
        if (presentTriggers.has(`${name}|${table}`)) {
          console.log(`  ✓  trigger   ${name}  (on ${table})`);
        } else {
          console.error(`  ✖  trigger   ${name}  (on ${table})  ← MISSING`);
          anyMissing = true;
        }
      }
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }

  if (anyMissing) {
    console.error(
      "\n✖  One or more routines are missing.\n" +
        "   Fix: psql $DATABASE_URL -f migrations/0045_restore_routine_parity.sql\n",
    );
    process.exit(1);
  } else {
    console.log(
      `\n✓  All ${REQUIRED_FUNCTIONS.length} functions and ${REQUIRED_TRIGGERS.length} triggers are present.\n`,
    );
    process.exit(0);
  }
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
