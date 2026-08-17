-- 0005_email_dispatch_claim.sql
--
-- Task: a queued email must never be silently lost if the process stops
-- mid-send. Adds a 'sending' status used as a dispatch CLAIM: the dispatcher
-- atomically moves queued → sending BEFORE calling the provider, so a row
-- found stranded later tells us which side of the provider call the crash
-- happened on:
--   * stranded 'queued'  → the provider was never called; safe to re-dispatch.
--   * stranded 'sending' → the provider MAY have sent; never auto-retried —
--     marked failed with a loud message instead (no double send).
alter table email_log drop constraint email_log_status_check;
alter table email_log add constraint email_log_status_check
  check (status in ('queued','sending','sent','failed'));

comment on column email_log.status is
  'queued → sending (dispatch claim, set before the provider call) → sent/failed. A row stranded in sending means the process stopped mid-send: the sweep marks it failed rather than risking a double send.';
