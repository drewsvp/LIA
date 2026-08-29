-- Reconcile generated request availability after every managed pledge update,
-- not only cancellation. Manual and expired archives are never reopened.

create or replace function reopen_fulfilled_item_request_after_pledge_cancel()
returns trigger
language plpgsql
as $$
declare
  v_actor uuid;
  v_status text;
  v_archived_reason text;
  v_has_remaining boolean;
begin
  select status, archived_reason into v_status, v_archived_reason
    from item_requests
   where id = new.item_request_id
   for update;
  select exists (
    select 1 from items
     where item_request_id = new.item_request_id
       and quantity_remaining > 0
  ) into v_has_remaining;
  v_actor := nullif(current_setting('app.user_id', true), '')::uuid;

  if v_status = 'archived' and v_archived_reason = 'fulfilled' and v_has_remaining then
    update item_requests
       set status = 'active', archived_at = null, archived_reason = null
     where id = new.item_request_id;
    insert into approval_events(entity_type, entity_id, from_status, to_status, actor_user_id, note)
      values ('item_request', new.item_request_id, 'archived', 'active', v_actor, 'participation changed; capacity reopened');
  elsif v_status = 'active' and not v_has_remaining then
    update item_requests
       set status = 'archived', archived_at = now(), archived_reason = 'fulfilled'
     where id = new.item_request_id;
    insert into approval_events(entity_type, entity_id, from_status, to_status, actor_user_id, note)
      values ('item_request', new.item_request_id, 'active', 'archived', v_actor, 'fulfilled');
  end if;
  return new;
end;
$$;

drop trigger if exists reopen_fulfilled_item_request_trigger on item_pledges;
create trigger reopen_fulfilled_item_request_trigger
  after update on item_pledges
  for each row execute function reopen_fulfilled_item_request_after_pledge_cancel();