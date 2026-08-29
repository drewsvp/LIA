-- Reversible, staff-admin-only participation corrections.
-- Counters remain derived from active participation rows, but all changes to
-- the protected counter columns happen inside these locked routines.

alter table item_pledges
  add column if not exists status text not null default 'active'
    check (status in ('active', 'cancelled')),
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by uuid references users(id),
  add column if not exists cancellation_reason text;

alter table volunteer_signups
  add column if not exists status text not null default 'active'
    check (status in ('active', 'cancelled')),
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by uuid references users(id),
  add column if not exists cancellation_reason text;

create table if not exists participation_history (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('item_pledge', 'volunteer_signup')),
  entity_id uuid not null,
  action text not null check (action in ('edit', 'cancel', 'reinstate')),
  actor_user_id uuid not null references users(id),
  reason text not null,
  before_state jsonb not null,
  after_state jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists participation_history_entity_idx
  on participation_history (entity_type, entity_id, created_at desc);
create index if not exists participation_history_created_idx
  on participation_history (created_at desc);

create or replace view counter_drift as
  select 'item' as kind, i.id, i.quantity_claimed as stored,
         coalesce(sum(l.quantity) filter (where ip.status = 'active'), 0) as actual
    from items i
    left join item_pledge_lines l on l.item_id = i.id
    left join item_pledges ip on ip.id = l.item_pledge_id
   group by i.id, i.quantity_claimed
  having i.quantity_claimed <> coalesce(sum(l.quantity) filter (where ip.status = 'active'), 0)
  union all
  select 'role', r.id, r.quantity_interested,
         coalesce(count(sr.id) filter (where vs.status = 'active'), 0)
    from volunteer_roles r
    left join volunteer_signup_roles sr on sr.volunteer_role_id = r.id
    left join volunteer_signups vs on vs.id = sr.volunteer_signup_id
   group by r.id, r.quantity_interested
  having r.quantity_interested <> coalesce(count(sr.id) filter (where vs.status = 'active'), 0);

alter table item_pledges enable row level security;
alter table item_pledges force row level security;
drop policy if exists item_pledges_system_staff_all on item_pledges;
create policy item_pledges_system_staff_all on item_pledges
  using (current_setting('app.context', true) in ('system', 'staff'))
  with check (current_setting('app.context', true) in ('system', 'staff'));

alter table volunteer_signups enable row level security;
alter table volunteer_signups force row level security;
drop policy if exists volunteer_signups_system_staff_all on volunteer_signups;
create policy volunteer_signups_system_staff_all on volunteer_signups
  using (current_setting('app.context', true) in ('system', 'staff'))
  with check (current_setting('app.context', true) in ('system', 'staff'));

alter table participation_history enable row level security;
alter table participation_history force row level security;
drop policy if exists participation_history_system_staff_all on participation_history;
create policy participation_history_system_staff_all on participation_history
  using (current_setting('app.context', true) in ('system', 'staff'))
  with check (current_setting('app.context', true) in ('system', 'staff'));

create or replace function manage_item_pledge(
  p_pledge_id uuid,
  p_action text,
  p_lines jsonb,
  p_notes text,
  p_reason text,
  p_actor_user_id uuid,
  p_expected_updated_at timestamptz
) returns jsonb
language plpgsql
as $$
declare
  v_request_id uuid;
  v_old_status text;
  v_new_status text;
  v_old_active boolean;
  v_new_active boolean;
  v_old_updated_at timestamptz;
  v_old_notes text;
  v_new_notes text;
  v_old_lines jsonb;
  v_new_lines jsonb;
  v_line jsonb;
  v_item_id uuid;
  v_qty integer;
  v_old_qty integer;
  v_requested integer;
  v_claimed integer;
  v_delta integer;
  v_before jsonb;
  v_after jsonb;
begin
  if current_setting('app.context', true) <> 'staff' then
    raise exception 'participation_staff_only';
  end if;
  if p_actor_user_id is null or p_reason is null or btrim(p_reason) = '' or length(btrim(p_reason)) > 1000 then
    raise exception 'participation_reason_required';
  end if;
  if p_action not in ('edit', 'cancel', 'reinstate') then
    raise exception 'participation_action_invalid';
  end if;

  select item_request_id into v_request_id
    from item_pledges where id = p_pledge_id;
  if v_request_id is null then raise exception 'participation_not_found'; end if;
  perform 1 from item_requests where id = v_request_id for update;

  select status, updated_at, notes into v_old_status, v_old_updated_at, v_old_notes
    from item_pledges where id = p_pledge_id for update;
  if p_expected_updated_at is not null and v_old_updated_at is distinct from p_expected_updated_at then
    raise exception 'participation_stale';
  end if;
  if p_action = 'cancel' and v_old_status = 'cancelled' then raise exception 'participation_already_cancelled'; end if;
  if p_action = 'reinstate' and v_old_status = 'active' then raise exception 'participation_already_active'; end if;
  if p_action = 'edit' and p_lines is null then raise exception 'participation_lines_required'; end if;
  if p_action = 'edit' and jsonb_typeof(p_lines) <> 'array' then raise exception 'participation_lines_invalid'; end if;
  if p_action = 'edit' and jsonb_array_length(p_lines) = 0 then raise exception 'participation_lines_required'; end if;

  select coalesce(jsonb_agg(jsonb_build_object('itemId', item_id, 'quantity', quantity) order by item_id), '[]'::jsonb)
    into v_old_lines from item_pledge_lines where item_pledge_id = p_pledge_id;
  v_new_status := case when p_action = 'cancel' then 'cancelled' when p_action = 'reinstate' then 'active' else v_old_status end;
  v_new_notes := case when p_action = 'edit' then p_notes else v_old_notes end;
  v_old_active := v_old_status = 'active';
  v_new_active := v_new_status = 'active';
  v_new_lines := case when p_action = 'reinstate' then v_old_lines
                      when p_action = 'cancel' then v_old_lines
                      else p_lines end;

  if jsonb_typeof(v_new_lines) <> 'array' then raise exception 'participation_lines_invalid'; end if;
  if exists (
    select 1 from jsonb_array_elements(v_new_lines) a
    group by a->>'itemId' having count(*) > 1
  ) then raise exception 'participation_duplicate_item'; end if;

  -- Lock every affected child before checking capacity. Request and child
  -- locks are always acquired in this order by all participation routines.
  for v_item_id in
    select id from items
     where item_request_id = v_request_id
       and id in (
         select (a->>'itemId')::uuid from jsonb_array_elements(v_new_lines) a
         union
         select item_id from item_pledge_lines where item_pledge_id = p_pledge_id
       )
     order by id
  loop
    perform 1 from items where id = v_item_id for update;
  end loop;

  for v_line in select * from jsonb_array_elements(v_new_lines) loop
    begin v_item_id := (v_line->>'itemId')::uuid; exception when invalid_text_representation then raise exception 'participation_lines_invalid'; end;
    begin v_qty := (v_line->>'quantity')::integer; exception when invalid_text_representation then raise exception 'participation_quantity_invalid'; end;
    if v_qty is null or v_qty <= 0 then raise exception 'participation_quantity_invalid'; end if;
    select quantity_requested, quantity_claimed into v_requested, v_claimed
      from items where id = v_item_id and item_request_id = v_request_id;
    if v_requested is null then raise exception 'participation_item_not_in_request'; end if;
    select coalesce(sum(quantity), 0) into v_old_qty from item_pledge_lines
      where item_pledge_id = p_pledge_id and item_id = v_item_id;
    v_delta := (case when v_new_active then v_qty else 0 end) - (case when v_old_active then v_old_qty else 0 end);
    if v_delta > 0 and v_claimed + v_delta > v_requested then raise exception 'participation_insufficient_quantity'; end if;
  end loop;
  -- Existing lines omitted from a replacement are released. This also
  -- prevents a malformed replacement from leaving counter drift.
  for v_item_id in select distinct item_id from item_pledge_lines where item_pledge_id = p_pledge_id loop
    if not exists (select 1 from jsonb_array_elements(v_new_lines) a where (a->>'itemId')::uuid = v_item_id) then
      select coalesce(sum(quantity), 0) into v_old_qty from item_pledge_lines
        where item_pledge_id = p_pledge_id and item_id = v_item_id;
      if v_old_active and v_old_qty > 0 then
        perform set_config('app.counter_write', 'on', true);
        update items set quantity_claimed = quantity_claimed - v_old_qty where id = v_item_id;
        perform set_config('app.counter_write', 'off', true);
      end if;
    end if;
  end loop;

  for v_line in select * from jsonb_array_elements(v_new_lines) loop
    v_item_id := (v_line->>'itemId')::uuid; v_qty := (v_line->>'quantity')::integer;
    select coalesce(sum(quantity), 0) into v_old_qty from item_pledge_lines
      where item_pledge_id = p_pledge_id and item_id = v_item_id;
    v_delta := (case when v_new_active then v_qty else 0 end) - (case when v_old_active then v_old_qty else 0 end);
    if v_delta <> 0 then
      perform set_config('app.counter_write', 'on', true);
      update items set quantity_claimed = quantity_claimed + v_delta where id = v_item_id;
      perform set_config('app.counter_write', 'off', true);
    end if;
  end loop;

  delete from item_pledge_lines where item_pledge_id = p_pledge_id;
  insert into item_pledge_lines (item_pledge_id, item_id, quantity)
    select p_pledge_id, (a->>'itemId')::uuid, (a->>'quantity')::integer
      from jsonb_array_elements(v_new_lines) a;
  update item_pledges
     set status = v_new_status, notes = v_new_notes,
         cancelled_at = case when p_action = 'cancel' then now() when p_action = 'reinstate' then null else cancelled_at end,
         cancelled_by = case when p_action = 'cancel' then p_actor_user_id when p_action = 'reinstate' then null else cancelled_by end,
         cancellation_reason = case when p_action = 'cancel' then btrim(p_reason) when p_action = 'reinstate' then null else cancellation_reason end
   where id = p_pledge_id;

  select coalesce(jsonb_agg(jsonb_build_object('itemId', item_id, 'quantity', quantity) order by item_id), '[]'::jsonb)
    into v_new_lines from item_pledge_lines where item_pledge_id = p_pledge_id;
  v_before := jsonb_build_object('status', v_old_status, 'notes', v_old_notes, 'lines', v_old_lines);
  v_after := jsonb_build_object('status', v_new_status, 'notes', v_new_notes, 'lines', v_new_lines);
  insert into participation_history(entity_type, entity_id, action, actor_user_id, reason, before_state, after_state)
    values ('item_pledge', p_pledge_id, p_action, p_actor_user_id, btrim(p_reason), v_before, v_after);
  return jsonb_build_object('id', p_pledge_id, 'status', v_new_status, 'updatedAt', (select updated_at from item_pledges where id = p_pledge_id));
end;
$$;

create or replace function manage_volunteer_signup(
  p_signup_id uuid,
  p_action text,
  p_role_ids uuid[],
  p_notes text,
  p_reason text,
  p_actor_user_id uuid,
  p_expected_updated_at timestamptz
) returns jsonb
language plpgsql
as $$
declare
  v_request_id uuid;
  v_old_status text;
  v_new_status text;
  v_old_active boolean;
  v_new_active boolean;
  v_old_updated_at timestamptz;
  v_old_notes text;
  v_new_notes text;
  v_old_roles jsonb;
  v_new_roles jsonb;
  v_target_roles uuid[];
  v_role_id uuid;
  v_needed integer;
  v_interested integer;
  v_old_has boolean;
  v_new_has boolean;
  v_delta integer;
  v_before jsonb;
  v_after jsonb;
begin
  if current_setting('app.context', true) <> 'staff' then raise exception 'participation_staff_only'; end if;
  if p_actor_user_id is null or p_reason is null or btrim(p_reason) = '' or length(btrim(p_reason)) > 1000 then raise exception 'participation_reason_required'; end if;
  if p_action not in ('edit', 'cancel', 'reinstate') then raise exception 'participation_action_invalid'; end if;
  select volunteer_request_id into v_request_id from volunteer_signups where id = p_signup_id;
  if v_request_id is null then raise exception 'participation_not_found'; end if;
  perform 1 from volunteer_requests where id = v_request_id for update;
  select status, updated_at, notes into v_old_status, v_old_updated_at, v_old_notes from volunteer_signups where id = p_signup_id for update;
  if p_expected_updated_at is not null and v_old_updated_at is distinct from p_expected_updated_at then raise exception 'participation_stale'; end if;
  if p_action = 'cancel' and v_old_status = 'cancelled' then raise exception 'participation_already_cancelled'; end if;
  if p_action = 'reinstate' and v_old_status = 'active' then raise exception 'participation_already_active'; end if;
  if p_action = 'edit' and p_role_ids is null then raise exception 'participation_roles_required'; end if;
  if p_action = 'edit' and cardinality(p_role_ids) = 0 then raise exception 'participation_roles_required'; end if;
  if p_role_ids is not null and exists (select 1 from unnest(p_role_ids) x group by x having count(*) > 1) then raise exception 'participation_duplicate_role'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('roleId', volunteer_role_id) order by volunteer_role_id), '[]'::jsonb)
    into v_old_roles from volunteer_signup_roles where volunteer_signup_id = p_signup_id;
  select coalesce(array_agg(volunteer_role_id order by volunteer_role_id), array[]::uuid[])
    into v_target_roles from volunteer_signup_roles where volunteer_signup_id = p_signup_id;
  if p_action = 'edit' then v_target_roles := p_role_ids; end if;
  v_new_status := case when p_action = 'cancel' then 'cancelled' when p_action = 'reinstate' then 'active' else v_old_status end;
  v_new_notes := case when p_action = 'edit' then p_notes else v_old_notes end;
  v_old_active := v_old_status = 'active'; v_new_active := v_new_status = 'active';
  for v_role_id in
    select id from volunteer_roles where volunteer_request_id = v_request_id
      and id in (select unnest(coalesce(p_role_ids, array[]::uuid[])) union select volunteer_role_id from volunteer_signup_roles where volunteer_signup_id = p_signup_id)
    order by id
  loop perform 1 from volunteer_roles where id = v_role_id for update; end loop;
  for v_role_id in select unnest(v_target_roles) loop
    if not exists (select 1 from volunteer_roles where id = v_role_id and volunteer_request_id = v_request_id) then raise exception 'participation_role_not_in_request'; end if;
    select quantity_needed, quantity_interested into v_needed, v_interested from volunteer_roles where id = v_role_id;
    v_old_has := exists (select 1 from volunteer_signup_roles where volunteer_signup_id = p_signup_id and volunteer_role_id = v_role_id);
    v_new_has := (p_action in ('cancel', 'reinstate') and v_old_has) or (p_action = 'edit' and v_role_id = any(p_role_ids));
    v_delta := (case when v_new_active and v_new_has then 1 else 0 end) - (case when v_old_active and v_old_has then 1 else 0 end);
    if v_delta > 0 and v_interested + v_delta > v_needed then raise exception 'participation_role_full'; end if;
    if v_delta <> 0 then
      perform set_config('app.counter_write', 'on', true);
      update volunteer_roles set quantity_interested = quantity_interested + v_delta where id = v_role_id;
      perform set_config('app.counter_write', 'off', true);
    end if;
  end loop;
  -- Remove old roles that are omitted by an edit.
  if p_action = 'edit' then
    for v_role_id in select volunteer_role_id from volunteer_signup_roles where volunteer_signup_id = p_signup_id and not (volunteer_role_id = any(p_role_ids)) loop
      perform set_config('app.counter_write', 'on', true);
      update volunteer_roles set quantity_interested = quantity_interested - 1 where id = v_role_id;
      perform set_config('app.counter_write', 'off', true);
    end loop;
  end if;
  if p_action in ('cancel', 'reinstate') then
    -- The target roles are the original roles; their counters were adjusted
    -- in the loop above. No replacement is needed, but the rows are retained.
    null;
  end if;
  -- Keep the target list because deleting the join rows would otherwise make
  -- cancellation/reinstatement lose the participation detail.
  v_new_roles := coalesce(v_old_roles, '[]'::jsonb);
  delete from volunteer_signup_roles where volunteer_signup_id = p_signup_id;
  insert into volunteer_signup_roles (volunteer_signup_id, volunteer_role_id)
    select p_signup_id, x from unnest(v_target_roles) x;
  update volunteer_signups set status = v_new_status, notes = v_new_notes,
    cancelled_at = case when p_action = 'cancel' then now() when p_action = 'reinstate' then null else cancelled_at end,
    cancelled_by = case when p_action = 'cancel' then p_actor_user_id when p_action = 'reinstate' then null else cancelled_by end,
    cancellation_reason = case when p_action = 'cancel' then btrim(p_reason) when p_action = 'reinstate' then null else cancellation_reason end
    where id = p_signup_id;
  select coalesce(jsonb_agg(jsonb_build_object('roleId', volunteer_role_id) order by volunteer_role_id), '[]'::jsonb)
    into v_new_roles from volunteer_signup_roles where volunteer_signup_id = p_signup_id;
  v_before := jsonb_build_object('status', v_old_status, 'notes', v_old_notes, 'roles', v_old_roles);
  v_after := jsonb_build_object('status', v_new_status, 'notes', v_new_notes, 'roles', v_new_roles);
  insert into participation_history(entity_type, entity_id, action, actor_user_id, reason, before_state, after_state)
    values ('volunteer_signup', p_signup_id, p_action, p_actor_user_id, btrim(p_reason), v_before, v_after);
  return jsonb_build_object('id', p_signup_id, 'status', v_new_status, 'updatedAt', (select updated_at from volunteer_signups where id = p_signup_id));
end;
$$;