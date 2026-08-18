/**
 * Integration tests for the image-sweep job's concurrency guarantees.
 *
 * Tests:
 *   1. A 'failed' row is claimed exactly once when two concurrent claims race.
 *   2. A stale 'pending' row (stranded by crash) is claimable.
 *   3. A fresh 'pending' row (in-flight sourcing) is NOT claimable.
 *   4. A row at the retry cap is not claimable.
 *
 * Writes real rows to the DB then cleans them up. Safe to run in dev.
 * Usage: NODE_ENV=development npx tsx scripts/test-image-sweep.ts
 * Exit 0 = all pass. Exit 1 = at least one failure.
 */
import { pool, SYSTEM } from "../server/db/client";
import {
  claimImageGenForSweep,
  listFailedOrStrandedImageGen,
} from "../server/dal/item-requests";

const STRANDED_MINUTES = 5;
const MAX_RETRIES = 3;

let passed = 0;
let failed = 0;
const cleanup: string[] = [];

function pass(label: string): void {
  console.log(`  ✓  ${label}`);
  passed++;
}

function fail(label: string, detail?: string): void {
  console.error(`  ✗  ${label}`);
  if (detail) console.error(`       ${detail}`);
  failed++;
}

function assert(cond: boolean, label: string, detail?: string): void {
  if (cond) pass(label);
  else fail(label, detail);
}

/** Insert a minimal item_request row for testing, returning its id. */
async function insertTestRequest(opts: {
  imageGenStatus: "pending" | "failed" | null;
  imageGenRetries?: number;
  /** Make updated_at this many minutes in the past. Default: 0 (now). */
  staleMins?: number;
}): Promise<string> {
  // Find an org to attach to (any will do).
  const orgRow = await pool.query<{ id: string }>(
    `select id from organizations limit 1`,
  );
  const orgId = orgRow.rows[0]?.id;
  if (!orgId) throw new Error("No organization found — run db:seed first.");

  const staleMins = opts.staleMins ?? 0;
  const row = await pool.query<{ id: string }>(
    `insert into item_requests
       (org_id, title, status, image_gen_status, image_gen_retries, updated_at, created_at)
     values
       ($1, 'zz.sweep-test', 'pending', $2, $3,
        now() - ($4 || ' minutes')::interval,
        now() - ($4 || ' minutes')::interval)
     returning id`,
    [orgId, opts.imageGenStatus, opts.imageGenRetries ?? 0, staleMins],
  );
  const id = row.rows[0]!.id;
  cleanup.push(id);
  return id;
}

async function main(): Promise<void> {
  console.log("\n[image-sweep tests]\n");

  // ── 1. Concurrent claims on a 'failed' row ─────────────────────────────
  {
    const id = await insertTestRequest({ imageGenStatus: "failed" });
    // Fire both claims without awaiting between them — true concurrency.
    const [a, b] = await Promise.all([
      claimImageGenForSweep(SYSTEM, id, MAX_RETRIES, STRANDED_MINUTES),
      claimImageGenForSweep(SYSTEM, id, MAX_RETRIES, STRANDED_MINUTES),
    ]);
    const claimedCount = [a, b].filter(Boolean).length;
    assert(
      claimedCount === 1,
      "concurrent claims on a failed row: exactly one succeeds",
      `got ${claimedCount} successful claims (expected 1)`,
    );

    // Verify the retry counter was incremented exactly once.
    const row = await pool.query<{ image_gen_retries: number }>(
      `select image_gen_retries from item_requests where id = $1`,
      [id],
    );
    assert(
      row.rows[0]?.image_gen_retries === 1,
      "retry counter incremented exactly once after concurrent claims",
      `counter = ${row.rows[0]?.image_gen_retries}`,
    );
  }

  // ── 2. Stale 'pending' row is claimable ────────────────────────────────
  {
    const id = await insertTestRequest({
      imageGenStatus: "pending",
      staleMins: STRANDED_MINUTES + 2, // older than threshold
    });
    const claimed = await claimImageGenForSweep(SYSTEM, id, MAX_RETRIES, STRANDED_MINUTES);
    assert(claimed, "stale pending row (stranded by crash) is claimable");
  }

  // ── 3. Fresh 'pending' row is NOT claimable ────────────────────────────
  {
    const id = await insertTestRequest({
      imageGenStatus: "pending",
      staleMins: 0, // just updated — in-flight sourcing
    });
    const claimed = await claimImageGenForSweep(SYSTEM, id, MAX_RETRIES, STRANDED_MINUTES);
    assert(!claimed, "fresh pending row (in-flight sourcing) is not claimable");
  }

  // ── 4. Row at retry cap is not claimable ──────────────────────────────
  {
    const id = await insertTestRequest({
      imageGenStatus: "failed",
      imageGenRetries: MAX_RETRIES,
    });
    const claimed = await claimImageGenForSweep(SYSTEM, id, MAX_RETRIES, STRANDED_MINUTES);
    assert(!claimed, "row at retry cap is not claimable");
  }

  // ── 5. listFailedOrStrandedImageGen respects the cap ──────────────────
  {
    const idFailed = await insertTestRequest({
      imageGenStatus: "failed",
      imageGenRetries: 0,
    });
    const idCapped = await insertTestRequest({
      imageGenStatus: "failed",
      imageGenRetries: MAX_RETRIES,
    });
    const rows = await listFailedOrStrandedImageGen(SYSTEM, STRANDED_MINUTES, MAX_RETRIES);
    const ids = rows.map((r) => r.id);
    assert(ids.includes(idFailed), "listFailedOrStrandedImageGen includes uncapped failed row");
    assert(!ids.includes(idCapped), "listFailedOrStrandedImageGen excludes capped failed row");
  }

  // ── cleanup ───────────────────────────────────────────────────────────
  if (cleanup.length > 0) {
    await pool.query(
      `delete from item_requests where id = any($1::uuid[])`,
      [cleanup],
    );
  }
  await pool.end();

  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("test runner error:", err);
  process.exit(1);
});
