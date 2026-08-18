/**
 * Focused integration test: Task 75 — structured failure diagnostics and
 * resend chain visibility.
 *
 * Covers the three gaps the code review flagged:
 *   1. Transactional approval paths set failure_category on EmailConfigError.
 *   2. Disabled-template resend: the skipped row carries resend_of_id.
 *   3. findResendAttempt returns the linked attempt from the original row.
 *
 * Does NOT send real emails — failure rows are written directly via DAL
 * helpers, mirroring the approval service paths.
 *
 * Usage:
 *   npx tsx scripts/test-email-failure-diagnostics.ts
 *
 * Expects a running database (same as other scripts/ tests).
 * All rows use the zz_fixture payload key so the sweep ignores them.
 * Rows are cleaned up at the end regardless of pass/fail.
 */

import * as emailLog from "../server/dal/email-log";
import { SYSTEM, pool } from "../server/db/client";

let insertedIds: string[] = [];
let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string): void {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${label}`);
    failed++;
  }
}

async function cleanup(): Promise<void> {
  if (insertedIds.length === 0) return;
  await pool.query(`delete from email_log where id = any($1::uuid[])`, [insertedIds]);
  insertedIds = [];
}

async function main(): Promise<void> {
  console.log("\nTask 75 — email failure diagnostics integration test\n");

  // ── Section 1: failure_category round-trips through markFailed* ──────────
  console.log("1. failure_category persisted by markFailed variants");

  const client = await pool.connect();
  try {
    // 1a. markFailed (non-tx path, used by config errors in dispatchQueuedEmail)
    await client.query("begin");
    const r1 = await emailLog.insertQueuedInTx(client, {
      templateKey: "org_approved",
      toEmail: "zz.diag1@example.test",
      entityType: "organization",
      entityId: "00000000-0000-0000-0000-000000000001",
      payload: { zz_fixture: true },
    });
    insertedIds.push(r1.id);
    await emailLog.markFailedInTx(client, r1.id, "EMAIL_FROM_ADDRESS is not set", "config");
    await client.query("commit");

    const row1 = await emailLog.getById(SYSTEM, r1.id);
    assert(row1?.status === "failed", "1a: markFailedInTx sets status=failed");
    assert(row1?.failureCategory === "config", "1a: markFailedInTx persists category=config");

    // 1b. markFailedInTx with category=render (approval service path)
    await client.query("begin");
    const r2 = await emailLog.insertQueuedInTx(client, {
      templateKey: "org_member_approved",
      toEmail: "zz.diag2@example.test",
      entityType: "org_membership",
      entityId: "00000000-0000-0000-0000-000000000002",
      payload: { zz_fixture: true },
    });
    insertedIds.push(r2.id);
    await emailLog.markFailedInTx(client, r2.id, "unresolved variable(s): memberName", "render");
    await client.query("commit");

    const row2 = await emailLog.getById(SYSTEM, r2.id);
    assert(row2?.failureCategory === "render", "1b: markFailedInTx persists category=render");

    // 1c. markFailedIfStatus with category=provider_timeout
    await client.query("begin");
    const r3 = await emailLog.insertQueuedInTx(client, {
      templateKey: "org_approved",
      toEmail: "zz.diag3@example.test",
      entityType: "organization",
      entityId: "00000000-0000-0000-0000-000000000003",
      payload: { zz_fixture: true },
    });
    insertedIds.push(r3.id);
    // Claim it (queued → sending) to simulate mid-send state
    await client.query(`update email_log set status = 'sending' where id = $1`, [r3.id]);
    await client.query("commit");
    const marked3 = await emailLog.markFailedIfStatus(SYSTEM, r3.id, "provider timeout", "sending", "provider_timeout");
    assert(marked3 !== null, "1c: markFailedIfStatus returns row when status matches");
    assert(marked3?.failureCategory === "provider_timeout", "1c: markFailedIfStatus persists category=provider_timeout");

    // 1d. markFailed (non-tx) with category=sweep
    await client.query("begin");
    const r4 = await emailLog.insertQueuedInTx(client, {
      templateKey: "org_approved",
      toEmail: "zz.diag4@example.test",
      entityType: "organization",
      entityId: "00000000-0000-0000-0000-000000000004",
      payload: { zz_fixture: true },
    });
    insertedIds.push(r4.id);
    await client.query("commit");
    await emailLog.markFailed(SYSTEM, r4.id, "stranded at queued by sweep", "sweep");
    const row4 = await emailLog.getById(SYSTEM, r4.id);
    assert(row4?.failureCategory === "sweep", "1d: markFailed persists category=sweep");

    // 1e. pre-migration row (no category) still reads null safely
    const row4Null = await emailLog.getById(SYSTEM, r4.id);
    // Already set to sweep above; simulate null by reading a fresh queued row
    await client.query("begin");
    const r5 = await emailLog.insertQueuedInTx(client, {
      templateKey: "org_approved",
      toEmail: "zz.diag5@example.test",
      entityType: "organization",
      entityId: "00000000-0000-0000-0000-000000000005",
      payload: { zz_fixture: true },
    });
    insertedIds.push(r5.id);
    await client.query("commit");
    // Mark failed without a category (simulates pre-migration row)
    await emailLog.markFailed(SYSTEM, r5.id, "some old error text");
    const row5 = await emailLog.getById(SYSTEM, r5.id);
    assert(row5?.failureCategory === null, "1e: markFailed without category leaves failureCategory=null");
    assert(row5?.error === "some old error text", "1e: error text preserved when no category supplied");
  } finally {
    await client.release();
  }

  // ── Section 2: resend_of_id chain via insertSkipped ───────────────────────
  console.log("\n2. resend_of_id chain for disabled-template resend");

  const client2 = await pool.connect();
  try {
    // Create the original failed row
    await client2.query("begin");
    const original = await emailLog.insertQueuedInTx(client2, {
      templateKey: "org_approved",
      toEmail: "zz.chain-orig@example.test",
      entityType: "organization",
      entityId: "00000000-0000-0000-0000-000000000010",
      payload: { zz_fixture: true },
    });
    insertedIds.push(original.id);
    await emailLog.markFailedInTx(client2, original.id, "some prior failure", "config");
    await client2.query("commit");

    // Simulate what resendEmail does when the template is disabled:
    // insertSkipped with resendOfId = original.id
    const skipped = await emailLog.insertSkipped(SYSTEM, {
      templateKey: "org_approved",
      toEmail: "zz.chain-orig@example.test",
      entityType: "organization",
      entityId: "00000000-0000-0000-0000-000000000010",
      payload: { zz_fixture: true },
      resendOfId: original.id,
    });
    insertedIds.push(skipped.id);

    assert(skipped.resendOfId === original.id, "2a: insertSkipped stores resend_of_id");
    assert(skipped.status === "skipped", "2a: skipped row status is 'skipped'");

    // findResendAttempt should find the skipped row from the original's id
    const found = await emailLog.findResendAttempt(SYSTEM, original.id);
    assert(found !== null, "2b: findResendAttempt finds skipped resend attempt");
    assert(found?.id === skipped.id, "2b: findResendAttempt returns the correct row");
    assert(found?.resendOfId === original.id, "2b: found row has correct resend_of_id");
  } finally {
    await client2.release();
  }

  // ── Section 3: resend_of_id chain via insertQueued ────────────────────────
  console.log("\n3. resend_of_id chain for successful resend (new queued row)");

  const client3 = await pool.connect();
  try {
    // Original failed row with a different entity to avoid once-only index
    await client3.query("begin");
    const orig2 = await emailLog.insertQueuedInTx(client3, {
      templateKey: "org_member_approved",
      toEmail: "zz.chain2@example.test",
      entityType: "org_membership",
      entityId: "00000000-0000-0000-0000-000000000020",
      payload: { zz_fixture: true },
    });
    insertedIds.push(orig2.id);
    await emailLog.markFailedInTx(client3, orig2.id, "render failed", "render");
    await client3.query("commit");

    // Resend attempt: new queued row pointing back to orig2
    const resendRow = await emailLog.insertQueued(SYSTEM, {
      templateKey: "org_member_approved",
      toEmail: "zz.chain2@example.test",
      entityType: "org_membership",
      // Use a different entity_id so the once-only index doesn't collide
      entityId: "00000000-0000-0000-0000-000000000021",
      payload: { zz_fixture: true },
      resendOfId: orig2.id,
    });
    if (resendRow.duplicate) {
      console.error("  ✗ FAIL: 3a: unexpected duplicate on resend row insert");
      failed++;
    } else {
      insertedIds.push(resendRow.entry.id);
      assert(resendRow.entry.resendOfId === orig2.id, "3a: insertQueued stores resend_of_id");

      const found2 = await emailLog.findResendAttempt(SYSTEM, orig2.id);
      assert(found2 !== null, "3b: findResendAttempt finds queued resend attempt");
      assert(found2?.id === resendRow.entry.id, "3b: findResendAttempt returns correct row id");
    }
  } finally {
    await client3.release();
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────
  await cleanup();
  await pool.end();

  console.log(`\n${"─".repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.error("\nTest failures detected — see ✗ lines above.");
    process.exit(1);
  } else {
    console.log("\nAll checks passed.");
  }
}

main().catch((err) => {
  console.error("Test script error:", err);
  void cleanup().finally(() => pool.end());
  process.exit(1);
});
