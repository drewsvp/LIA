-- ADMIN-04 is a contact directory, not just a review queue.  Contact audit is
-- person-centric because many useful contacts do not have a login account.
create table contact_admin_audit (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references users(id) on delete set null,
  person_id uuid references people(id) on delete set null,
  action text not null,
  outcome text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index contact_admin_audit_person_created_idx on contact_admin_audit (person_id, created_at desc);

alter table contact_admin_audit enable row level security;
alter table contact_admin_audit force row level security;
create policy contact_admin_audit_system_staff_all on contact_admin_audit
  using (current_setting('app.context', true) in ('system', 'staff'))
  with check (current_setting('app.context', true) in ('system', 'staff'));