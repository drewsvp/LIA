import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { pool } from "../server/db/client";
import { applyMigrations } from "../server/db/apply-migrations";
import {
  readMigrationFiles,
  withoutTopLevelTransactionControl,
} from "../server/db/migration-files";
import {
  checkDbSchemaVersion,
  checkRequiredRlsEnforcement,
  REQUIRED_RLS_TABLES,
} from "../server/db/startup-checks";

type QueryRow = Record<string, unknown>;
type FakeQuery = (text: string, values?: unknown[]) => Promise<{ rows: QueryRow[] }>;

const files = readMigrationFiles();
const shaByFilename = new Map(
  files.map(({ filename, sql }) => [
    filename,
    createHash("sha256").update(sql).digest("hex"),
  ]),
);
const sqlToFilename = new Map(
  files.map(({ filename, sql }) => [
    withoutTopLevelTransactionControl(sql).trim(),
    filename,
  ]),
);

let passed = 0;

function assert(condition: boolean, label: string): void {
  if (!condition) throw new Error(`FAIL: ${label}`);
  passed += 1;
  console.log(`  ✓ ${label}`);
}

async function withFakeClient<T>(
  query: FakeQuery,
  fn: () => Promise<T>,
): Promise<T> {
  const mutablePool = pool as unknown as {
    connect: typeof pool.connect;
  };
  const realConnect = pool.connect.bind(pool);
  const client = {
    query,
    release: () => {},
  } as unknown as PoolClient;
  mutablePool.connect = (() => Promise.resolve(client)) as typeof pool.connect;

  try {
    return await fn();
  } finally {
    mutablePool.connect = realConnect;
  }
}

function recordedRows(except: ReadonlySet<string>): QueryRow[] {
  return files
    .filter(({ filename }) => !except.has(filename))
    .map(({ filename }) => ({
      filename,
      sha256: shaByFilename.get(filename),
    }));
}

async function testPendingBatchRollsBackTogether(): Promise<void> {
  const pending = files.slice(-2).map(({ filename }) => filename);
  const commands: string[] = [];
  let currentFilename: string | undefined;

  let rejected = false;
  await withFakeClient(
    async (text) => {
      const normalized = text.trim();
      commands.push(normalized);
      if (normalized === "select filename, sha256 from schema_migrations") {
        return { rows: recordedRows(new Set(pending)) };
      }
      currentFilename = sqlToFilename.get(normalized) ?? currentFilename;
      if (currentFilename === pending[1] && sqlToFilename.has(normalized)) {
        throw new Error("simulated second migration failure");
      }
      return { rows: [] };
    },
    async () => {
      const realLog = console.log;
      console.log = () => {};
      try {
        await applyMigrations();
      } catch {
        rejected = true;
      } finally {
        console.log = realLog;
      }
    },
  );

  assert(rejected, "a failed migration rejects startup migration application");
  assert(commands.includes("rollback"), "a later failure rolls back the outer batch transaction");
  assert(!commands.includes("commit"), "a failed pending batch never commits an earlier migration");
  assert(
    commands.some((text) => text.includes("pg_advisory_xact_lock")),
    "the ledger is read under the transaction-scoped advisory lock",
  );
}

async function testClosedLedgerDriftException(): Promise<void> {
  const filename = "0044_repair_item_request_expiry_functions.sql";
  const commands: string[] = [];

  await withFakeClient(
    async (text) => {
      const normalized = text.trim();
      commands.push(normalized);
      if (normalized === "select filename, sha256 from schema_migrations") {
        return { rows: recordedRows(new Set([filename])) };
      }
      if (sqlToFilename.get(normalized) === filename) {
        const duplicate = new Error("already exists") as Error & { code: string };
        duplicate.code = "42P07";
        throw duplicate;
      }
      return { rows: [] };
    },
    async () => {
      const realLog = console.log;
      const realWarn = console.warn;
      console.log = () => {};
      console.warn = () => {};
      try {
        await applyMigrations();
      } finally {
        console.log = realLog;
        console.warn = realWarn;
      }
    },
  );

  assert(commands.includes("commit"), "an audited publish-synced duplicate can be baselined");
  assert(
    commands.some(
      (text) =>
        text.startsWith("insert into schema_migrations") &&
        text.includes("(filename, sha256)"),
    ),
    "the audited duplicate records its ledger row",
  );
}

async function testUnknownDuplicateFailsClosed(): Promise<void> {
  const filename = files.at(-1)?.filename;
  if (!filename) throw new Error("migration manifest is empty");
  const commands: string[] = [];
  let rejected = false;

  await withFakeClient(
    async (text) => {
      const normalized = text.trim();
      commands.push(normalized);
      if (normalized === "select filename, sha256 from schema_migrations") {
        return { rows: recordedRows(new Set([filename])) };
      }
      if (sqlToFilename.get(normalized) === filename) {
        const duplicate = new Error("already exists") as Error & { code: string };
        duplicate.code = "42P07";
        throw duplicate;
      }
      return { rows: [] };
    },
    async () => {
      const realLog = console.log;
      console.log = () => {};
      try {
        await applyMigrations();
      } catch {
        rejected = true;
      } finally {
        console.log = realLog;
      }
    },
  );

  assert(rejected, "a duplicate outside the audited drift list fails closed");
  assert(commands.includes("rollback"), "an unaudited duplicate rolls back the batch");
  assert(!commands.includes("commit"), "an unaudited duplicate is never committed");
}

async function testSchemaVersionDirections(): Promise<void> {
  const expected = files.map(({ filename }) => filename);
  const realError = console.error;
  console.error = () => {};
  try {
    const behind = await withFakeClient(
      async () => ({
        rows: expected.slice(0, -1).map((filename) => ({ filename })),
      }),
      checkDbSchemaVersion,
    );
    const ahead = await withFakeClient(
      async () => ({
        rows: [...expected, "9999_future.sql"].map((filename) => ({ filename })),
      }),
      checkDbSchemaVersion,
    );

    assert(behind.status === "behind", "a missing ledger row reports database behind code");
    assert(ahead.status === "ahead", "an unknown ledger row reports database ahead of code");
    assert(
      ahead.unexpectedMigrations.includes("9999_future.sql"),
      "the ahead result identifies the migration absent from the running image",
    );
  } finally {
    console.error = realError;
  }
}

async function testRlsInventoryMatchesPolicyFile(): Promise<void> {
  const policySql = await import("node:fs/promises").then((fs) =>
    fs.readFile(new URL("../server/db/rls-policies.sql", import.meta.url), "utf8"),
  );
  const declared = new Set(
    [...policySql.matchAll(/alter table\s+([a-z_]+)\s+(?:enable|force) row level security/gi)]
      .map((match) => match[1]),
  );
  assert(
    declared.size === REQUIRED_RLS_TABLES.length &&
      REQUIRED_RLS_TABLES.every((table) => declared.has(table)),
    "the startup RLS inventory covers every table declared in rls-policies.sql",
  );
}

async function testRlsFlagFailures(): Promise<void> {
  const rows = REQUIRED_RLS_TABLES.map((relname) => ({
    relname,
    relrowsecurity: relname !== "item_requests",
    relforcerowsecurity: relname !== "volunteer_requests",
  }));
  const realError = console.error;
  console.error = () => {};
  try {
    const result = await withFakeClient(async () => ({ rows }), checkRequiredRlsEnforcement);
    assert(result.status === "missing" && !result.ok, "disabled RLS enforcement fails closed");
    assert(
      result.rlsDisabledTables.includes("item_requests"),
      "the check identifies a table missing RLS enablement",
    );
    assert(
      result.forceDisabledTables.includes("volunteer_requests"),
      "the check identifies a table missing forced enforcement",
    );
  } finally {
    console.error = realError;
  }
}

async function testNonBypassRoleCannotReadPrivateRows(): Promise<void> {
  const client = await pool.connect();
  const role = `zz_rls_release_${process.pid}`;
  try {
    await client.query("begin");
    await client.query(`create role ${role} nologin`);
    await client.query(`grant usage on schema public to ${role}`);
    // organizations' member policy also references org_memberships. PostgreSQL
    // checks that referenced-table privilege even when the public policy is the
    // one relevant to this query.
    await client.query(`grant select on organizations, org_memberships to ${role}`);
    await client.query(
      `select set_config('app.context', 'system', true),
              set_config('app.user_id', '', true)`,
    );
    const inserted = await client.query<{ id: string }>(
      `insert into organizations (name, slug, kind, status)
       values ($1, $2, 'member_org', 'pending')
       returning id`,
      [`zz fixture RLS release ${process.pid}`, `zz-rls-release-${process.pid}`],
    );
    await client.query(`set local role ${role}`);
    await client.query(`select set_config('app.context', 'public', true)`);
    const visible = await client.query(
      `select id from organizations where id = $1`,
      [inserted.rows[0]?.id],
    );
    assert(visible.rows.length === 0, "a non-BYPASSRLS public role cannot read a pending organization");
    await client.query("reset role");
    await client.query("rollback");
  } catch (err) {
    try {
      await client.query("reset role");
      await client.query("rollback");
    } catch {
      // Preserve the original failure.
    }
    throw err;
  } finally {
    await pool.query(`drop role if exists ${role}`);
    client.release();
  }
}

async function main(): Promise<void> {
  await testPendingBatchRollsBackTogether();
  await testClosedLedgerDriftException();
  await testUnknownDuplicateFailsClosed();
  await testSchemaVersionDirections();
  await testRlsInventoryMatchesPolicyFile();
  await testRlsFlagFailures();
  await testNonBypassRoleCannotReadPrivateRows();
  console.log(`\n${passed} deployment-migration checks passed`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());