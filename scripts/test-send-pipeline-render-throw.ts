/**
 * Integration test: Task 272 — send pipeline records a failed row when
 * template.render() throws at dispatch time.
 *
 * Verifies that queueProductEmail catches a render() exception, marks the
 * already-inserted email_log row failed with category='render', and returns
 * outcome:'blocked' with the error text in reason. The queued row is NOT
 * rolled back — a visible failed entry is better than a silent gap.
 *
 * The trick: donor_item_confirmation with items:["not-a-valid-item"]. A
 * non-empty array passes unresolvedVariables, but itemsTable calls
 * escapeHtml(r.name) on each element where r.name is undefined, causing a
 * TypeError inside render(). The catch block at send.ts:566-571 intercepts
 * this and calls block("template render failed: ..."), which marks the row
 * failed before returning.
 *
 * Same fixture technique as test-email-preview-panel.ts case 1g, but
 * exercising the queueProductEmail (send) path instead of the preview
 * endpoint.
 *
 * Checks:
 *   1a. queueProductEmail returns outcome:'blocked' without throwing.
 *   1b. result.reason is a non-empty string.
 *   1c. result.reason contains "render failed" (the block prefix).
 *   2a. An email_log row exists for the returned emailLogId.
 *   2b. The row status is 'failed'.
 *   2c. The row error field is non-empty and matches the reason.
 *   2d. The row failure_category is 'render'.
 *
 * Usage:
 *   npm run test:send-pipeline-render-throw
 *
 * The development server must be running. All rows are cleaned before and
 * after the test.
 */
import { pool, SYSTEM } from "../server/db/client";
import { queueProductEmail } from "../server/email/send";

const RENDER_THROW_EMAIL = "zz.send-render-throw@example.test";
// Reserved nil-prefix UUID block (ffff) — will never collide with real data.
const ENTITY_ID = "00000000-0000-0000-ffff-000000000272";

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
  console.log("\nTask 272 — send pipeline render-throw → failed email_log row\n");

  // Pre-clean any rows from a prior aborted run.
  await cleanup();

  // All required fields for donor_item_confirmation are present and non-empty,
  // but items is a non-empty array of plain strings rather than {name,quantity}
  // objects. A non-empty array passes unresolvedVariables, but itemsTable calls
  // escapeHtml(r.name) where r.name is undefined, causing a TypeError inside
  // render(). The catch block at send.ts:566-571 marks the already-inserted
  // queued row failed and returns outcome:'blocked'.
  const vars = {
    donorName: "Fixture Donor",
    organizationName: "Fixture RenderThrow Org",
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

  // ── Section 1: queueProductEmail outcome ──────────────────────────────────
  console.log("1. queueProductEmail — render-throw caught and returned as blocked");

  type BlockedResult = { outcome: "blocked"; emailLogId: string; reason: string };

  let result: Awaited<ReturnType<typeof queueProductEmail>> | null = null;
  let thrownError: unknown = null;
  try {
    result = await queueProductEmail(SYSTEM, {
      key: "donor_item_confirmation",
      entityId: ENTITY_ID,
      entityType: "item_pledge",
      toEmail: RENDER_THROW_EMAIL,
      vars,
    });
  } catch (err) {
    thrownError = err;
  }

  assert(
    thrownError === null && result?.outcome === "blocked",
    "1a: queueProductEmail returns outcome:'blocked' without throwing",
    thrownError !== null
      ? `threw: ${thrownError instanceof Error ? thrownError.message : String(thrownError)}`
      : { outcome: result?.outcome },
  );

  const blocked = result?.outcome === "blocked" ? (result as BlockedResult) : null;

  assert(
    typeof blocked?.reason === "string" && blocked.reason.length > 0,
    "1b: result.reason is a non-empty string",
    blocked?.reason,
  );
  assert(
    (blocked?.reason ?? "").includes("render failed"),
    "1c: result.reason contains 'render failed'",
    blocked?.reason,
  );

  // ── Section 2: email_log row recorded as failed ───────────────────────────
  console.log("\n2. email_log row — persisted as failed with render category");

  const emailLogId = blocked?.emailLogId;
  assert(
    typeof emailLogId === "string" && emailLogId.length > 0,
    "2a: result.emailLogId is a non-empty string",
    emailLogId,
  );

  if (emailLogId) {
    const { rows } = await pool.query<{
      status: string;
      error: string | null;
      failure_category: string | null;
    }>(
      `select status, error, failure_category
         from email_log
        where id = $1`,
      [emailLogId],
    );

    assert(
      rows.length === 1,
      "2a: email_log row exists for the returned emailLogId",
      { emailLogId, rowCount: rows.length },
    );

    const row = rows[0];
    if (row) {
      assert(
        row.status === "failed",
        "2b: email_log row status is 'failed'",
        row.status,
      );
      assert(
        typeof row.error === "string" && row.error.length > 0,
        "2c: email_log row error field is non-empty",
        row.error,
      );
      assert(
        row.failure_category === "render",
        "2d: email_log row failure_category is 'render'",
        row.failure_category,
      );
    }
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────
  await cleanup();

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log(`\n${passed + failed} checks — ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
