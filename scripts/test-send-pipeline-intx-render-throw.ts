/**
 * Integration test: Task 278 — queueProductEmailInTx throws EmailConfigError
 * and leaves no orphaned email_log row when template.render() fails.
 *
 * Verifies that queueProductEmailInTx — the path used inside signup and
 * request transactions — throws EmailConfigError (not a generic Error) when
 * template.render() throws internally, and that the caller's transaction
 * leaves no email_log row after rollback. This is the InTx counterpart of
 * task 272's non-transactional render-throw test.
 *
 * The trick: donor_item_confirmation with items:["not-a-valid-item"]. A
 * non-empty array passes unresolvedVariables, but itemsTable calls
 * escapeHtml(r.name) on each element where r.name is undefined, causing a
 * TypeError inside render(). The catch block in queueProductEmailInTx wraps
 * this as EmailConfigError("render failed: …") and re-throws before any
 * email_log row is inserted, aborting the caller's transaction cleanly.
 *
 * Checks:
 *   1a. The call throws EmailConfigError (not a generic Error).
 *   1b. The error message contains "render failed".
 *   2a. No email_log row exists for the test entity after rollback.
 *
 * Usage:
 *   npm run test:send-pipeline-intx-render-throw
 *
 * The development server must be running. No rows are written (the throw
 * fires before the INSERT), so there is nothing to clean up.
 */
import { pool } from "../server/db/client";
import { queueProductEmailInTx, EmailConfigError } from "../server/email/send";

const RENDER_THROW_EMAIL = "zz.send-intx-render-throw@example.test";
// Reserved nil-prefix UUID block (ffff) — will never collide with real data.
const ENTITY_ID = "00000000-0000-0000-ffff-000000000278";

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string, detail?: unknown): void {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    const extra = detail !== undefined ? `: ${JSON.stringify(detail)}` : "";
    console.error(`  ✗ FAIL: ${label}${extra}`);
    failed++;
  }
}

async function cleanup(): Promise<void> {
  await pool.query(
    `delete from email_log where to_email = $1 and entity_id = $2::uuid`,
    [RENDER_THROW_EMAIL, ENTITY_ID],
  );
}

async function main(): Promise<void> {
  console.log("\nTask 278 — queueProductEmailInTx render-throw → no orphaned row\n");

  // Pre-clean any rows from a prior aborted run (the throw should prevent any
  // row from being written, but clean up defensively in case of test drift).
  await cleanup();

  // All required fields for donor_item_confirmation are present and non-empty,
  // but items is a non-empty array of plain strings rather than {name,quantity}
  // objects. A non-empty array passes unresolvedVariables, but itemsTable
  // calls escapeHtml(r.name) where r.name is undefined, causing a TypeError
  // inside render(). queueProductEmailInTx wraps this as EmailConfigError and
  // re-throws before any email_log INSERT.
  const vars = {
    donorName: "Fixture Donor",
    organizationName: "Fixture InTx RenderThrow Org",
    requestContactName: "Fixture Contact",
    requestContactEmail: "contact@fixture.test",
    requestContactPhone: null,
    requestName: "Fixture Request",
    requestDescription: null,
    requestDeadlineType: "Ongoing",
    requestDeadlineDate: null,
    dropoffLocation: null,
    requestUrl: "https://fixture.test/request",
    // Non-empty array passes unresolvedVariables; plain strings cause render()
    // to throw because itemsTable expects {name, quantity} objects.
    items: ["not-a-valid-item"],
  };

  // ── Section 1: throw behaviour ────────────────────────────────────────────
  console.log("1. queueProductEmailInTx — render failure throws EmailConfigError");

  let thrownError: unknown = null;
  const client = await pool.connect();
  try {
    await client.query("begin");
    await queueProductEmailInTx(client, {
      key: "donor_item_confirmation",
      entityId: ENTITY_ID,
      entityType: "item_pledge",
      toEmail: RENDER_THROW_EMAIL,
      vars,
    });
    // Should never reach here — roll back the no-op transaction.
    await client.query("rollback");
  } catch (err) {
    thrownError = err;
    await client.query("rollback").catch(() => undefined);
  } finally {
    client.release();
  }

  assert(
    thrownError instanceof EmailConfigError,
    "1a: throws EmailConfigError (not a generic Error)",
    thrownError instanceof Error
      ? `${thrownError.name}: ${thrownError.message}`
      : String(thrownError),
  );
  assert(
    thrownError instanceof EmailConfigError &&
      thrownError.message.includes("render failed"),
    "1b: error message contains 'render failed'",
    thrownError instanceof Error ? thrownError.message : undefined,
  );

  // ── Section 2: no row written ─────────────────────────────────────────────
  console.log("\n2. No email_log row written after transaction rollback");

  const { rows } = await pool.query<{ count: string }>(
    `select count(*)::text as count
       from email_log
      where to_email = $1
        and entity_id = $2::uuid`,
    [RENDER_THROW_EMAIL, ENTITY_ID],
  );
  const rowCount = parseInt(rows[0]!.count, 10);
  assert(
    rowCount === 0,
    "2a: no email_log row exists for the test entity after rollback",
    { rowCount },
  );

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log(`\n${passed + failed} checks — ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
