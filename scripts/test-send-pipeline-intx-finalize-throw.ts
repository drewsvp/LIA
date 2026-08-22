/**
 * Integration test: Task 281 — queueProductEmailInTx throws and leaves no
 * orphaned email_log row when finalizeHtml() fails.
 *
 * Verifies that queueProductEmailInTx — the path used inside signup and
 * request transactions — throws when template.render() returns HTML that
 * lacks the expected shell() slot marker (HEADER_IMAGE_MARKER), and that
 * the caller's transaction leaves no email_log row after rollback.
 *
 * The trick: the staff_new_user template's render function is temporarily
 * patched to return HTML without the HEADER_IMAGE_MARKER. render() itself
 * succeeds (no throw from the render try-catch), so execution reaches the
 * finalizeHtml() call, which throws loudly because the slot is absent.
 * This throw propagates out of queueProductEmailInTx before any email_log
 * INSERT, aborting the caller's transaction cleanly. The original render is
 * restored before any assertion.
 *
 * Checks:
 *   1a. The call throws (any error — the throw is intentional and is a plain
 *       Error, not EmailConfigError).
 *   1b. The error message mentions "header slot marker missing".
 *   2a. No email_log row exists for the test entity after rollback.
 *
 * Usage:
 *   npm run test:send-pipeline-intx-finalize-throw
 *
 * The development server must be running. No rows are written (the throw
 * fires before the INSERT), so there is nothing to clean up.
 */
import { pool } from "../server/db/client";
import { queueProductEmailInTx } from "../server/email/send";
import { PRODUCT_TEMPLATES } from "../server/email/templates";
import { HEADER_IMAGE_MARKER } from "../server/email/render";

const FINALIZE_THROW_EMAIL = "zz.send-intx-finalize-throw@example.test";
// Reserved nil-prefix UUID block (ffff) — will never collide with real data.
const ENTITY_ID = "00000000-0000-0000-ffff-000000000281";

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
    [FINALIZE_THROW_EMAIL, ENTITY_ID],
  );
}

async function main(): Promise<void> {
  console.log("\nTask 281 — queueProductEmailInTx finalizeHtml-throw → no orphaned row\n");

  // Pre-clean any rows from a prior aborted run (the throw should prevent any
  // row from being written, but clean up defensively in case of test drift).
  await cleanup();

  // Vars that satisfy all required fields for staff_new_user so that
  // unresolvedVariables passes and render() succeeds. The render function is
  // then patched to strip the slot marker, so finalizeHtml() throws instead.
  const vars = {
    memberName: "Fixture Member",
    memberEmail: "fixture@example.test",
    memberPhone: null,
    organizationName: "Fixture InTx FinalizeThrow Org",
    submitterName: "Fixture Submitter",
    submitterEmail: "submitter@fixture.test",
    adminUrl: "https://fixture.test/admin/members",
  };

  // ── Patch: replace render to return HTML without the slot marker ──────────
  // Save the original render so we can restore it after the test.
  const template = PRODUCT_TEMPLATES["staff_new_user"];
  const originalRender = template.render.bind(template);

  // Override render to strip the HEADER_IMAGE_MARKER from the returned HTML.
  // The subject and text are produced normally; only the html is altered so
  // that finalizeHtml() cannot find the slot and throws.
  (template as { render: typeof template.render }).render = (v, copy) => {
    const result = originalRender(v, copy);
    return {
      ...result,
      html: result.html.replace(HEADER_IMAGE_MARKER, "<!-- marker removed by fixture -->"),
    };
  };

  // ── Section 1: throw behaviour ────────────────────────────────────────────
  console.log("1. queueProductEmailInTx — finalizeHtml failure throws");

  let thrownError: unknown = null;
  const client = await pool.connect();
  try {
    await client.query("begin");
    await queueProductEmailInTx(client, {
      key: "staff_new_user",
      entityId: ENTITY_ID,
      entityType: "org_membership",
      toEmail: FINALIZE_THROW_EMAIL,
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

  // Restore the original render immediately after the test, before assertions.
  (template as { render: typeof template.render }).render = originalRender;

  assert(
    thrownError !== null,
    "1a: throws (any error — finalizeHtml detected missing slot marker)",
    thrownError instanceof Error
      ? `${thrownError.name}: ${thrownError.message}`
      : String(thrownError),
  );
  assert(
    thrownError instanceof Error &&
      thrownError.message.includes("header slot marker missing"),
    "1b: error message contains 'header slot marker missing'",
    thrownError instanceof Error ? thrownError.message : undefined,
  );

  // ── Section 2: no row written ─────────────────────────────────────────────
  console.log("\n2. No email_log row written after transaction rollback");

  const { rows } = await pool.query<{ count: string }>(
    `select count(*)::text as count
       from email_log
      where to_email = $1
        and entity_id = $2::uuid`,
    [FINALIZE_THROW_EMAIL, ENTITY_ID],
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
