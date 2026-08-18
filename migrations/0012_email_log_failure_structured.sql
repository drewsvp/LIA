-- Task 75: Structured failure diagnostics on email_log.
--
-- failure_category: machine-readable bucket set at failure time by the send
--   pipeline. NULL on rows that pre-date this migration and on non-failed rows.
-- resend_of_id: the original failed row this row was dispatched to recover.
--   Creates a visible chain in the admin UI without touching the original row.

alter table email_log
  add column if not exists failure_category text
    check (failure_category in ('config','render','provider_timeout','provider','sweep')),
  add column if not exists resend_of_id uuid references email_log(id);

create index if not exists email_log_resend_of_idx on email_log (resend_of_id)
  where resend_of_id is not null;
