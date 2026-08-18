-- 0013_digest_exclusions_simpler_key.sql
-- Task 77: change digest_exclusions unique key from (need_type, need_id, window_start)
-- to just (need_type, need_id) so there is at most one active exclusion per need
-- at any time, and filtering uses excluded_at > run.window_start instead of an
-- exact timestamp match. This avoids drift when the fallback window_start is
-- now()-7d (which changes millisecond to millisecond between calls when no
-- prior completed digest run exists).
alter table digest_exclusions
  drop constraint if exists digest_exclusions_need_type_need_id_window_start_key;

alter table digest_exclusions
  add constraint digest_exclusions_need_type_need_id_key unique (need_type, need_id);
