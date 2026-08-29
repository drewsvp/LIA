-- Audit trail for direct staff-admin organization profile edits.
-- Lifecycle status remains in approval_events; these rows capture profile
-- before/after values and the real staff actor without an org context.
create table if not exists organization_revisions (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations(id),
  actor_user_id    uuid not null references users(id),
  changed_fields   jsonb not null,
  created_at       timestamptz not null default now()
);

create index if not exists organization_revisions_entity_idx
  on organization_revisions (organization_id, created_at desc);