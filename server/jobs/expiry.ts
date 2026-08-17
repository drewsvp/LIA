/**
 * Part 3 — the nightly expiry job.
 *
 * Scheduled at 12:15 AM Pacific. Selects item requests and volunteer
 * requests where status = 'active' and expires_on is earlier than the
 * current LA date, and archives each with archived_reason = 'expired',
 * writing exactly one approval_events row per request with a null actor
 * (transitionStatusInTx does both in one transaction). The event note is
 * 'expired', which ADMIN-07 renders as "Archived automatically after
 * expiry" — the same pattern record_item_pledge() uses with 'fulfilled'.
 *
 * Both types, one job. Batches of 50, paging until exhausted. Idempotent:
 * archiving removes a row from the next selection, and a pass that finds
 * nothing does nothing.
 *
 * Fulfillment archiving is NOT this job; it happens inside
 * record_item_pledge() when the final item reaches zero remaining.
 *
 * Scheduling: a 60-second tick compares the LA wall clock. The pass fires
 * on the first tick at or after 00:15 LA that has not yet fired for that
 * LA date. Run state is in-memory, so a restart later in the day runs the
 * pass again at boot — deliberate: the pass is idempotent, and a no-op
 * re-run is better than an expired request lingering because a deploy
 * spanned midnight. LA has no DST transition at 00:15 (transitions are at
 * 02:00), and the once-per-LA-date guard covers the fall-back repeat hour.
 */
import * as dal from "../dal";
import { SYSTEM, withDbContext } from "../db/client";

const BATCH_SIZE = 50;
const RUN_AT_MINUTES_OF_DAY = 15; // 00:15 LA

export type ExpirySummary = {
  itemArchived: number;
  volunteerArchived: number;
  /** Changed state between selection and the row lock — benign, logged. */
  skipped: number;
  /** Real failures, logged loudly; the pass continues past them. */
  failed: number;
};

type Kind = "item" | "volunteer";

async function archiveOne(kind: Kind, requestId: string): Promise<"archived" | "skipped" | "failed"> {
  try {
    await withDbContext(SYSTEM, async (c) => {
      const input = {
        requestId,
        to: "archived" as const,
        actorUserId: null,
        note: "expired",
        archivedReason: "expired" as const,
      };
      if (kind === "item") {
        await dal.itemRequests.transitionStatusInTx(c, input);
      } else {
        await dal.volunteerRequests.transitionStatusInTx(c, input);
      }
    });
    return "archived";
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // The transition takes a FOR UPDATE lock and re-reads status, so this
    // branch means someone else archived (or otherwise moved) the request
    // between our select and the lock. It is no longer active-and-expired,
    // which is the outcome we wanted.
    if (message.includes("already archived") || message.includes("not a legal edge") || message.includes("not found")) {
      console.warn(`[expiry] ${kind} ${requestId} skipped: ${message}`);
      return "skipped";
    }
    console.error(`[expiry] ${kind} ${requestId} FAILED:`, err);
    return "failed";
  }
}

async function runKind(kind: Kind): Promise<{ archived: number; skipped: number; failed: number }> {
  // Archived and skipped rows drop out of the next selection on their own;
  // failed ids are excluded here so a persistent failure cannot loop the
  // pass forever. (If failures ever fill a whole batch window, the rows
  // behind them wait for the next night — every failure is already loud.)
  const failedIds = new Set<string>();
  let archived = 0;
  let skipped = 0;
  for (;;) {
    const ids =
      kind === "item"
        ? await dal.itemRequests.expiredActiveIds(SYSTEM, BATCH_SIZE)
        : await dal.volunteerRequests.expiredActiveIds(SYSTEM, BATCH_SIZE);
    const fresh = ids.filter((id) => !failedIds.has(id));
    if (fresh.length === 0) break;
    for (const id of fresh) {
      const outcome = await archiveOne(kind, id);
      if (outcome === "archived") archived += 1;
      else if (outcome === "skipped") skipped += 1;
      else failedIds.add(id);
    }
  }
  return { archived, skipped, failed: failedIds.size };
}

let passRunning = false;

/** One full pass over both types. Exported for the scheduler and for manual verification runs. */
export async function runExpiryOnce(): Promise<ExpirySummary> {
  if (passRunning) {
    console.warn("[expiry] a pass is already running; not starting another");
    return { itemArchived: 0, volunteerArchived: 0, skipped: 0, failed: 0 };
  }
  passRunning = true;
  try {
    const startedAt = Date.now();
    const item = await runKind("item");
    const volunteer = await runKind("volunteer");
    const summary: ExpirySummary = {
      itemArchived: item.archived,
      volunteerArchived: volunteer.archived,
      skipped: item.skipped + volunteer.skipped,
      failed: item.failed + volunteer.failed,
    };
    console.log(
      `[expiry] pass done in ${Date.now() - startedAt}ms: ` +
        `${summary.itemArchived} item archived, ${summary.volunteerArchived} volunteer archived, ` +
        `${summary.skipped} skipped, ${summary.failed} failed`,
    );
    return summary;
  } finally {
    passRunning = false;
  }
}

function laDateAndMinutes(now: Date): { date: string; minutesOfDay: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? "";
  const hour = Number(get("hour")) % 24; // some ICU builds emit "24" at midnight
  return { date: `${get("year")}-${get("month")}-${get("day")}`, minutesOfDay: hour * 60 + Number(get("minute")) };
}

let lastRunLaDate: string | null = null;

export function startExpiryScheduler(): void {
  const tick = (): void => {
    const { date, minutesOfDay } = laDateAndMinutes(new Date());
    if (minutesOfDay >= RUN_AT_MINUTES_OF_DAY && lastRunLaDate !== date) {
      // Marked before the pass so the next tick cannot double-start it.
      lastRunLaDate = date;
      void runExpiryOnce();
    }
  };
  setInterval(tick, 60_000);
  tick(); // boot catch-up — see header comment
  console.log("[expiry] scheduler started: nightly at 12:15 AM Pacific (60s tick, boot catch-up)");
}
