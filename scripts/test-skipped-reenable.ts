/**
 * Regression test: a skipped (disabled) email row must never count as a
 * delivery. Disable a template, queue a send (skipped row written), then
 * re-enable and queue again — the real send must go through instead of
 * being reported as already sent. Also asserts placeholder validation
 * refuses a copy override missing a required placeholder.
 *
 * Usage: NODE_ENV=development npx tsx scripts/test-skipped-reenable.ts
 * Exit 0 = all pass. Exit 1 = at least one failure.
 */
import { pool, SYSTEM } from "../server/db/client";
import * as dal from "../server/dal";
import { queueProductEmail } from "../server/email/send";
import { PRODUCT_TEMPLATES } from "../server/email/templates";
import { validateCopy } from "../server/email/overrides";

const KEY = "donor_item_confirmation" as const;
const TO = "zz.skip-reenable@example.org";
const ENTITY_TYPE = "item_request";

let passed = 0;
let failed = 0;
function check(label: string, ok: boolean, detail?: string): void {
  if (ok) {
    console.log(`  ✓  ${label}`);
    passed++;
  } else {
    console.error(`  ✗  ${label}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

async function cleanup(entityId: string): Promise<void> {
  await dal.emailTemplateOverrides.setEnabled(SYSTEM, KEY, true);
  await pool.query("delete from email_log where lower(to_email) = lower($1)", [TO]);
  void entityId;
}

async function main(): Promise<void> {
  // A synthetic entity id keeps the once-per-entity dedup in play without
  // touching real rows (email_log has no FK on entity_id).
  const { rows } = await pool.query<{ id: string }>("select gen_random_uuid() as id");
  const entityId = rows[0]!.id;
  const vars = PRODUCT_TEMPLATES[KEY].sample as never;

  try {
    console.log("\nSkipped rows must not block a re-enabled send:");

    await dal.emailTemplateOverrides.setEnabled(SYSTEM, KEY, false);
    const first = await queueProductEmail(SYSTEM, {
      key: KEY,
      entityType: ENTITY_TYPE,
      entityId,
      toEmail: TO,
      vars,
    });
    check("disabled send outcome is skipped_disabled", first.outcome === "skipped_disabled", first.outcome);
    if (first.outcome === "skipped_disabled") {
      const row = await dal.emailLog.getById(SYSTEM, first.emailLogId);
      check("skipped row visible in email_log", row?.status === "skipped", row?.status);
    }

    await dal.emailTemplateOverrides.setEnabled(SYSTEM, KEY, true);
    const second = await queueProductEmail(SYSTEM, {
      key: KEY,
      entityType: ENTITY_TYPE,
      entityId,
      toEmail: TO,
      vars,
    });
    check(
      "re-enabled send queues instead of reporting already sent",
      second.outcome === "queued",
      second.outcome,
    );

    console.log("\nPlaceholder validation:");
    const badCopy = {
      subject: "Hi",
      heading: "Hi",
      paragraphs: PRODUCT_TEMPLATES[KEY].defaultCopy.paragraphs.map(() => "plain text, no tokens"),
    };
    const errors = validateCopy(KEY, badCopy);
    check("copy missing a required placeholder is refused", errors.length > 0, "no errors returned");
    const goodErrors = validateCopy(KEY, PRODUCT_TEMPLATES[KEY].defaultCopy);
    check("default copy validates clean", goodErrors.length === 0, goodErrors.join("; "));
  } finally {
    await cleanup(entityId);
    await pool.end();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
