-- Project participation corrections into the existing staff activity trail
-- while retaining the richer immutable before/after participation history.

alter table approval_events drop constraint approval_events_entity_type_check;
alter table approval_events add constraint approval_events_entity_type_check
  check (entity_type in (
    'organization', 'organization_context', 'org_membership',
    'item_request', 'volunteer_request', 'person',
    'item_pledge', 'volunteer_signup'
  ));

create or replace function project_participation_history_to_activity()
returns trigger
language plpgsql
as $$
begin
  insert into approval_events (
    entity_type, entity_id, from_status, to_status, actor_user_id, note
  ) values (
    new.entity_type,
    new.entity_id,
    new.before_state->>'status',
    case when new.action = 'edit' then 'edited' else new.after_state->>'status' end,
    new.actor_user_id,
    new.action || ': ' || new.reason
  );
  return new;
end;
$$;

drop trigger if exists participation_history_activity_trigger on participation_history;
create trigger participation_history_activity_trigger
  after insert on participation_history
  for each row execute function project_participation_history_to_activity();