-- Audit trail for staff content corrections to item and volunteer needs.
-- Written in the same transaction as the edit when the save succeeds.
-- Separate from approval_events, which tracks lifecycle status transitions.
--
-- Each row records who made the correction, when, and a privacy-conscious
-- human-readable summary of what changed (field names only, no contact values).
create table request_revisions (
  id            uuid primary key default gen_random_uuid(),
  entity_type   text not null
                  check (entity_type in ('item_request', 'volunteer_request')),
  entity_id     uuid not null,
  actor_user_id uuid not null references users (id),
  summary       text not null,
  created_at    timestamptz not null default now()
);

create index request_revisions_entity_idx
  on request_revisions (entity_type, entity_id, created_at desc);
