/**
 * Task 58 verification — weekly New Needs digest.
 *
 * Exercises the durable pieces directly against the dev database, WITHOUT
 * dispatching to the provider (no real emails):
 *   1. Template renders (sample vars) with subject/html/text and header slot.
 *   2. claimOrResume: fresh claim, resume while 'running', null once completed
 *      (the restart double-send guard).
 *   3. Watermark: the next run's window_start equals the previous completed
 *      run's window_end.
 *   4. newActiveNeeds returns active needs for a full-history window and none
 *      for an empty future window.
 *   5. Fan-out dedup: queueProductEmail bound to the same run + recipient is
 *      { duplicate } the second time.
 * Cleans up everything it created. Run: NODE_ENV=development npx tsx scripts/test-digest.ts
 */
import { q, withDbContext, SYSTEM } from "../server/db/client";
import * as dal from "../server/dal";
import { recoverUnfinishedRuns, runDigestOnce } from "../server/jobs/digest";
import { queueProductEmail } from "../server/email/send";
import { PRODUCT_TEMPLATES } from "../server/email/templates";
import { HEADER_IMAGE_MARKER } from "../server/email/render";

function canon(v: unknown): string {
  return JSON.stringify(v, (_k, val) =>
    val && typeof val === "object" && !Array.isArray(val)
      ? Object.fromEntries(Object.entries(val as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
      : val,
  );
}

let failures = 0;
function check(name: string, ok: boolean, detail?: string): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

async function main(): Promise<void> {
  const T1 = "2001-01-04"; // fixture Thursdays far in the past — cleaned up below
  const T2 = "2001-01-11";
  const T3 = "2001-01-18";
  const T4 = "2001-01-25";
  const FIXTURE_EMAIL = "zz.digest.test@example.com";

  // Clean slate for the fixture dates/rows.
  const cleanup = async (): Promise<void> => {
    await withDbContext(SYSTEM, async (c) => {
      await q(c, `delete from email_log where lower(to_email) like 'zz.digest.%' and template_key = 'digest_new_needs'`, []);
      await q(c, `delete from digest_runs where run_date in ($1::date, $2::date, $3::date, $4::date)`, [T1, T2, T3, T4]);
    });
  };
  await cleanup();

  try {
    // 1. Template render
    const tpl = PRODUCT_TEMPLATES.digest_new_needs;
    const rendered = tpl.render(tpl.sample);
    check("template renders subject/html/text", rendered.subject.length > 0 && rendered.html.includes(HEADER_IMAGE_MARKER) && rendered.text.includes("Unsubscribe:"));
    check("template lists sample needs", rendered.html.includes("Winter Warmth Drive") && rendered.text.includes("Meal Service Volunteers"));

    // 2/3. claim / resume / complete / watermark
    const first = await dal.digestRuns.claimOrResume(SYSTEM, T1);
    check("fresh claim returns a running run", first !== null && !first.resumed && first.run.status === "running");
    const again = await dal.digestRuns.claimOrResume(SYSTEM, T1);
    check("second claim resumes, same run", again !== null && again.resumed && again.run.id === first?.run.id);
    if (!first) throw new Error("no run claimed");
    await dal.digestRuns.finalize(SYSTEM, first.run.id, "skipped_empty", { needsCount: 0, recipientsCount: 0 }, "test");
    const done = await dal.digestRuns.claimOrResume(SYSTEM, T1);
    check("claim after completion returns null (no double send)", done === null);

    const second = await dal.digestRuns.claimOrResume(SYSTEM, T2);
    check(
      "watermark: next window_start = previous window_end",
      second !== null && new Date(second.run.windowStart).getTime() === new Date(first.run.windowEnd).getTime(),
      second ? `${second.run.windowStart} vs ${first.run.windowEnd}` : "no second run",
    );

    // 4. selection
    const all = await dal.digestRuns.newActiveNeeds(SYSTEM, "1970-01-01", new Date().toISOString());
    check("full-history window finds active needs", all.length > 0, `found ${all.length}`);
    const shapes = all.every((n) => (n.type === "item" || n.type === "volunteer") && n.name.length > 0 && n.orgName.length > 0);
    check("need rows carry type/name/orgName", shapes);
    const empty = await dal.digestRuns.newActiveNeeds(SYSTEM, "2099-01-01", "2099-01-02");
    check("empty window finds nothing", empty.length === 0);

    // 5. fan-out dedup on the once-only index
    if (second) {
      const original = [{ name: "Original Need", organizationName: "Org A", typeLabel: "Item need", url: "https://example.org/items/1", imageUrl: null }];
      const vars = { needs: original, unsubscribeUrl: "https://example.org/unsubscribe/x" };
      const q1 = await queueProductEmail(SYSTEM, { key: "digest_new_needs", entityId: second.run.id, toEmail: FIXTURE_EMAIL, vars });
      const q2 = await queueProductEmail(SYSTEM, { key: "digest_new_needs", entityId: second.run.id, toEmail: FIXTURE_EMAIL, vars });
      check("first enqueue queued (or skipped if staff disabled)", q1.outcome === "queued" || q1.outcome === "skipped_disabled", q1.outcome);
      check("second enqueue is a duplicate (restart-safe fan-out)", q1.outcome !== "queued" || q2.outcome === "duplicate", q2.outcome);
      check("email_log row uses digest_run entity binding", q1.outcome !== "queued" || (await withDbContext(SYSTEM, (c) => q<{ entity_type: string }>(c, `select entity_type from email_log where id = $1`, [(q1 as { dispatch: { emailLogId: string } }).dispatch.emailLogId]))).some((r) => r.entity_type === "digest_run"));

      // 6. Content snapshot survives a resume (review regression): the run's
      // needs are written once; a later (resumed) pass that selects different
      // content gets the ORIGINAL snapshot back, so recipient #2 is enqueued
      // with content identical to recipient #1 even if needs changed/archived
      // between the crash and the restart.
      const changed = [{ name: "Different Need", organizationName: "Org B", typeLabel: "Volunteer need", url: "https://example.org/items/2", imageUrl: null }];
      const stored1 = await dal.digestRuns.setNeedsSnapshotOnce(SYSTEM, second.run.id, original);
      const stored2 = await dal.digestRuns.setNeedsSnapshotOnce(SYSTEM, second.run.id, changed);
      check("snapshot is write-once (resume keeps original content)", canon(stored2) === canon(original));
      const resumedRun = await dal.digestRuns.claimOrResume(SYSTEM, T2);
      check("resumed run carries the stored snapshot", resumedRun !== null && canon(resumedRun.run.needsPayload) === canon(original));
      const FIXTURE_EMAIL_2 = "zz.digest.test2@example.com";
      const q3 = await queueProductEmail(SYSTEM, {
        key: "digest_new_needs",
        entityId: second.run.id,
        toEmail: FIXTURE_EMAIL_2,
        vars: { needs: stored2, unsubscribeUrl: "https://example.org/unsubscribe/y" },
      });
      if (q3.outcome === "queued" && q1.outcome === "queued") {
        const payloads = await withDbContext(SYSTEM, (c) =>
          q<{ vars: { needs: unknown } }>(c, `select payload->'vars' as vars from email_log where id in ($1, $2)`, [
            q1.dispatch.emailLogId,
            q3.dispatch.emailLogId,
          ]),
        );
        check(
          "recipients queued before and after resume get identical needs",
          payloads.length === 2 && canon((payloads[0]!.vars as { needs: unknown }).needs) === canon((payloads[1]!.vars as { needs: unknown }).needs),
        );
      } else {
        check("post-resume recipient enqueued", q3.outcome === "skipped_disabled" && q1.outcome === "skipped_disabled", `${q1.outcome}/${q3.outcome}`);
      }
      await withDbContext(SYSTEM, (c) =>
        q(c, `delete from email_log where lower(to_email) = lower($1) and template_key = 'digest_new_needs'`, [FIXTURE_EMAIL_2]),
      );
      await dal.digestRuns.finalize(SYSTEM, second.run.id, "skipped_empty", { needsCount: 0, recipientsCount: 0 }, "test");
    }

    // 7. Cross-day crash recovery (review regression): crash after a partial
    // fan-out on Thursday, restart AFTER Thursday, then the next scheduled
    // date. The prior run must complete (remaining recipients get the stored
    // content), and no recipient may receive a second run re-covering the
    // same needs.
    const SUB_A = { email: "zz.digest.a@example.com", personId: null, unsubscribeToken: "00000000-0000-0000-0000-00000000000a" };
    const SUB_B = { email: "zz.digest.b@example.com", personId: null, unsubscribeToken: "00000000-0000-0000-0000-00000000000b" };
    const deps = { listSubscribers: async () => [SUB_A, SUB_B], dispatch: async () => [] };
    const crashNeeds = [{ name: "Crash Week Need", organizationName: "Org C", typeLabel: "Item need", url: "https://example.org/items/9", imageUrl: null }];
    const crashed = await dal.digestRuns.claimOrResume(SYSTEM, T3);
    if (!crashed) throw new Error("could not claim T3");
    await dal.digestRuns.setNeedsSnapshotOnce(SYSTEM, crashed.run.id, crashNeeds);
    const qa = await queueProductEmail(SYSTEM, {
      key: "digest_new_needs",
      entityId: crashed.run.id,
      toEmail: SUB_A.email,
      vars: { needs: crashNeeds, unsubscribeUrl: "https://example.org/unsubscribe/a" },
    });
    // ...process "crashes" here: run left 'running', only A enqueued.

    const recovered = await recoverUnfinishedRuns("2001-01-19", deps); // a Friday
    check("Friday restart recovers the unfinished Thursday run", recovered === 1, `recovered ${recovered}`);
    const afterRecovery = await withDbContext(SYSTEM, (c) =>
      q<{ status: string; note: string | null }>(c, `select status, note from digest_runs where run_date = $1::date`, [T3]),
    );
    check("recovered run completed as sent", afterRecovery[0]?.status === "sent", afterRecovery[0]?.status);
    const bRows = await withDbContext(SYSTEM, (c) =>
      q<{ vars: { needs: unknown } }>(
        c,
        `select payload->'vars' as vars from email_log where lower(to_email) = lower($1) and template_key = 'digest_new_needs'`,
        [SUB_B.email],
      ),
    );
    check("remaining recipient was queued during recovery with the stored content", bRows.length === 1 && canon((bRows[0]!.vars as { needs: unknown }).needs) === canon(crashNeeds));

    // Next scheduled date: watermark must start where the recovered run
    // ended; no recipient gets a second email containing the crash-week
    // needs (the ancient window holds no new activations → skipped_empty).
    const next = await runDigestOnce(T4, deps);
    check("next scheduled run does not re-send the recovered week", next.outcome === "skipped_empty" || next.outcome === "sent");
    const aRows = await withDbContext(SYSTEM, (c) =>
      q<{ vars: { needs: unknown } }>(
        c,
        `select payload->'vars' as vars from email_log where lower(to_email) = lower($1) and template_key = 'digest_new_needs'`,
        [SUB_A.email],
      ),
    );
    const aWithCrashNeeds = aRows.filter((r) => canon((r.vars as { needs: unknown }).needs) === canon(crashNeeds));
    check("recipient A received the crash-week needs exactly once", qa.outcome !== "queued" || aWithCrashNeeds.length === 1, `${aWithCrashNeeds.length} row(s)`);
    const t4run = await withDbContext(SYSTEM, (c) =>
      q<{ window_start: string; window_end: string }>(c, `select window_start, window_end from digest_runs where run_date = $1::date`, [T4]),
    );
    const t3run = await withDbContext(SYSTEM, (c) =>
      q<{ window_end: string }>(c, `select window_end from digest_runs where run_date = $1::date`, [T3]),
    );
    check(
      "next run's watermark starts at the recovered run's window end",
      t4run[0] !== undefined && t3run[0] !== undefined && new Date(t4run[0].window_start).getTime() === new Date(t3run[0].window_end).getTime(),
    );
  } finally {
    await cleanup();
  }

  console.log(failures === 0 ? "\nAll digest checks passed." : `\n${failures} check(s) FAILED.`);
  process.exitCode = failures === 0 ? 0 : 1;
  const { pool } = await import("../server/db/client");
  await (pool as { end?: () => Promise<void> }).end?.();
}

main().catch((err) => {
  console.error("test-digest failed:", err);
  process.exit(1);
});
