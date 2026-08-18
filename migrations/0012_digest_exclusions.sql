-- 0012_digest_exclusions.sql
-- Task 77: staff can exclude individual needs from the upcoming Thursday digest.
-- An exclusion is scoped to the digest window (identified by window_start, the
-- watermark at claim time) so it has no effect on future windows once the run
-- completes and the watermark advances.
create table digest_exclusions (
  id             uuid        primary key default gen_random_uuid(),
  need_type      text        not null check (need_type in ('item', 'volunteer')),
  need_id        uuid        not null,
  window_start   timestamptz not null,
  excluded_by    uuid        references users(id),
  excluded_at    timestamptz not null default now(),
  note           text,
  unique (need_type, need_id, window_start)
);

comment on table digest_exclusions is
  'Per-need exclusions for a digest run window; scoped to window_start so they expire naturally once the run completes and the watermark advances.';

alter table digest_exclusions enable row level security;
alter table digest_exclusions force row level security;

drop policy if exists digest_exclusions_system_staff_all on digest_exclusions;
create policy digest_exclusions_system_staff_all on digest_exclusions
  using (current_setting('app.context', true) in ('system','staff'))
  with check (current_setting('app.context', true) in ('system','staff'));
