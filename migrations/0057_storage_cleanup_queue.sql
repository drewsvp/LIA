-- Durable retry queue for storage objects that could not be deleted after a
-- failed save or successful replacement. Safe when Publish materializes the
-- schema before the migration ledger catches up.
create table if not exists storage_cleanup_queue (
  id              uuid primary key default gen_random_uuid(),
  object_url      text not null unique,
  reason          text not null,
  attempts        integer not null default 0 check (attempts >= 0),
  last_error      text,
  next_attempt_at timestamptz not null default now(),
  created_at      timestamptz not null default now()
);

create index if not exists storage_cleanup_queue_due_idx
  on storage_cleanup_queue (next_attempt_at, created_at);

create unique index if not exists storage_cleanup_queue_object_url_key
  on storage_cleanup_queue (object_url);

alter table storage_cleanup_queue enable row level security;
alter table storage_cleanup_queue force row level security;
drop policy if exists storage_cleanup_queue_system_staff_all on storage_cleanup_queue;
create policy storage_cleanup_queue_system_staff_all on storage_cleanup_queue
  using (current_setting('app.context', true) in ('system','staff'))
  with check (current_setting('app.context', true) in ('system','staff'));