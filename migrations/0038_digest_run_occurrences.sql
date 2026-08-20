-- A calendar date alone cannot distinguish a weekly digest from a separately
-- scheduled one-time digest later that same day. Keep run_date for display and
-- recovery ordering, but claim durable schedule occurrences by their own key.
alter table digest_runs add column occurrence_key text;

-- Every historical run was created by the former weekly-only scheduler.
update digest_runs
   set occurrence_key = 'weekly:' || run_date::text;

alter table digest_runs
  alter column occurrence_key set not null,
  drop constraint digest_runs_run_date_key,
  add constraint digest_runs_occurrence_key_key unique (occurrence_key);

comment on column digest_runs.occurrence_key is
  'Durable schedule occurrence claim: weekly:YYYY-MM-DD, once:<ISO instant>, or date:<YYYY-MM-DD> for direct verification passes.';