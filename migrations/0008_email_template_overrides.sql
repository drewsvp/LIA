-- 0008_email_template_overrides.sql
-- Staff-admin editing of the automated emails (ADMIN-10).
--
-- 1. email_template_overrides: per-template overrides for the editable parts
--    of a product email — subject/heading/paragraph copy, the enabled flag,
--    and (for the staff-notification templates only) the recipient list. The
--    hardcoded TypeScript template remains the fallback when no override
--    exists. Copy override is all-or-nothing: subject, heading, and
--    paragraphs are set together (enforced at the API) so a partial override
--    can never mix old and new copy silently.
--
-- 2. email_log gains a 'skipped' status: a send suppressed because staff
--    disabled the template writes a visible "skipped (disabled)" row instead
--    of silently dropping. Skipped rows do NOT consume the once-only index,
--    so re-enabling the template lets the email go out later.

create table email_template_overrides (
  template_key text primary key,
  -- Copy override (all three set together, or all three null = default copy).
  subject      text,
  heading      text,
  paragraphs   jsonb,
  -- Comma-separated recipient override; only honored for templates whose
  -- recipients are genuinely configurable (the staff notification address).
  recipients   text,
  enabled      boolean not null default true,
  updated_at   timestamptz not null default now(),
  constraint email_template_overrides_copy_all_or_nothing check (
    (subject is null and heading is null and paragraphs is null)
    or (subject is not null and heading is not null and paragraphs is not null)
  ),
  constraint email_template_overrides_paragraphs_array check (
    paragraphs is null or jsonb_typeof(paragraphs) = 'array'
  )
);

alter table email_log drop constraint email_log_status_check;
alter table email_log add constraint email_log_status_check
  check (status in ('queued','sending','sent','failed','skipped'));

comment on column email_log.status is
  'queued -> sending (dispatch claim) -> sent | failed. skipped = template disabled by staff; never dispatched.';

-- Skipped rows must not consume the once-only slot: after re-enabling, the
-- same entity/recipient may legitimately receive the email.
drop index email_log_once_idx;
create unique index email_log_once_idx
  on email_log (template_key, entity_type, entity_id, lower(to_email))
  where entity_id is not null and status not in ('failed','skipped');

-- RLS (mirrored in server/db/rls-policies.sql): staff/system only. Members
-- and the public never read or write email configuration.
alter table email_template_overrides enable row level security;
alter table email_template_overrides force row level security;

drop policy if exists email_template_overrides_system_staff_all on email_template_overrides;
create policy email_template_overrides_system_staff_all on email_template_overrides
  using (current_setting('app.context', true) in ('system','staff'))
  with check (current_setting('app.context', true) in ('system','staff'));
