-- 0049_site_settings.sql
-- Site-wide settings: the three pieces of copy that appear across many
-- surfaces but cannot currently be changed without a code deploy.
-- A single row (id = 1 enforced by CHECK) holds the platform-wide values.
-- Staff-admins edit through /admin/settings (ADMIN-13).

create table if not exists site_settings (
  id                    integer primary key
                        constraint site_settings_singleton check (id = 1),
  site_name             text not null default 'Love in Action Database',
  contact_email         text not null default 'info@defendingthecause.org',
  response_time_language text not null default '1-3 business days',
  updated_at            timestamptz,
  updated_by            uuid references users(id) on delete set null
);

alter table only site_settings force row level security;
alter table only site_settings enable row level security;

drop policy if exists site_settings_system_staff_all on site_settings;
create policy site_settings_system_staff_all
  on site_settings
  using  (current_setting('app.context', true) = any (array['system', 'staff']))
  with check (current_setting('app.context', true) = any (array['system', 'staff']));

-- Seed the single row with the current hardcoded defaults.
insert into site_settings (id) values (1)
  on conflict (id) do nothing;
