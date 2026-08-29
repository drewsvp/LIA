-- Staff-admin supporter directory: durable, auditable account controls and
-- reversible supporter contexts. Supporter contexts retain the underlying
-- admin authentication session but change application authorization to the
-- target supporter until expiry or explicit exit.

create table supporter_impersonation_contexts (
  id                uuid primary key default gen_random_uuid(),
  admin_user_id     uuid not null references users(id),
  supporter_user_id uuid not null references users(id),
  started_at        timestamptz not null default now(),
  expires_at        timestamptz not null default (now() + interval '1 hour'),
  ended_at          timestamptz,
  end_reason        text
);

create unique index supporter_impersonation_one_active_per_admin
  on supporter_impersonation_contexts (admin_user_id) where ended_at is null;
create index supporter_impersonation_supporter_idx
  on supporter_impersonation_contexts (supporter_user_id, started_at desc);

create table supporter_admin_audit (
  id                uuid primary key default gen_random_uuid(),
  actor_user_id     uuid references users(id) on delete set null,
  target_user_id    uuid references users(id) on delete set null,
  context_id        uuid references supporter_impersonation_contexts(id) on delete set null,
  action            text not null,
  outcome           text not null,
  details           jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now()
);

create index supporter_admin_audit_created_idx
  on supporter_admin_audit (created_at desc);
create index supporter_admin_audit_target_idx
  on supporter_admin_audit (target_user_id, created_at desc);

alter table supporter_impersonation_contexts enable row level security;
alter table supporter_impersonation_contexts force row level security;
create policy supporter_impersonation_contexts_system_staff_all
  on supporter_impersonation_contexts
  using (current_setting('app.context', true) in ('system','staff'))
  with check (current_setting('app.context', true) in ('system','staff'));

alter table supporter_admin_audit enable row level security;
alter table supporter_admin_audit force row level security;
create policy supporter_admin_audit_system_staff_all
  on supporter_admin_audit
  using (current_setting('app.context', true) in ('system','staff'))
  with check (current_setting('app.context', true) in ('system','staff'));