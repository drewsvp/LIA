/**
 * Diagnostic: send an org_approved email through the product template path
 * and print the email_log outcome.  Uses a synthetic entity id so it does
 * not touch production data, and sends to drew@svpsacramento.org (the
 * Postmark sender-signature address, safe during pending-approval mode).
 *
 * Usage:
 *   npx tsx scripts/test-approval-email.ts
 */
import { queueProductEmail, dispatchQueuedEmails } from "../server/email/send";
import { absoluteUrl } from "../server/email/send";
import * as emailLog from "../server/dal/email-log";
import { SYSTEM, pool } from "../server/db/client";

// Synthetic entity id — far outside any real uuid range; won't collide.
const DIAG_ENTITY_ID = "00000000-0000-0000-0000-000000000001";
const TO = "drew@svpsacramento.org";

async function main() {
  console.log("Testing org_approved product email path via Postmark");
  console.log("From  :", process.env.EMAIL_FROM_ADDRESS ?? "(not set)");
  console.log("To    :", TO);
  console.log("");

  // Clean up any leftover diagnostic row from a previous run so the
  // once-only index doesn't block us.
  await pool.query(
    `delete from email_log
      where template_key = 'org_approved' and entity_type = 'organization'
        and entity_id = $1 and lower(to_email) = lower($2)`,
    [DIAG_ENTITY_ID, TO],
  );

  const dashboardUrl = absoluteUrl("/dashboard");

  const result = await queueProductEmail(SYSTEM, {
    key: "org_approved",
    entityId: DIAG_ENTITY_ID,
    entityType: "organization",
    toEmail: TO,
    toPersonId: null,
    vars: {
      organizationName: "Diagnostic Test Org",
      orgAddress: null,
      orgPhoneNumber: null,
      websiteUrl: null,
      missionStatement: null,
      primaryPopulationServed: null,
      organizationPrimaryContact: "Drew Eggert",
      organizationPrimaryContactEmail: TO,
      organizationPrimaryContactPhone: null,
      dashboardUrl,
    },
  });

  if (result.outcome === "duplicate") {
    console.error("✗ duplicate (unexpected — row should have been cleaned up)");
    process.exit(1);
  }
  if (result.outcome === "blocked") {
    console.error("✗ blocked:", result.reason);
    process.exit(1);
  }
  if (result.outcome === "skipped_disabled") {
    console.error("✗ skipped: template disabled by staff admin");
    process.exit(1);
  }

  // Dispatch
  const outcomes = await dispatchQueuedEmails([result.dispatch]);
  const outcome = outcomes[0];
  if (!outcome) {
    console.error("✗ no outcome returned from dispatch");
    process.exit(1);
  }

  if (outcome.outcome === "sent") {
    const row = await emailLog.getById(SYSTEM, outcome.emailLogId);
    console.log("✓ SENT");
    console.log("  email_log id       :", outcome.emailLogId);
    console.log("  Postmark MessageID :", outcome.providerMessageId);
    console.log("  DB status          :", row?.status);
    console.log("  DB providerMessageId:", row?.providerMessageId);
  } else if (outcome.outcome === "failed") {
    console.error("✗ FAILED (" + outcome.kind + "):", outcome.error);
    process.exit(1);
  } else {
    console.error("✗ skipped (unexpected):", (outcome as {reason: string}).reason);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
