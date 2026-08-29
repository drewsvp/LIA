-- Monotonic API versions, append-only history, cancelled-signup edit repair,
-- and reopening of requests archived automatically because they were full.

alter table item_pledges add column if not exists participation_version bigint not null default 1;
alter table volunteer_signups add column if not exists participation_version bigint not null default 1;

create or replace function increment_participation_version()
returns trigger
language plpgsql
as $$
begin
  new.participation_version := old.participation_version + 1;
  return new;
end;
$$;

drop trigger if exists zy_item_pledge_participation_version on item_pledges;
create trigger zy_item_pledge_participation_version
  before update on item_pledges
  for each row execute function increment_participation_version();
drop trigger if exists zy_volunteer_signup_participation_version on volunteer_signups;
create trigger zy_volunteer_signup_participation_version
  before update on volunteer_signups
  for each row execute function increment_participation_version();

create or replace function protect_participation_history()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'participation_history_is_append_only';
  end if;
  if old.entity_type = 'item_pledge' and exists (select 1 from item_pledges where id = old.entity_id) then
    raise exception 'participation_history_is_append_only';
  end if;
  if old.entity_type = 'volunteer_signup' and exists (select 1 from volunteer_signups where id = old.entity_id) then
    raise exception 'participation_history_is_append_only';
  end if;
  return old;
end;
$$;

drop trigger if exists protect_participation_history_trigger on participation_history;
create trigger protect_participation_history_trigger
  before update or delete on participation_history
  for each row execute function protect_participation_history();

drop policy if exists participation_history_system_staff_all on participation_history;
create policy participation_history_system_staff_select on participation_history
  for select using (current_setting('app.context', true) in ('system', 'staff'));
create policy participation_history_system_staff_insert on participation_history
  for insert with check (current_setting('app.context', true) in ('system', 'staff'));

-- Repair the already-installed routine without duplicating its full body in a
-- follow-up migration. The original numbered migration contains the corrected
-- body for fresh databases; this transforms databases that already applied it.
do $$
declare
  v_oid oid;
  v_definition text;
  v_old text := $needle$
      perform set_config('app.counter_write', 'on', true);
      update volunteer_roles set quantity_interested = quantity_interested - 1 where id = v_role_id;
      perform set_config('app.counter_write', 'off', true);
$needle$;
  v_new text := $replacement$
      if v_old_active then
        perform set_config('app.counter_write', 'on', true);
        update volunteer_roles set quantity_interested = quantity_interested - 1 where id = v_role_id;
        perform set_config('app.counter_write', 'off', true);
      end if;
$replacement$;
begin
  select 'manage_volunteer_signup(uuid,text,uuid[],text,text,uuid,timestamptz)'::regprocedure::oid into v_oid;
  select pg_get_functiondef(v_oid) into v_definition;
  if position(v_new in v_definition) = 0 then
    if position(v_old in v_definition) = 0 then
      raise exception 'manage_volunteer_signup repair target not found';
    end if;
    execute replace(v_definition, v_old, v_new);
  end if;
end;
$$;

create or replace function reopen_fulfilled_item_request_after_pledge_cancel()
returns trigger
language plpgsql
as $$
declare
  v_actor uuid;
begin
  if old.status = 'active' and new.status = 'cancelled' then
    update item_requests
       set status = 'active', archived_at = null, archived_reason = null
     where id = new.item_request_id
       and status = 'archived'
       and archived_reason = 'fulfilled';
    if found then
      v_actor := new.cancelled_by;
      insert into approval_events(entity_type, entity_id, from_status, to_status, actor_user_id, note)
        values ('item_request', new.item_request_id, 'archived', 'active', v_actor, 'participation cancelled; capacity reopened');
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists reopen_fulfilled_item_request_trigger on item_pledges;
create trigger reopen_fulfilled_item_request_trigger
  after update of status on item_pledges
  for each row execute function reopen_fulfilled_item_request_after_pledge_cancel();