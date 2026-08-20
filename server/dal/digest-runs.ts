/**
 * Digest runs — durable state for the weekly "New Needs" digest (task 58).
 *
 * The unique occurrence_key is the restart-proof schedule guard: claiming an
 * occurrence either succeeds (this process owns it) or conflicts (it is
 * already claimed). A run left at 'running' by a
 * crash is RESUMED, not re-created — per-recipient idempotency comes from
 * the email_log once-only index on (template, 'digest_run', run id, email).
 *
 * The watermark is the previous completed run's window_end: each run covers
 * (window_start, window_end], so no 'active' transition is ever covered by
 * two runs and none can fall between them.
 */
import { pool, q, withDbContext, type DbContext } from "../db/client";

export type DigestRunStatus = "running" | "sent" | "skipped_empty";

export type DigestRun = {
  id: string;
  occurrenceKey: string;
  runDate: string;
  windowStart: string;
  windowEnd: string;
  status: DigestRunStatus;
  needsCount: number | null;
  recipientsCount: number | null;
  note: string | null;
  /** Canonical DigestNeed[] snapshot; null until selection ran. Resume reads this, never re-queries. */
  needsPayload: unknown[] | null;
  createdAt: string;
  completedAt: string | null;
};

const COLS = `id, occurrence_key as "occurrenceKey", run_date as "runDate", window_start as "windowStart", window_end as "windowEnd",
  status, needs_count as "needsCount", recipients_count as "recipientsCount", note,
  needs_payload as "needsPayload", created_at as "createdAt", completed_at as "completedAt"`;

export type ClaimResult =
  | { run: DigestRun; resumed: boolean }
  /** The date's run already completed — nothing to do (the double-send guard). */
  | null;

/**
 * Serialize complete digest scheduler passes across processes. The advisory
 * lock is held on one dedicated pool connection while the callback's normal
 * RLS-scoped DAL work uses other connections. A dropped connection releases
 * the lock automatically.
 */
export async function tryWithSchedulerLock<T>(
  fn: () => Promise<T>,
): Promise<{ acquired: false } | { acquired: true; result: T }> {
  const client = await pool.connect();
  let acquired = false;
  try {
    const lock = await client.query<{ acquired: boolean }>(
      `select pg_try_advisory_lock(118041, 1) as acquired`,
    );
    acquired = lock.rows[0]?.acquired === true;
    if (!acquired) return { acquired: false };
    return { acquired: true, result: await fn() };
  } finally {
    if (acquired) {
      try {
        await client.query(`select pg_advisory_unlock(118041, 1)`);
      } catch {
        // Releasing or losing the session releases the advisory lock either way.
      }
    }
    client.release();
  }
}

/**
 * Claim occurrenceKey for runDate (YYYY-MM-DD, the LA send date), or resume
 * that occurrence's unfinished run.
 * window_start = watermark (last completed run's window_end; first run ever
 * falls back to 7 days before now). window_end = now() at claim time.
 */
export async function claimOrResume(
  ctx: DbContext,
  runDate: string,
  occurrenceKey = `date:${runDate}`,
): Promise<ClaimResult> {
  return withDbContext(ctx, async (c) => {
    const inserted = await q<DigestRun>(
      c,
      `insert into digest_runs (run_date, occurrence_key, window_start, window_end)
       select $1::date, $2,
              coalesce((select max(window_end) from digest_runs where status in ('sent','skipped_empty')),
                       now() - interval '7 days'),
              now()
       on conflict (occurrence_key) do nothing
       returning ${COLS}`,
      [runDate, occurrenceKey],
    );
    const fresh = inserted[0];
    if (fresh) return { run: fresh, resumed: false };
    const existing = await q<DigestRun>(c, `select ${COLS} from digest_runs where occurrence_key = $1`, [occurrenceKey]);
    const row = existing[0];
    if (!row) throw new Error(`digestRuns.claimOrResume: conflict but no row for ${occurrenceKey}`);
    if (row.status !== "running") return null; // completed — restart must not re-send
    return { run: row, resumed: true };
  });
}

/**
 * Persist the run's needs snapshot exactly once and return the canonical
 * one. Write-once (update only while needs_payload is null): if a snapshot
 * already exists — an interrupted run being resumed — the STORED snapshot
 * wins and the caller's fresh selection is discarded, so every recipient of
 * a run gets identical content no matter how many restarts happen.
 */
export async function setNeedsSnapshotOnce(ctx: DbContext, id: string, needs: unknown[]): Promise<unknown[]> {
  return withDbContext(ctx, async (c) => {
    const updated = await q<{ needsPayload: unknown[] }>(
      c,
      `update digest_runs set needs_payload = $2::jsonb
        where id = $1 and needs_payload is null
        returning needs_payload as "needsPayload"`,
      [id, JSON.stringify(needs)],
    );
    const fresh = updated[0];
    if (fresh) return fresh.needsPayload;
    const existing = await q<{ needsPayload: unknown[] | null }>(
      c,
      `select needs_payload as "needsPayload" from digest_runs where id = $1`,
      [id],
    );
    const row = existing[0];
    if (!row || row.needsPayload == null) throw new Error(`digestRuns.setNeedsSnapshotOnce: no snapshot on run ${id}`);
    return row.needsPayload;
  });
}

/** Complete a run. Loud if the row is not still 'running'. */
export async function finalize(
  ctx: DbContext,
  id: string,
  status: Exclude<DigestRunStatus, "running">,
  counts: { needsCount: number; recipientsCount: number },
  note: string | null,
): Promise<DigestRun> {
  const rows = await withDbContext(ctx, (c) =>
    q<DigestRun>(
      c,
      `update digest_runs
          set status = $2, needs_count = $3, recipients_count = $4, note = $5, completed_at = now()
        where id = $1 and status = 'running' returning ${COLS}`,
      [id, status, counts.needsCount, counts.recipientsCount, note],
    ),
  );
  const row = rows[0];
  if (!row) throw new Error(`digestRuns.finalize: run ${id} was not 'running'`);
  return row;
}

/**
 * Oldest run still 'running' through this date — an interrupted run that
 * must be finished BEFORE any newer date is claimed, on any weekday. Left
 * unfinished it would strand its remaining recipients and let the next
 * Thursday's watermark re-cover the same window (double send).
 */
export async function oldestUnfinishedBefore(ctx: DbContext, date: string): Promise<DigestRun | null> {
  const rows = await withDbContext(ctx, (c) =>
    q<DigestRun>(
      c,
      `select ${COLS} from digest_runs
        where status = 'running' and run_date <= $1::date
        order by run_date, created_at
        limit 1`,
      [date],
    ),
  );
  return rows[0] ?? null;
}

/** Most recent run, for the /admin/subscribers status line. */
export async function latest(ctx: DbContext): Promise<DigestRun | null> {
  const rows = await withDbContext(ctx, (c) =>
    q<DigestRun>(c, `select ${COLS} from digest_runs order by run_date desc, created_at desc limit 1`),
  );
  return rows[0] ?? null;
}

export type NewNeed = {
  id: string;
  type: "item" | "volunteer";
  name: string;
  orgName: string;
  imageUrl: string | null;
};

/**
 * Needs that transitioned to 'active' inside (from, to] — read from
 * approval_events so reinstatements count and approved_at rewrites don't
 * matter — and that are STILL active on an approved member org (a need
 * archived before the digest goes out is not advertised).
 *
 * Needs with an exclusion whose excluded_at is AFTER the window start are
 * omitted. Using excluded_at (not window_start) as the filter key means the
 * check is stable regardless of millisecond drift in the now()-7d fallback:
 * any exclusion created after the watermark counts; any created before it
 * (a prior window's stale row) does not.
 */
export async function newActiveNeeds(ctx: DbContext, from: string, to: string): Promise<NewNeed[]> {
  return withDbContext(ctx, (c) =>
    q<NewNeed>(
      c,
      `select r.id, 'item' as type, r.title as name, o.name as "orgName", r.image_url as "imageUrl"
         from item_requests r
         join organizations o on o.id = r.org_id
        where r.status = 'active' and o.kind = 'member_org' and o.status = 'approved'
          and exists (select 1 from approval_events e
                       where e.entity_type = 'item_request' and e.entity_id = r.id
                         and e.to_status = 'active' and e.created_at > $1 and e.created_at <= $2)
          and not exists (select 1 from digest_exclusions x
                           where x.need_type = 'item' and x.need_id = r.id
                             and x.excluded_at > $1::timestamptz)
       union all
       select r.id, 'volunteer' as type, r.title as name, o.name as "orgName", r.image_url as "imageUrl"
         from volunteer_requests r
         join organizations o on o.id = r.org_id
        where r.status = 'active' and o.kind = 'member_org' and o.status = 'approved'
          and exists (select 1 from approval_events e
                       where e.entity_type = 'volunteer_request' and e.entity_id = r.id
                         and e.to_status = 'active' and e.created_at > $1 and e.created_at <= $2)
          and not exists (select 1 from digest_exclusions x
                           where x.need_type = 'volunteer' and x.need_id = r.id
                             and x.excluded_at > $1::timestamptz)
        order by name`,
      [from, to],
    ),
  );
}

// ---------------------------------------------------------------------------
// Upcoming-window preview and exclusion management (task 77)
// ---------------------------------------------------------------------------

export type UpcomingWindow = {
  /** ISO timestamptz — the watermark; same value claimOrResume will use. */
  windowStart: string;
  /** ISO timestamptz — now() at query time. */
  windowEnd: string;
};

/**
 * The window the next digest run will cover: (windowStart, windowEnd].
 * windowStart is the durable watermark (max completed window_end, or 7 days
 * ago for the very first ever run). windowEnd is now().
 * This is the same arithmetic claimOrResume uses, so the preview and the
 * job always agree on the window boundaries.
 */
export async function upcomingWindow(ctx: DbContext): Promise<UpcomingWindow> {
  const rows = await withDbContext(ctx, (c) =>
    q<UpcomingWindow>(
      c,
      `select coalesce(
                (select max(window_end) from digest_runs where status in ('sent','skipped_empty')),
                now() - interval '7 days'
              ) as "windowStart",
              now() as "windowEnd"`,
      [],
    ),
  );
  const row = rows[0];
  if (!row) throw new Error("digestRuns.upcomingWindow: no row returned");
  return row;
}

export type UpcomingNeed = NewNeed & {
  /** True when an exclusion row exists for this need in the upcoming window. */
  excluded: boolean;
};

/**
 * All needs in the upcoming digest window, annotated with their exclusion
 * status. Included and excluded needs are both returned so staff can see
 * the full picture and toggle either direction.
 *
 * The window boundaries are computed in the same transaction as the needs
 * query so the two agree exactly (no TOCTOU gap between separate calls).
 */
export async function upcomingNeeds(ctx: DbContext): Promise<{ window: UpcomingWindow; needs: UpcomingNeed[] }> {
  return withDbContext(ctx, async (c) => {
    // Compute window bounds once; reuse the same watermark arithmetic as claimOrResume.
    const winRows = await q<UpcomingWindow>(
      c,
      `select coalesce(
                (select max(window_end) from digest_runs where status in ('sent','skipped_empty')),
                now() - interval '7 days'
              ) as "windowStart",
              now() as "windowEnd"`,
      [],
    );
    const win = winRows[0];
    if (!win) throw new Error("digestRuns.upcomingNeeds: window query returned no rows");

    // Same approved-org / approval_events predicate as newActiveNeeds, but
    // with the exclusion flag computed instead of filtered, so both states show.
    // The EXISTS check uses excluded_at > windowStart (not exact window_start
    // equality) so the flag is stable even when windowStart drifts between
    // calls (no-prior-completed-runs fallback = now()-7d changes each call).
    const needs = await q<UpcomingNeed>(
      c,
      `select r.id, 'item' as type, r.title as name, o.name as "orgName", r.image_url as "imageUrl",
              (exists (select 1 from digest_exclusions x
                        where x.need_type = 'item' and x.need_id = r.id
                          and x.excluded_at > $1::timestamptz)) as excluded
         from item_requests r
         join organizations o on o.id = r.org_id
        where r.status = 'active' and o.kind = 'member_org' and o.status = 'approved'
          and exists (select 1 from approval_events e
                       where e.entity_type = 'item_request' and e.entity_id = r.id
                         and e.to_status = 'active' and e.created_at > $1 and e.created_at <= $2)
       union all
       select r.id, 'volunteer' as type, r.title as name, o.name as "orgName", r.image_url as "imageUrl",
              (exists (select 1 from digest_exclusions x
                        where x.need_type = 'volunteer' and x.need_id = r.id
                          and x.excluded_at > $1::timestamptz)) as excluded
         from volunteer_requests r
         join organizations o on o.id = r.org_id
        where r.status = 'active' and o.kind = 'member_org' and o.status = 'approved'
          and exists (select 1 from approval_events e
                       where e.entity_type = 'volunteer_request' and e.entity_id = r.id
                         and e.to_status = 'active' and e.created_at > $1 and e.created_at <= $2)
        order by name`,
      [win.windowStart, win.windowEnd],
    );
    return { window: win, needs };
  });
}

/**
 * Exclude a need from the upcoming digest window.
 * Idempotent: upserts on (need_type, need_id), refreshing excluded_at so the
 * filter `excluded_at > window_start` stays correct. window_start is stored
 * for auditability only — filtering uses excluded_at, not window_start.
 * The excluded_by user id is recorded for auditability.
 */
export async function excludeNeed(
  ctx: DbContext,
  needType: "item" | "volunteer",
  needId: string,
  windowStart: string,
  excludedByUserId: string,
): Promise<void> {
  await withDbContext(ctx, (c) =>
    q(
      c,
      `insert into digest_exclusions (need_type, need_id, window_start, excluded_by, excluded_at)
       values ($1, $2, $3::timestamptz, $4::uuid, now())
       on conflict (need_type, need_id)
       do update set window_start = excluded.window_start,
                     excluded_by  = excluded.excluded_by,
                     excluded_at  = now()`,
      [needType, needId, windowStart, excludedByUserId],
    ),
  );
}

/**
 * Re-include a previously excluded need (removes the exclusion row).
 * Idempotent: a call for a need that is not excluded is a no-op.
 * Deletes by (need_type, need_id) — no window scoping needed since at most
 * one exclusion row exists per need at any time.
 */
export async function includeNeed(
  ctx: DbContext,
  needType: "item" | "volunteer",
  needId: string,
): Promise<void> {
  await withDbContext(ctx, (c) =>
    q(c, `delete from digest_exclusions where need_type = $1 and need_id = $2`, [needType, needId]),
  );
}
