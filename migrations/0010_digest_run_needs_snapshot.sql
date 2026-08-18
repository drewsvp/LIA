-- 0010_digest_run_needs_snapshot.sql
-- Review fix (task 58): a resumed digest run must send the SAME content the
-- interrupted run selected. needs_payload is the canonical snapshot of the
-- rendered needs list (DigestNeed[] with absolute URLs), written exactly once
-- right after selection; every resume reads it instead of re-querying, so a
-- need archived mid-fan-out cannot change (or empty out) the digest for the
-- recipients still waiting.
alter table digest_runs add column needs_payload jsonb;

comment on column digest_runs.needs_payload is
  'Canonical DigestNeed[] snapshot for this run; set once after selection, reused verbatim on resume.';
