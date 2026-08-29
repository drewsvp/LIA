create table admin_organization_contexts (
  id              uuid primary key default gen_random_uuid(),
  admin_user_id   uuid not null references users(id),
  organization_id uuid not null references organizations(id),
  started_at      timestamptz not null default now(),
  ended_at        timestamptz
);

create unique index admin_organization_contexts_one_active_per_admin
  on admin_organization_contexts (admin_user_id) where ended_at is null;
create index admin_organization_contexts_org_started
  on admin_organization_contexts (organization_id, started_at desc);

create table organization_context_actions (
  id                      uuid primary key default gen_random_uuid(),
  organization_context_id uuid not null references admin_organization_contexts(id),
  organization_id         uuid not null references organizations(id),
  actor_user_id           uuid not null references users(id),
  action                  text not null,
  entity_type             text,
  entity_id               uuid,
  created_at              timestamptz not null default now()
);

create index organization_context_actions_created
  on organization_context_actions (created_at desc);
create index organization_context_actions_context
  on organization_context_actions (organization_context_id, created_at desc);

alter table approval_events
  add column organization_context_id uuid references admin_organization_contexts(id),
  add column context_organization_id uuid references organizations(id);

alter table approval_events drop constraint approval_events_entity_type_check;
alter table approval_events add constraint approval_events_entity_type_check
  check (entity_type in ('organization','organization_context','org_membership',
                         'item_request','volunteer_request','person'));

alter table request_revisions
  add column organization_context_id uuid references admin_organization_contexts(id),
  add column context_organization_id uuid references organizations(id);

create function capture_organization_context_attribution() returns trigger
language plpgsql as $$
begin
  if nullif(current_setting('app.organization_context_id', true), '') is not null then
    new.organization_context_id :=
      nullif(current_setting('app.organization_context_id', true), '')::uuid;
    new.context_organization_id :=
      nullif(current_setting('app.organization_id', true), '')::uuid;
  end if;
  return new;
end;
$$;

create trigger approval_events_capture_organization_context
  before insert on approval_events
  for each row execute function capture_organization_context_attribution();

create trigger request_revisions_capture_organization_context
  before insert on request_revisions
  for each row execute function capture_organization_context_attribution();

create function capture_organization_context_action() returns trigger
language plpgsql as $$
declare
  context_id uuid;
  organization_id uuid;
  actor_id uuid;
  row_json jsonb;
  entity_id uuid;
begin
  context_id := nullif(current_setting('app.organization_context_id', true), '')::uuid;
  if context_id is null then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;
  organization_id := nullif(current_setting('app.organization_id', true), '')::uuid;
  actor_id := nullif(current_setting('app.actor_user_id', true), '')::uuid;
  row_json := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  entity_id := coalesce(
    nullif(row_json ->> 'id', '')::uuid,
    nullif(row_json ->> 'org_id', '')::uuid
  );
  insert into organization_context_actions
    (organization_context_id, organization_id, actor_user_id, action, entity_type, entity_id)
  values
    (context_id, organization_id, actor_id, lower(tg_op), tg_table_name, entity_id);
  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;

create trigger organizations_capture_organization_context_action
  after insert or update or delete on organizations
  for each row execute function capture_organization_context_action();
create trigger org_memberships_capture_organization_context_action
  after insert or update or delete on org_memberships
  for each row execute function capture_organization_context_action();
create trigger item_requests_capture_organization_context_action
  after insert or update or delete on item_requests
  for each row execute function capture_organization_context_action();
create trigger items_capture_organization_context_action
  after insert or update or delete on items
  for each row execute function capture_organization_context_action();
create trigger volunteer_requests_capture_organization_context_action
  after insert or update or delete on volunteer_requests
  for each row execute function capture_organization_context_action();
create trigger volunteer_roles_capture_organization_context_action
  after insert or update or delete on volunteer_roles
  for each row execute function capture_organization_context_action();
create trigger organization_populations_capture_organization_context_action
  after insert or update or delete on organization_populations
  for each row execute function capture_organization_context_action();