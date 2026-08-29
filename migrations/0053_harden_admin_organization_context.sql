alter table admin_organization_contexts
  add column expires_at timestamptz;

update admin_organization_contexts
   set expires_at = started_at + interval '8 hours'
 where expires_at is null;

alter table admin_organization_contexts
  alter column expires_at set default (now() + interval '8 hours'),
  alter column expires_at set not null;

create index admin_organization_contexts_active_expiry
  on admin_organization_contexts (expires_at) where ended_at is null;

create trigger people_capture_organization_context_action
  after insert or update or delete on people
  for each row execute function capture_organization_context_action();

create trigger volunteer_request_categories_capture_organization_context_action
  after insert or update or delete on volunteer_request_categories
  for each row execute function capture_organization_context_action();

create or replace function capture_organization_context_action() returns trigger
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
    nullif(row_json ->> 'org_id', '')::uuid,
    nullif(row_json ->> 'item_request_id', '')::uuid,
    nullif(row_json ->> 'volunteer_request_id', '')::uuid
  );
  insert into organization_context_actions
    (organization_context_id, organization_id, actor_user_id, action, entity_type, entity_id)
  values
    (context_id, organization_id, actor_id, lower(tg_op), tg_table_name, entity_id);
  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;