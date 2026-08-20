-- Supporters explicitly opt in to alerts when newly-approved volunteer needs
-- match their saved interests. Missing preference rows mean "off", preserving
-- opt-in consent for every existing and future supporter.
create table volunteer_alert_preferences (
  user_id uuid primary key references users(id) on delete cascade,
  enabled boolean not null default false,
  unsubscribe_token uuid not null default gen_random_uuid() unique,
  enabled_at timestamptz,
  disabled_at timestamptz,
  updated_at timestamptz not null default now()
);

create trigger volunteer_alert_preferences_set_updated_at
  before update on volunteer_alert_preferences
  for each row execute function set_updated_at();

comment on table volunteer_alert_preferences is
  'Explicit per-supporter consent for immediate matching-volunteer email alerts. No row is equivalent to enabled=false.';
comment on column volunteer_alert_preferences.unsubscribe_token is
  'Opaque one-way capability used only to disable future matching alerts.';

-- A claim is created before the product email row is queued. It remains even
-- if rendering, provider delivery, or a disabled template produces a failed or
-- skipped email-log row, so request reapproval/retry cannot fan out a second
-- alert. Resending an explicitly failed row is a separate staff action.
create table volunteer_match_alert_claims (
  volunteer_request_id uuid not null references volunteer_requests(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  to_email text not null check (btrim(to_email) <> ''),
  claimed_at timestamptz not null default now(),
  primary key (volunteer_request_id, user_id)
);

create unique index volunteer_match_alert_claims_email_once_idx
  on volunteer_match_alert_claims (volunteer_request_id, lower(btrim(to_email)));

comment on table volunteer_match_alert_claims is
  'Durable once-only claim for approval-triggered matching alerts, independent of retryable email_log status.';