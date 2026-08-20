-- Reusable schedule settings for automated emails. Only templates explicitly
-- opted into the scheduling registry use these rows; event-triggered emails
-- remain unschedulable.
create table email_schedules (
  template_key    text primary key,
  active          boolean not null default true,
  weekly_weekday  smallint not null check (weekly_weekday between 0 and 6),
  weekly_minutes  smallint not null check (weekly_minutes between 0 and 1439),
  one_time_at     timestamptz,
  updated_at      timestamptz not null default now(),
  updated_by      uuid references users(id)
);

-- Preserve the pre-schedule behavior: Thursday (4 in PostgreSQL/JS Sunday=0)
-- at 9:00 AM in America/Los_Angeles.
insert into email_schedules (template_key, active, weekly_weekday, weekly_minutes)
values ('digest_new_needs', true, 4, 540)
on conflict (template_key) do nothing;

alter table email_schedules enable row level security;
alter table email_schedules force row level security;

drop policy if exists email_schedules_system_staff_all on email_schedules;
create policy email_schedules_system_staff_all on email_schedules
  using (current_setting('app.context', true) in ('system','staff'))
  with check (current_setting('app.context', true) in ('system','staff'));