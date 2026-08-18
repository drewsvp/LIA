-- 0009_digest_runs.sql
-- Weekly "New Needs" digest (task 58): durable run state.
--
-- One row per digest run, keyed by the LA calendar date the run belongs to
-- (unique — the durable once-per-Thursday guard; a restart on Thursday can
-- claim the date exactly once). The window [window_start, window_end] is the
-- interval of approval_events 'active' transitions this run covers:
-- window_start is the previous completed run's window_end (the watermark),
-- so the selection is "since the last digest", never a fixed 7-day window.
--
-- status:
--   running       — the run claimed its date; fan-out may be in progress.
--                   A restart resumes fan-out (the email_log once-only index
--                   makes per-recipient enqueue idempotent for the run id).
--   sent          — fan-out enqueued for every subscribed address.
--   skipped_empty — zero new needs in the window; nothing was sent, and this
--                   row IS the visible record of that decision (surfaced on
--                   /admin/subscribers), never a silent skip.
create table digest_runs (
  id               uuid primary key default gen_random_uuid(),
  run_date         date not null unique,
  window_start     timestamptz not null,
  window_end       timestamptz not null,
  status           text not null default 'running'
                     check (status in ('running','sent','skipped_empty')),
  needs_count      integer,
  recipients_count integer,
  note             text,
  created_at       timestamptz not null default now(),
  completed_at     timestamptz
);

-- RLS (mirrored in server/db/rls-policies.sql): staff/system only. The run
-- ledger is operational state; members and the public never read it.
alter table digest_runs enable row level security;
alter table digest_runs force row level security;

drop policy if exists digest_runs_system_staff_all on digest_runs;
create policy digest_runs_system_staff_all on digest_runs
  using (current_setting('app.context', true) in ('system','staff'))
  with check (current_setting('app.context', true) in ('system','staff'));
