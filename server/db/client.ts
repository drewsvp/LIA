/**
 * The single database entry point. Standard `pg` over a normal TCP connection
 * string (D58) — never a Neon-specific client.
 *
 * Every query in the application runs inside `withDbContext`, which opens a
 * transaction and sets two GUCs the row-level-security policies read:
 *
 *   app.context  — 'system' | 'public' | 'member' | 'staff'
 *   app.user_id  — the application users.id (uuid) for member/staff contexts
 *
 * RLS (server/db/rls-policies.sql) is FORCEd on all 17 application tables, so
 * a query that runs outside `withDbContext` sees nothing and writes nothing.
 * That is deliberate: silent failure is worse than loud failure, and a query
 * that forgot its context should fail visibly in development, not leak.
 *
 * The GUCs are an application-asserted claim, same trust model as the WHERE
 * clauses they back up. RLS here is defense in depth against a buggy or
 * missing filter (the cross-organization leak class), not a defense against a
 * compromised server process.
 */
import pg from "pg";
import type { PoolClient, QueryResultRow } from "pg";

const { Pool } = pg;

// Temporal contract (shared/types.ts): DATE columns are YYYY-MM-DD strings,
// timestamps are ISO-8601 UTC strings. `date` has no time or zone, so the
// global parser returns it verbatim (Better Auth tables have no date columns;
// its `timestamp` columns keep pg's default Date parsing, which it expects).
pg.types.setTypeParser(pg.types.builtins.DATE, (value: string) => value);

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set. The application cannot start without its database.");
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });

/**
 * Normalize a DAL row to the shared-type contract: every Date (pg's parsing
 * of timestamp/timestamptz) becomes an ISO-8601 UTC string. One generic pass
 * here instead of per-entity mappers; rendering in America/Los_Angeles is a
 * display concern.
 */
function normalizeTemporals<T extends QueryResultRow>(row: T): T {
  let copy: Record<string, unknown> | null = null;
  for (const [key, value] of Object.entries(row)) {
    if (value instanceof Date) {
      copy ??= { ...row };
      copy[key] = value.toISOString();
    }
  }
  return (copy as T | null) ?? row;
}

/** Who a database operation runs as. Resolved from the session, never from caller input. */
export type DbContext =
  | { kind: "system" }
  | { kind: "public" }
  | { kind: "member"; userId: string }
  | { kind: "staff"; userId: string };

export const SYSTEM: DbContext = { kind: "system" };
export const PUBLIC: DbContext = { kind: "public" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Run `fn` inside one transaction with the RLS context GUCs set.
 * Commits on success, rolls back on any throw, always releases the client.
 */
export async function withDbContext<T>(
  ctx: DbContext,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const userId = ctx.kind === "member" || ctx.kind === "staff" ? ctx.userId : "";
  if (userId !== "" && !UUID_RE.test(userId)) {
    throw new Error(`withDbContext: userId is not a uuid: ${JSON.stringify(userId)}`);
  }
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('app.context', $1, true), set_config('app.user_id', $2, true)", [
      ctx.kind,
      userId,
    ]);
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (err) {
    try {
      await client.query("rollback");
    } catch {
      /* the original error is the one that matters */
    }
    throw err;
  } finally {
    client.release();
  }
}

/** Typed single-query helper for use inside withDbContext callbacks. */
export async function q<T extends QueryResultRow>(
  client: PoolClient,
  text: string,
  params: readonly unknown[] = [],
): Promise<T[]> {
  const res = await client.query<T>(text, params as unknown[]);
  return res.rows.map(normalizeTemporals);
}

/** Convenience: run one query in its own context/transaction. */
export async function queryInContext<T extends QueryResultRow>(
  ctx: DbContext,
  text: string,
  params: readonly unknown[] = [],
): Promise<T[]> {
  return withDbContext(ctx, (client) => q<T>(client, text, params));
}

/** True when `err` is a Postgres unique-violation on the given constraint/index. */
export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { code?: string; constraint?: string };
  if (e.code !== "23505") return false;
  return constraint === undefined || e.constraint === constraint;
}
