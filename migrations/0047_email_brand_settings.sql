-- 0047_email_brand_settings.sql
-- Global email brand settings: primary colour, fonts, org identity, director
-- contact. A single row (id = 1 enforced by CHECK) holds the platform-wide
-- values used by every outbound email. Staff-admins edit through the admin UI.

create table if not exists email_brand_settings (
  id                integer primary key
                    constraint email_brand_settings_singleton check (id = 1),
  primary_color     text        not null default 'rgb(6, 54, 93)',
  font_stack        text        not null default '-apple-system, BlinkMacSystemFont, ''Segoe UI'', Roboto, Helvetica, Arial, sans-serif',
  org_name          text        not null default 'The Alliance',
  program_name      text        not null default 'Love in Action',
  signature_name    text        not null default 'The Alliance Love in Action Team',
  director_name     text        not null default 'Christina Moe',
  director_email    text        not null default 'christina@defendingthecause.org',
  director_title    text        not null default 'Love in Action Program Director',
  header_image_url  text,
  updated_at        timestamptz,
  updated_by        uuid        references users(id) on delete set null
);

alter table only email_brand_settings force row level security;
alter table only email_brand_settings enable row level security;

drop policy if exists email_brand_settings_system_staff_all on email_brand_settings;
create policy email_brand_settings_system_staff_all
  on email_brand_settings
  using  (current_setting('app.context', true) = any (array['system', 'staff']))
  with check (current_setting('app.context', true) = any (array['system', 'staff']));

-- Seed the single row with the current hardcoded defaults.
insert into email_brand_settings (id) values (1)
  on conflict (id) do nothing;
