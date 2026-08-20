/**
 * Weekly "New Needs" digest job (task 58).
 *
 * On the configured Pacific weekly or one-time schedule, one digest email per subscribed
 * digest_subscribers row, listing the needs that transitioned to 'active'
 * since the previous completed digest run (a durable watermark in
 * digest_runs, NOT a fixed 7-day window).
 *
 * Restart safety — unlike the nightly expiry pass, sending email is not
 * idempotent by nature, so the guard is durable, not in-memory:
 *   1. The digest_runs.occurrence_key uniquely claims each weekly/one-time
 *      occurrence. A completed occurrence means a restarted process does nothing.
 *   2. A run left 'running' by a crash is RESUMED — on ANY day, not just
 *      Thursday: every pass first finishes the oldest unfinished run before
 *      a newer date may be claimed, so a crash that spans past Thursday
 *      still delivers to the remaining recipients, and the watermark
 *      advances before the next week's selection (no re-covered window).
 *   3. The run's content is a write-once snapshot (digest_runs.needs_payload)
 *      taken before any recipient is enqueued; resumes reuse it verbatim, so
 *      every recipient of a run gets identical content even if needs were
 *      archived between crash and restart.
 *   4. Enqueueing goes through queueProductEmail bound to
 *      (digest_run, run id, recipient): the email_log once-only index turns
 *      every already-enqueued recipient into a visible { duplicate } — never
 *      a second email. Rows enqueued but not dispatched before a crash are
 *      re-dispatched by the existing stranded-email sweep.
 *
 * A week with zero new needs sends nothing and records the decision as a
 * digest_runs row with status 'skipped_empty' (surfaced on
 * /admin/subscribers) plus a loud log line — never a silent skip.
 *
 * Scheduling mirrors startExpiryScheduler: 60-second tick against the LA
 * wall clock with a boot catch-up tick, but the once-per-date decision lives
 * in the database. The boot tick additionally runs recovery on every weekday.
 */
import * as dal from "../dal";
import { SYSTEM } from "../db/client";
import {
  absoluteUrl,
  dispatchQueuedEmails,
  queueProductEmail,
  type PendingDispatch,
} from "../email/send";
import type { DigestRun } from "../dal/digest-runs";
import type { DigestNeed } from "../email/templates/digest-new-needs";
import { DIGEST_TEMPLATE_KEY, pacificClock } from "../digest-schedule";

export type DigestSummary = {
  outcome: "already_ran" | "skipped_empty" | "sent";
  needs: number;
  enqueued: number;
  duplicates: number;
  skippedDisabled: number;
  blocked: number;
};

/** Injectable seams for verification scripts (never dispatch to real subscribers from a test). */
export type DigestDeps = {
  listSubscribers: () => Promise<{ email: string; personId: string | null; unsubscribeToken: string }[]>;
  dispatch: (pending: PendingDispatch[]) => Promise<unknown>;
};

const REAL_DEPS: DigestDeps = {
  listSubscribers: async () => dal.digestSubscribers.list(SYSTEM, "subscribed"),
  dispatch: dispatchQueuedEmails,
};

export type DigestSchedulerDeps = DigestDeps & {
  getSchedule: () => ReturnType<typeof dal.emailSchedules.getSchedule>;
  weeklyOccurrenceAt: (date: string, minutes: number) => Promise<string>;
  consumeOneTime: (oneTimeAt: string) => Promise<void>;
};

const REAL_SCHEDULER_DEPS: DigestSchedulerDeps = {
  ...REAL_DEPS,
  getSchedule: async () => dal.emailSchedules.getSchedule(SYSTEM, DIGEST_TEMPLATE_KEY),
  weeklyOccurrenceAt: async (date, minutes) =>
    dal.emailSchedules.pacificWeeklyLocalToInstant(SYSTEM, date, minutes),
  consumeOneTime: async (oneTimeAt) =>
    dal.emailSchedules.consumeOneTimeIfMatches(SYSTEM, DIGEST_TEMPLATE_KEY, oneTimeAt),
};

function needToVars(n: dal.digestRuns.NewNeed): DigestNeed {
  const path = n.type === "item" ? `/items/${n.id}` : `/volunteer/${n.id}`;
  const imageUrl =
    n.imageUrl == null || n.imageUrl.trim() === ""
      ? null
      : /^https?:\/\//.test(n.imageUrl)
        ? n.imageUrl
        : absoluteUrl(n.imageUrl);
  return {
    name: n.name,
    organizationName: n.orgName,
    typeLabel: n.type === "item" ? "Item need" : "Volunteer need",
    url: absoluteUrl(path),
    imageUrl,
  };
}

/** Fan out and complete one claimed/resumed run. */
async function processRun(run: DigestRun, resumed: boolean, deps: DigestDeps): Promise<DigestSummary> {
  const none: DigestSummary = { outcome: "already_ran", needs: 0, enqueued: 0, duplicates: 0, skippedDisabled: 0, blocked: 0 };
  if (resumed) {
    console.warn(`[digest] resuming unfinished run ${run.id} (${run.runDate}) — process stopped mid-fan-out?`);
  }

  // Content snapshot (review fix): selection runs at most once per run.
  // The snapshot is written before any recipient is enqueued, and a resume
  // reads it back instead of re-querying — so a need archived mid-fan-out
  // can neither change the digest for the remaining recipients nor turn an
  // interrupted send into a bogus skipped_empty. The empty case is only
  // ever evaluated on the initial selection (no snapshot = nothing was
  // enqueued yet, so skipping is still correct).
  let needs: DigestNeed[];
  if (run.needsPayload != null) {
    needs = run.needsPayload as DigestNeed[];
    console.warn(`[digest] run ${run.id}: using stored content snapshot (${needs.length} need(s))`);
  } else {
    const rawNeeds = await dal.digestRuns.newActiveNeeds(SYSTEM, run.windowStart, run.windowEnd);
    if (rawNeeds.length === 0) {
      const note = `No needs became active between ${run.windowStart} and ${run.windowEnd}; nothing was sent.`;
      await dal.digestRuns.finalize(SYSTEM, run.id, "skipped_empty", { needsCount: 0, recipientsCount: 0 }, note);
      console.warn(`[digest] ${run.runDate}: zero new needs in window — digest skipped (recorded on run ${run.id})`);
      return { ...none, outcome: "skipped_empty" };
    }
    // Write-once: if a concurrent/resumed writer got there first, the
    // stored snapshot is returned and used instead of this selection.
    needs = (await dal.digestRuns.setNeedsSnapshotOnce(SYSTEM, run.id, rawNeeds.map(needToVars))) as DigestNeed[];
  }

  // Subscribed only — unsubscribed and bounced are never emailed.
  const subscribers = await deps.listSubscribers();
  const dispatches: PendingDispatch[] = [];
  let duplicates = 0;
  let skippedDisabled = 0;
  let blocked = 0;
  for (const sub of subscribers) {
    const queued = await queueProductEmail(SYSTEM, {
      key: "digest_new_needs",
      entityId: run.id,
      toEmail: sub.email,
      toPersonId: sub.personId ?? null,
      vars: { needs, unsubscribeUrl: absoluteUrl(`/unsubscribe/${sub.unsubscribeToken}`) },
    });
    if (queued.outcome === "queued") dispatches.push(queued.dispatch);
    else if (queued.outcome === "duplicate") duplicates += 1; // resumed run — already enqueued
    else if (queued.outcome === "skipped_disabled") skippedDisabled += 1;
    else {
      blocked += 1;
      console.error(`[digest] enqueue blocked for ${sub.email}: ${queued.reason}`);
    }
  }

  const noteParts: string[] = [];
  if (resumed) noteParts.push("resumed after an interrupted run");
  if (duplicates > 0) noteParts.push(`${duplicates} recipient(s) already enqueued before the restart`);
  if (skippedDisabled > 0) noteParts.push(`${skippedDisabled} skipped: template disabled by staff`);
  if (blocked > 0) noteParts.push(`${blocked} blocked (see email log)`);
  await dal.digestRuns.finalize(
    SYSTEM,
    run.id,
    "sent",
    { needsCount: needs.length, recipientsCount: dispatches.length + duplicates },
    noteParts.length > 0 ? noteParts.join("; ") : null,
  );
  console.log(
    `[digest] ${run.runDate}: ${needs.length} need(s), ${dispatches.length} email(s) enqueued` +
      (noteParts.length > 0 ? ` (${noteParts.join("; ")})` : ""),
  );

  // Dispatch after the run is finalized: per-recipient outcomes live on the
  // email_log rows, and anything stranded here is the sweep's job.
  await deps.dispatch(dispatches);
  return { outcome: "sent", needs: needs.length, enqueued: dispatches.length, duplicates, skippedDisabled, blocked };
}

/**
 * Finish every run left 'running' from a date before laDate — crash
 * recovery that runs on ANY weekday (boot and every scheduled pass), so an
 * interrupted Thursday delivers to its remaining recipients on the next
 * restart instead of stranding them, and the watermark advances before a
 * newer run can be claimed.
 */
export async function recoverUnfinishedRuns(laDate: string, deps: DigestDeps = REAL_DEPS): Promise<number> {
  let recovered = 0;
  for (;;) {
    const stale = await dal.digestRuns.oldestUnfinishedBefore(SYSTEM, laDate);
    if (!stale) return recovered;
    console.warn(`[digest] recovering unfinished run from ${stale.runDate}`);
    await processRun(stale, true, deps);
    recovered += 1;
  }
}

const NO_RUN: DigestSummary = {
  outcome: "already_ran",
  needs: 0,
  enqueued: 0,
  duplicates: 0,
  skippedDisabled: 0,
  blocked: 0,
};

/** One digest attempt for the given LA date (recovery first, then today's run). */
export async function runDigestOnce(laDate: string, deps: DigestDeps = REAL_DEPS): Promise<DigestSummary> {
  const locked = await dal.digestRuns.tryWithSchedulerLock<DigestSummary>(async () => {
    // Older unfinished runs MUST complete before today's run is claimed, or
    // today's watermark would re-cover the unfinished run's window.
    await recoverUnfinishedRuns(laDate, deps);
    const claim = await dal.digestRuns.claimOrResume(SYSTEM, laDate);
    if (claim === null) {
      console.log(`[digest] run for ${laDate} already completed — nothing to do`);
      return NO_RUN;
    }
    return processRun(claim.run, claim.resumed, deps);
  });
  if (!locked.acquired) {
    console.warn("[digest] a pass is already running; not starting another");
    return NO_RUN;
  }
  return locked.result;
}

/** Boot-time crash recovery only — never claims a new date. */
export async function recoverAtBoot(laDate: string): Promise<void> {
  const locked = await dal.digestRuns.tryWithSchedulerLock(async () => {
    const recovered = await recoverUnfinishedRuns(laDate, REAL_DEPS);
    if (recovered > 0) console.warn(`[digest] boot recovery finished ${recovered} interrupted run(s)`);
  });
  if (!locked.acquired) console.warn("[digest] another process owns boot recovery");
}

/**
 * Configuration-aware scheduler pass. Recovery always runs, even while the
 * schedule is paused; only claiming a NEW run is paused. A due one-time send
 * is cleared only after the run date was claimed/resumed, so a restart cannot
 * lose it. Exact same-instant weekly/one-time schedules share an occurrence;
 * different instants on the same date receive separate durable claims.
 */
export async function runScheduledDigestOnce(
  now = new Date(),
  deps: DigestSchedulerDeps = REAL_SCHEDULER_DEPS,
): Promise<DigestSummary> {
  const locked = await dal.digestRuns.tryWithSchedulerLock<DigestSummary>(async () => {
    const clock = pacificClock(now);
    await recoverUnfinishedRuns(clock.date, deps);
    const schedule = await deps.getSchedule();
    if (!schedule?.active) return NO_RUN;

    const addDays = (date: string, days: number): string => {
      const [year, month, day] = date.split("-").map(Number);
      return new Date(Date.UTC(year!, month! - 1, day! + days)).toISOString().slice(0, 10);
    };
    const daysSinceWeekday = (clock.weekday - schedule.weeklyWeekday + 7) % 7;
    let weeklyDate = addDays(clock.date, -daysSinceWeekday);
    let weeklyAt = await deps.weeklyOccurrenceAt(weeklyDate, schedule.weeklyMinutes);
    if (new Date(weeklyAt).getTime() > now.getTime()) {
      weeklyDate = addDays(weeklyDate, -7);
      weeklyAt = await deps.weeklyOccurrenceAt(weeklyDate, schedule.weeklyMinutes);
    }
    // A schedule edit/resume does not retroactively invent an occurrence
    // under settings that were not active yet. An unchanged active schedule
    // still catches up its latest missed occurrence after an outage.
    const weeklyDue =
      new Date(weeklyAt).getTime() >= new Date(schedule.updatedAt).getTime();
    const oneTimeDue =
      schedule.oneTimeAt !== null && new Date(schedule.oneTimeAt).getTime() <= now.getTime();
    if (!weeklyDue && !oneTimeDue) return NO_RUN;

    type DueOccurrence = { key: string; targetAt: string; consumeOneTime: string | null };
    const occurrences: DueOccurrence[] = [];
    if (weeklyDue && oneTimeDue && new Date(weeklyAt).getTime() === new Date(schedule.oneTimeAt!).getTime()) {
      // Exact same instant: one digest run, while still consuming the one-time
      // request so it cannot reappear after restart.
      occurrences.push({
        key: `weekly:${weeklyDate}`,
        targetAt: weeklyAt,
        consumeOneTime: schedule.oneTimeAt!,
      });
    } else {
      if (weeklyDue) occurrences.push({ key: `weekly:${weeklyDate}`, targetAt: weeklyAt, consumeOneTime: null });
      if (oneTimeDue) {
        occurrences.push({
          key: `once:${new Date(schedule.oneTimeAt!).toISOString()}`,
          targetAt: schedule.oneTimeAt!,
          consumeOneTime: schedule.oneTimeAt!,
        });
      }
    }
    occurrences.sort((a, b) => new Date(a.targetAt).getTime() - new Date(b.targetAt).getTime());

    const summaries: DigestSummary[] = [];
    for (const occurrence of occurrences) {
      const claim = await dal.digestRuns.claimOrResume(SYSTEM, clock.date, occurrence.key);
      if (occurrence.consumeOneTime !== null) await deps.consumeOneTime(occurrence.consumeOneTime);
      if (claim !== null) summaries.push(await processRun(claim.run, claim.resumed, deps));
    }
    if (summaries.length === 0) return NO_RUN;
    return {
      outcome: summaries.some((summary) => summary.outcome === "sent") ? "sent" : "skipped_empty",
      needs: summaries.reduce((sum, summary) => sum + summary.needs, 0),
      enqueued: summaries.reduce((sum, summary) => sum + summary.enqueued, 0),
      duplicates: summaries.reduce((sum, summary) => sum + summary.duplicates, 0),
      skippedDisabled: summaries.reduce((sum, summary) => sum + summary.skippedDisabled, 0),
      blocked: summaries.reduce((sum, summary) => sum + summary.blocked, 0),
    };
  });
  if (!locked.acquired) {
    console.warn("[digest] another process owns the scheduled pass");
    return NO_RUN;
  }
  return locked.result;
}

export function startDigestScheduler(): void {
  const tick = (): void => {
    const now = new Date();
    const clock = pacificClock(now);
    void runScheduledDigestOnce(now).catch((err) => {
      console.error(`[digest] scheduled pass for ${clock.date} failed; will retry:`, err);
    });
  };
  setInterval(tick, 60_000);
  // Boot calls the same pass: it recovers interrupted fan-out on any day and
  // evaluates a due configured schedule without relying on process memory.
  tick();
  console.log("[digest] scheduler started: configured Pacific weekly/one-time schedule (60s tick, durable run guard, boot recovery)");
}
