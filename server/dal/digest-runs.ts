/**
 * Digest runs — durable state for the weekly "New Needs" digest (task 58).
 *
 * The unique run_date is the restart-proof once-per-Thursday guard: claiming
 * a date is an insert that either succeeds (this process owns the run) or
 * conflicts (the date is already claimed). A run left at 'running' by a
 * crash is RESUMED, not re-created — per-recipient idempotency comes from
 * the email_log once-only index on (template, 'digest_run', run id, email).
 *
 * The watermark is the previous completed run's window_end: each run covers
 * (window_start, window_end], so no 'active' transition is ever covered by
 * two runs and none can fall between them.
 */
import { q, withDbContext, type DbContext } from "../db/client";

export type DigestRunStatus = "running" | "sent" | "skipped_empty";

export type DigestRun = {
  id: string;
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

const COLS = `id, run_date as "runDate", window_start as "windowStart", window_end as "windowEnd",
  status, needs_count as "needsCount", recipients_count as "recipientsCount", note,
  needs_payload as "needsPayload", created_at as "createdAt", completed_at as "completedAt"`;

export type ClaimResult =
  | { run: DigestRun; resumed: boolean }
  /** The date's run already completed — nothing to do (the double-send guard). */
  | null;

/**
 * Claim runDate (YYYY-MM-DD, the LA date) or resume its unfinished run.
 * window_start = watermark (last completed run's window_end; first run ever
 * falls back to 7 days before now). window_end = now() at claim time.
 */
export async function claimOrResume(ctx: DbContext, runDate: string): Promise<ClaimResult> {
  return withDbContext(ctx, async (c) => {
    const inserted = await q<DigestRun>(
      c,
      `insert into digest_runs (run_date, window_start, window_end)
       select $1::date,
              coalesce((select max(window_end) from digest_runs where status in ('sent','skipped_empty')),
                       now() - interval '7 days'),
              now()
       on conflict (run_date) do nothing
       returning ${COLS}`,
      [runDate],
    );
    const fresh = inserted[0];
    if (fresh) return { run: fresh, resumed: false };
    const existing = await q<DigestRun>(c, `select ${COLS} from digest_runs where run_date = $1::date`, [runDate]);
    const row = existing[0];
    if (!row) throw new Error(`digestRuns.claimOrResume: conflict but no row for ${runDate}`);
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
 * Oldest run still 'running' from an earlier date — an interrupted run that
 * must be finished BEFORE any newer date is claimed, on any weekday. Left
 * unfinished it would strand its remaining recipients and let the next
 * Thursday's watermark re-cover the same window (double send).
 */
export async function oldestUnfinishedBefore(ctx: DbContext, date: string): Promise<DigestRun | null> {
  const rows = await withDbContext(ctx, (c) =>
    q<DigestRun>(
      c,
      `select ${COLS} from digest_runs where status = 'running' and run_date < $1::date order by run_date limit 1`,
      [date],
    ),
  );
  return rows[0] ?? null;
}

/** Most recent run, for the /admin/subscribers status line. */
export async function latest(ctx: DbContext): Promise<DigestRun | null> {
  const rows = await withDbContext(ctx, (c) =>
    q<DigestRun>(c, `select ${COLS} from digest_runs order by run_date desc limit 1`),
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
       union all
       select r.id, 'volunteer' as type, r.title as name, o.name as "orgName", r.image_url as "imageUrl"
         from volunteer_requests r
         join organizations o on o.id = r.org_id
        where r.status = 'active' and o.kind = 'member_org' and o.status = 'approved'
          and exists (select 1 from approval_events e
                       where e.entity_type = 'volunteer_request' and e.entity_id = r.id
                         and e.to_status = 'active' and e.created_at > $1 and e.created_at <= $2)
        order by name`,
      [from, to],
    ),
  );
}
