/**
 * Integration test: Task 283 — queueProductEmail (non-transactional path)
 * returns a "blocked" outcome and writes a failed email_log row when
 * finalizeHtml() cannot find the header slot marker in the rendered HTML.
 *
 * The non-transactional counterpart (queueProductEmailInTx) is covered by
 * Task 281 / test-send-pipeline-intx-finalize-throw.ts. This script covers
 * the standalone send path used outside signup/request transactions:
 *
 *   queueProductEmail(ctx, input)  →  { outcome: "blocked", reason, emailLogId }
 *
 * The trick: the staff_new_user template's render function is temporarily
 * patched to return HTML without the HEADER_IMAGE_MARKER. render() itself
 * succeeds (no throw from the render try-catch), so execution reaches the
 * finalizeHtml() call inside the try block, which throws because the slot is
 * absent. queueProductEmail catches that throw, marks the already-inserted
 * email_log row as failed, and returns { outcome: "blocked" } rather than
 * re-throwing. The original render is restored before any assertion.
 *
 * Checks:
 *   1a. The call does NOT throw — it returns a result object.
 *   1b. The returned outcome is "blocked".
 *   1c. The returned reason mentions "header image injection failed".
 *   2a. An email_log row exists for the test entity.
 *   2b. That row has status = 'failed'.
 *   2c. The row's error field mentions "header slot marker missing".
 *
 * Usage:
 *   npm run test:send-pipeline-finalize-throw
 *
 * The development server must be running. The failed email_log row is cleaned
 * up automatically at the end of the run.
 */
import { pool, SYSTEM } from "../server/db/client";
import { queueProductEmail } from "../server/email/send";
import { PRODUCT_TEMPLATES } from "../server/email/templates";
import { HEADER_IMAGE_MARKER } from "../server/email/render";

const FINALIZE_THROW_EMAIL = "zz.send-finalize-throw@example.test";
// Reserved nil-prefix UUID block (ffff) — will never collide with real data.
const ENTITY_ID = "00000000-0000-0000-ffff-000000000283";

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
  console.log("\nTask 283 — queueProductEmail finalizeHtml-throw → blocked outcome + failed row\n");

  // Pre-clean any rows from a prior aborted run.
  await cleanup();

  // Vars that satisfy all required fields for staff_new_user so that
  // unresolvedVariables passes and render() succeeds. The render function is
  // then patched to strip the slot marker, so finalizeHtml() throws inside its
  // try block and queueProductEmail returns { outcome: "blocked" }.
  const vars = {
    memberName: "Fixture Member",
    memberEmail: "fixture@example.test",
    memberPhone: null,
    organizationName: "Fixture FinalizeThrow Org",
    submitterName: "Fixture Submitter",
    submitterEmail: "submitter@fixture.test",
    adminUrl: "https://fixture.test/admin/members",
  };

  // ── Patch: replace render to return HTML without the slot marker ──────────
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

  // ── Section 1: return value behaviour ────────────────────────────────────
  console.log("1. queueProductEmail — finalizeHtml failure returns blocked outcome");

  let thrownError: unknown = null;
  let result: Awaited<ReturnType<typeof queueProductEmail>> | null = null;
  try {
    result = await queueProductEmail(SYSTEM, {
      key: "staff_new_user",
      entityId: ENTITY_ID,
      entityType: "org_membership",
      toEmail: FINALIZE_THROW_EMAIL,
      vars,
    });
  } catch (err) {
    thrownError = err;
  }

  // Restore the original render immediately after the call, before assertions.
  (template as { render: typeof template.render }).render = originalRender;

  assert(
    thrownError === null,
    "1a: does NOT throw — returns a result object",
    thrownError instanceof Error
      ? `unexpected throw: ${thrownError.name}: ${thrownError.message}`
      : thrownError !== null
        ? String(thrownError)
        : undefined,
  );
  assert(
    result !== null && result.outcome === "blocked",
    "1b: returned outcome is 'blocked'",
    result !== null ? { outcome: result.outcome } : "result is null (threw)",
  );
  assert(
    result !== null &&
      result.outcome === "blocked" &&
      result.reason.includes("header image injection failed"),
    "1c: returned reason mentions 'header image injection failed'",
    result !== null && result.outcome === "blocked" ? result.reason : undefined,
  );

  // ── Section 2: email_log row state ───────────────────────────────────────
  console.log("\n2. email_log row written and marked failed");

  const { rows } = await pool.query<{ count: string; status: string; error: string | null }>(
    `select count(*)::text as count, min(status) as status, min(error) as error
       from email_log
      where to_email = $1
        and entity_id = $2::uuid`,
    [FINALIZE_THROW_EMAIL, ENTITY_ID],
  );
  const row = rows[0]!;
  const rowCount = parseInt(row.count, 10);

  assert(rowCount === 1, "2a: exactly one email_log row exists for the test entity", { rowCount });
  assert(
    row.status === "failed",
    "2b: the email_log row has status = 'failed'",
    { status: row.status },
  );
  assert(
    typeof row.error === "string" && row.error.includes("header slot marker missing"),
    "2c: the row error mentions 'header slot marker missing'",
    { error: row.error },
  );

  // ── Cleanup ───────────────────────────────────────────────────────────────
  await cleanup();
  console.log("\n  (failed row cleaned up)");

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log(`\n${passed + failed} checks — ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
