--
-- PostgreSQL database dump
--

\restrict GNBVqP7cppzR6h25gHRRsDbHQIvuZY2I209zuSlbwtIOErp93h0lAnNvMOo7rSK

-- Dumped from database version 16.15 (b357239)
-- Dumped by pg_dump version 16.10

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: _system; Type: SCHEMA; Schema: -; Owner: neondb_owner
--

CREATE SCHEMA _system;


ALTER SCHEMA _system OWNER TO neondb_owner;

--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;


--
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';


--
-- Name: capture_organization_context_action(); Type: FUNCTION; Schema: public; Owner: neondb_owner
--

CREATE FUNCTION public.capture_organization_context_action() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
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


ALTER FUNCTION public.capture_organization_context_action() OWNER TO neondb_owner;

--
-- Name: capture_organization_context_attribution(); Type: FUNCTION; Schema: public; Owner: neondb_owner
--

CREATE FUNCTION public.capture_organization_context_attribution() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
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


ALTER FUNCTION public.capture_organization_context_attribution() OWNER TO neondb_owner;

--
-- Name: guard_counter_columns(); Type: FUNCTION; Schema: public; Owner: neondb_owner
--

CREATE FUNCTION public.guard_counter_columns() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  if current_setting('app.counter_write', true) = 'on' then
    return new;
  end if;

  if tg_table_name = 'items' then
    if new.quantity_claimed is distinct from old.quantity_claimed then
      raise exception
        'items.quantity_claimed is written only by record_item_pledge()';
    end if;
  elsif tg_table_name = 'volunteer_roles' then
    if new.quantity_interested is distinct from old.quantity_interested then
      raise exception
        'volunteer_roles.quantity_interested is written only by record_volunteer_signup()';
    end if;
  end if;

  return new;
end;
$$;


ALTER FUNCTION public.guard_counter_columns() OWNER TO neondb_owner;

--
-- Name: guard_member_request_transitions(); Type: FUNCTION; Schema: public; Owner: neondb_owner
--

CREATE FUNCTION public.guard_member_request_transitions() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  if current_setting('app.context', true) is distinct from 'member' then
    return new;
  end if;

  if new.org_id is distinct from old.org_id then
    raise exception 'member_cannot_move_request_between_orgs';
  end if;

  if new.approved_at is distinct from old.approved_at
     or new.approved_by is distinct from old.approved_by then
    raise exception 'member_cannot_set_approval_fields';
  end if;

  if new.status is distinct from old.status then
    if (old.status, new.status) not in
         (('draft','pending'), ('pending','draft'), ('active','archived')) then
      raise exception 'member_status_transition_not_allowed: % -> %',
        old.status, new.status;
    end if;

    if old.status = 'draft' then
      new.submitted_at := coalesce(new.submitted_at, now());
    end if;

    if new.status = 'archived' then
      new.archived_at     := coalesce(new.archived_at, now());
      new.archived_reason := 'manual';
    end if;

    -- Every status transition writes an event, including this one.
    insert into approval_events
      (entity_type, entity_id, from_status, to_status, actor_user_id)
    values
      (tg_argv[0], new.id, old.status, new.status,
       nullif(current_setting('app.user_id', true), '')::uuid);
  end if;

  return new;
end;
$$;


ALTER FUNCTION public.guard_member_request_transitions() OWNER TO neondb_owner;

--
-- Name: increment_participation_version(); Type: FUNCTION; Schema: public; Owner: neondb_owner
--

CREATE FUNCTION public.increment_participation_version() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  new.participation_version := old.participation_version + 1;
  return new;
end;
$$;


ALTER FUNCTION public.increment_participation_version() OWNER TO neondb_owner;

--
-- Name: item_request_current_la_date(); Type: FUNCTION; Schema: public; Owner: neondb_owner
--

CREATE FUNCTION public.item_request_current_la_date() RETURNS date
    LANGUAGE sql
    AS $$
  select (clock_timestamp() at time zone 'America/Los_Angeles')::date;
$$;


ALTER FUNCTION public.item_request_current_la_date() OWNER TO neondb_owner;

--
-- Name: item_request_expired_on(text, date, date, date); Type: FUNCTION; Schema: public; Owner: neondb_owner
--

CREATE FUNCTION public.item_request_expired_on(p_deadline_type text, p_deadline_date date, p_expires_on date, p_today date) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    AS $$
  select
    (p_expires_on is not null and p_expires_on < p_today)
    or (
      p_deadline_type = 'date_specific'
      and p_deadline_date is not null
      and p_deadline_date < p_today
    );
$$;


ALTER FUNCTION public.item_request_expired_on(p_deadline_type text, p_deadline_date date, p_expires_on date, p_today date) OWNER TO neondb_owner;

--
-- Name: manage_item_pledge(uuid, text, jsonb, text, text, uuid, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: neondb_owner
--

CREATE FUNCTION public.manage_item_pledge(p_pledge_id uuid, p_action text, p_lines jsonb, p_notes text, p_reason text, p_actor_user_id uuid, p_expected_updated_at timestamp with time zone) RETURNS jsonb
    LANGUAGE plpgsql
    AS $$
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


ALTER FUNCTION public.manage_item_pledge(p_pledge_id uuid, p_action text, p_lines jsonb, p_notes text, p_reason text, p_actor_user_id uuid, p_expected_updated_at timestamp with time zone) OWNER TO neondb_owner;

--
-- Name: manage_volunteer_signup(uuid, text, uuid[], text, text, uuid, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: neondb_owner
--

CREATE FUNCTION public.manage_volunteer_signup(p_signup_id uuid, p_action text, p_role_ids uuid[], p_notes text, p_reason text, p_actor_user_id uuid, p_expected_updated_at timestamp with time zone) RETURNS jsonb
    LANGUAGE plpgsql
    AS $$
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
      if v_old_active then
        perform set_config('app.counter_write', 'on', true);
        update volunteer_roles set quantity_interested = quantity_interested - 1 where id = v_role_id;
        perform set_config('app.counter_write', 'off', true);
      end if;
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


ALTER FUNCTION public.manage_volunteer_signup(p_signup_id uuid, p_action text, p_role_ids uuid[], p_notes text, p_reason text, p_actor_user_id uuid, p_expected_updated_at timestamp with time zone) OWNER TO neondb_owner;

--
-- Name: merge_people(uuid, uuid); Type: FUNCTION; Schema: public; Owner: neondb_owner
--

CREATE FUNCTION public.merge_people(p_duplicate uuid, p_survivor uuid) RETURNS jsonb
    LANGUAGE plpgsql
    AS $$
declare
  n_pledges int;
  n_signups int;
  n_users int;
  n_digest int;
  n_org_contacts int;
  n_email int;
  n_item_req_contacts int;
  n_vol_req_contacts int;
  n_volunteer_interests int;
  v_actor uuid;
  v_note text;
begin
  if p_duplicate is null or p_survivor is null then
    raise exception 'merge_people: both ids are required';
  end if;
  if p_duplicate = p_survivor then
    raise exception 'merge_people: duplicate and survivor are the same row';
  end if;

  perform 1 from people where id = least(p_duplicate, p_survivor) for update;
  if not found then
    raise exception 'merge_people: person % not found', least(p_duplicate, p_survivor);
  end if;
  perform 1 from people where id = greatest(p_duplicate, p_survivor) for update;
  if not found then
    raise exception 'merge_people: person % not found', greatest(p_duplicate, p_survivor);
  end if;

  if exists (select 1 from users where person_id = p_duplicate)
     and exists (select 1 from users where person_id = p_survivor) then
    raise exception 'merge_people: both records have login accounts';
  end if;

  if exists (
    select 1
      from users u
      join people duplicate_person on duplicate_person.id = u.person_id
      join people survivor_person on survivor_person.id = p_survivor
     where u.person_id = p_duplicate
       and lower(btrim(duplicate_person.email)) is distinct from lower(btrim(survivor_person.email))
  ) then
    raise exception 'merge_people: login account email would change';
  end if;

  select format('Merged %s %s <%s> (%s) into %s.',
                first_name, last_name, email, id, p_survivor)
    into v_note
    from people where id = p_duplicate;

  v_actor := nullif(current_setting('app.user_id', true), '')::uuid;

  update item_pledges set person_id = p_survivor where person_id = p_duplicate;
  get diagnostics n_pledges = row_count;
  update volunteer_signups set person_id = p_survivor where person_id = p_duplicate;
  get diagnostics n_signups = row_count;
  update users set person_id = p_survivor where person_id = p_duplicate;
  get diagnostics n_users = row_count;
  update digest_subscribers set person_id = p_survivor where person_id = p_duplicate;
  get diagnostics n_digest = row_count;
  update organizations set primary_contact_person_id = p_survivor
   where primary_contact_person_id = p_duplicate;
  get diagnostics n_org_contacts = row_count;
  update email_log set to_person_id = p_survivor where to_person_id = p_duplicate;
  get diagnostics n_email = row_count;
  update item_requests set contact_person_id = p_survivor where contact_person_id = p_duplicate;
  get diagnostics n_item_req_contacts = row_count;
  update volunteer_requests set contact_person_id = p_survivor where contact_person_id = p_duplicate;
  get diagnostics n_vol_req_contacts = row_count;

  select count(*)::int into n_volunteer_interests
    from person_volunteer_interests where person_id = p_duplicate;
  insert into person_volunteer_interests (person_id, category_id)
  select p_survivor, category_id from person_volunteer_interests
   where person_id = p_duplicate on conflict do nothing;
  delete from person_volunteer_interests where person_id = p_duplicate;

  insert into approval_events
    (entity_type, entity_id, from_status, to_status, actor_user_id, note)
  values
    ('person', p_duplicate, 'duplicate', 'merged', v_actor, v_note);

  delete from people where id = p_duplicate;

  return jsonb_build_object(
    'pledges', n_pledges,
    'signups', n_signups,
    'users', n_users,
    'digestSubscribers', n_digest,
    'orgPrimaryContacts', n_org_contacts,
    'emailLogEntries', n_email,
    'itemRequestContacts', n_item_req_contacts,
    'volunteerRequestContacts', n_vol_req_contacts,
    'volunteerInterests', n_volunteer_interests);
end;
$$;


ALTER FUNCTION public.merge_people(p_duplicate uuid, p_survivor uuid) OWNER TO neondb_owner;

--
-- Name: project_participation_history_to_activity(); Type: FUNCTION; Schema: public; Owner: neondb_owner
--

CREATE FUNCTION public.project_participation_history_to_activity() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
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


ALTER FUNCTION public.project_participation_history_to_activity() OWNER TO neondb_owner;

--
-- Name: protect_account_email_identity(); Type: FUNCTION; Schema: public; Owner: neondb_owner
--

CREATE FUNCTION public.protect_account_email_identity() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  new.email := lower(btrim(new.email));
  if new.email = '' then
    raise exception 'people_email_empty';
  end if;

  if tg_op = 'UPDATE'
     and lower(btrim(old.email)) is distinct from new.email
     and exists (select 1 from users where person_id = old.id)
     and not (
       coalesce(current_setting('app.account_email_change_person_id', true), '') = old.id::text
       and coalesce(current_setting('app.account_email_change_email', true), '') = new.email
     ) then
    raise exception 'account_email_immutable'
      using hint = 'A linked login account must retain its email identity.';
  end if;

  return new;
end;
$$;


ALTER FUNCTION public.protect_account_email_identity() OWNER TO neondb_owner;

--
-- Name: protect_participation_history(); Type: FUNCTION; Schema: public; Owner: neondb_owner
--

CREATE FUNCTION public.protect_participation_history() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
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


ALTER FUNCTION public.protect_participation_history() OWNER TO neondb_owner;

--
-- Name: record_item_pledge(text, text, text, text, uuid, text, jsonb); Type: FUNCTION; Schema: public; Owner: neondb_owner
--

CREATE FUNCTION public.record_item_pledge(p_first_name text, p_last_name text, p_email text, p_phone text, p_request_id uuid, p_notes text, p_lines jsonb) RETURNS uuid
    LANGUAGE plpgsql
    AS $$
declare
  v_person_id         uuid;
  v_pledge_id         uuid;
  v_line              jsonb;
  v_item_id           uuid;
  v_qty               integer;
  v_remaining         integer;
  v_status            text;
  v_phone_digits      text;
  v_phone_match_count integer;
  v_match_list        text;
  v_needs_review      boolean := false;
  v_review_note       text;
  v_prior_context     text;
begin
  -- This function is called from the public pledge flow, where app.context is
  -- 'public' and people has no public policy. Run the body as system and put
  -- the caller's context back before returning, so the escalation is bounded
  -- by this function rather than by the surrounding transaction.
  v_prior_context := coalesce(current_setting('app.context', true), '');
  perform set_config('app.context', 'system', true);

  select status into v_status from item_requests where id = p_request_id for update;
  if v_status is null then
    raise exception 'request_not_found';
  end if;
  if v_status is distinct from 'active' then
    raise exception 'request_not_active';
  end if;

  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'no_lines';
  end if;

  select id into v_person_id from people where lower(email) = lower(p_email);
  if v_person_id is null then
    v_phone_digits := regexp_replace(coalesce(nullif(trim(p_phone), ''), ''), '[^0-9]', '', 'g');
    if v_phone_digits <> '' then
      select count(*),
             string_agg(
               format('%s %s <%s> (%s)', first_name, last_name, email, id),
               '; ' order by created_at asc, id asc
             )
        into v_phone_match_count, v_match_list
        from people
       where regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g') = v_phone_digits;

      if v_phone_match_count > 0 then
        v_needs_review := true;
        if v_phone_match_count = 1 then
          v_review_note := format(
            'Suspected duplicate: submitted phone matches existing person %s.',
            v_match_list
          );
        else
          v_review_note := format(
            'Suspected duplicate: submitted phone matches %s existing people: %s.',
            v_phone_match_count, v_match_list
          );
        end if;
      end if;
    end if;

    insert into people (first_name, last_name, email, phone, needs_review, review_note)
    values (p_first_name, p_last_name, p_email, p_phone, v_needs_review, v_review_note)
    returning id into v_person_id;
  else
    update people
       set first_name = p_first_name,
           last_name  = p_last_name,
           phone      = coalesce(nullif(p_phone, ''), phone)
     where id = v_person_id;
  end if;

  insert into item_pledges (person_id, item_request_id, notes)
  values (v_person_id, p_request_id, p_notes)
  returning id into v_pledge_id;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_item_id := (v_line->>'item_id')::uuid;
    v_qty     := (v_line->>'quantity')::integer;

    if v_qty is null or v_qty <= 0 then
      raise exception 'invalid_quantity';
    end if;

    select quantity_remaining into v_remaining
      from items
     where id = v_item_id and item_request_id = p_request_id
     for update;

    if v_remaining is null then
      raise exception 'item_not_in_request';
    end if;
    if v_qty > v_remaining then
      raise exception 'insufficient_quantity';
    end if;

    insert into item_pledge_lines (item_pledge_id, item_id, quantity)
    values (v_pledge_id, v_item_id, v_qty);

    perform set_config('app.counter_write', 'on', true);
    update items
       set quantity_claimed = quantity_claimed + v_qty
     where id = v_item_id;
    perform set_config('app.counter_write', 'off', true);
  end loop;

  if not exists (
    select 1 from items
     where item_request_id = p_request_id and quantity_remaining > 0
  ) then
    update item_requests
       set status = 'archived',
           archived_at = now(),
           archived_reason = 'fulfilled'
     where id = p_request_id;

    insert into approval_events (entity_type, entity_id, from_status, to_status, note)
    values ('item_request', p_request_id, 'active', 'archived', 'fulfilled');
  end if;

  perform set_config('app.context', v_prior_context, true);
  return v_pledge_id;
end;
$$;


ALTER FUNCTION public.record_item_pledge(p_first_name text, p_last_name text, p_email text, p_phone text, p_request_id uuid, p_notes text, p_lines jsonb) OWNER TO neondb_owner;

--
-- Name: record_volunteer_signup(text, text, text, text, uuid, text, uuid[]); Type: FUNCTION; Schema: public; Owner: neondb_owner
--

CREATE FUNCTION public.record_volunteer_signup(p_first_name text, p_last_name text, p_email text, p_phone text, p_request_id uuid, p_notes text, p_role_ids uuid[]) RETURNS uuid
    LANGUAGE plpgsql
    AS $$
declare
  v_person_id         uuid;
  v_signup_id         uuid;
  v_role_id           uuid;
  v_remaining         integer;
  v_status            text;
  v_expires_on        date;
  v_phone_digits      text;
  v_phone_match_count integer;
  v_match_list        text;
  v_needs_review      boolean := false;
  v_review_note       text;
  v_prior_context     text;
begin
  -- See the note in record_item_pledge(). Same reason, same bounded escalation.
  v_prior_context := coalesce(current_setting('app.context', true), '');
  perform set_config('app.context', 'system', true);

  select status, expires_on
    into v_status, v_expires_on
    from volunteer_requests
   where id = p_request_id
   for update;

  if v_status is null then
    raise exception 'request_not_found';
  end if;
  if v_status is distinct from 'active' then
    raise exception 'request_not_active';
  end if;
  -- Re-check expiry under the lock. The nightly job can lag; the route
  -- pre-gate already filters, but a race between the gate read and this
  -- write could still let an expired request through without this guard.
  if v_expires_on is not null
     and v_expires_on < (now() at time zone 'America/Los_Angeles')::date then
    raise exception 'request_not_active';
  end if;

  if p_role_ids is null or array_length(p_role_ids, 1) is null then
    raise exception 'no_roles';
  end if;

  select id into v_person_id from people where lower(email) = lower(p_email);
  if v_person_id is null then
    v_phone_digits := regexp_replace(coalesce(nullif(trim(p_phone), ''), ''), '[^0-9]', '', 'g');
    if v_phone_digits <> '' then
      select count(*),
             string_agg(
               format('%s %s <%s> (%s)', first_name, last_name, email, id),
               '; ' order by created_at asc, id asc
             )
        into v_phone_match_count, v_match_list
        from people
       where regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g') = v_phone_digits;

      if v_phone_match_count > 0 then
        v_needs_review := true;
        if v_phone_match_count = 1 then
          v_review_note := format(
            'Suspected duplicate: submitted phone matches existing person %s.',
            v_match_list
          );
        else
          v_review_note := format(
            'Suspected duplicate: submitted phone matches %s existing people: %s.',
            v_phone_match_count, v_match_list
          );
        end if;
      end if;
    end if;

    insert into people (first_name, last_name, email, phone, needs_review, review_note)
    values (p_first_name, p_last_name, p_email, p_phone, v_needs_review, v_review_note)
    returning id into v_person_id;
  else
    update people
       set first_name = p_first_name,
           last_name  = p_last_name,
           phone      = coalesce(nullif(p_phone, ''), phone)
     where id = v_person_id;
  end if;

  insert into volunteer_signups (person_id, volunteer_request_id, notes)
  values (v_person_id, p_request_id, p_notes)
  returning id into v_signup_id;

  foreach v_role_id in array p_role_ids loop
    select quantity_remaining into v_remaining
      from volunteer_roles
     where id = v_role_id and volunteer_request_id = p_request_id
     for update;

    if v_remaining is null then
      raise exception 'role_not_in_request';
    end if;
    if v_remaining < 1 then
      raise exception 'role_full';
    end if;

    insert into volunteer_signup_roles (volunteer_signup_id, volunteer_role_id)
    values (v_signup_id, v_role_id);

    perform set_config('app.counter_write', 'on', true);
    update volunteer_roles
       set quantity_interested = quantity_interested + 1
     where id = v_role_id;
    perform set_config('app.counter_write', 'off', true);
  end loop;

  perform set_config('app.context', v_prior_context, true);
  return v_signup_id;
end;
$$;


ALTER FUNCTION public.record_volunteer_signup(p_first_name text, p_last_name text, p_email text, p_phone text, p_request_id uuid, p_notes text, p_role_ids uuid[]) OWNER TO neondb_owner;

--
-- Name: reject_expired_item_pledge(); Type: FUNCTION; Schema: public; Owner: neondb_owner
--

CREATE FUNCTION public.reject_expired_item_pledge() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  if exists (
    select 1
      from item_requests r
     where r.id = new.item_request_id
       and item_request_expired_on(
         r.deadline_type,
         r.deadline_date,
         r.expires_on,
         item_request_current_la_date()
       )
  ) then
    raise exception 'request_not_active';
  end if;
  return new;
end;
$$;


ALTER FUNCTION public.reject_expired_item_pledge() OWNER TO neondb_owner;

--
-- Name: reject_ineligible_item_pledge(); Type: FUNCTION; Schema: public; Owner: neondb_owner
--

CREATE FUNCTION public.reject_ineligible_item_pledge() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  perform 1
    from item_requests r
    join organizations o on o.id = r.org_id
   where r.id = new.item_request_id
     and o.status = 'approved'
     and o.kind in ('member_org', 'platform_owner')
   for share of o;

  if not found then
    raise exception 'request_not_found';
  end if;

  return new;
end;
$$;


ALTER FUNCTION public.reject_ineligible_item_pledge() OWNER TO neondb_owner;

--
-- Name: reopen_fulfilled_item_request_after_pledge_cancel(); Type: FUNCTION; Schema: public; Owner: neondb_owner
--

CREATE FUNCTION public.reopen_fulfilled_item_request_after_pledge_cancel() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
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


ALTER FUNCTION public.reopen_fulfilled_item_request_after_pledge_cancel() OWNER TO neondb_owner;

--
-- Name: revoke_admin_organization_contexts_for_ineligible_org(); Type: FUNCTION; Schema: public; Owner: neondb_owner
--

CREATE FUNCTION public.revoke_admin_organization_contexts_for_ineligible_org() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
declare
  context_row record;
begin
  if old.kind = 'member_org'
     and old.status = 'approved'
     and (new.kind <> 'member_org' or new.status <> 'approved') then
    for context_row in
      update admin_organization_contexts
         set ended_at = now()
       where organization_id = new.id
         and ended_at is null
      returning id, admin_user_id, organization_id
    loop
      insert into organization_context_actions
        (organization_context_id, organization_id, actor_user_id, action)
      values
        (context_row.id, context_row.organization_id, context_row.admin_user_id, 'invalidated');

      insert into approval_events
        (entity_type, entity_id, from_status, to_status, actor_user_id,
         note, organization_context_id, context_organization_id)
      values
        ('organization_context', context_row.id, 'active', 'invalidated',
         context_row.admin_user_id, 'Organization became ineligible',
         context_row.id, context_row.organization_id);
    end loop;
  end if;
  return new;
end;
$$;


ALTER FUNCTION public.revoke_admin_organization_contexts_for_ineligible_org() OWNER TO neondb_owner;

--
-- Name: round_participation_updated_at(); Type: FUNCTION; Schema: public; Owner: neondb_owner
--

CREATE FUNCTION public.round_participation_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  new.updated_at := date_trunc('milliseconds', new.updated_at);
  return new;
end;
$$;


ALTER FUNCTION public.round_participation_updated_at() OWNER TO neondb_owner;

--
-- Name: set_updated_at(); Type: FUNCTION; Schema: public; Owner: neondb_owner
--

CREATE FUNCTION public.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION public.set_updated_at() OWNER TO neondb_owner;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: replit_database_migrations_v1; Type: TABLE; Schema: _system; Owner: neondb_owner
--

CREATE TABLE _system.replit_database_migrations_v1 (
    id bigint NOT NULL,
    build_id text NOT NULL,
    deployment_id text NOT NULL,
    statement_count bigint NOT NULL,
    applied_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE _system.replit_database_migrations_v1 OWNER TO neondb_owner;

--
-- Name: replit_database_migrations_v1_id_seq; Type: SEQUENCE; Schema: _system; Owner: neondb_owner
--

CREATE SEQUENCE _system.replit_database_migrations_v1_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE _system.replit_database_migrations_v1_id_seq OWNER TO neondb_owner;

--
-- Name: replit_database_migrations_v1_id_seq; Type: SEQUENCE OWNED BY; Schema: _system; Owner: neondb_owner
--

ALTER SEQUENCE _system.replit_database_migrations_v1_id_seq OWNED BY _system.replit_database_migrations_v1.id;


--
-- Name: account; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.account (
    id text NOT NULL,
    "accountId" text NOT NULL,
    "providerId" text NOT NULL,
    "userId" text NOT NULL,
    "accessToken" text,
    "refreshToken" text,
    "idToken" text,
    "accessTokenExpiresAt" timestamp without time zone,
    "refreshTokenExpiresAt" timestamp without time zone,
    scope text,
    password text,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp without time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.account OWNER TO neondb_owner;

--
-- Name: admin_organization_contexts; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.admin_organization_contexts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    admin_user_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    ended_at timestamp with time zone,
    expires_at timestamp with time zone DEFAULT (now() + '08:00:00'::interval) NOT NULL
);

ALTER TABLE ONLY public.admin_organization_contexts FORCE ROW LEVEL SECURITY;


ALTER TABLE public.admin_organization_contexts OWNER TO neondb_owner;

--
-- Name: approval_events; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.approval_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    entity_type text NOT NULL,
    entity_id uuid NOT NULL,
    from_status text,
    to_status text NOT NULL,
    actor_user_id uuid,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    organization_context_id uuid,
    context_organization_id uuid,
    CONSTRAINT approval_events_entity_type_check CHECK ((entity_type = ANY (ARRAY['organization'::text, 'organization_context'::text, 'org_membership'::text, 'item_request'::text, 'volunteer_request'::text, 'person'::text, 'item_pledge'::text, 'volunteer_signup'::text])))
);

ALTER TABLE ONLY public.approval_events FORCE ROW LEVEL SECURITY;


ALTER TABLE public.approval_events OWNER TO neondb_owner;

--
-- Name: contact_admin_audit; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.contact_admin_audit (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    actor_user_id uuid,
    person_id uuid,
    action text NOT NULL,
    outcome text NOT NULL,
    details jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.contact_admin_audit FORCE ROW LEVEL SECURITY;


ALTER TABLE public.contact_admin_audit OWNER TO neondb_owner;

--
-- Name: item_pledge_lines; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.item_pledge_lines (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    item_pledge_id uuid NOT NULL,
    item_id uuid NOT NULL,
    quantity integer NOT NULL,
    CONSTRAINT item_pledge_lines_quantity_check CHECK ((quantity > 0))
);

ALTER TABLE ONLY public.item_pledge_lines FORCE ROW LEVEL SECURITY;


ALTER TABLE public.item_pledge_lines OWNER TO neondb_owner;

--
-- Name: item_pledges; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.item_pledges (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    legacy_wix_id text,
    person_id uuid NOT NULL,
    item_request_id uuid NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    cancelled_at timestamp with time zone,
    cancelled_by uuid,
    cancellation_reason text,
    participation_version bigint DEFAULT 1 NOT NULL,
    CONSTRAINT item_pledges_status_check CHECK ((status = ANY (ARRAY['active'::text, 'cancelled'::text])))
);

ALTER TABLE ONLY public.item_pledges FORCE ROW LEVEL SECURITY;


ALTER TABLE public.item_pledges OWNER TO neondb_owner;

--
-- Name: items; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    legacy_wix_id text,
    item_request_id uuid NOT NULL,
    name text NOT NULL,
    description text,
    condition text,
    product_url text,
    quantity_requested integer NOT NULL,
    quantity_claimed integer DEFAULT 0 NOT NULL,
    quantity_received integer DEFAULT 0 NOT NULL,
    quantity_remaining integer GENERATED ALWAYS AS (GREATEST((quantity_requested - quantity_claimed), 0)) STORED,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT items_condition_check CHECK ((condition = ANY (ARRAY['new'::text, 'gently_used'::text, 'any'::text]))),
    CONSTRAINT items_quantity_claimed_check CHECK ((quantity_claimed >= 0)),
    CONSTRAINT items_quantity_received_check CHECK ((quantity_received >= 0)),
    CONSTRAINT items_quantity_requested_check CHECK ((quantity_requested > 0))
);

ALTER TABLE ONLY public.items FORCE ROW LEVEL SECURITY;


ALTER TABLE public.items OWNER TO neondb_owner;

--
-- Name: volunteer_roles; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.volunteer_roles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    legacy_wix_id text,
    volunteer_request_id uuid NOT NULL,
    name text NOT NULL,
    description text,
    quantity_needed integer NOT NULL,
    quantity_interested integer DEFAULT 0 NOT NULL,
    quantity_confirmed integer DEFAULT 0 NOT NULL,
    quantity_remaining integer GENERATED ALWAYS AS (GREATEST((quantity_needed - quantity_interested), 0)) STORED,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT volunteer_roles_quantity_confirmed_check CHECK ((quantity_confirmed >= 0)),
    CONSTRAINT volunteer_roles_quantity_interested_check CHECK ((quantity_interested >= 0)),
    CONSTRAINT volunteer_roles_quantity_needed_check CHECK ((quantity_needed > 0))
);

ALTER TABLE ONLY public.volunteer_roles FORCE ROW LEVEL SECURITY;


ALTER TABLE public.volunteer_roles OWNER TO neondb_owner;

--
-- Name: volunteer_signup_roles; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.volunteer_signup_roles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    volunteer_signup_id uuid NOT NULL,
    volunteer_role_id uuid NOT NULL
);

ALTER TABLE ONLY public.volunteer_signup_roles FORCE ROW LEVEL SECURITY;


ALTER TABLE public.volunteer_signup_roles OWNER TO neondb_owner;

--
-- Name: volunteer_signups; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.volunteer_signups (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    legacy_wix_id text,
    person_id uuid NOT NULL,
    volunteer_request_id uuid NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    cancelled_at timestamp with time zone,
    cancelled_by uuid,
    cancellation_reason text,
    participation_version bigint DEFAULT 1 NOT NULL,
    CONSTRAINT volunteer_signups_status_check CHECK ((status = ANY (ARRAY['active'::text, 'cancelled'::text])))
);

ALTER TABLE ONLY public.volunteer_signups FORCE ROW LEVEL SECURITY;


ALTER TABLE public.volunteer_signups OWNER TO neondb_owner;

--
-- Name: counter_drift; Type: VIEW; Schema: public; Owner: neondb_owner
--

CREATE VIEW public.counter_drift AS
 SELECT 'item'::text AS kind,
    i.id,
    i.quantity_claimed AS stored,
    COALESCE(sum(l.quantity) FILTER (WHERE (ip.status = 'active'::text)), (0)::bigint) AS actual
   FROM ((public.items i
     LEFT JOIN public.item_pledge_lines l ON ((l.item_id = i.id)))
     LEFT JOIN public.item_pledges ip ON ((ip.id = l.item_pledge_id)))
  GROUP BY i.id, i.quantity_claimed
 HAVING (i.quantity_claimed <> COALESCE(sum(l.quantity) FILTER (WHERE (ip.status = 'active'::text)), (0)::bigint))
UNION ALL
 SELECT 'role'::text AS kind,
    r.id,
    r.quantity_interested AS stored,
    COALESCE(count(sr.id) FILTER (WHERE (vs.status = 'active'::text)), (0)::bigint) AS actual
   FROM ((public.volunteer_roles r
     LEFT JOIN public.volunteer_signup_roles sr ON ((sr.volunteer_role_id = r.id)))
     LEFT JOIN public.volunteer_signups vs ON ((vs.id = sr.volunteer_signup_id)))
  GROUP BY r.id, r.quantity_interested
 HAVING (r.quantity_interested <> COALESCE(count(sr.id) FILTER (WHERE (vs.status = 'active'::text)), (0)::bigint));


ALTER VIEW public.counter_drift OWNER TO neondb_owner;

--
-- Name: digest_exclusions; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.digest_exclusions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    need_type text NOT NULL,
    need_id uuid NOT NULL,
    window_start timestamp with time zone NOT NULL,
    excluded_by uuid,
    excluded_at timestamp with time zone DEFAULT now() NOT NULL,
    note text,
    CONSTRAINT digest_exclusions_need_type_check CHECK ((need_type = ANY (ARRAY['item'::text, 'volunteer'::text])))
);

ALTER TABLE ONLY public.digest_exclusions FORCE ROW LEVEL SECURITY;


ALTER TABLE public.digest_exclusions OWNER TO neondb_owner;

--
-- Name: TABLE digest_exclusions; Type: COMMENT; Schema: public; Owner: neondb_owner
--

COMMENT ON TABLE public.digest_exclusions IS 'Per-need exclusions for a digest run window; scoped to window_start so they expire naturally once the run completes and the watermark advances.';


--
-- Name: digest_runs; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.digest_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    run_date date NOT NULL,
    window_start timestamp with time zone NOT NULL,
    window_end timestamp with time zone NOT NULL,
    status text DEFAULT 'running'::text NOT NULL,
    needs_count integer,
    recipients_count integer,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    needs_payload jsonb,
    occurrence_key text NOT NULL,
    CONSTRAINT digest_runs_status_check CHECK ((status = ANY (ARRAY['running'::text, 'sent'::text, 'skipped_empty'::text])))
);

ALTER TABLE ONLY public.digest_runs FORCE ROW LEVEL SECURITY;


ALTER TABLE public.digest_runs OWNER TO neondb_owner;

--
-- Name: COLUMN digest_runs.needs_payload; Type: COMMENT; Schema: public; Owner: neondb_owner
--

COMMENT ON COLUMN public.digest_runs.needs_payload IS 'Canonical DigestNeed[] snapshot for this run; set once after selection, reused verbatim on resume.';


--
-- Name: COLUMN digest_runs.occurrence_key; Type: COMMENT; Schema: public; Owner: neondb_owner
--

COMMENT ON COLUMN public.digest_runs.occurrence_key IS 'Durable schedule occurrence claim: weekly:YYYY-MM-DD, once:<ISO instant>, or date:<YYYY-MM-DD> for direct verification passes.';


--
-- Name: digest_subscribers; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.digest_subscribers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    person_id uuid,
    email text NOT NULL,
    status text DEFAULT 'subscribed'::text NOT NULL,
    unsubscribe_token uuid DEFAULT gen_random_uuid() NOT NULL,
    subscribed_at timestamp with time zone DEFAULT now() NOT NULL,
    unsubscribed_at timestamp with time zone,
    legacy_source text,
    first_name text,
    last_name text,
    CONSTRAINT digest_subscribers_status_check CHECK ((status = ANY (ARRAY['subscribed'::text, 'unsubscribed'::text, 'bounced'::text])))
);

ALTER TABLE ONLY public.digest_subscribers FORCE ROW LEVEL SECURITY;


ALTER TABLE public.digest_subscribers OWNER TO neondb_owner;

--
-- Name: COLUMN digest_subscribers.first_name; Type: COMMENT; Schema: public; Owner: neondb_owner
--

COMMENT ON COLUMN public.digest_subscribers.first_name IS 'PB-05 form value, stored exactly as entered. Null on rows created before 0004 or imported without a name.';


--
-- Name: COLUMN digest_subscribers.last_name; Type: COMMENT; Schema: public; Owner: neondb_owner
--

COMMENT ON COLUMN public.digest_subscribers.last_name IS 'PB-05 form value, stored exactly as entered. Null on rows created before 0004 or imported without a name.';


--
-- Name: email_brand_settings; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.email_brand_settings (
    id integer NOT NULL,
    primary_color text DEFAULT 'rgb(6, 54, 93)'::text NOT NULL,
    font_stack text DEFAULT '-apple-system, BlinkMacSystemFont, ''Segoe UI'', Roboto, Helvetica, Arial, sans-serif'::text NOT NULL,
    org_name text DEFAULT 'The Alliance'::text NOT NULL,
    program_name text DEFAULT 'Love in Action'::text NOT NULL,
    signature_name text DEFAULT 'The Alliance Love in Action Team'::text NOT NULL,
    director_name text DEFAULT 'Christina Moe'::text NOT NULL,
    director_email text DEFAULT 'christina@defendingthecause.org'::text NOT NULL,
    director_title text DEFAULT 'Love in Action Program Director'::text NOT NULL,
    header_image_url text,
    updated_at timestamp with time zone,
    updated_by uuid,
    CONSTRAINT email_brand_settings_singleton CHECK ((id = 1))
);

ALTER TABLE ONLY public.email_brand_settings FORCE ROW LEVEL SECURITY;


ALTER TABLE public.email_brand_settings OWNER TO neondb_owner;

--
-- Name: email_log; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.email_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    template_key text NOT NULL,
    to_email text NOT NULL,
    to_person_id uuid,
    entity_type text,
    entity_id uuid,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text DEFAULT 'queued'::text NOT NULL,
    provider_message_id text,
    error text,
    sent_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    failure_category text,
    resend_of_id uuid,
    CONSTRAINT email_log_failure_category_check CHECK ((failure_category = ANY (ARRAY['config'::text, 'render'::text, 'provider_timeout'::text, 'provider'::text, 'sweep'::text]))),
    CONSTRAINT email_log_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'sending'::text, 'sent'::text, 'failed'::text, 'skipped'::text])))
);

ALTER TABLE ONLY public.email_log FORCE ROW LEVEL SECURITY;


ALTER TABLE public.email_log OWNER TO neondb_owner;

--
-- Name: COLUMN email_log.status; Type: COMMENT; Schema: public; Owner: neondb_owner
--

COMMENT ON COLUMN public.email_log.status IS 'queued -> sending (dispatch claim) -> sent | failed. skipped = template disabled by staff; never dispatched.';


--
-- Name: email_schedules; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.email_schedules (
    template_key text NOT NULL,
    active boolean DEFAULT true NOT NULL,
    weekly_weekday smallint NOT NULL,
    weekly_minutes smallint NOT NULL,
    one_time_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by uuid,
    CONSTRAINT email_schedules_weekly_minutes_check CHECK (((weekly_minutes >= 0) AND (weekly_minutes <= 1439))),
    CONSTRAINT email_schedules_weekly_weekday_check CHECK (((weekly_weekday >= 0) AND (weekly_weekday <= 6)))
);

ALTER TABLE ONLY public.email_schedules FORCE ROW LEVEL SECURITY;


ALTER TABLE public.email_schedules OWNER TO neondb_owner;

--
-- Name: email_template_overrides; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.email_template_overrides (
    template_key text NOT NULL,
    subject text,
    heading text,
    paragraphs jsonb,
    recipients text,
    enabled boolean DEFAULT true NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by uuid,
    body_blocks jsonb,
    CONSTRAINT email_template_overrides_body_blocks_array CHECK (((body_blocks IS NULL) OR (jsonb_typeof(body_blocks) = 'array'::text))),
    CONSTRAINT email_template_overrides_copy_all_or_nothing CHECK ((((subject IS NULL) AND (heading IS NULL) AND (paragraphs IS NULL)) OR ((subject IS NOT NULL) AND (heading IS NOT NULL) AND (paragraphs IS NOT NULL)))),
    CONSTRAINT email_template_overrides_paragraphs_array CHECK (((paragraphs IS NULL) OR (jsonb_typeof(paragraphs) = 'array'::text)))
);

ALTER TABLE ONLY public.email_template_overrides FORCE ROW LEVEL SECURITY;


ALTER TABLE public.email_template_overrides OWNER TO neondb_owner;

--
-- Name: item_requests; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.item_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    legacy_wix_id text,
    org_id uuid NOT NULL,
    title text NOT NULL,
    description text,
    image_url text,
    dropoff_location text,
    people_helped integer,
    deadline_type text DEFAULT 'until_fulfilled'::text NOT NULL,
    deadline_date date,
    expires_on date,
    contact_person_id uuid,
    status text DEFAULT 'draft'::text NOT NULL,
    submitted_at timestamp with time zone,
    approved_at timestamp with time zone,
    approved_by uuid,
    archived_at timestamp with time zone,
    archived_reason text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    image_generated boolean DEFAULT false NOT NULL,
    image_gen_status text,
    image_gen_error text,
    image_gen_retries integer DEFAULT 0 NOT NULL,
    CONSTRAINT item_requests_archived_reason_check CHECK ((archived_reason = ANY (ARRAY['manual'::text, 'expired'::text, 'fulfilled'::text]))),
    CONSTRAINT item_requests_deadline_date_required CHECK (((deadline_type <> 'date_specific'::text) OR (deadline_date IS NOT NULL))),
    CONSTRAINT item_requests_deadline_type_check CHECK ((deadline_type = ANY (ARRAY['date_specific'::text, 'until_fulfilled'::text, 'ongoing'::text]))),
    CONSTRAINT item_requests_image_gen_status_check CHECK ((image_gen_status = ANY (ARRAY['pending'::text, 'succeeded'::text, 'failed'::text]))),
    CONSTRAINT item_requests_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'pending'::text, 'active'::text, 'archived'::text])))
);

ALTER TABLE ONLY public.item_requests FORCE ROW LEVEL SECURITY;


ALTER TABLE public.item_requests OWNER TO neondb_owner;

--
-- Name: org_memberships; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.org_memberships (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role text DEFAULT 'member'::text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    invited_by uuid,
    approved_at timestamp with time zone,
    approved_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT org_memberships_role_check CHECK ((role = ANY (ARRAY['owner'::text, 'member'::text, 'staff_admin'::text, 'staff_approver'::text]))),
    CONSTRAINT org_memberships_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'active'::text, 'removed'::text])))
);

ALTER TABLE ONLY public.org_memberships FORCE ROW LEVEL SECURITY;


ALTER TABLE public.org_memberships OWNER TO neondb_owner;

--
-- Name: organization_context_actions; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.organization_context_actions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_context_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    actor_user_id uuid NOT NULL,
    action text NOT NULL,
    entity_type text,
    entity_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.organization_context_actions FORCE ROW LEVEL SECURITY;


ALTER TABLE public.organization_context_actions OWNER TO neondb_owner;

--
-- Name: organization_populations; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.organization_populations (
    org_id uuid NOT NULL,
    population_id uuid NOT NULL
);

ALTER TABLE ONLY public.organization_populations FORCE ROW LEVEL SECURITY;


ALTER TABLE public.organization_populations OWNER TO neondb_owner;

--
-- Name: organization_revisions; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.organization_revisions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    actor_user_id uuid NOT NULL,
    changed_fields jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.organization_revisions FORCE ROW LEVEL SECURITY;


ALTER TABLE public.organization_revisions OWNER TO neondb_owner;

--
-- Name: organizations; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.organizations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    legacy_wix_id text,
    kind text DEFAULT 'member_org'::text NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    website_url text,
    mission text,
    phone text,
    logo_url text,
    populations_other text,
    address_line1 text,
    address_line2 text,
    city text,
    state text,
    postal_code text,
    address_formatted text,
    primary_contact_person_id uuid,
    status text DEFAULT 'pending'::text NOT NULL,
    approved_at timestamp with time zone,
    approved_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT organizations_kind_check CHECK ((kind = ANY (ARRAY['member_org'::text, 'platform_owner'::text]))),
    CONSTRAINT organizations_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'disabled'::text])))
);

ALTER TABLE ONLY public.organizations FORCE ROW LEVEL SECURITY;


ALTER TABLE public.organizations OWNER TO neondb_owner;

--
-- Name: participation_history; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.participation_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    entity_type text NOT NULL,
    entity_id uuid NOT NULL,
    action text NOT NULL,
    actor_user_id uuid NOT NULL,
    reason text NOT NULL,
    before_state jsonb NOT NULL,
    after_state jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT participation_history_action_check CHECK ((action = ANY (ARRAY['edit'::text, 'cancel'::text, 'reinstate'::text]))),
    CONSTRAINT participation_history_entity_type_check CHECK ((entity_type = ANY (ARRAY['item_pledge'::text, 'volunteer_signup'::text])))
);

ALTER TABLE ONLY public.participation_history FORCE ROW LEVEL SECURITY;


ALTER TABLE public.participation_history OWNER TO neondb_owner;

--
-- Name: people; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.people (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    first_name text NOT NULL,
    last_name text NOT NULL,
    email text NOT NULL,
    phone text,
    needs_review boolean DEFAULT false NOT NULL,
    review_note text,
    source_note text,
    legacy_wix_contact_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.people FORCE ROW LEVEL SECURITY;


ALTER TABLE public.people OWNER TO neondb_owner;

--
-- Name: person_volunteer_interests; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.person_volunteer_interests (
    person_id uuid NOT NULL,
    category_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.person_volunteer_interests FORCE ROW LEVEL SECURITY;


ALTER TABLE public.person_volunteer_interests OWNER TO neondb_owner;

--
-- Name: populations; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.populations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL
);

ALTER TABLE ONLY public.populations FORCE ROW LEVEL SECURITY;


ALTER TABLE public.populations OWNER TO neondb_owner;

--
-- Name: request_engagement_events; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.request_engagement_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    client_event_id uuid NOT NULL,
    event_type text NOT NULL,
    request_kind text NOT NULL,
    item_request_id uuid,
    volunteer_request_id uuid,
    item_id uuid,
    volunteer_role_id uuid,
    user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT request_engagement_child_target CHECK ((((event_type = ANY (ARRAY['product_link_click'::text, 'item_selected'::text])) AND (request_kind = 'item'::text) AND (item_id IS NOT NULL) AND (volunteer_role_id IS NULL)) OR ((event_type = 'role_selected'::text) AND (request_kind = 'volunteer'::text) AND (volunteer_role_id IS NOT NULL) AND (item_id IS NULL)) OR ((event_type = ANY (ARRAY['card_click'::text, 'detail_view'::text, 'form_start'::text])) AND (item_id IS NULL) AND (volunteer_role_id IS NULL)))),
    CONSTRAINT request_engagement_events_event_type_check CHECK ((event_type = ANY (ARRAY['card_click'::text, 'detail_view'::text, 'product_link_click'::text, 'form_start'::text, 'item_selected'::text, 'role_selected'::text]))),
    CONSTRAINT request_engagement_events_request_kind_check CHECK ((request_kind = ANY (ARRAY['item'::text, 'volunteer'::text]))),
    CONSTRAINT request_engagement_request_target CHECK ((((request_kind = 'item'::text) AND (item_request_id IS NOT NULL) AND (volunteer_request_id IS NULL)) OR ((request_kind = 'volunteer'::text) AND (volunteer_request_id IS NOT NULL) AND (item_request_id IS NULL))))
);

ALTER TABLE ONLY public.request_engagement_events FORCE ROW LEVEL SECURITY;


ALTER TABLE public.request_engagement_events OWNER TO neondb_owner;

--
-- Name: TABLE request_engagement_events; Type: COMMENT; Schema: public; Owner: neondb_owner
--

COMMENT ON TABLE public.request_engagement_events IS 'Allowlisted public request interactions. Anonymous rows have no persistent visitor identity; pledges/signups remain authoritative conversions.';


--
-- Name: COLUMN request_engagement_events.client_event_id; Type: COMMENT; Schema: public; Owner: neondb_owner
--

COMMENT ON COLUMN public.request_engagement_events.client_event_id IS 'Fresh UUID for one client interaction, used only to make duplicate delivery idempotent.';


--
-- Name: request_revisions; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.request_revisions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    entity_type text NOT NULL,
    entity_id uuid NOT NULL,
    actor_user_id uuid NOT NULL,
    summary text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    organization_context_id uuid,
    context_organization_id uuid,
    CONSTRAINT request_revisions_entity_type_check CHECK ((entity_type = ANY (ARRAY['item_request'::text, 'volunteer_request'::text])))
);

ALTER TABLE ONLY public.request_revisions FORCE ROW LEVEL SECURITY;


ALTER TABLE public.request_revisions OWNER TO neondb_owner;

--
-- Name: schema_migrations; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.schema_migrations (
    filename text NOT NULL,
    sha256 text NOT NULL,
    applied_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.schema_migrations OWNER TO neondb_owner;

--
-- Name: session; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.session (
    id text NOT NULL,
    "expiresAt" timestamp without time zone NOT NULL,
    token text NOT NULL,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp without time zone DEFAULT now() NOT NULL,
    "ipAddress" text,
    "userAgent" text,
    "userId" text NOT NULL
);


ALTER TABLE public.session OWNER TO neondb_owner;

--
-- Name: site_settings; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.site_settings (
    id integer NOT NULL,
    site_name text DEFAULT 'Love in Action Database'::text NOT NULL,
    contact_email text DEFAULT 'info@defendingthecause.org'::text NOT NULL,
    response_time_language text DEFAULT '1-3 business days'::text NOT NULL,
    updated_at timestamp with time zone,
    updated_by uuid,
    image_generation_enabled boolean DEFAULT false NOT NULL,
    CONSTRAINT site_settings_singleton CHECK ((id = 1))
);

ALTER TABLE ONLY public.site_settings FORCE ROW LEVEL SECURITY;


ALTER TABLE public.site_settings OWNER TO neondb_owner;

--
-- Name: storage_cleanup_queue; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.storage_cleanup_queue (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    object_url text NOT NULL,
    reason text NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    last_error text,
    next_attempt_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT storage_cleanup_queue_attempts_check CHECK ((attempts >= 0))
);

ALTER TABLE ONLY public.storage_cleanup_queue FORCE ROW LEVEL SECURITY;


ALTER TABLE public.storage_cleanup_queue OWNER TO neondb_owner;

--
-- Name: supporter_admin_audit; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.supporter_admin_audit (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    actor_user_id uuid,
    target_user_id uuid,
    context_id uuid,
    action text NOT NULL,
    outcome text NOT NULL,
    details jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.supporter_admin_audit FORCE ROW LEVEL SECURITY;


ALTER TABLE public.supporter_admin_audit OWNER TO neondb_owner;

--
-- Name: supporter_impersonation_contexts; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.supporter_impersonation_contexts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    admin_user_id uuid NOT NULL,
    supporter_user_id uuid NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone DEFAULT (now() + '01:00:00'::interval) NOT NULL,
    ended_at timestamp with time zone,
    end_reason text
);

ALTER TABLE ONLY public.supporter_impersonation_contexts FORCE ROW LEVEL SECURITY;


ALTER TABLE public.supporter_impersonation_contexts OWNER TO neondb_owner;

--
-- Name: user; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public."user" (
    id text NOT NULL,
    name text NOT NULL,
    email text NOT NULL,
    "emailVerified" boolean DEFAULT false NOT NULL,
    image text,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp without time zone DEFAULT now() NOT NULL
);


ALTER TABLE public."user" OWNER TO neondb_owner;

--
-- Name: users; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    person_id uuid NOT NULL,
    auth_subject text,
    status text DEFAULT 'invited'::text NOT NULL,
    last_login_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    kind text DEFAULT 'member'::text NOT NULL,
    CONSTRAINT users_kind_check CHECK ((kind = ANY (ARRAY['member'::text, 'supporter'::text]))),
    CONSTRAINT users_status_check CHECK ((status = ANY (ARRAY['invited'::text, 'active'::text, 'disabled'::text])))
);

ALTER TABLE ONLY public.users FORCE ROW LEVEL SECURITY;


ALTER TABLE public.users OWNER TO neondb_owner;

--
-- Name: verification; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.verification (
    id text NOT NULL,
    identifier text NOT NULL,
    value text NOT NULL,
    "expiresAt" timestamp without time zone NOT NULL,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp without time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.verification OWNER TO neondb_owner;

--
-- Name: volunteer_alert_preferences; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.volunteer_alert_preferences (
    user_id uuid NOT NULL,
    enabled boolean DEFAULT false NOT NULL,
    unsubscribe_token uuid DEFAULT gen_random_uuid() NOT NULL,
    enabled_at timestamp with time zone,
    disabled_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.volunteer_alert_preferences FORCE ROW LEVEL SECURITY;


ALTER TABLE public.volunteer_alert_preferences OWNER TO neondb_owner;

--
-- Name: TABLE volunteer_alert_preferences; Type: COMMENT; Schema: public; Owner: neondb_owner
--

COMMENT ON TABLE public.volunteer_alert_preferences IS 'Explicit per-supporter consent for immediate matching-volunteer email alerts. No row is equivalent to enabled=false.';


--
-- Name: COLUMN volunteer_alert_preferences.unsubscribe_token; Type: COMMENT; Schema: public; Owner: neondb_owner
--

COMMENT ON COLUMN public.volunteer_alert_preferences.unsubscribe_token IS 'Opaque one-way capability used only to disable future matching alerts.';


--
-- Name: volunteer_categories; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.volunteer_categories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    CONSTRAINT volunteer_categories_name_check CHECK ((btrim(name) <> ''::text))
);

ALTER TABLE ONLY public.volunteer_categories FORCE ROW LEVEL SECURITY;


ALTER TABLE public.volunteer_categories OWNER TO neondb_owner;

--
-- Name: volunteer_match_alert_claims; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.volunteer_match_alert_claims (
    volunteer_request_id uuid NOT NULL,
    user_id uuid NOT NULL,
    to_email text NOT NULL,
    claimed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT volunteer_match_alert_claims_to_email_check CHECK ((btrim(to_email) <> ''::text))
);

ALTER TABLE ONLY public.volunteer_match_alert_claims FORCE ROW LEVEL SECURITY;


ALTER TABLE public.volunteer_match_alert_claims OWNER TO neondb_owner;

--
-- Name: TABLE volunteer_match_alert_claims; Type: COMMENT; Schema: public; Owner: neondb_owner
--

COMMENT ON TABLE public.volunteer_match_alert_claims IS 'Durable once-only claim for approval-triggered matching alerts, independent of retryable email_log status.';


--
-- Name: volunteer_request_categories; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.volunteer_request_categories (
    volunteer_request_id uuid NOT NULL,
    category_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.volunteer_request_categories FORCE ROW LEVEL SECURITY;


ALTER TABLE public.volunteer_request_categories OWNER TO neondb_owner;

--
-- Name: volunteer_requests; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.volunteer_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    legacy_wix_id text,
    org_id uuid NOT NULL,
    title text NOT NULL,
    description text,
    details text,
    event_location text,
    image_url text,
    people_helped integer,
    deadline_type text DEFAULT 'ongoing'::text NOT NULL,
    deadline_date date,
    expires_on date,
    contact_person_id uuid,
    status text DEFAULT 'draft'::text NOT NULL,
    submitted_at timestamp with time zone,
    approved_at timestamp with time zone,
    approved_by uuid,
    archived_at timestamp with time zone,
    archived_reason text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    image_generated boolean DEFAULT false NOT NULL,
    image_gen_status text,
    image_gen_error text,
    image_gen_retries integer DEFAULT 0 NOT NULL,
    CONSTRAINT volunteer_requests_archived_reason_check CHECK ((archived_reason = ANY (ARRAY['manual'::text, 'expired'::text, 'fulfilled'::text]))),
    CONSTRAINT volunteer_requests_deadline_date_required CHECK (((deadline_type <> 'date_specific'::text) OR (deadline_date IS NOT NULL))),
    CONSTRAINT volunteer_requests_deadline_type_check CHECK ((deadline_type = ANY (ARRAY['date_specific'::text, 'until_fulfilled'::text, 'ongoing'::text]))),
    CONSTRAINT volunteer_requests_image_gen_status_check CHECK ((image_gen_status = ANY (ARRAY['pending'::text, 'succeeded'::text, 'failed'::text]))),
    CONSTRAINT volunteer_requests_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'pending'::text, 'active'::text, 'archived'::text])))
);

ALTER TABLE ONLY public.volunteer_requests FORCE ROW LEVEL SECURITY;


ALTER TABLE public.volunteer_requests OWNER TO neondb_owner;

--
-- Name: replit_database_migrations_v1 id; Type: DEFAULT; Schema: _system; Owner: neondb_owner
--

ALTER TABLE ONLY _system.replit_database_migrations_v1 ALTER COLUMN id SET DEFAULT nextval('_system.replit_database_migrations_v1_id_seq'::regclass);


--
-- Data for Name: replit_database_migrations_v1; Type: TABLE DATA; Schema: _system; Owner: neondb_owner
--

COPY _system.replit_database_migrations_v1 (id, build_id, deployment_id, statement_count, applied_at) FROM stdin;
1	adaf757d-cdbd-4300-b892-2b3167d685b3	c52d59a9-d6bd-4d09-92e3-6d2d4817a18a	72	2026-09-10 00:34:28.77248+00
\.


--
-- Data for Name: account; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.account (id, "accountId", "providerId", "userId", "accessToken", "refreshToken", "idToken", "accessTokenExpiresAt", "refreshTokenExpiresAt", scope, password, "createdAt", "updatedAt") FROM stdin;
\.


--
-- Data for Name: admin_organization_contexts; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.admin_organization_contexts (id, admin_user_id, organization_id, started_at, ended_at, expires_at) FROM stdin;
\.


--
-- Data for Name: approval_events; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.approval_events (id, entity_type, entity_id, from_status, to_status, actor_user_id, note, created_at, organization_context_id, context_organization_id) FROM stdin;
e736376a-d864-4621-adfe-d42cd25cc9cd	organization	0c89b3ea-9569-4318-b9d0-3854aaf071e0	pending	approved	d7b85b9f-20b6-4ecc-8e76-7cd9b44674bd	\N	2026-09-04 15:49:56.233308+00	\N	\N
bbf7285d-11b8-4fba-a11d-497670e31434	organization	f4ab47e3-b36d-4e90-96e9-59971985e17e	pending	approved	d7b85b9f-20b6-4ecc-8e76-7cd9b44674bd	\N	2026-09-04 15:49:56.284685+00	\N	\N
ff64702e-01ac-4455-af39-7f10818ae223	organization	3cf8c6c3-8f2b-4d25-ab16-e9d44364a9b9	pending	approved	d7b85b9f-20b6-4ecc-8e76-7cd9b44674bd	\N	2026-09-04 15:49:56.293152+00	\N	\N
98fbf775-a333-4cb6-82b6-776c595eff00	organization	04c22dc0-5ba3-4cb4-b89c-2a2f7e8cc7a5	pending	approved	d7b85b9f-20b6-4ecc-8e76-7cd9b44674bd	\N	2026-09-04 15:49:56.30241+00	\N	\N
e3470bd4-04d6-4572-abc7-18b16cdedca4	org_membership	2714b536-d17a-4aff-b5de-710a0d3b601e	pending	active	d7b85b9f-20b6-4ecc-8e76-7cd9b44674bd	\N	2026-09-04 15:49:56.334101+00	\N	\N
1a02033b-d0b2-470b-846e-dd80a4bc303b	org_membership	154387f8-7179-44f7-b32d-a8f8a2495dc3	pending	active	d7b85b9f-20b6-4ecc-8e76-7cd9b44674bd	\N	2026-09-04 15:49:56.342646+00	\N	\N
501ce389-07f4-4a92-9cfc-2fb0468ab447	org_membership	cb31b833-6d4b-4fbc-8ae3-8e0cf8185894	pending	active	d7b85b9f-20b6-4ecc-8e76-7cd9b44674bd	\N	2026-09-04 15:49:56.352059+00	\N	\N
0ea19d9f-0f40-4f27-bf98-72ece997b437	org_membership	1ec7ed6d-b380-442b-a0a6-2787154e504a	pending	active	d7b85b9f-20b6-4ecc-8e76-7cd9b44674bd	\N	2026-09-04 15:49:56.361662+00	\N	\N
7c30bb7a-5096-4efa-9fea-68ee1809a1ab	org_membership	310880e3-c8a2-45eb-b57b-5866d0a2bdf3	pending	active	d7b85b9f-20b6-4ecc-8e76-7cd9b44674bd	\N	2026-09-04 15:49:56.370198+00	\N	\N
646d878c-9641-4836-aeaf-7bc62db536bd	org_membership	35bd0de6-a3c7-406c-bc9d-359d3855d119	pending	active	d7b85b9f-20b6-4ecc-8e76-7cd9b44674bd	\N	2026-09-04 15:49:56.381663+00	\N	\N
50e4e38a-20ba-418d-b071-7a3b9f4bdfb0	item_request	6d53ace7-7b5b-4311-9c26-8a1d9c4a5af4	draft	pending	1b20f969-a37c-4d29-bb39-972610f29036	\N	2026-09-04 15:49:56.411769+00	\N	\N
93b6b1ab-4f22-4891-9831-f8d5daa7ddd9	item_request	6d53ace7-7b5b-4311-9c26-8a1d9c4a5af4	pending	active	a390dd25-6daa-4061-a6fc-2e3dac327aab	\N	2026-09-04 15:49:56.416801+00	\N	\N
82e5630b-8479-4e01-9899-29e52046ada7	item_request	f8cd9b74-4dcc-4e63-9b98-21b7419360b1	draft	pending	1b20f969-a37c-4d29-bb39-972610f29036	\N	2026-09-04 15:49:56.446656+00	\N	\N
ec5cd262-4409-494a-91b6-4439a8c46973	item_request	f8cd9b74-4dcc-4e63-9b98-21b7419360b1	pending	active	a390dd25-6daa-4061-a6fc-2e3dac327aab	\N	2026-09-04 15:49:56.451099+00	\N	\N
e823e6de-54f7-4f6d-af43-9ad94886579b	item_request	5dead054-4f0d-45bd-8487-de4df854dc63	draft	pending	a679fbfc-3e61-4484-b322-6c0ddfb942ea	\N	2026-09-04 15:49:56.472019+00	\N	\N
df4cd519-345f-4a3d-befa-703e820cf39b	item_request	5dead054-4f0d-45bd-8487-de4df854dc63	pending	active	a390dd25-6daa-4061-a6fc-2e3dac327aab	\N	2026-09-04 15:49:56.477005+00	\N	\N
46dbd5f4-4b41-4d38-8f3a-1da92c46ca8d	item_request	faff2833-f22c-4e37-8186-52c6f93687f2	draft	pending	d3aa047c-714b-48fc-83a7-47cdee08e374	\N	2026-09-04 15:49:56.497642+00	\N	\N
dfa2b976-8772-4fe5-bfec-b8fda85b53b4	item_request	faff2833-f22c-4e37-8186-52c6f93687f2	pending	active	a390dd25-6daa-4061-a6fc-2e3dac327aab	\N	2026-09-04 15:49:56.502467+00	\N	\N
e9325ebb-4c8a-4fc7-ad23-163a00d549f9	item_request	a6d15b75-01c3-4a86-a8f8-207b87ca7068	draft	pending	d3aa047c-714b-48fc-83a7-47cdee08e374	\N	2026-09-04 15:49:56.543383+00	\N	\N
49020b5d-3a3c-442c-b08e-bcd17a24cd6a	volunteer_request	22f66b7c-317c-4e0d-a3ab-25a03e7be1e1	draft	pending	d3aa047c-714b-48fc-83a7-47cdee08e374	\N	2026-09-04 15:49:56.564837+00	\N	\N
16681293-5940-4bdc-9b18-545bf92e7ccf	volunteer_request	22f66b7c-317c-4e0d-a3ab-25a03e7be1e1	pending	active	a390dd25-6daa-4061-a6fc-2e3dac327aab	\N	2026-09-04 15:49:56.569899+00	\N	\N
0f774eac-49a5-4f5c-a76b-772053b10893	volunteer_request	6390df82-ae1a-4b3a-ad1d-f5a67cb7d014	draft	pending	1b20f969-a37c-4d29-bb39-972610f29036	\N	2026-09-04 15:49:56.592145+00	\N	\N
61319dba-fb63-47ac-b145-dd2166f08ec7	volunteer_request	6390df82-ae1a-4b3a-ad1d-f5a67cb7d014	pending	active	a390dd25-6daa-4061-a6fc-2e3dac327aab	\N	2026-09-04 15:49:56.595944+00	\N	\N
5ccd923b-be57-4407-a74f-2ee09e30dd59	volunteer_request	7a4a1a40-63a4-468e-a3ae-49dfc5a1aa3c	draft	pending	a679fbfc-3e61-4484-b322-6c0ddfb942ea	\N	2026-09-04 15:49:56.612376+00	\N	\N
e8d83ef4-6054-47d0-8fb3-4fa4bb84c2ac	volunteer_request	7a4a1a40-63a4-468e-a3ae-49dfc5a1aa3c	pending	active	a390dd25-6daa-4061-a6fc-2e3dac327aab	\N	2026-09-04 15:49:56.616357+00	\N	\N
2f24f33c-2638-4ff3-bd7c-32157434ae06	volunteer_request	1feedba6-482a-4917-b5df-0cc3ca5bca94	draft	pending	a679fbfc-3e61-4484-b322-6c0ddfb942ea	\N	2026-09-04 15:49:56.643598+00	\N	\N
66247510-f242-473a-a41c-60bbd73e568e	item_request	6d53ace7-7b5b-4311-9c26-8a1d9c4a5af4	active	archived	\N	fulfilled	2026-09-04 15:49:56.659813+00	\N	\N
066ac599-8512-4175-a53c-deef09935f75	item_request	faff2833-f22c-4e37-8186-52c6f93687f2	active	archived	\N	expired	2026-09-04 15:50:04.76776+00	\N	\N
f226e9e9-9967-48c7-a6d0-dc5a1ae77b9c	volunteer_request	7a4a1a40-63a4-468e-a3ae-49dfc5a1aa3c	active	archived	\N	expired	2026-09-04 15:50:04.802145+00	\N	\N
\.


--
-- Data for Name: contact_admin_audit; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.contact_admin_audit (id, actor_user_id, person_id, action, outcome, details, created_at) FROM stdin;
\.


--
-- Data for Name: digest_exclusions; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.digest_exclusions (id, need_type, need_id, window_start, excluded_by, excluded_at, note) FROM stdin;
\.


--
-- Data for Name: digest_runs; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.digest_runs (id, run_date, window_start, window_end, status, needs_count, recipients_count, note, created_at, completed_at, needs_payload, occurrence_key) FROM stdin;
944e76e3-7d20-41f7-b761-e9289624d96e	2026-09-10	2026-09-03 16:00:48.601568+00	2026-09-10 16:00:48.601568+00	sent	4	0	3 blocked (see email log)	2026-09-10 16:00:48.601568+00	2026-09-10 16:00:51.271804+00	[{"url": "https://lia.defendingthecause.org/items/5dead054-4f0d-45bd-8487-de4df854dc63", "name": "Apartment Setup for Arriving Family", "imageUrl": null, "typeLabel": "Item need", "organizationName": "New Horizons Refugee Support"}, {"url": "https://lia.defendingthecause.org/volunteer/22f66b7c-317c-4e0d-a3ab-25a03e7be1e1", "name": "Fall Soccer League Coaches", "imageUrl": null, "typeLabel": "Volunteer need", "organizationName": "Safe Harbor Youth Alliance"}, {"url": "https://lia.defendingthecause.org/volunteer/6390df82-ae1a-4b3a-ad1d-f5a67cb7d014", "name": "Move-In Day Volunteers", "imageUrl": null, "typeLabel": "Volunteer need", "organizationName": "Hearts & Hands Family Services"}, {"url": "https://lia.defendingthecause.org/items/f8cd9b74-4dcc-4e63-9b98-21b7419360b1", "name": "Welcome Boxes for New Placements", "imageUrl": null, "typeLabel": "Item need", "organizationName": "Hearts & Hands Family Services"}]	weekly:2026-09-10
\.


--
-- Data for Name: digest_subscribers; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.digest_subscribers (id, person_id, email, status, unsubscribe_token, subscribed_at, unsubscribed_at, legacy_source, first_name, last_name) FROM stdin;
48fe17da-328b-4575-b32a-0ac3a44873b0	\N	carol.d@example.org	subscribed	6b2aa1cd-3d46-49f2-96f9-fe42f68c0265	2026-09-04 15:49:56.805853+00	\N	wix_import	\N	\N
9bd37f81-9e70-49fa-a2e1-b0559118a4d5	\N	frank.m@example.org	subscribed	3527e15d-8655-4262-a58a-1894216f2885	2026-09-04 15:49:56.812428+00	\N	wix_import	\N	\N
62c64ee0-d17d-4458-9f6d-93d9b7cbdb86	5ca07dc3-8b4f-4c91-bddd-e643b95e8889	maria.lopez@example.org	subscribed	539eaf2d-06bf-4b1b-a11e-0c03bdef2b93	2026-09-04 15:49:56.817128+00	\N	\N	\N	\N
1bca1d5f-73d9-4ba5-ab31-707c8a6666db	\N	newsletter.fan@example.org	unsubscribed	c6804558-be80-4f58-a44c-b2c51c655ab2	2026-09-04 15:49:56.821082+00	2026-09-04 15:49:56.826321+00	\N	\N	\N
\.


--
-- Data for Name: email_brand_settings; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.email_brand_settings (id, primary_color, font_stack, org_name, program_name, signature_name, director_name, director_email, director_title, header_image_url, updated_at, updated_by) FROM stdin;
1	rgb(6, 54, 93)	-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif	The Alliance	Love in Action	The Alliance Love in Action Team	Christina Moe	christina@defendingthecause.org	Love in Action Program Director	\N	\N	\N
\.


--
-- Data for Name: email_log; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.email_log (id, template_key, to_email, to_person_id, entity_type, entity_id, payload, status, provider_message_id, error, sent_at, created_at, failure_category, resend_of_id) FROM stdin;
f46180ea-4fbc-4c2b-8e75-b70496b8a6ae	digest_new_needs	maria.lopez@example.org	5ca07dc3-8b4f-4c91-bddd-e643b95e8889	digest_run	944e76e3-7d20-41f7-b761-e9289624d96e	{"vars": {"needs": [{"url": "https://lia.defendingthecause.org/items/5dead054-4f0d-45bd-8487-de4df854dc63", "name": "Apartment Setup for Arriving Family", "imageUrl": null, "typeLabel": "Item need", "organizationName": "New Horizons Refugee Support"}, {"url": "https://lia.defendingthecause.org/volunteer/22f66b7c-317c-4e0d-a3ab-25a03e7be1e1", "name": "Fall Soccer League Coaches", "imageUrl": null, "typeLabel": "Volunteer need", "organizationName": "Safe Harbor Youth Alliance"}, {"url": "https://lia.defendingthecause.org/volunteer/6390df82-ae1a-4b3a-ad1d-f5a67cb7d014", "name": "Move-In Day Volunteers", "imageUrl": null, "typeLabel": "Volunteer need", "organizationName": "Hearts & Hands Family Services"}, {"url": "https://lia.defendingthecause.org/items/f8cd9b74-4dcc-4e63-9b98-21b7419360b1", "name": "Welcome Boxes for New Placements", "imageUrl": null, "typeLabel": "Item need", "organizationName": "Hearts & Hands Family Services"}], "unsubscribeUrl": "https://lia.defendingthecause.org/unsubscribe/539eaf2d-06bf-4b1b-a11e-0c03bdef2b93"}}	failed	\N	literal placeholder(s) left in rendered output: programName	\N	2026-09-10 16:00:49.438061+00	render	\N
9c086e0b-e60b-4c3e-9a18-71157168c1c9	digest_new_needs	frank.m@example.org	\N	digest_run	944e76e3-7d20-41f7-b761-e9289624d96e	{"vars": {"needs": [{"url": "https://lia.defendingthecause.org/items/5dead054-4f0d-45bd-8487-de4df854dc63", "name": "Apartment Setup for Arriving Family", "imageUrl": null, "typeLabel": "Item need", "organizationName": "New Horizons Refugee Support"}, {"url": "https://lia.defendingthecause.org/volunteer/22f66b7c-317c-4e0d-a3ab-25a03e7be1e1", "name": "Fall Soccer League Coaches", "imageUrl": null, "typeLabel": "Volunteer need", "organizationName": "Safe Harbor Youth Alliance"}, {"url": "https://lia.defendingthecause.org/volunteer/6390df82-ae1a-4b3a-ad1d-f5a67cb7d014", "name": "Move-In Day Volunteers", "imageUrl": null, "typeLabel": "Volunteer need", "organizationName": "Hearts & Hands Family Services"}, {"url": "https://lia.defendingthecause.org/items/f8cd9b74-4dcc-4e63-9b98-21b7419360b1", "name": "Welcome Boxes for New Placements", "imageUrl": null, "typeLabel": "Item need", "organizationName": "Hearts & Hands Family Services"}], "unsubscribeUrl": "https://lia.defendingthecause.org/unsubscribe/3527e15d-8655-4262-a58a-1894216f2885"}}	failed	\N	literal placeholder(s) left in rendered output: programName	\N	2026-09-10 16:00:50.236491+00	render	\N
7bab288e-261b-4710-b971-13c22f2aebf9	digest_new_needs	carol.d@example.org	\N	digest_run	944e76e3-7d20-41f7-b761-e9289624d96e	{"vars": {"needs": [{"url": "https://lia.defendingthecause.org/items/5dead054-4f0d-45bd-8487-de4df854dc63", "name": "Apartment Setup for Arriving Family", "imageUrl": null, "typeLabel": "Item need", "organizationName": "New Horizons Refugee Support"}, {"url": "https://lia.defendingthecause.org/volunteer/22f66b7c-317c-4e0d-a3ab-25a03e7be1e1", "name": "Fall Soccer League Coaches", "imageUrl": null, "typeLabel": "Volunteer need", "organizationName": "Safe Harbor Youth Alliance"}, {"url": "https://lia.defendingthecause.org/volunteer/6390df82-ae1a-4b3a-ad1d-f5a67cb7d014", "name": "Move-In Day Volunteers", "imageUrl": null, "typeLabel": "Volunteer need", "organizationName": "Hearts & Hands Family Services"}, {"url": "https://lia.defendingthecause.org/items/f8cd9b74-4dcc-4e63-9b98-21b7419360b1", "name": "Welcome Boxes for New Placements", "imageUrl": null, "typeLabel": "Item need", "organizationName": "Hearts & Hands Family Services"}], "unsubscribeUrl": "https://lia.defendingthecause.org/unsubscribe/6b2aa1cd-3d46-49f2-96f9-fe42f68c0265"}}	failed	\N	literal placeholder(s) left in rendered output: programName	\N	2026-09-10 16:00:50.771158+00	render	\N
\.


--
-- Data for Name: email_schedules; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.email_schedules (template_key, active, weekly_weekday, weekly_minutes, one_time_at, updated_at, updated_by) FROM stdin;
digest_new_needs	t	4	540	\N	2026-09-04 15:49:54.359786+00	\N
\.


--
-- Data for Name: email_template_overrides; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.email_template_overrides (template_key, subject, heading, paragraphs, recipients, enabled, updated_at, updated_by, body_blocks) FROM stdin;
\.


--
-- Data for Name: item_pledge_lines; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.item_pledge_lines (id, item_pledge_id, item_id, quantity) FROM stdin;
a95d6791-c5f2-44af-96da-be38e81cd7b1	e17beef8-6f97-45e7-8091-30b2503ab5b6	589be485-7ae8-4fe2-b448-f674b64f9599	2
e76baa12-893c-4927-902b-087c629ea5fc	e17beef8-6f97-45e7-8091-30b2503ab5b6	1951b1d7-5ebb-4b7c-b176-3593a8a88db4	1
ca03f864-9b45-4dc7-b8bd-500cd7148c8c	01ec0b8b-44ad-4a7c-84af-d09920ba9fff	589be485-7ae8-4fe2-b448-f674b64f9599	2
f886ab12-3d87-4065-9aac-b11f978595a9	01ec0b8b-44ad-4a7c-84af-d09920ba9fff	1951b1d7-5ebb-4b7c-b176-3593a8a88db4	1
be7b1475-2bab-4027-818a-b78cf330e988	0e1de8af-3c49-4204-92bc-fbf8bd28b120	e4bfb50e-fa89-45b4-8aac-12540f8ab52e	6
d7146864-f5c5-4504-b1cc-e51ea706f72c	d7579b26-738c-4502-99dd-695077e6200a	e3a2acbe-ecb9-43cb-9d58-e0f8b40ba63c	5
7cab72b5-e3de-4a43-a798-276740279f11	a84e355d-31dc-4fd9-b3a1-bb497e6d172c	e59c5b6a-05a4-4a6d-afd6-123d46f9dd1d	1
a5559671-19f0-4646-9c53-86150eaa8201	a84e355d-31dc-4fd9-b3a1-bb497e6d172c	828e86a3-2c6a-43df-b730-ba75bf68455f	3
b8cf361a-358f-45d5-820f-db43db41d407	73d44a8b-4b2d-427f-835b-bb86b2db61a4	1dff56a1-9cc1-43c8-ada8-b20430c5bd3c	6
c26dae02-003e-4766-9c5c-3db7949cb5d3	ecf7f691-52d8-499e-a826-4ba50c5adb1f	e505f3c0-58a6-43f8-8441-d0a7f1f23eea	3
\.


--
-- Data for Name: item_pledges; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.item_pledges (id, legacy_wix_id, person_id, item_request_id, notes, created_at, updated_at, status, cancelled_at, cancelled_by, cancellation_reason, participation_version) FROM stdin;
e17beef8-6f97-45e7-8091-30b2503ab5b6	\N	5ca07dc3-8b4f-4c91-bddd-e643b95e8889	6d53ace7-7b5b-4311-9c26-8a1d9c4a5af4	Can drop off Saturday morning.	2026-09-04 15:49:56.650888+00	2026-09-04 15:49:56.65+00	active	\N	\N	\N	1
01ec0b8b-44ad-4a7c-84af-d09920ba9fff	\N	20b1b06a-5e79-4bf5-bf4b-4f7ef7f15d82	6d53ace7-7b5b-4311-9c26-8a1d9c4a5af4	\N	2026-09-04 15:49:56.659813+00	2026-09-04 15:49:56.659+00	active	\N	\N	\N	1
0e1de8af-3c49-4204-92bc-fbf8bd28b120	\N	5ca07dc3-8b4f-4c91-bddd-e643b95e8889	f8cd9b74-4dcc-4e63-9b98-21b7419360b1	\N	2026-09-04 15:49:56.666926+00	2026-09-04 15:49:56.666+00	active	\N	\N	\N	1
d7579b26-738c-4502-99dd-695077e6200a	\N	20b1b06a-5e79-4bf5-bf4b-4f7ef7f15d82	f8cd9b74-4dcc-4e63-9b98-21b7419360b1	\N	2026-09-04 15:49:56.673916+00	2026-09-04 15:49:56.673+00	active	\N	\N	\N	1
a84e355d-31dc-4fd9-b3a1-bb497e6d172c	\N	35cda6c7-421c-4ff6-9237-1746526fb9a8	5dead054-4f0d-45bd-8487-de4df854dc63	\N	2026-09-04 15:49:56.678872+00	2026-09-04 15:49:56.678+00	active	\N	\N	\N	1
73d44a8b-4b2d-427f-835b-bb86b2db61a4	\N	efbeaaf2-789b-4c46-868f-afe5c38af1fb	faff2833-f22c-4e37-8186-52c6f93687f2	\N	2026-09-04 15:49:56.684434+00	2026-09-04 15:49:56.684+00	active	\N	\N	\N	1
ecf7f691-52d8-499e-a826-4ba50c5adb1f	\N	0932eb0e-8a7d-4097-8a63-a96332565cb8	faff2833-f22c-4e37-8186-52c6f93687f2	\N	2026-09-04 15:49:56.689478+00	2026-09-04 15:49:56.689+00	active	\N	\N	\N	1
\.


--
-- Data for Name: item_requests; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.item_requests (id, legacy_wix_id, org_id, title, description, image_url, dropoff_location, people_helped, deadline_type, deadline_date, expires_on, contact_person_id, status, submitted_at, approved_at, approved_by, archived_at, archived_reason, created_by, created_at, updated_at, image_generated, image_gen_status, image_gen_error, image_gen_retries) FROM stdin;
f8cd9b74-4dcc-4e63-9b98-21b7419360b1	\N	f4ab47e3-b36d-4e90-96e9-59971985e17e	Welcome Boxes for New Placements	A first-night box for kids arriving in care: bedding, pajamas, and a book of their own.	\N	Hearts & Hands office, 210 Vernon St, Roseville	12	until_fulfilled	\N	\N	0e034298-2ed0-42fa-a269-44fee2679ba8	active	2026-09-04 15:49:56.446656+00	2026-09-04 15:49:56.451099+00	a390dd25-6daa-4061-a6fc-2e3dac327aab	\N	\N	1b20f969-a37c-4d29-bb39-972610f29036	2026-09-04 15:49:56.426138+00	2026-09-04 15:49:56.451099+00	f	\N	\N	0
5dead054-4f0d-45bd-8487-de4df854dc63	\N	3cf8c6c3-8f2b-4d25-ab16-e9d44364a9b9	Apartment Setup for Arriving Family	A family of five arrives this month to an empty apartment. Help us make it a home.	\N	New Horizons warehouse, 7811 Auburn Blvd, Citrus Heights	5	until_fulfilled	\N	\N	d47c25c9-9e0e-45be-840d-b0dcbe75e551	active	2026-09-04 15:49:56.472019+00	2026-09-04 15:49:56.477005+00	a390dd25-6daa-4061-a6fc-2e3dac327aab	\N	\N	a679fbfc-3e61-4484-b322-6c0ddfb942ea	2026-09-04 15:49:56.459224+00	2026-09-04 15:49:56.477005+00	f	\N	\N	0
3393c28a-951d-4fd9-b342-bf70d0b8673b	\N	3cf8c6c3-8f2b-4d25-ab16-e9d44364a9b9	Winter Coat Closet Restock	Draft — sizing list still being confirmed with case workers.	\N	New Horizons warehouse, 7811 Auburn Blvd, Citrus Heights	20	until_fulfilled	\N	\N	d47c25c9-9e0e-45be-840d-b0dcbe75e551	draft	\N	\N	\N	\N	\N	a679fbfc-3e61-4484-b322-6c0ddfb942ea	2026-09-04 15:49:56.520931+00	2026-09-04 15:49:56.520931+00	f	\N	\N	0
a6d15b75-01c3-4a86-a8f8-207b87ca7068	\N	04c22dc0-5ba3-4cb4-b89c-2a2f7e8cc7a5	Bus Passes for Job Interviews	Monthly transit passes so teens can reliably get to interviews and first shifts.	\N	Safe Harbor drop-in center, 5000 Rocklin Rd, Rocklin	10	until_fulfilled	\N	\N	d7ee4728-0c19-48e8-bcc0-462c09de2e50	pending	2026-09-04 15:49:56.543383+00	\N	\N	\N	\N	d3aa047c-714b-48fc-83a7-47cdee08e374	2026-09-04 15:49:56.534169+00	2026-09-04 15:49:56.543383+00	f	\N	\N	0
6d53ace7-7b5b-4311-9c26-8a1d9c4a5af4	\N	f4ab47e3-b36d-4e90-96e9-59971985e17e	Car Seats for Foster Placements	New placements often arrive with nothing. These seats let families say yes to emergency calls.	\N	Hearts & Hands office, 210 Vernon St, Roseville	6	until_fulfilled	\N	\N	0e034298-2ed0-42fa-a269-44fee2679ba8	archived	2026-09-04 15:49:56.411769+00	2026-09-04 15:49:56.416801+00	a390dd25-6daa-4061-a6fc-2e3dac327aab	2026-09-04 15:49:56.659813+00	fulfilled	1b20f969-a37c-4d29-bb39-972610f29036	2026-09-04 15:49:56.395625+00	2026-09-04 15:49:56.659813+00	f	\N	\N	0
faff2833-f22c-4e37-8186-52c6f93687f2	\N	04c22dc0-5ba3-4cb4-b89c-2a2f7e8cc7a5	Hygiene Kits for Drop-In Center	Teens at the drop-in center rely on these kits weekly. Full-size products last longest.	\N	Safe Harbor drop-in center, 5000 Rocklin Rd, Rocklin	40	until_fulfilled	\N	2026-09-03	d7ee4728-0c19-48e8-bcc0-462c09de2e50	archived	2026-09-04 15:49:56.497642+00	2026-09-04 15:49:56.502467+00	a390dd25-6daa-4061-a6fc-2e3dac327aab	2026-09-04 15:50:04.76776+00	expired	d3aa047c-714b-48fc-83a7-47cdee08e374	2026-09-04 15:49:56.483054+00	2026-09-04 15:50:04.76776+00	f	\N	\N	0
\.


--
-- Data for Name: items; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.items (id, legacy_wix_id, item_request_id, name, description, condition, product_url, quantity_requested, quantity_claimed, quantity_received, sort_order, created_at, updated_at) FROM stdin;
8709d36f-96e6-46fb-b20d-baaea9b28951	\N	f8cd9b74-4dcc-4e63-9b98-21b7419360b1	Board books	\N	\N	\N	10	0	0	2	2026-09-04 15:49:56.441373+00	2026-09-04 15:49:56.441373+00
5caeeb03-c31b-4e0a-951c-74f2159cb968	\N	3393c28a-951d-4fd9-b342-bf70d0b8673b	Winter coats (teen sizes)	\N	\N	\N	20	0	0	0	2026-09-04 15:49:56.526654+00	2026-09-04 15:49:56.526654+00
76b57516-8f94-4872-b524-cc6503c45883	\N	a6d15b75-01c3-4a86-a8f8-207b87ca7068	Monthly transit pass	\N	\N	\N	10	0	0	0	2026-09-04 15:49:56.539391+00	2026-09-04 15:49:56.539391+00
589be485-7ae8-4fe2-b448-f674b64f9599	\N	6d53ace7-7b5b-4311-9c26-8a1d9c4a5af4	Infant car seat (rear-facing)	New in box — safety regulations require unused seats.	\N	\N	4	4	0	0	2026-09-04 15:49:56.403077+00	2026-09-04 15:49:56.659813+00
1951b1d7-5ebb-4b7c-b176-3593a8a88db4	\N	6d53ace7-7b5b-4311-9c26-8a1d9c4a5af4	Convertible car seat	\N	\N	\N	2	2	0	1	2026-09-04 15:49:56.407295+00	2026-09-04 15:49:56.659813+00
e4bfb50e-fa89-45b4-8aac-12540f8ab52e	\N	f8cd9b74-4dcc-4e63-9b98-21b7419360b1	Twin mattress protector	\N	\N	\N	6	6	0	0	2026-09-04 15:49:56.433913+00	2026-09-04 15:49:56.666926+00
e3a2acbe-ecb9-43cb-9d58-e0f8b40ba63c	\N	f8cd9b74-4dcc-4e63-9b98-21b7419360b1	Pajama sets (kids 4-10)	\N	\N	\N	12	5	0	1	2026-09-04 15:49:56.437962+00	2026-09-04 15:49:56.673916+00
e59c5b6a-05a4-4a6d-afd6-123d46f9dd1d	\N	5dead054-4f0d-45bd-8487-de4df854dc63	Kitchen starter kit	Pots, pans, utensils, and dishes for four.	\N	\N	3	1	0	0	2026-09-04 15:49:56.463661+00	2026-09-04 15:49:56.678872+00
828e86a3-2c6a-43df-b730-ba75bf68455f	\N	5dead054-4f0d-45bd-8487-de4df854dc63	Bath towels (new)	\N	\N	\N	8	3	0	1	2026-09-04 15:49:56.468328+00	2026-09-04 15:49:56.678872+00
1dff56a1-9cc1-43c8-ada8-b20430c5bd3c	\N	faff2833-f22c-4e37-8186-52c6f93687f2	Full-size shampoo	\N	\N	\N	24	6	0	0	2026-09-04 15:49:56.488511+00	2026-09-04 15:49:56.684434+00
e505f3c0-58a6-43f8-8441-d0a7f1f23eea	\N	faff2833-f22c-4e37-8186-52c6f93687f2	Deodorant	\N	\N	\N	30	3	0	1	2026-09-04 15:49:56.492417+00	2026-09-04 15:49:56.689478+00
\.


--
-- Data for Name: org_memberships; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.org_memberships (id, org_id, user_id, role, status, invited_by, approved_at, approved_by, created_at, updated_at) FROM stdin;
2714b536-d17a-4aff-b5de-710a0d3b601e	0c89b3ea-9569-4318-b9d0-3854aaf071e0	d7b85b9f-20b6-4ecc-8e76-7cd9b44674bd	staff_admin	active	\N	2026-09-04 15:49:56.334101+00	d7b85b9f-20b6-4ecc-8e76-7cd9b44674bd	2026-09-04 15:49:56.330276+00	2026-09-04 15:49:56.334101+00
154387f8-7179-44f7-b32d-a8f8a2495dc3	0c89b3ea-9569-4318-b9d0-3854aaf071e0	5836a04f-56a9-4c27-9177-e593c6804fa9	staff_admin	active	\N	2026-09-04 15:49:56.342646+00	d7b85b9f-20b6-4ecc-8e76-7cd9b44674bd	2026-09-04 15:49:56.339646+00	2026-09-04 15:49:56.342646+00
cb31b833-6d4b-4fbc-8ae3-8e0cf8185894	0c89b3ea-9569-4318-b9d0-3854aaf071e0	a390dd25-6daa-4061-a6fc-2e3dac327aab	staff_approver	active	\N	2026-09-04 15:49:56.352059+00	d7b85b9f-20b6-4ecc-8e76-7cd9b44674bd	2026-09-04 15:49:56.34909+00	2026-09-04 15:49:56.352059+00
1ec7ed6d-b380-442b-a0a6-2787154e504a	f4ab47e3-b36d-4e90-96e9-59971985e17e	1b20f969-a37c-4d29-bb39-972610f29036	owner	active	\N	2026-09-04 15:49:56.361662+00	d7b85b9f-20b6-4ecc-8e76-7cd9b44674bd	2026-09-04 15:49:56.357794+00	2026-09-04 15:49:56.361662+00
310880e3-c8a2-45eb-b57b-5866d0a2bdf3	3cf8c6c3-8f2b-4d25-ab16-e9d44364a9b9	a679fbfc-3e61-4484-b322-6c0ddfb942ea	owner	active	\N	2026-09-04 15:49:56.370198+00	d7b85b9f-20b6-4ecc-8e76-7cd9b44674bd	2026-09-04 15:49:56.367413+00	2026-09-04 15:49:56.370198+00
35bd0de6-a3c7-406c-bc9d-359d3855d119	04c22dc0-5ba3-4cb4-b89c-2a2f7e8cc7a5	d3aa047c-714b-48fc-83a7-47cdee08e374	owner	active	\N	2026-09-04 15:49:56.381663+00	d7b85b9f-20b6-4ecc-8e76-7cd9b44674bd	2026-09-04 15:49:56.37862+00	2026-09-04 15:49:56.381663+00
addbf90d-f561-44b5-b5ae-d110d121457c	bed18810-3b73-4e60-89e2-dd5deba7bc36	96a9e916-d1d5-43cb-9317-34aeb60a52a2	owner	pending	\N	\N	\N	2026-09-04 15:49:56.388355+00	2026-09-04 15:49:56.388355+00
\.


--
-- Data for Name: organization_context_actions; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.organization_context_actions (id, organization_context_id, organization_id, actor_user_id, action, entity_type, entity_id, created_at) FROM stdin;
\.


--
-- Data for Name: organization_populations; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.organization_populations (org_id, population_id) FROM stdin;
f4ab47e3-b36d-4e90-96e9-59971985e17e	1253c440-0f46-4309-b024-9826e03ae59e
f4ab47e3-b36d-4e90-96e9-59971985e17e	09ff690d-7b11-40f9-a276-b75a9f66e5e9
3cf8c6c3-8f2b-4d25-ab16-e9d44364a9b9	7322d99d-d8c5-43a0-a77f-1ce2d0ecf79e
3cf8c6c3-8f2b-4d25-ab16-e9d44364a9b9	5f84272e-bb8b-436e-b1ad-691946bd4b2d
04c22dc0-5ba3-4cb4-b89c-2a2f7e8cc7a5	3ec1ac2f-90bf-4e39-8ae4-037adf0f19be
04c22dc0-5ba3-4cb4-b89c-2a2f7e8cc7a5	b65ee250-a0df-43f1-bc0a-1aba3a485f41
04c22dc0-5ba3-4cb4-b89c-2a2f7e8cc7a5	5a33dd4a-9e13-4cf1-a697-7637ef89589d
bed18810-3b73-4e60-89e2-dd5deba7bc36	adf14eee-eef1-4b72-9cd3-58e6c229fe73
bed18810-3b73-4e60-89e2-dd5deba7bc36	9c45fccb-fc2b-4b62-b0b2-c657208d49ad
\.


--
-- Data for Name: organization_revisions; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.organization_revisions (id, organization_id, actor_user_id, changed_fields, created_at) FROM stdin;
\.


--
-- Data for Name: organizations; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.organizations (id, legacy_wix_id, kind, name, slug, website_url, mission, phone, logo_url, populations_other, address_line1, address_line2, city, state, postal_code, address_formatted, primary_contact_person_id, status, approved_at, approved_by, created_at, updated_at) FROM stdin;
0c89b3ea-9569-4318-b9d0-3854aaf071e0	\N	platform_owner	The Alliance	the-alliance	https://thealliance.example.org	A network of local organizations caring for kids and families in crisis across South Placer County.	\N	\N	\N	\N	\N	Roseville	CA	\N	\N	43aed73a-a82e-4083-9d5e-76452faa6a3e	approved	2026-09-04 15:49:56.233308+00	d7b85b9f-20b6-4ecc-8e76-7cd9b44674bd	2026-09-04 15:49:56.228395+00	2026-09-04 15:49:56.233308+00
f4ab47e3-b36d-4e90-96e9-59971985e17e	\N	member_org	Hearts & Hands Family Services	hearts-hands-family-services	https://heartsandhands.example.org	Wrapping foster and adoptive families in practical, hands-on support from placement day forward.	\N	\N	\N	\N	\N	Roseville	CA	\N	\N	0e034298-2ed0-42fa-a269-44fee2679ba8	approved	2026-09-04 15:49:56.284685+00	d7b85b9f-20b6-4ecc-8e76-7cd9b44674bd	2026-09-04 15:49:56.28104+00	2026-09-04 15:49:56.284685+00
3cf8c6c3-8f2b-4d25-ab16-e9d44364a9b9	\N	member_org	New Horizons Refugee Support	new-horizons-refugee-support	https://newhorizons.example.org	Helping newly arrived refugee families set up homes, learn English, and find their footing.	\N	\N	\N	\N	\N	Citrus Heights	CA	\N	\N	d47c25c9-9e0e-45be-840d-b0dcbe75e551	approved	2026-09-04 15:49:56.293152+00	d7b85b9f-20b6-4ecc-8e76-7cd9b44674bd	2026-09-04 15:49:56.289532+00	2026-09-04 15:49:56.293152+00
04c22dc0-5ba3-4cb4-b89c-2a2f7e8cc7a5	\N	member_org	Safe Harbor Youth Alliance	safe-harbor-youth-alliance	https://safeharbor.example.org	A drop-in center and mentoring community for unhoused and at-risk teens in South Placer.	\N	\N	\N	\N	\N	Rocklin	CA	\N	\N	d7ee4728-0c19-48e8-bcc0-462c09de2e50	approved	2026-09-04 15:49:56.30241+00	d7b85b9f-20b6-4ecc-8e76-7cd9b44674bd	2026-09-04 15:49:56.298615+00	2026-09-04 15:49:56.30241+00
bed18810-3b73-4e60-89e2-dd5deba7bc36	\N	member_org	Bridge of Hope Single Parents Network	bridge-of-hope-single-parents	https://bridgeofhope.example.org	Community, coaching, and material help for single parents rebuilding stability.	\N	\N	\N	\N	\N	Lincoln	CA	\N	\N	44c5ffbc-d8ea-47b8-9bde-d54a636d7108	pending	\N	\N	2026-09-04 15:49:56.307532+00	2026-09-04 15:49:56.307532+00
\.


--
-- Data for Name: participation_history; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.participation_history (id, entity_type, entity_id, action, actor_user_id, reason, before_state, after_state, created_at) FROM stdin;
\.


--
-- Data for Name: people; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.people (id, first_name, last_name, email, phone, needs_review, review_note, source_note, legacy_wix_contact_id, created_at, updated_at) FROM stdin;
f6f198d2-fdcc-4f98-bf60-2454b400c36f	Alex	Rivera	supporter@example.org	\N	f	\N	migration	\N	2026-09-04 15:49:54.359786+00	2026-09-04 15:49:54.359786+00
a9e7a159-ce7b-4b57-8938-3c32409ea614	Tiffany	Loeffler	tiffany@defendingthecause.org	\N	f	\N	seed	\N	2026-09-04 15:49:56.187675+00	2026-09-04 15:49:56.187675+00
43aed73a-a82e-4083-9d5e-76452faa6a3e	Christina	Moe	christina@defendingthecause.org	\N	f	\N	seed	\N	2026-09-04 15:49:56.19595+00	2026-09-04 15:49:56.19595+00
d4ea664d-25d3-4818-adae-3d679d0ab910	Riley	Chen	approver@thealliance.example.org	\N	f	\N	seed	\N	2026-09-04 15:49:56.200512+00	2026-09-04 15:49:56.200512+00
0e034298-2ed0-42fa-a269-44fee2679ba8	Dana	Whitfield	dana@heartsandhands.example.org	\N	f	\N	seed	\N	2026-09-04 15:49:56.240332+00	2026-09-04 15:49:56.240332+00
d47c25c9-9e0e-45be-840d-b0dcbe75e551	Samuel	Okafor	samuel@newhorizons.example.org	\N	f	\N	seed	\N	2026-09-04 15:49:56.24891+00	2026-09-04 15:49:56.24891+00
d7ee4728-0c19-48e8-bcc0-462c09de2e50	Grace	Lin	grace@safeharbor.example.org	\N	f	\N	seed	\N	2026-09-04 15:49:56.25284+00	2026-09-04 15:49:56.25284+00
44c5ffbc-d8ea-47b8-9bde-d54a636d7108	Monica	Reyes	monica@bridgeofhope.example.org	\N	f	\N	seed	\N	2026-09-04 15:49:56.25728+00	2026-09-04 15:49:56.25728+00
efbeaaf2-789b-4c46-868f-afe5c38af1fb	Tom	Nguyen	tom.nguyen@example.org	\N	f	\N	\N	\N	2026-09-04 15:49:56.684434+00	2026-09-04 15:49:56.684434+00
5ca07dc3-8b4f-4c91-bddd-e643b95e8889	Maria	Lopez	maria.lopez@example.org	\N	f	\N	\N	\N	2026-09-04 15:49:56.650888+00	2026-09-04 15:49:56.695859+00
9c7c34e4-4491-4808-8b64-1e049304811d	Kevin	Park	kevin.park@example.org	\N	f	\N	\N	\N	2026-09-04 15:49:56.704074+00	2026-09-04 15:49:56.704074+00
cf07c136-8d77-4fa0-8f4a-c6294d386f79	Priya	Sharma	priya.sharma@example.org	\N	f	\N	\N	\N	2026-09-04 15:49:56.70877+00	2026-09-04 15:49:56.70877+00
20b1b06a-5e79-4bf5-bf4b-4f7ef7f15d82	David	Kim	david.kim@example.org	\N	f	\N	\N	\N	2026-09-04 15:49:56.659813+00	2026-09-04 15:49:56.713709+00
42d56245-84c7-4853-9352-47f65f392156	Lena	Fischer	lena.fischer@example.org	\N	f	\N	\N	\N	2026-09-04 15:49:56.718525+00	2026-09-04 15:49:56.718525+00
35cda6c7-421c-4ff6-9237-1746526fb9a8	Aisha	Bello	aisha.bello@example.org	\N	f	\N	\N	\N	2026-09-04 15:49:56.678872+00	2026-09-04 15:49:56.723402+00
0932eb0e-8a7d-4097-8a63-a96332565cb8	Patrick	Nguyen	pat.nguyen@example.org	\N	t	Signed up as 'Patrick' but pledged as 'Pat' — confirm one person.	\N	\N	2026-09-04 15:49:56.689478+00	2026-09-04 15:49:56.733797+00
\.


--
-- Data for Name: person_volunteer_interests; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.person_volunteer_interests (person_id, category_id, created_at) FROM stdin;
\.


--
-- Data for Name: populations; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.populations (id, name, slug, sort_order, is_active) FROM stdin;
b65ee250-a0df-43f1-bc0a-1aba3a485f41	At-Risk Kids/Teens	at-risk-kids-teens	1	t
09ff690d-7b11-40f9-a276-b75a9f66e5e9	Youth in Foster Care	youth-in-foster-care	2	t
5a33dd4a-9e13-4cf1-a697-7637ef89589d	Transitional Age Youth/Young Adults	transitional-age-youth-young-adults	3	t
3ec1ac2f-90bf-4e39-8ae4-037adf0f19be	Unhoused Teens/Families	unhoused-teens-families	4	t
1253c440-0f46-4309-b024-9826e03ae59e	Foster/Adoptive Families	foster-adoptive-families	5	t
7322d99d-d8c5-43a0-a77f-1ce2d0ecf79e	Refugee Families	refugee-families	6	t
adf14eee-eef1-4b72-9cd3-58e6c229fe73	Single Parents	single-parents	7	t
9c45fccb-fc2b-4b62-b0b2-c657208d49ad	Women Facing Unplanned Pregnancies	women-facing-unplanned-pregnancies	8	t
5f84272e-bb8b-436e-b1ad-691946bd4b2d	Families/Young Adults in Crisis	families-young-adults-in-crisis	9	t
ba6b73f7-5a18-4bea-bd5a-2652208795d3	Youth with Disabilities/Health Issues	youth-with-disabilities-health-issues	10	t
ba507e27-ce75-4b0a-8813-c771cd919f6b	Other	other	11	t
\.


--
-- Data for Name: request_engagement_events; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.request_engagement_events (id, client_event_id, event_type, request_kind, item_request_id, volunteer_request_id, item_id, volunteer_role_id, user_id, created_at) FROM stdin;
\.


--
-- Data for Name: request_revisions; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.request_revisions (id, entity_type, entity_id, actor_user_id, summary, created_at, organization_context_id, context_organization_id) FROM stdin;
\.


--
-- Data for Name: schema_migrations; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.schema_migrations (filename, sha256, applied_at) FROM stdin;
0001_initial_schema.sql	73328ab6c9a74d922e5c652cf67b31557305070eb6e8d81dc82446b2deab890a	2026-09-04 15:49:54.359786+00
0002_phone_match_names_all_duplicates.sql	e0d0e301eac443c1df83cb2b7a154dc08b0cba230dbbf0a5759781b80b6a6e25	2026-09-04 15:49:54.359786+00
0003_merge_people_function.sql	262e6a6beeb36598f12324d84f535dfe8c9f2b3a1e68929f7f0ea18ceb844ee7	2026-09-04 15:49:54.359786+00
0004_digest_subscriber_names.sql	caacf788db472c746fe80c3ddb3c408f8c468912724b30a51590e9517d825965	2026-09-04 15:49:54.359786+00
0005_email_dispatch_claim.sql	8d1a65f26330404e826ce8ca218eb5c80d5fb31c681cb6f3eaf8d5c6e0585920	2026-09-04 15:49:54.359786+00
0006_close_rls_and_counter_gaps.sql	56ad21bc1c1d6791d1c556305ce3e2170d575fcce15e7486a5432fa388b1e30a	2026-09-04 15:49:54.359786+00
0007_scope_public_child_policies.sql	5e56f55e86860cc596a837879c2c659406181f80fd5df04fefcfa17702604ba1	2026-09-04 15:49:54.359786+00
0008_email_template_overrides.sql	2c6cf1f49606a143b3b04e02a777942fbe21d6f20facd5da56d63562efcf25b0	2026-09-04 15:49:54.359786+00
0008_item_image_generation.sql	1abdae27ae3f601177f2b8b9fdcce715c41e071fd52565cd65a0c86aa1cfadd7	2026-09-04 15:49:54.359786+00
0009_digest_runs.sql	40ea9e9d788ac2678a11b84317b0b92fe9e744e946ee089295684fc86e7f85a5	2026-09-04 15:49:54.359786+00
0009_email_template_overrides_updated_by.sql	9acf342bb03749b3cec2d2736db5b888d6cc7201914553763949f8e0e85a3956	2026-09-04 15:49:54.359786+00
0010_digest_run_needs_snapshot.sql	e0ddc5a1585638f1e4b5d4d87e9901ea4caf11531a686c9dcfb7364fe7bbb538	2026-09-04 15:49:54.359786+00
0011_image_gen_retries.sql	6ed8ac577bfd4d380b1ec33930dfa990249039a5a692d0384e0fdcbcf9eb96fe	2026-09-04 15:49:54.359786+00
0012_digest_exclusions.sql	2c79ee2d0848f76c8f4ba8de67867a6e38236bb19db8ef1cfc1bb9f88e702999	2026-09-04 15:49:54.359786+00
0012_email_log_failure_structured.sql	a8f50f55a0dbfede5aa600d9a82e27e0082dc626cd3c0ab59158578ae2baeeb8	2026-09-04 15:49:54.359786+00
0013_digest_exclusions_simpler_key.sql	b56e00f54f72349198e24222dd5d66fd2044118fbc93209bc087e8adefca314e	2026-09-04 15:49:54.359786+00
0014_supporter_user_kind.sql	82e537f3a103be45441424eb035adbfb7cda1bf624aaed2facaf2543163d67ac	2026-09-04 15:49:54.359786+00
0034_split_counter_trigger_branches.sql	e30ec9c8f58990d090d055fed38527c25cb40e8090880072a82d5643b3f55008	2026-09-04 15:49:54.359786+00
0035_volunteer_image_generation.sql	51e9f8f51ebd90e8c1b613216e91e0ec14ad7f6255097f00e00b33007e1e1311	2026-09-04 15:49:54.359786+00
0036_item_request_deadline_expiry.sql	370c5d703f504242e884268f82f4aa603ec11972a4a3d9af2d482d8cfa6ac287	2026-09-04 15:49:54.359786+00
0037_email_schedules.sql	b921c1b64339f189f9a0593cce605ae9157efbc32a26996839fdd69ec2289993	2026-09-04 15:49:54.359786+00
0037_volunteer_interests.sql	8b739b00c9bf89f1592afdaadf991ec77479d8d9e99a87c2c5f7ea8abdba4e80	2026-09-04 15:49:54.359786+00
0038_digest_run_occurrences.sql	00f22cda51efa62b54028b589257e06370ed6084b3a3f8db3619cec96ddd1235	2026-09-04 15:49:54.359786+00
0038_volunteer_request_categories.sql	423e51128ac3acbf61c0176196619d8692695dc43de61468276caad3ba0b24c7	2026-09-04 15:49:54.359786+00
0039_matching_volunteer_alerts.sql	8738f0b22b292b37e8ff3169fe6ec11817bd9d5d971b469c762f000608558e58	2026-09-04 15:49:54.359786+00
0040_request_analytics_parent_ownership_keys.sql	b1a5a98d88a7cd805e7547913142448efb80bba2a6c54ad89bfcac1d5a36fe71	2026-09-04 15:49:54.359786+00
0041_request_engagement.sql	68d84fba6fae1804115488be0905ef678cbe9a1304e07922cbd46ef8e0b6b604	2026-09-04 15:49:54.359786+00
0042_engagement_child_ownership.sql	1e7b5486c3b2609e1140ad91f0b9530235da4792252e527bc9439d19f2b930de	2026-09-04 15:49:54.359786+00
0043_request_revisions.sql	7d350c27dd87693d39bfab8aa28418b892f8b94b290e3d87d0275a5605c098c6	2026-09-04 15:49:54.359786+00
0043_volunteer_signup_expiry_check.sql	70d2354db0c94e125fb5a252e844b053553999cb9ba98504806dad3838647d51	2026-09-04 15:49:54.359786+00
0044_repair_item_request_expiry_functions.sql	c76d5d01248c478321f6197a6d6c7cf6d683f4c275877a985d06f3bd2e379952	2026-09-04 15:49:54.359786+00
0045_restore_routine_parity.sql	05f28c712f4b2fa9fe2963d2b3f34a40b7639ffbf479a6f913010957399fba90	2026-09-04 15:49:54.359786+00
0046_seed_quick_login_supporter.sql	9a3f100d9f7830fd9041da7e98e4238c2a9e40c6409efa6e7d7a55de7466894b	2026-09-04 15:49:54.359786+00
0046_seed_volunteer_categories.sql	84521bd041055e1c6dc90da2a32b70d56c3e168c5b0aabd82017300e4e232ff7	2026-09-04 15:49:54.359786+00
0047_email_body_blocks.sql	393d1fb7b1035e36f9cab7ff1da64e5495ea02663c0441c0f0cbe6edfde6da53	2026-09-04 15:49:54.359786+00
0047_email_brand_settings.sql	79924cbd0b3eb5f284f793b9f087eef6bc4c6bb6c628ba2315a0491b9c85c28c	2026-09-04 15:49:54.359786+00
0048_email_body_blocks_check.sql	1a5c292cee7339b14b82f3db78e42cc88b9e7b200ca2399a4983916133253811	2026-09-04 15:49:54.359786+00
0049_site_settings.sql	0158e7911077f19a5cb69c5897afbd352ab5cfe92359a804ac1b0b0f1e12fff6	2026-09-04 15:49:54.359786+00
0050_protect_account_email_identity.sql	e1bbab8aefb8c6cd07b161951ef876a38d97815b60ea29fd0ea75ab431b0b892	2026-09-04 15:49:54.359786+00
0051_enforce_normalized_people_email.sql	9e74d99db0bacf01e2f9c25ea2c76c2c9d8ee3d409858eaebb6d49bad9d01cb7	2026-09-04 15:49:54.359786+00
0052_admin_organization_context.sql	75068c8efa2bcac9623e05738931c4b4123127bf23f9c6670ff80bd7020ebcd0	2026-09-04 15:49:54.359786+00
0052_publish_alliance_volunteer_needs.sql	0c46d12deb65a341e520a35a13f86c68f9c3abf14c67efc3d8aabbb020e954d4	2026-09-04 15:49:54.359786+00
0053_harden_admin_organization_context.sql	e10af940a1ad7fb4811adc1dd1bc216f0ce5968bc306f4410738d8ea3f814a47	2026-09-04 15:49:54.359786+00
0054_revoke_context_when_organization_disabled.sql	e1161215d3474572ba36d4372c91b3513fd0c04662d871731d6e631724ea5ae2	2026-09-04 15:49:54.359786+00
0055_admin_participation_indexes.sql	2b3acfc2cbbd1cfa918214ba985156041104060acbfc50f4e82db2b540da6c51	2026-09-04 15:49:54.359786+00
0055_admin_supporter_directory.sql	ccc577a88f866574a3b6f1c945999dc037b3c56aa93536c30bfb2bd99b37c0ea	2026-09-04 15:49:54.359786+00
0055_allow_confirmed_profile_email_change.sql	e4bfc740073213ef8e2b1b837ec7c66ad5a895733b78f8be3ab5b8e7d4d47b3d	2026-09-04 15:49:54.359786+00
0055_organization_revisions.sql	675c4d89f67c74a8555f67866fd7d2decf4b0e1ef903ace5371ea730fdb22582	2026-09-04 15:49:54.359786+00
0056_default_deny_account_email_change.sql	5ab84674469ef3ac79c9e85bfb449f9a2b5098ef27a38162fe038573ae0700a9	2026-09-04 15:49:54.359786+00
0056_enable_organization_revisions_rls.sql	2bd93e968a223e8118cef69a10e7a47a8f2e422a939cba52b78d7f3d9c52c0bb	2026-09-04 15:49:54.359786+00
0057_storage_cleanup_queue.sql	c6564ab0e176e0363f73e62dde6294cd7904e98756ba9367a44afc38e0bb7615	2026-09-04 15:49:54.359786+00
0058_manage_participation.sql	cf41509490c5e58a0e9ef02358da4c30eeca0f270132d5ffa3e260be9390e71e	2026-09-04 15:49:54.359786+00
0059_participation_activity_events.sql	cd3fe48157b8277e334ca709ca6f22cce2bb9699acc6227aacd4785a351f99e3	2026-09-04 15:49:54.359786+00
0060_participation_timestamp_precision.sql	02251de0e9dea3a2738ad6f8e5ec623e604c50e84decb9fdd8fa1df0d8697b98	2026-09-04 15:49:54.359786+00
0061_harden_participation_management.sql	2912ea21c65dc314618bba697f24d521498048860bddf374c060d0788eba8f7c	2026-09-04 15:49:54.359786+00
0062_reconcile_item_request_after_management.sql	e1ec28b9f572fc5bf9f4e1849f7a27e46f20958f42a349f0b796ca0e17f741d7	2026-09-04 15:49:54.359786+00
0063_image_generation_setting.sql	585eb7c0c67ea67b0aefff867c1acf093e2fcf64dc741793999f3c78144bfa57	2026-09-04 20:31:59.863515+00
0057_admin_contacts.sql	88607ea19a280b64b2b01150e3540b0c9fc05ce60c1fc6d06d09a300c00426c8	2026-09-05 19:58:07.433685+00
0064_publish_alliance_physical_needs.sql	6e528bdc55b9fae3a07520268df063dde068075765548be53613e23f9dacf6e6	2026-09-07 17:05:39.6604+00
0065_enforce_alliance_physical_need_rls.sql	0a79af40527f4893e595e051246168f6726ff7773d62974b92e102350373d7fa	2026-09-07 17:05:39.6604+00
0066_align_physical_need_visibility_and_pledges.sql	8bb4bf29189f17aa73aac919bc45ad9622c0f0fdd20521f7fb08f66c87724a9e	2026-09-07 17:05:39.6604+00
0067_force_row_level_security.sql	adf7d5a45c4a543d09718107ddd780234ecb5fcc967a980d0995896eee933b3c	2026-09-10 00:34:54.768324+00
\.


--
-- Data for Name: session; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.session (id, "expiresAt", token, "createdAt", "updatedAt", "ipAddress", "userAgent", "userId") FROM stdin;
S0VRJsFYKHI7jPdz8Okb840562HW1xJk	2026-09-11 15:50:29.485	eKKJPQy0aBf69Skg05FKEm9aZTcHVCQc	2026-09-04 15:50:29.485	2026-09-04 15:50:29.485	127.0.0.1		m0TQRWG9eQYoNuEkqsTujNQpAu0bzlGo
2dwHVrIPpf7Drc7yrCHvlOZvWRp8lEXE	2026-09-11 15:50:46.233	IQ4ZL0ZQ2loRMKM3WEiBFbdc0uwVKb6T	2026-09-04 15:50:46.233	2026-09-04 15:50:46.233			m0TQRWG9eQYoNuEkqsTujNQpAu0bzlGo
EejMms4D8fq2fi8F0nRMs5iYnPKLUBT1	2026-09-11 15:50:46.303	Qk7cxt68g4wA6763TQDjD4Jy45mVwuh3	2026-09-04 15:50:46.303	2026-09-04 15:50:46.303			kvmCv3a2oIIXRqEwSGPdXzl1uKPeqbZ4
BxT4f4YXmuiwafqZo0za5FjNFXHetyUx	2026-09-11 15:50:46.344	6vU6QH3dxKf2PYZVl5S5NNi0IVms2b3g	2026-09-04 15:50:46.345	2026-09-04 15:50:46.345			vGzMZI0BeNgXB2nEP5tSdhdnGoHCCPxZ
BMNRiURm558qen2PD2VKRo6WplB2JHgm	2026-09-11 15:50:46.379	ZOQZZdhZTxoZuSL9WquS1dOCzOUAdMv1	2026-09-04 15:50:46.379	2026-09-04 15:50:46.379			7R9IIMxjMQa2TXKTG34OBo89jl18OOpD
ojqHlcoRwDEByaum5XlC0HiBf92gkJDn	2026-09-11 15:51:03.947	FBxKnD2O6Np6ZYwGwCTsNuYP9bJwJB9p	2026-09-04 15:51:03.947	2026-09-04 15:51:03.947	127.0.0.1		m0TQRWG9eQYoNuEkqsTujNQpAu0bzlGo
GYNkkFFv1cKIMG8gqUtMz1oDJI77QhLy	2026-09-11 15:51:03.95	K1D6OLhSMmcIiU3mjy5DNu3equ6VTkQh	2026-09-04 15:51:03.95	2026-09-04 15:51:03.95	127.0.0.1		kvmCv3a2oIIXRqEwSGPdXzl1uKPeqbZ4
7iTxLbtpmwf7gi5K9F2K6nY1iu1sSPdj	2026-09-11 15:51:03.957	94sgxX758fbTg5N0HwPKFafgJ8HOQwLF	2026-09-04 15:51:03.957	2026-09-04 15:51:03.957	127.0.0.1		vGzMZI0BeNgXB2nEP5tSdhdnGoHCCPxZ
7NRVCtliWQN6x54jy00Xhoa4A2KBMJzQ	2026-09-11 15:51:05.406	ax0rJi6pJokuZYCd7asqAJcxb2XQUxzw	2026-09-04 15:51:05.406	2026-09-04 15:51:05.406	127.0.0.1		m0TQRWG9eQYoNuEkqsTujNQpAu0bzlGo
Fg7bJO2nKhGYkW2ShgPtTT6Cw8cPaMiV	2026-09-11 15:51:05.438	MJtR1pe7WKydlEzcAXkB6yBNGaggxsb5	2026-09-04 15:51:05.438	2026-09-04 15:51:05.438	127.0.0.1		kvmCv3a2oIIXRqEwSGPdXzl1uKPeqbZ4
fMmQNirpZeLUYCYzt4MFT519DpH1yma7	2026-09-11 15:51:05.511	ldvdqM8EwjmF1OFJZnf4Xt6ViJySVToA	2026-09-04 15:51:05.511	2026-09-04 15:51:05.511	127.0.0.1		vGzMZI0BeNgXB2nEP5tSdhdnGoHCCPxZ
YNxLebfxRy69qT2ya4V3u2mhwqcK3Zbu	2026-09-11 15:51:05.553	Ik6NcI5jBHVFnilnu2PaX5KTICbqi7Kk	2026-09-04 15:51:05.553	2026-09-04 15:51:05.553	127.0.0.1		7R9IIMxjMQa2TXKTG34OBo89jl18OOpD
eMWL5KXZEt4Q8j1b3jz1phfc8onkLNeZ	2026-09-11 15:51:05.59	cwCE6p5xQwgOX1LgtJCdobLX9t0VvgwO	2026-09-04 15:51:05.59	2026-09-04 15:51:05.59	127.0.0.1		7R9IIMxjMQa2TXKTG34OBo89jl18OOpD
XmCf58tCcwG1ziVwKPUtitfFc6DUTRhR	2026-09-11 16:03:03.996	CkZylFlVII7nIixY73aUEbHH6Gj8Fs5y	2026-09-04 16:03:03.996	2026-09-04 16:03:03.996	127.0.0.1		m0TQRWG9eQYoNuEkqsTujNQpAu0bzlGo
UAyZOGZBaa5HNXJFrqDJbPQt0N4tRYWn	2026-09-11 16:03:05.62	bMYikfrqU3dxPd2juYCu2WXZBaD7d9pD	2026-09-04 16:03:05.62	2026-09-04 16:03:05.62	127.0.0.1		m0TQRWG9eQYoNuEkqsTujNQpAu0bzlGo
4EYB0noeM3FZvEz6Ab3e4roRBZ9iY7gx	2026-09-12 02:36:52.834	dfbFqEMkHwBWsw1jBUmAUY1FhQSRfmOh	2026-09-05 02:36:52.835	2026-09-05 02:36:52.835			m0TQRWG9eQYoNuEkqsTujNQpAu0bzlGo
5nZ421dj0dP7SzJzHT9Yf5gdkz7bc9Uc	2026-09-12 02:36:52.859	hy5n9fwbsJ98Es29IdDXg0NHyH4hAaEv	2026-09-05 02:36:52.859	2026-09-05 02:36:52.859	127.0.0.1		m0TQRWG9eQYoNuEkqsTujNQpAu0bzlGo
RMrblfY91Xmg86uCpsc6diSfhZ0wAAbn	2026-09-12 02:36:52.953	vUn1soP81MDo6N1mjuUbmpElA1rw79Pe	2026-09-05 02:36:52.953	2026-09-05 02:36:52.953			kvmCv3a2oIIXRqEwSGPdXzl1uKPeqbZ4
BLtr1mw0Ec5LGPhOHHyrzVw1VmJGToiO	2026-09-12 02:36:52.991	Kg4pGG15wIz2uewmasSv5ortWGZxCyjD	2026-09-05 02:36:52.991	2026-09-05 02:36:52.991			vGzMZI0BeNgXB2nEP5tSdhdnGoHCCPxZ
IGiONkxTCjUyFzLMVoCoD6oCXPgUYpfZ	2026-09-12 02:36:53.028	mfpZDmIuEsqtDMnZIFWesRyLr0tlP7rd	2026-09-05 02:36:53.028	2026-09-05 02:36:53.028			7R9IIMxjMQa2TXKTG34OBo89jl18OOpD
URTNTvQmLQFltgSHd5Q0aJWRsytWI3Fw	2026-09-12 19:36:19.219	XLPdl4nBPxCPLjMF1Pwx1vEGbw7R79HV	2026-09-05 19:36:19.22	2026-09-05 19:36:19.22			m0TQRWG9eQYoNuEkqsTujNQpAu0bzlGo
Nb3sOuHjo4R5x92sr9yK8dPyVwSCwaWb	2026-09-12 19:36:19.23	0aj0T0SIndhJgVPR8npLKjZFPK8AYHkO	2026-09-05 19:36:19.23	2026-09-05 19:36:19.23	127.0.0.1		m0TQRWG9eQYoNuEkqsTujNQpAu0bzlGo
oHU67uu0LUB84FgXZ2PPNFwOWl4Cl74G	2026-09-12 19:36:19.332	IQrnrH9fAU6pph9IpHsLFrcMMBmoKpw0	2026-09-05 19:36:19.333	2026-09-05 19:36:19.333			kvmCv3a2oIIXRqEwSGPdXzl1uKPeqbZ4
GVQ7Yio1gnZuUVrltI862IKGIyycSwja	2026-09-12 19:36:19.367	8YjsuHKBTEZNM4SoImNuGAgGlSMVhhjA	2026-09-05 19:36:19.367	2026-09-05 19:36:19.367			vGzMZI0BeNgXB2nEP5tSdhdnGoHCCPxZ
EPWtJYA0aEnZP1cwv4DAn4XNBvrfbJKA	2026-09-12 19:36:19.398	YAGWaNSApLjU1ThQhoG6kamy8Fcfy3z7	2026-09-05 19:36:19.398	2026-09-05 19:36:19.398			7R9IIMxjMQa2TXKTG34OBo89jl18OOpD
YWPSp53WVZyq9WHIM9vNIwYlbjx8q6Am	2026-09-13 01:36:22.934	8PiQZoC4Sj5RFIyQkeZu6NIHB5HrR6fF	2026-09-06 01:36:22.935	2026-09-06 01:36:22.935			m0TQRWG9eQYoNuEkqsTujNQpAu0bzlGo
RtSU4EGStqQU0GP3jZVsYyvEkuhQbyeJ	2026-09-13 01:36:22.945	MufRH89Lq2fLTnmmOynD2iFoFp44ma1m	2026-09-06 01:36:22.945	2026-09-06 01:36:22.945	127.0.0.1		m0TQRWG9eQYoNuEkqsTujNQpAu0bzlGo
t11el8OmCVn1X08atkRYTzqQUVcuTrL2	2026-09-13 01:36:23.031	j6pucVtE1rha7k7XHIcJlmdbCbB3SlED	2026-09-06 01:36:23.031	2026-09-06 01:36:23.031			kvmCv3a2oIIXRqEwSGPdXzl1uKPeqbZ4
z5ql3XJm6DZf55H2lBXezBG1UJM9MFxC	2026-09-13 01:36:23.079	GSZ9bMwXdZwU8xh2djRM8ZXWy0b9kNS3	2026-09-06 01:36:23.079	2026-09-06 01:36:23.079			vGzMZI0BeNgXB2nEP5tSdhdnGoHCCPxZ
yu84jvC8kb9I6FD4ZQFfTMQVXPXAMapm	2026-09-13 01:36:23.116	QFv4P7bnH13nCK0LyqILUVrIBaNRImD1	2026-09-06 01:36:23.116	2026-09-06 01:36:23.116			7R9IIMxjMQa2TXKTG34OBo89jl18OOpD
HY7pQeGkpWmJ4h3sYmp98a67MPyGNwv3	2026-09-13 05:36:38.636	Zodpv0NLSTivACvGsYgFt75iW6z7jVLc	2026-09-06 05:36:38.636	2026-09-06 05:36:38.636			m0TQRWG9eQYoNuEkqsTujNQpAu0bzlGo
6QO9bJlHNpWHtYOTsi5mGVbcFZTrpttb	2026-09-13 05:36:38.739	38WDN4nY6XTbt8PsZYksxfWfXR2Wu084	2026-09-06 05:36:38.739	2026-09-06 05:36:38.739			kvmCv3a2oIIXRqEwSGPdXzl1uKPeqbZ4
ZvX9n5e56Ktmkc5ERfpIda7siglkxEtF	2026-09-13 05:36:38.744	2nH7s0QHroJRFgVoSvEaamfSLYCrNklD	2026-09-06 05:36:38.744	2026-09-06 05:36:38.744	127.0.0.1		m0TQRWG9eQYoNuEkqsTujNQpAu0bzlGo
LPeaL2WDVJQXW8sSdI1KlAOJK1esbrI7	2026-09-13 05:36:38.774	X06dLIRU3dt8sf8PDIJjHquvNcMYjQ9N	2026-09-06 05:36:38.774	2026-09-06 05:36:38.774			vGzMZI0BeNgXB2nEP5tSdhdnGoHCCPxZ
FVueIE4vQSuPc9xksThZ9wccfawSHvdT	2026-09-13 05:36:38.805	yUcgvnGOqGcnKXOkgrOhIGVzI7fO5Z0F	2026-09-06 05:36:38.805	2026-09-06 05:36:38.805			7R9IIMxjMQa2TXKTG34OBo89jl18OOpD
Nu2sfKZIFII4zR9EoqJcZIOfRxGGXKk3	2026-09-13 06:58:51.72	EQyGfJ4aACKBsrox9HK0PZuDwqB1GRp9	2026-09-06 06:58:51.721	2026-09-06 06:58:51.721			m0TQRWG9eQYoNuEkqsTujNQpAu0bzlGo
0y9uocRrwnIoQIytPudS3FUNsW6yx3iG	2026-09-13 06:58:51.728	SzpOqbBm8I2yc7M8zvIgzeUvhjkDADNA	2026-09-06 06:58:51.728	2026-09-06 06:58:51.728	127.0.0.1		m0TQRWG9eQYoNuEkqsTujNQpAu0bzlGo
2bZeypMsZNYOeNUvkJtqEonPV5IZMtIJ	2026-09-13 06:58:51.815	xX6iErrqIjBpUdcObVL2Kg1lul49JJQO	2026-09-06 06:58:51.815	2026-09-06 06:58:51.815			kvmCv3a2oIIXRqEwSGPdXzl1uKPeqbZ4
0zrdCnYaE6kW9drW5jF7ZICyAmFytu4i	2026-09-13 06:58:51.849	2faQS4KMGkCJNvw6hUB9EdNwlTtqo8cm	2026-09-06 06:58:51.849	2026-09-06 06:58:51.849			vGzMZI0BeNgXB2nEP5tSdhdnGoHCCPxZ
sMTtAyub1OCDmzYC0u6w74SEriMnHP7c	2026-09-13 06:58:51.877	3gNiSukmGkISXigob72gWgT3cBlvXIo8	2026-09-06 06:58:51.877	2026-09-06 06:58:51.877			7R9IIMxjMQa2TXKTG34OBo89jl18OOpD
mIAkp78kQTJDljcxYc4VGj480BPfgQLH	2026-09-13 08:00:20.338	5ZSlhWkmJ9vR7evtINOElmga12RbUGqG	2026-09-06 08:00:20.339	2026-09-06 08:00:20.339			m0TQRWG9eQYoNuEkqsTujNQpAu0bzlGo
GAmK5WEkNpelbupQVk37N9x6a695xU79	2026-09-13 08:00:20.363	WICDkjxW8sXIdrzXX6UdCM4ApVsOvfwx	2026-09-06 08:00:20.363	2026-09-06 08:00:20.363	127.0.0.1		m0TQRWG9eQYoNuEkqsTujNQpAu0bzlGo
qqP3rzxWPdYH9DwrBQR3dXJRwRr6dKpN	2026-09-13 08:00:20.477	DRB0s45mwLsD5fxGvWjI2am8lsecGocB	2026-09-06 08:00:20.477	2026-09-06 08:00:20.477			kvmCv3a2oIIXRqEwSGPdXzl1uKPeqbZ4
goN51AP21JNOFk4L7q2h35MpNEkuqMKV	2026-09-13 08:00:20.524	neDI8gagvW2GGQwNTar3j8yBbQLTjX2y	2026-09-06 08:00:20.524	2026-09-06 08:00:20.524			vGzMZI0BeNgXB2nEP5tSdhdnGoHCCPxZ
zLjiC97XaC3AbIdXZqOjL3h2sxQUapga	2026-09-13 08:00:20.575	Qt6uGKRBtCrd4IFIrD7xrxdUOfNcGqAG	2026-09-06 08:00:20.575	2026-09-06 08:00:20.575			7R9IIMxjMQa2TXKTG34OBo89jl18OOpD
wwjlBa2Gl4moG97InV2jJffEGTAEDr6F	2026-09-13 13:36:33.342	tpQpNpFFL3vjTVppHFtMsJIrOkx2Xzoh	2026-09-06 13:36:33.342	2026-09-06 13:36:33.342			m0TQRWG9eQYoNuEkqsTujNQpAu0bzlGo
TUNeCzSr3H5Qjo6tGntLux7JyO5Ruwr5	2026-09-13 13:36:33.37	nz42wfYYzGoc9GexJ3dKmzaI1vJYeSoJ	2026-09-06 13:36:33.371	2026-09-06 13:36:33.371	127.0.0.1		m0TQRWG9eQYoNuEkqsTujNQpAu0bzlGo
Owcw0Gw6hlWwgVjWjvvOuTxe9vAqeOuT	2026-09-13 13:36:33.48	TcF0WC5Srub0OOPnQkcU0rhKIShEttTL	2026-09-06 13:36:33.48	2026-09-06 13:36:33.48			kvmCv3a2oIIXRqEwSGPdXzl1uKPeqbZ4
b05040ExK5nfUc01IEJdWf6shmM2pdgY	2026-09-13 13:36:33.529	ljQEKlIk4awyjMTZRlQPsP7xsA3A5grG	2026-09-06 13:36:33.53	2026-09-06 13:36:33.53			vGzMZI0BeNgXB2nEP5tSdhdnGoHCCPxZ
6bI6Q6pW6kByH6UxpdxJMHH67zAw0bMH	2026-09-13 13:36:33.574	BeQjHSAGKm9DNbK7DNWnRm02gtSD324R	2026-09-06 13:36:33.574	2026-09-06 13:36:33.574			7R9IIMxjMQa2TXKTG34OBo89jl18OOpD
BcuASErYqc0hXfjtpGM05gccm10f9aHl	2026-09-14 01:36:39.142	kqWOymub5QOw65WAYrxEie20Kb36geK8	2026-09-07 01:36:39.143	2026-09-07 01:36:39.143			m0TQRWG9eQYoNuEkqsTujNQpAu0bzlGo
zlGjiFp9VaqDTRTKSGMTcU3MoS7EzezH	2026-09-14 01:36:39.191	GcaXTWwfJ3SBYwajwVQhYmaVG9tDgfvp	2026-09-07 01:36:39.191	2026-09-07 01:36:39.191	127.0.0.1		m0TQRWG9eQYoNuEkqsTujNQpAu0bzlGo
In7p5GHdpIKWpLKygMaMw9tgijPL6lHP	2026-09-14 01:36:39.265	tOcQfUVtHTSfu9T2vTZQ4gNzFt3EEQiM	2026-09-07 01:36:39.265	2026-09-07 01:36:39.265			kvmCv3a2oIIXRqEwSGPdXzl1uKPeqbZ4
K5RDzs5KxODjjPS8nr3UN9XJy1LaF8GP	2026-09-14 01:36:39.359	MRH1viFZ4Rf6IpL927fikVzMeS3q4Rmd	2026-09-07 01:36:39.359	2026-09-07 01:36:39.359			vGzMZI0BeNgXB2nEP5tSdhdnGoHCCPxZ
3Okw0D6ulmLXxylRaBUsqz8h1bMIqQX6	2026-09-14 01:36:39.416	ltSLjRRKMO4o8NQ68t5WCIVaWKbr9n78	2026-09-07 01:36:39.416	2026-09-07 01:36:39.416			7R9IIMxjMQa2TXKTG34OBo89jl18OOpD
pFZNi7yeHgLmcKbg3UtiVXCVMfCJMk51	2026-09-14 09:12:18.112	JVMqHks22Bk8lfz3hA8QhafAnafmIIdj	2026-09-07 09:12:18.113	2026-09-07 09:12:18.113			m0TQRWG9eQYoNuEkqsTujNQpAu0bzlGo
IhtrMWwI5rv6BJUsx1lXMfFcNb5sHOi8	2026-09-14 09:12:18.151	dhOXBMBLTgZUPJ2lcARWIQC36U37zFaE	2026-09-07 09:12:18.151	2026-09-07 09:12:18.151	127.0.0.1		m0TQRWG9eQYoNuEkqsTujNQpAu0bzlGo
GxIsbmIvREKjjURFoZ6H7jciZ63ZR0A1	2026-09-14 09:12:18.251	poIQYHJjTafq4dq3FbWyWoul2YViWxlg	2026-09-07 09:12:18.251	2026-09-07 09:12:18.251			kvmCv3a2oIIXRqEwSGPdXzl1uKPeqbZ4
vc0bAG97L8shoc2hj1UoTTZ1QkyrPxPQ	2026-09-14 09:12:18.284	QbNfknNswxOkEUZtuPfF0aGV2DMSDg0Z	2026-09-07 09:12:18.284	2026-09-07 09:12:18.284			vGzMZI0BeNgXB2nEP5tSdhdnGoHCCPxZ
tk790xYzrF593s3fChxM14iQXJCWzwnY	2026-09-14 09:12:18.332	raqcQYvpduwKONqc3rkUmsL03lKQIqfm	2026-09-07 09:12:18.332	2026-09-07 09:12:18.332			7R9IIMxjMQa2TXKTG34OBo89jl18OOpD
barcacojhNCMK35NO1nwjZDRPgUlMG7m	2026-09-14 15:39:52.034	JuoK3o9FVHzxmSSVp5npAXqVh6RQsO2e	2026-09-07 15:39:52.035	2026-09-07 15:39:52.035			m0TQRWG9eQYoNuEkqsTujNQpAu0bzlGo
YFw6QTV9HL3k5gVhUfUtbCU40adMpyUF	2026-09-14 15:39:52.053	4m9R6NnYo79IndS1tGOZySykjdOHu0i7	2026-09-07 15:39:52.053	2026-09-07 15:39:52.053	127.0.0.1		m0TQRWG9eQYoNuEkqsTujNQpAu0bzlGo
QaC1j91SQ9mQVurRfQGfP9vY5ofoM9nq	2026-09-14 15:39:52.159	PowJWuQtAxJmTNPWVmvFXeyRNSlJAaOB	2026-09-07 15:39:52.159	2026-09-07 15:39:52.159			kvmCv3a2oIIXRqEwSGPdXzl1uKPeqbZ4
nxW50aqoPj0daeKWS98FO1QcqtxmdSnn	2026-09-14 15:39:52.211	eaQkE5mggYFmxKgcfQJS3J26xFUWIUy9	2026-09-07 15:39:52.211	2026-09-07 15:39:52.211			vGzMZI0BeNgXB2nEP5tSdhdnGoHCCPxZ
hynx3o2QupdMaAGN7OSJCYRS5f1Xa0ik	2026-09-14 15:39:52.256	S3p8aGROD7HEpLF8l1OGarYCB5HfdqNt	2026-09-07 15:39:52.256	2026-09-07 15:39:52.256			7R9IIMxjMQa2TXKTG34OBo89jl18OOpD
Zcbh1ukPZqzBxZQaEpnddu1DY6CEX8Gl	2026-09-14 19:36:45.64	5tKx5zo6JkDw2RqUapt6crwUWxBS1qlS	2026-09-07 19:36:45.64	2026-09-07 19:36:45.64			m0TQRWG9eQYoNuEkqsTujNQpAu0bzlGo
OSB7vZoouiANg3zaiPbdaVhhou1LTPG1	2026-09-14 19:36:45.652	HdXMpSdsmx7SeZxHDEQp3CEgtuvZykwh	2026-09-07 19:36:45.652	2026-09-07 19:36:45.652	127.0.0.1		m0TQRWG9eQYoNuEkqsTujNQpAu0bzlGo
01bilrX7fbAsFlfbyWuSiJkMGBRMbk4A	2026-09-14 19:36:45.754	0kX2mqmxZL3FQZKSejO1sJ7qowVkegPQ	2026-09-07 19:36:45.754	2026-09-07 19:36:45.754			kvmCv3a2oIIXRqEwSGPdXzl1uKPeqbZ4
u2MbCnvZa9VXsMJ6pwYsPlRafpCTn9bJ	2026-09-14 19:36:45.801	Uat7deyddD3kZFXWjh9t4WWI1N9nJk7E	2026-09-07 19:36:45.802	2026-09-07 19:36:45.802			vGzMZI0BeNgXB2nEP5tSdhdnGoHCCPxZ
dNrxOTEiuD9NyBY8bgsjRNahwaD0JCf3	2026-09-14 19:36:45.841	2AReoeSHvy3L0mtl68XD2JoKuMaOT04a	2026-09-07 19:36:45.841	2026-09-07 19:36:45.841			7R9IIMxjMQa2TXKTG34OBo89jl18OOpD
h9k88O496nrTTmzAH5wHGLWK9RWckdLl	2026-09-15 17:16:10.083	ri8vM91OVOIm8VoJ8GJ3IPSCh3t7DFNP	2026-09-04 15:57:10.189	2026-09-08 17:16:10.083	127.0.0.1		m0TQRWG9eQYoNuEkqsTujNQpAu0bzlGo
Ii1Ud5TFZuTIxNXQ6iAj2RZXlLuUpp5w	2026-09-15 17:16:11.834	sYpYWbwgR8q318eQpVquAZyOqn5Fx15K	2026-09-08 17:16:11.835	2026-09-08 17:16:11.835			m0TQRWG9eQYoNuEkqsTujNQpAu0bzlGo
1I42MeZ0pkxFH7obtpNtb5SCcVMMEVWf	2026-09-15 17:16:11.929	Y2M8etybDSr13nIr8hYRMqHmCVb3gDMB	2026-09-08 17:16:11.929	2026-09-08 17:16:11.93	127.0.0.1		m0TQRWG9eQYoNuEkqsTujNQpAu0bzlGo
lzyXbMPn33Gk1Wo9HqGi5U6x1v84dB8v	2026-09-15 17:16:11.973	1WoLv8vjWq5y576BCyT93Ty9Bi0W3WTj	2026-09-08 17:16:11.973	2026-09-08 17:16:11.973			kvmCv3a2oIIXRqEwSGPdXzl1uKPeqbZ4
eC00Z1zzHUTQrG0CRE0n11M3zr8LVzMn	2026-09-15 17:16:12.008	MDgZRsT9cofya6oAYjad8gifGBzkoapo	2026-09-08 17:16:12.008	2026-09-08 17:16:12.008			vGzMZI0BeNgXB2nEP5tSdhdnGoHCCPxZ
PGppA9aqhtgCgDzZX0z5CW10FWtCBgwf	2026-09-15 17:16:12.038	wFVIU6IpifhC8Ehry7Lx2LdYkcbHeXat	2026-09-08 17:16:12.038	2026-09-08 17:16:12.038			7R9IIMxjMQa2TXKTG34OBo89jl18OOpD
\.


--
-- Data for Name: site_settings; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.site_settings (id, site_name, contact_email, response_time_language, updated_at, updated_by, image_generation_enabled) FROM stdin;
1	Love in Action Database	info@defendingthecause.org	1-3 business days	\N	\N	f
\.


--
-- Data for Name: storage_cleanup_queue; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.storage_cleanup_queue (id, object_url, reason, attempts, last_error, next_attempt_at, created_at) FROM stdin;
\.


--
-- Data for Name: supporter_admin_audit; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.supporter_admin_audit (id, actor_user_id, target_user_id, context_id, action, outcome, details, created_at) FROM stdin;
\.


--
-- Data for Name: supporter_impersonation_contexts; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.supporter_impersonation_contexts (id, admin_user_id, supporter_user_id, started_at, expires_at, ended_at, end_reason) FROM stdin;
\.


--
-- Data for Name: user; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public."user" (id, name, email, "emailVerified", image, "createdAt", "updatedAt") FROM stdin;
m0TQRWG9eQYoNuEkqsTujNQpAu0bzlGo		tiffany@defendingthecause.org	t	\N	2026-09-04 15:50:29.479	2026-09-04 15:50:29.479
kvmCv3a2oIIXRqEwSGPdXzl1uKPeqbZ4		approver@thealliance.example.org	t	\N	2026-09-04 15:50:46.291	2026-09-04 15:50:46.291
vGzMZI0BeNgXB2nEP5tSdhdnGoHCCPxZ		dana@heartsandhands.example.org	t	\N	2026-09-04 15:50:46.342	2026-09-04 15:50:46.342
7R9IIMxjMQa2TXKTG34OBo89jl18OOpD		supporter@example.org	t	\N	2026-09-04 15:50:46.376	2026-09-04 15:50:46.376
\.


--
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.users (id, person_id, auth_subject, status, last_login_at, created_at, updated_at, kind) FROM stdin;
5836a04f-56a9-4c27-9177-e593c6804fa9	43aed73a-a82e-4083-9d5e-76452faa6a3e	\N	active	\N	2026-09-04 15:49:56.211658+00	2026-09-04 15:49:56.211658+00	member
a679fbfc-3e61-4484-b322-6c0ddfb942ea	d47c25c9-9e0e-45be-840d-b0dcbe75e551	\N	active	\N	2026-09-04 15:49:56.265979+00	2026-09-04 15:49:56.265979+00	member
d3aa047c-714b-48fc-83a7-47cdee08e374	d7ee4728-0c19-48e8-bcc0-462c09de2e50	\N	active	\N	2026-09-04 15:49:56.271628+00	2026-09-04 15:49:56.271628+00	member
96a9e916-d1d5-43cb-9317-34aeb60a52a2	44c5ffbc-d8ea-47b8-9bde-d54a636d7108	\N	invited	\N	2026-09-04 15:49:56.276952+00	2026-09-04 15:49:56.276952+00	member
d7b85b9f-20b6-4ecc-8e76-7cd9b44674bd	a9e7a159-ce7b-4b57-8938-3c32409ea614	m0TQRWG9eQYoNuEkqsTujNQpAu0bzlGo	active	2026-09-08 17:16:11.937106+00	2026-09-04 15:49:56.206197+00	2026-09-08 17:16:11.937106+00	member
a390dd25-6daa-4061-a6fc-2e3dac327aab	d4ea664d-25d3-4818-adae-3d679d0ab910	kvmCv3a2oIIXRqEwSGPdXzl1uKPeqbZ4	active	2026-09-08 17:16:11.982433+00	2026-09-04 15:49:56.217521+00	2026-09-08 17:16:11.982433+00	member
1b20f969-a37c-4d29-bb39-972610f29036	0e034298-2ed0-42fa-a269-44fee2679ba8	vGzMZI0BeNgXB2nEP5tSdhdnGoHCCPxZ	active	2026-09-08 17:16:12.014282+00	2026-09-04 15:49:56.26131+00	2026-09-08 17:16:12.014282+00	member
f98d80c1-2618-41b3-86cc-e457383d9f00	f6f198d2-fdcc-4f98-bf60-2454b400c36f	7R9IIMxjMQa2TXKTG34OBo89jl18OOpD	active	2026-09-08 17:16:12.044981+00	2026-09-04 15:49:54.359786+00	2026-09-08 17:16:12.044981+00	supporter
\.


--
-- Data for Name: verification; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.verification (id, identifier, value, "expiresAt", "createdAt", "updatedAt") FROM stdin;
\.


--
-- Data for Name: volunteer_alert_preferences; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.volunteer_alert_preferences (user_id, enabled, unsubscribe_token, enabled_at, disabled_at, updated_at) FROM stdin;
\.


--
-- Data for Name: volunteer_categories; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.volunteer_categories (id, name, is_active) FROM stdin;
060994ba-00c6-4833-ba8e-278c76cca527	Administrative Support	t
3fb87abd-882c-4582-9627-ac28747ee2ac	Child Care & Family Support	t
54369d5d-eb5b-4f07-8098-6e4eaa005326	Event & Outreach Support	t
03add5a6-19de-4e18-912e-9a37ec317f63	Foster Care & Respite	t
754352ac-0f73-4f14-9f36-a6c3c6891393	Hands-On Projects & General Help	t
80ee9157-d1f7-402f-8fc1-ea19020fb98f	Kids' Camp Counselor / Help	t
ba4d24cf-7cfa-47cb-9775-6b60635f6421	Mentoring & Relationship Building	t
43a849e3-e636-4a21-adcc-5cc5ad4492bb	Ranch Help	t
c645e442-9044-4969-95fd-954968bf9664	Skilled & Professional Services	t
1ad307dc-0890-4b15-99e2-a808b6ef96b1	Sorting, Organizing & Distribution	t
fe238987-dc4b-42c1-b8cc-ba52cef10cf1	Technology & Digital Support	t
a4ecc5e6-10b4-4e91-b6b9-c6d01adb04cb	Transportation & Delivery	t
\.


--
-- Data for Name: volunteer_match_alert_claims; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.volunteer_match_alert_claims (volunteer_request_id, user_id, to_email, claimed_at) FROM stdin;
\.


--
-- Data for Name: volunteer_request_categories; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.volunteer_request_categories (volunteer_request_id, category_id, created_at) FROM stdin;
\.


--
-- Data for Name: volunteer_requests; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.volunteer_requests (id, legacy_wix_id, org_id, title, description, details, event_location, image_url, people_helped, deadline_type, deadline_date, expires_on, contact_person_id, status, submitted_at, approved_at, approved_by, archived_at, archived_reason, created_by, created_at, updated_at, image_generated, image_gen_status, image_gen_error, image_gen_retries) FROM stdin;
22f66b7c-317c-4e0d-a3ab-25a03e7be1e1	\N	04c22dc0-5ba3-4cb4-b89c-2a2f7e8cc7a5	Fall Soccer League Coaches	Coach a team of drop-in center teens for the eight-week fall league.	\N	Maidu Regional Park, Roseville	\N	30	until_fulfilled	\N	\N	d7ee4728-0c19-48e8-bcc0-462c09de2e50	active	2026-09-04 15:49:56.564837+00	2026-09-04 15:49:56.569899+00	a390dd25-6daa-4061-a6fc-2e3dac327aab	\N	\N	d3aa047c-714b-48fc-83a7-47cdee08e374	2026-09-04 15:49:56.551389+00	2026-09-04 15:49:56.569899+00	f	\N	\N	0
6390df82-ae1a-4b3a-ad1d-f5a67cb7d014	\N	f4ab47e3-b36d-4e90-96e9-59971985e17e	Move-In Day Volunteers	Help a newly licensed foster family set up bedrooms before a sibling set arrives.	\N	Roseville (address shared after signup)	\N	4	until_fulfilled	\N	\N	0e034298-2ed0-42fa-a269-44fee2679ba8	active	2026-09-04 15:49:56.592145+00	2026-09-04 15:49:56.595944+00	a390dd25-6daa-4061-a6fc-2e3dac327aab	\N	\N	1b20f969-a37c-4d29-bb39-972610f29036	2026-09-04 15:49:56.577744+00	2026-09-04 15:49:56.595944+00	f	\N	\N	0
d7d7206a-2ec1-4346-8550-70aaa27d5bef	\N	f4ab47e3-b36d-4e90-96e9-59971985e17e	Respite Night Childcare	Draft — background-check requirements being confirmed before this goes live.	\N	Hearts & Hands office, Roseville	\N	20	until_fulfilled	\N	\N	0e034298-2ed0-42fa-a269-44fee2679ba8	draft	\N	\N	\N	\N	\N	1b20f969-a37c-4d29-bb39-972610f29036	2026-09-04 15:49:56.622926+00	2026-09-04 15:49:56.622926+00	f	\N	\N	0
1feedba6-482a-4917-b5df-0cc3ca5bca94	\N	3cf8c6c3-8f2b-4d25-ab16-e9d44364a9b9	Airport Welcome Team	Be the first friendly faces a family sees on arrival night.	\N	Sacramento International Airport	\N	5	until_fulfilled	\N	\N	d47c25c9-9e0e-45be-840d-b0dcbe75e551	pending	2026-09-04 15:49:56.643598+00	\N	\N	\N	\N	a679fbfc-3e61-4484-b322-6c0ddfb942ea	2026-09-04 15:49:56.634709+00	2026-09-04 15:49:56.643598+00	f	\N	\N	0
7a4a1a40-63a4-468e-a3ae-49dfc5a1aa3c	\N	3cf8c6c3-8f2b-4d25-ab16-e9d44364a9b9	ESL Conversation Partners	One hour a week of friendly English conversation with newly arrived adults.	\N	New Horizons community room, Citrus Heights	\N	15	until_fulfilled	\N	2026-09-03	d47c25c9-9e0e-45be-840d-b0dcbe75e551	archived	2026-09-04 15:49:56.612376+00	2026-09-04 15:49:56.616357+00	a390dd25-6daa-4061-a6fc-2e3dac327aab	2026-09-04 15:50:04.802145+00	expired	a679fbfc-3e61-4484-b322-6c0ddfb942ea	2026-09-04 15:49:56.603577+00	2026-09-04 15:50:04.802145+00	f	\N	\N	0
\.


--
-- Data for Name: volunteer_roles; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.volunteer_roles (id, legacy_wix_id, volunteer_request_id, name, description, quantity_needed, quantity_interested, quantity_confirmed, sort_order, created_at, updated_at) FROM stdin;
febf44dd-ae1c-4ec4-8857-95337197bb26	\N	d7d7206a-2ec1-4346-8550-70aaa27d5bef	Childcare volunteer	\N	8	0	0	0	2026-09-04 15:49:56.62701+00	2026-09-04 15:49:56.62701+00
dd892908-5e4a-4792-8a40-86edc3a61fba	\N	1feedba6-482a-4917-b5df-0cc3ca5bca94	Greeter	\N	4	0	0	0	2026-09-04 15:49:56.639826+00	2026-09-04 15:49:56.639826+00
9f557db8-a970-498c-9e4a-54bfb3d125f4	\N	22f66b7c-317c-4e0d-a3ab-25a03e7be1e1	Head Coach	Runs two practices a week plus Saturday games.	2	2	0	0	2026-09-04 15:49:56.556452+00	2026-09-04 15:49:56.704074+00
0191a23e-b211-4152-a389-c7cb921187e8	\N	22f66b7c-317c-4e0d-a3ab-25a03e7be1e1	Assistant Coach	\N	4	1	0	1	2026-09-04 15:49:56.561058+00	2026-09-04 15:49:56.70877+00
0b5b68f1-b842-4e50-b022-83ed30771a1b	\N	6390df82-ae1a-4b3a-ad1d-f5a67cb7d014	Furniture mover	\N	6	2	0	0	2026-09-04 15:49:56.583043+00	2026-09-04 15:49:56.718525+00
f0384f5f-4e1b-4d86-8710-c40faa3705c3	\N	6390df82-ae1a-4b3a-ad1d-f5a67cb7d014	Meal train cook	\N	3	1	0	1	2026-09-04 15:49:56.587483+00	2026-09-04 15:49:56.718525+00
01dfc13c-f8d7-4b1c-b36b-7c629aee9b28	\N	7a4a1a40-63a4-468e-a3ae-49dfc5a1aa3c	Conversation partner	\N	5	2	0	0	2026-09-04 15:49:56.608105+00	2026-09-04 15:49:56.729442+00
\.


--
-- Data for Name: volunteer_signup_roles; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.volunteer_signup_roles (id, volunteer_signup_id, volunteer_role_id) FROM stdin;
1957007f-9aca-46e8-868c-1d591503b8ab	2fa89463-02b7-40d8-b562-e89c953a7ac3	9f557db8-a970-498c-9e4a-54bfb3d125f4
47a01335-894c-4a4b-ac1a-557c2828e5ae	e3af294b-9829-4ca5-a93f-116770511e30	9f557db8-a970-498c-9e4a-54bfb3d125f4
f02faaf3-bfbb-4a85-9845-16851d931a04	08dba0ac-e8bb-4738-9cb6-023506c50e06	0191a23e-b211-4152-a389-c7cb921187e8
461cf916-a6ee-4e43-92c9-3e35cf7e9cd8	3453b222-cd0d-417c-a293-c28189d6a1bb	0b5b68f1-b842-4e50-b022-83ed30771a1b
afe47ad6-41a5-47ac-b724-c4aec0c54f43	b287d052-a4e0-425e-b95c-8d18c61987b0	0b5b68f1-b842-4e50-b022-83ed30771a1b
07c347d3-2bd3-43bc-ab46-3c32f8631f47	b287d052-a4e0-425e-b95c-8d18c61987b0	f0384f5f-4e1b-4d86-8710-c40faa3705c3
cb702fa7-6454-4c86-9160-a21c6c90ede3	80a8c15a-0586-4365-8a6e-99ea8a163ac9	01dfc13c-f8d7-4b1c-b36b-7c629aee9b28
c30f0261-4900-4a46-8db1-26dd2f75583e	67f4eac1-8e35-4985-a380-d60508272c20	01dfc13c-f8d7-4b1c-b36b-7c629aee9b28
\.


--
-- Data for Name: volunteer_signups; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.volunteer_signups (id, legacy_wix_id, person_id, volunteer_request_id, notes, created_at, updated_at, status, cancelled_at, cancelled_by, cancellation_reason, participation_version) FROM stdin;
2fa89463-02b7-40d8-b562-e89c953a7ac3	\N	5ca07dc3-8b4f-4c91-bddd-e643b95e8889	22f66b7c-317c-4e0d-a3ab-25a03e7be1e1	\N	2026-09-04 15:49:56.695859+00	2026-09-04 15:49:56.695+00	active	\N	\N	\N	1
e3af294b-9829-4ca5-a93f-116770511e30	\N	9c7c34e4-4491-4808-8b64-1e049304811d	22f66b7c-317c-4e0d-a3ab-25a03e7be1e1	\N	2026-09-04 15:49:56.704074+00	2026-09-04 15:49:56.704+00	active	\N	\N	\N	1
08dba0ac-e8bb-4738-9cb6-023506c50e06	\N	cf07c136-8d77-4fa0-8f4a-c6294d386f79	22f66b7c-317c-4e0d-a3ab-25a03e7be1e1	\N	2026-09-04 15:49:56.70877+00	2026-09-04 15:49:56.708+00	active	\N	\N	\N	1
3453b222-cd0d-417c-a293-c28189d6a1bb	\N	20b1b06a-5e79-4bf5-bf4b-4f7ef7f15d82	6390df82-ae1a-4b3a-ad1d-f5a67cb7d014	\N	2026-09-04 15:49:56.713709+00	2026-09-04 15:49:56.713+00	active	\N	\N	\N	1
b287d052-a4e0-425e-b95c-8d18c61987b0	\N	42d56245-84c7-4853-9352-47f65f392156	6390df82-ae1a-4b3a-ad1d-f5a67cb7d014	\N	2026-09-04 15:49:56.718525+00	2026-09-04 15:49:56.718+00	active	\N	\N	\N	1
80a8c15a-0586-4365-8a6e-99ea8a163ac9	\N	35cda6c7-421c-4ff6-9237-1746526fb9a8	7a4a1a40-63a4-468e-a3ae-49dfc5a1aa3c	\N	2026-09-04 15:49:56.723402+00	2026-09-04 15:49:56.723+00	active	\N	\N	\N	1
67f4eac1-8e35-4985-a380-d60508272c20	\N	0932eb0e-8a7d-4097-8a63-a96332565cb8	7a4a1a40-63a4-468e-a3ae-49dfc5a1aa3c	\N	2026-09-04 15:49:56.729442+00	2026-09-04 15:49:56.729+00	active	\N	\N	\N	1
\.


--
-- Name: replit_database_migrations_v1_id_seq; Type: SEQUENCE SET; Schema: _system; Owner: neondb_owner
--

SELECT pg_catalog.setval('_system.replit_database_migrations_v1_id_seq', 1, true);


--
-- Name: replit_database_migrations_v1 replit_database_migrations_v1_pkey; Type: CONSTRAINT; Schema: _system; Owner: neondb_owner
--

ALTER TABLE ONLY _system.replit_database_migrations_v1
    ADD CONSTRAINT replit_database_migrations_v1_pkey PRIMARY KEY (id);


--
-- Name: account account_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.account
    ADD CONSTRAINT account_pkey PRIMARY KEY (id);


--
-- Name: admin_organization_contexts admin_organization_contexts_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.admin_organization_contexts
    ADD CONSTRAINT admin_organization_contexts_pkey PRIMARY KEY (id);


--
-- Name: approval_events approval_events_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.approval_events
    ADD CONSTRAINT approval_events_pkey PRIMARY KEY (id);


--
-- Name: contact_admin_audit contact_admin_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.contact_admin_audit
    ADD CONSTRAINT contact_admin_audit_pkey PRIMARY KEY (id);


--
-- Name: digest_exclusions digest_exclusions_need_type_need_id_key; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.digest_exclusions
    ADD CONSTRAINT digest_exclusions_need_type_need_id_key UNIQUE (need_type, need_id);


--
-- Name: digest_exclusions digest_exclusions_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.digest_exclusions
    ADD CONSTRAINT digest_exclusions_pkey PRIMARY KEY (id);


--
-- Name: digest_runs digest_runs_occurrence_key_key; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.digest_runs
    ADD CONSTRAINT digest_runs_occurrence_key_key UNIQUE (occurrence_key);


--
-- Name: digest_runs digest_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.digest_runs
    ADD CONSTRAINT digest_runs_pkey PRIMARY KEY (id);


--
-- Name: digest_subscribers digest_subscribers_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.digest_subscribers
    ADD CONSTRAINT digest_subscribers_pkey PRIMARY KEY (id);


--
-- Name: email_brand_settings email_brand_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.email_brand_settings
    ADD CONSTRAINT email_brand_settings_pkey PRIMARY KEY (id);


--
-- Name: email_log email_log_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.email_log
    ADD CONSTRAINT email_log_pkey PRIMARY KEY (id);


--
-- Name: email_schedules email_schedules_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.email_schedules
    ADD CONSTRAINT email_schedules_pkey PRIMARY KEY (template_key);


--
-- Name: email_template_overrides email_template_overrides_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.email_template_overrides
    ADD CONSTRAINT email_template_overrides_pkey PRIMARY KEY (template_key);


--
-- Name: item_pledge_lines item_pledge_lines_item_pledge_id_item_id_key; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.item_pledge_lines
    ADD CONSTRAINT item_pledge_lines_item_pledge_id_item_id_key UNIQUE (item_pledge_id, item_id);


--
-- Name: item_pledge_lines item_pledge_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.item_pledge_lines
    ADD CONSTRAINT item_pledge_lines_pkey PRIMARY KEY (id);


--
-- Name: item_pledges item_pledges_legacy_wix_id_key; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.item_pledges
    ADD CONSTRAINT item_pledges_legacy_wix_id_key UNIQUE (legacy_wix_id);


--
-- Name: item_pledges item_pledges_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.item_pledges
    ADD CONSTRAINT item_pledges_pkey PRIMARY KEY (id);


--
-- Name: item_requests item_requests_legacy_wix_id_key; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.item_requests
    ADD CONSTRAINT item_requests_legacy_wix_id_key UNIQUE (legacy_wix_id);


--
-- Name: item_requests item_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.item_requests
    ADD CONSTRAINT item_requests_pkey PRIMARY KEY (id);


--
-- Name: items items_id_item_request_id_key; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.items
    ADD CONSTRAINT items_id_item_request_id_key UNIQUE (id, item_request_id);


--
-- Name: items items_legacy_wix_id_key; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.items
    ADD CONSTRAINT items_legacy_wix_id_key UNIQUE (legacy_wix_id);


--
-- Name: items items_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.items
    ADD CONSTRAINT items_pkey PRIMARY KEY (id);


--
-- Name: org_memberships org_memberships_org_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.org_memberships
    ADD CONSTRAINT org_memberships_org_id_user_id_key UNIQUE (org_id, user_id);


--
-- Name: org_memberships org_memberships_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.org_memberships
    ADD CONSTRAINT org_memberships_pkey PRIMARY KEY (id);


--
-- Name: organization_context_actions organization_context_actions_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.organization_context_actions
    ADD CONSTRAINT organization_context_actions_pkey PRIMARY KEY (id);


--
-- Name: organization_populations organization_populations_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.organization_populations
    ADD CONSTRAINT organization_populations_pkey PRIMARY KEY (org_id, population_id);


--
-- Name: organization_revisions organization_revisions_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.organization_revisions
    ADD CONSTRAINT organization_revisions_pkey PRIMARY KEY (id);


--
-- Name: organizations organizations_legacy_wix_id_key; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_legacy_wix_id_key UNIQUE (legacy_wix_id);


--
-- Name: organizations organizations_name_key; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_name_key UNIQUE (name);


--
-- Name: organizations organizations_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_pkey PRIMARY KEY (id);


--
-- Name: organizations organizations_slug_key; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_slug_key UNIQUE (slug);


--
-- Name: participation_history participation_history_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.participation_history
    ADD CONSTRAINT participation_history_pkey PRIMARY KEY (id);


--
-- Name: people people_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.people
    ADD CONSTRAINT people_pkey PRIMARY KEY (id);


--
-- Name: person_volunteer_interests person_volunteer_interests_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.person_volunteer_interests
    ADD CONSTRAINT person_volunteer_interests_pkey PRIMARY KEY (person_id, category_id);


--
-- Name: populations populations_name_key; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.populations
    ADD CONSTRAINT populations_name_key UNIQUE (name);


--
-- Name: populations populations_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.populations
    ADD CONSTRAINT populations_pkey PRIMARY KEY (id);


--
-- Name: populations populations_slug_key; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.populations
    ADD CONSTRAINT populations_slug_key UNIQUE (slug);


--
-- Name: request_engagement_events request_engagement_events_client_event_id_key; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.request_engagement_events
    ADD CONSTRAINT request_engagement_events_client_event_id_key UNIQUE (client_event_id);


--
-- Name: request_engagement_events request_engagement_events_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.request_engagement_events
    ADD CONSTRAINT request_engagement_events_pkey PRIMARY KEY (id);


--
-- Name: request_revisions request_revisions_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.request_revisions
    ADD CONSTRAINT request_revisions_pkey PRIMARY KEY (id);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (filename);


--
-- Name: session session_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.session
    ADD CONSTRAINT session_pkey PRIMARY KEY (id);


--
-- Name: session session_token_key; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.session
    ADD CONSTRAINT session_token_key UNIQUE (token);


--
-- Name: site_settings site_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.site_settings
    ADD CONSTRAINT site_settings_pkey PRIMARY KEY (id);


--
-- Name: storage_cleanup_queue storage_cleanup_queue_object_url_key; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.storage_cleanup_queue
    ADD CONSTRAINT storage_cleanup_queue_object_url_key UNIQUE (object_url);


--
-- Name: storage_cleanup_queue storage_cleanup_queue_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.storage_cleanup_queue
    ADD CONSTRAINT storage_cleanup_queue_pkey PRIMARY KEY (id);


--
-- Name: supporter_admin_audit supporter_admin_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.supporter_admin_audit
    ADD CONSTRAINT supporter_admin_audit_pkey PRIMARY KEY (id);


--
-- Name: supporter_impersonation_contexts supporter_impersonation_contexts_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.supporter_impersonation_contexts
    ADD CONSTRAINT supporter_impersonation_contexts_pkey PRIMARY KEY (id);


--
-- Name: user user_email_key; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public."user"
    ADD CONSTRAINT user_email_key UNIQUE (email);


--
-- Name: user user_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public."user"
    ADD CONSTRAINT user_pkey PRIMARY KEY (id);


--
-- Name: users users_auth_subject_key; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_auth_subject_key UNIQUE (auth_subject);


--
-- Name: users users_person_id_key; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_person_id_key UNIQUE (person_id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: verification verification_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.verification
    ADD CONSTRAINT verification_pkey PRIMARY KEY (id);


--
-- Name: volunteer_alert_preferences volunteer_alert_preferences_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.volunteer_alert_preferences
    ADD CONSTRAINT volunteer_alert_preferences_pkey PRIMARY KEY (user_id);


--
-- Name: volunteer_alert_preferences volunteer_alert_preferences_unsubscribe_token_key; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.volunteer_alert_preferences
    ADD CONSTRAINT volunteer_alert_preferences_unsubscribe_token_key UNIQUE (unsubscribe_token);


--
-- Name: volunteer_categories volunteer_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.volunteer_categories
    ADD CONSTRAINT volunteer_categories_pkey PRIMARY KEY (id);


--
-- Name: volunteer_match_alert_claims volunteer_match_alert_claims_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.volunteer_match_alert_claims
    ADD CONSTRAINT volunteer_match_alert_claims_pkey PRIMARY KEY (volunteer_request_id, user_id);


--
-- Name: volunteer_request_categories volunteer_request_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.volunteer_request_categories
    ADD CONSTRAINT volunteer_request_categories_pkey PRIMARY KEY (volunteer_request_id, category_id);


--
-- Name: volunteer_requests volunteer_requests_legacy_wix_id_key; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.volunteer_requests
    ADD CONSTRAINT volunteer_requests_legacy_wix_id_key UNIQUE (legacy_wix_id);


--
-- Name: volunteer_requests volunteer_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.volunteer_requests
    ADD CONSTRAINT volunteer_requests_pkey PRIMARY KEY (id);


--
-- Name: volunteer_roles volunteer_roles_id_volunteer_request_id_key; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.volunteer_roles
    ADD CONSTRAINT volunteer_roles_id_volunteer_request_id_key UNIQUE (id, volunteer_request_id);


--
-- Name: volunteer_roles volunteer_roles_legacy_wix_id_key; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.volunteer_roles
    ADD CONSTRAINT volunteer_roles_legacy_wix_id_key UNIQUE (legacy_wix_id);


--
-- Name: volunteer_roles volunteer_roles_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.volunteer_roles
    ADD CONSTRAINT volunteer_roles_pkey PRIMARY KEY (id);


--
-- Name: volunteer_signup_roles volunteer_signup_roles_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.volunteer_signup_roles
    ADD CONSTRAINT volunteer_signup_roles_pkey PRIMARY KEY (id);


--
-- Name: volunteer_signup_roles volunteer_signup_roles_volunteer_signup_id_volunteer_role_i_key; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.volunteer_signup_roles
    ADD CONSTRAINT volunteer_signup_roles_volunteer_signup_id_volunteer_role_i_key UNIQUE (volunteer_signup_id, volunteer_role_id);


--
-- Name: volunteer_signups volunteer_signups_legacy_wix_id_key; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.volunteer_signups
    ADD CONSTRAINT volunteer_signups_legacy_wix_id_key UNIQUE (legacy_wix_id);


--
-- Name: volunteer_signups volunteer_signups_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.volunteer_signups
    ADD CONSTRAINT volunteer_signups_pkey PRIMARY KEY (id);


--
-- Name: idx_replit_database_migrations_v1_build_id; Type: INDEX; Schema: _system; Owner: neondb_owner
--

CREATE UNIQUE INDEX idx_replit_database_migrations_v1_build_id ON _system.replit_database_migrations_v1 USING btree (build_id);


--
-- Name: account_userId_idx; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX "account_userId_idx" ON public.account USING btree ("userId");


--
-- Name: admin_organization_contexts_active_expiry; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX admin_organization_contexts_active_expiry ON public.admin_organization_contexts USING btree (expires_at) WHERE (ended_at IS NULL);


--
-- Name: admin_organization_contexts_one_active_per_admin; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE UNIQUE INDEX admin_organization_contexts_one_active_per_admin ON public.admin_organization_contexts USING btree (admin_user_id) WHERE (ended_at IS NULL);


--
-- Name: admin_organization_contexts_org_started; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX admin_organization_contexts_org_started ON public.admin_organization_contexts USING btree (organization_id, started_at DESC);


--
-- Name: approval_events_created_idx; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX approval_events_created_idx ON public.approval_events USING btree (created_at DESC);


--
-- Name: approval_events_entity_idx; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX approval_events_entity_idx ON public.approval_events USING btree (entity_type, entity_id, created_at DESC);


--
-- Name: contact_admin_audit_person_created_idx; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX contact_admin_audit_person_created_idx ON public.contact_admin_audit USING btree (person_id, created_at DESC);


--
-- Name: digest_subscribers_email_key; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE UNIQUE INDEX digest_subscribers_email_key ON public.digest_subscribers USING btree (lower(email));


--
-- Name: digest_subscribers_token_key; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE UNIQUE INDEX digest_subscribers_token_key ON public.digest_subscribers USING btree (unsubscribe_token);


--
-- Name: email_log_entity_idx; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX email_log_entity_idx ON public.email_log USING btree (entity_type, entity_id);


--
-- Name: email_log_once_idx; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE UNIQUE INDEX email_log_once_idx ON public.email_log USING btree (template_key, entity_type, entity_id, lower(to_email)) WHERE ((entity_id IS NOT NULL) AND (status <> ALL (ARRAY['failed'::text, 'skipped'::text])));


--
-- Name: email_log_resend_of_idx; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX email_log_resend_of_idx ON public.email_log USING btree (resend_of_id) WHERE (resend_of_id IS NOT NULL);


--
-- Name: email_log_status_idx; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX email_log_status_idx ON public.email_log USING btree (status, created_at DESC);


--
-- Name: item_pledge_lines_item_idx; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX item_pledge_lines_item_idx ON public.item_pledge_lines USING btree (item_id);


--
-- Name: item_pledges_admin_participation_idx; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX item_pledges_admin_participation_idx ON public.item_pledges USING btree (created_at DESC, id DESC);


--
-- Name: item_pledges_person_idx; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX item_pledges_person_idx ON public.item_pledges USING btree (person_id);


--
-- Name: item_pledges_request_idx; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX item_pledges_request_idx ON public.item_pledges USING btree (item_request_id);


--
-- Name: item_requests_org_idx; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX item_requests_org_idx ON public.item_requests USING btree (org_id);


--
-- Name: item_requests_public_idx; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX item_requests_public_idx ON public.item_requests USING btree (status, created_at DESC) WHERE (status = 'active'::text);


--
-- Name: items_request_idx; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX items_request_idx ON public.items USING btree (item_request_id, sort_order);


--
-- Name: org_memberships_org_idx; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX org_memberships_org_idx ON public.org_memberships USING btree (org_id) WHERE (status = 'active'::text);


--
-- Name: org_memberships_user_idx; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX org_memberships_user_idx ON public.org_memberships USING btree (user_id) WHERE (status = 'active'::text);


--
-- Name: organization_context_actions_context; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX organization_context_actions_context ON public.organization_context_actions USING btree (organization_context_id, created_at DESC);


--
-- Name: organization_context_actions_created; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX organization_context_actions_created ON public.organization_context_actions USING btree (created_at DESC);


--
-- Name: organization_revisions_entity_idx; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX organization_revisions_entity_idx ON public.organization_revisions USING btree (organization_id, created_at DESC);


--
-- Name: organizations_kind_status_idx; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX organizations_kind_status_idx ON public.organizations USING btree (kind, status);


--
-- Name: participation_history_created_idx; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX participation_history_created_idx ON public.participation_history USING btree (created_at DESC);


--
-- Name: participation_history_entity_idx; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX participation_history_entity_idx ON public.participation_history USING btree (entity_type, entity_id, created_at DESC);


--
-- Name: people_email_key; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE UNIQUE INDEX people_email_key ON public.people USING btree (lower(btrim(email)));


--
-- Name: people_needs_review_idx; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX people_needs_review_idx ON public.people USING btree (needs_review) WHERE needs_review;


--
-- Name: person_volunteer_interests_category_idx; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX person_volunteer_interests_category_idx ON public.person_volunteer_interests USING btree (category_id);


--
-- Name: request_engagement_item_reporting_idx; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX request_engagement_item_reporting_idx ON public.request_engagement_events USING btree (item_request_id, created_at DESC) WHERE (item_request_id IS NOT NULL);


--
-- Name: request_engagement_type_created_idx; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX request_engagement_type_created_idx ON public.request_engagement_events USING btree (event_type, created_at DESC);


--
-- Name: request_engagement_user_history_idx; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX request_engagement_user_history_idx ON public.request_engagement_events USING btree (user_id, created_at DESC) WHERE ((user_id IS NOT NULL) AND (event_type = 'detail_view'::text));


--
-- Name: request_engagement_volunteer_reporting_idx; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX request_engagement_volunteer_reporting_idx ON public.request_engagement_events USING btree (volunteer_request_id, created_at DESC) WHERE (volunteer_request_id IS NOT NULL);


--
-- Name: request_revisions_entity_idx; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX request_revisions_entity_idx ON public.request_revisions USING btree (entity_type, entity_id, created_at DESC);


--
-- Name: session_userId_idx; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX "session_userId_idx" ON public.session USING btree ("userId");


--
-- Name: storage_cleanup_queue_due_idx; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX storage_cleanup_queue_due_idx ON public.storage_cleanup_queue USING btree (next_attempt_at, created_at);


--
-- Name: supporter_admin_audit_created_idx; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX supporter_admin_audit_created_idx ON public.supporter_admin_audit USING btree (created_at DESC);


--
-- Name: supporter_admin_audit_target_idx; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX supporter_admin_audit_target_idx ON public.supporter_admin_audit USING btree (target_user_id, created_at DESC);


--
-- Name: supporter_impersonation_one_active_per_admin; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE UNIQUE INDEX supporter_impersonation_one_active_per_admin ON public.supporter_impersonation_contexts USING btree (admin_user_id) WHERE (ended_at IS NULL);


--
-- Name: supporter_impersonation_supporter_idx; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX supporter_impersonation_supporter_idx ON public.supporter_impersonation_contexts USING btree (supporter_user_id, started_at DESC);


--
-- Name: verification_identifier_idx; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX verification_identifier_idx ON public.verification USING btree (identifier);


--
-- Name: volunteer_categories_name_ci_key; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE UNIQUE INDEX volunteer_categories_name_ci_key ON public.volunteer_categories USING btree (lower(btrim(name)));


--
-- Name: volunteer_match_alert_claims_email_once_idx; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE UNIQUE INDEX volunteer_match_alert_claims_email_once_idx ON public.volunteer_match_alert_claims USING btree (volunteer_request_id, lower(btrim(to_email)));


--
-- Name: volunteer_request_categories_category_idx; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX volunteer_request_categories_category_idx ON public.volunteer_request_categories USING btree (category_id);


--
-- Name: volunteer_requests_org_idx; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX volunteer_requests_org_idx ON public.volunteer_requests USING btree (org_id);


--
-- Name: volunteer_requests_public_idx; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX volunteer_requests_public_idx ON public.volunteer_requests USING btree (status, created_at DESC) WHERE (status = 'active'::text);


--
-- Name: volunteer_roles_request_idx; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX volunteer_roles_request_idx ON public.volunteer_roles USING btree (volunteer_request_id, sort_order);


--
-- Name: volunteer_signup_roles_role_idx; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX volunteer_signup_roles_role_idx ON public.volunteer_signup_roles USING btree (volunteer_role_id);


--
-- Name: volunteer_signups_admin_participation_idx; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX volunteer_signups_admin_participation_idx ON public.volunteer_signups USING btree (created_at DESC, id DESC);


--
-- Name: volunteer_signups_person_idx; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX volunteer_signups_person_idx ON public.volunteer_signups USING btree (person_id);


--
-- Name: volunteer_signups_request_idx; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX volunteer_signups_request_idx ON public.volunteer_signups USING btree (volunteer_request_id);


--
-- Name: approval_events approval_events_capture_organization_context; Type: TRIGGER; Schema: public; Owner: neondb_owner
--

CREATE TRIGGER approval_events_capture_organization_context BEFORE INSERT ON public.approval_events FOR EACH ROW EXECUTE FUNCTION public.capture_organization_context_attribution();


--
-- Name: item_pledges item_pledges_reject_expired_request; Type: TRIGGER; Schema: public; Owner: neondb_owner
--

CREATE TRIGGER item_pledges_reject_expired_request BEFORE INSERT ON public.item_pledges FOR EACH ROW EXECUTE FUNCTION public.reject_expired_item_pledge();


--
-- Name: item_pledges item_pledges_reject_ineligible_organization; Type: TRIGGER; Schema: public; Owner: neondb_owner
--

CREATE TRIGGER item_pledges_reject_ineligible_organization BEFORE INSERT ON public.item_pledges FOR EACH ROW EXECUTE FUNCTION public.reject_ineligible_item_pledge();


--
-- Name: item_pledges item_pledges_set_updated_at; Type: TRIGGER; Schema: public; Owner: neondb_owner
--

CREATE TRIGGER item_pledges_set_updated_at BEFORE UPDATE ON public.item_pledges FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: item_requests item_requests_capture_organization_context_action; Type: TRIGGER; Schema: public; Owner: neondb_owner
--

CREATE TRIGGER item_requests_capture_organization_context_action AFTER INSERT OR DELETE OR UPDATE ON public.item_requests FOR EACH ROW EXECUTE FUNCTION public.capture_organization_context_action();


--
-- Name: item_requests item_requests_guard_member_transitions; Type: TRIGGER; Schema: public; Owner: neondb_owner
--

CREATE TRIGGER item_requests_guard_member_transitions BEFORE UPDATE ON public.item_requests FOR EACH ROW EXECUTE FUNCTION public.guard_member_request_transitions('item_request');


--
-- Name: item_requests item_requests_set_updated_at; Type: TRIGGER; Schema: public; Owner: neondb_owner
--

CREATE TRIGGER item_requests_set_updated_at BEFORE UPDATE ON public.item_requests FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: items items_capture_organization_context_action; Type: TRIGGER; Schema: public; Owner: neondb_owner
--

CREATE TRIGGER items_capture_organization_context_action AFTER INSERT OR DELETE OR UPDATE ON public.items FOR EACH ROW EXECUTE FUNCTION public.capture_organization_context_action();


--
-- Name: items items_guard_counters; Type: TRIGGER; Schema: public; Owner: neondb_owner
--

CREATE TRIGGER items_guard_counters BEFORE UPDATE ON public.items FOR EACH ROW EXECUTE FUNCTION public.guard_counter_columns();


--
-- Name: items items_set_updated_at; Type: TRIGGER; Schema: public; Owner: neondb_owner
--

CREATE TRIGGER items_set_updated_at BEFORE UPDATE ON public.items FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: org_memberships org_memberships_capture_organization_context_action; Type: TRIGGER; Schema: public; Owner: neondb_owner
--

CREATE TRIGGER org_memberships_capture_organization_context_action AFTER INSERT OR DELETE OR UPDATE ON public.org_memberships FOR EACH ROW EXECUTE FUNCTION public.capture_organization_context_action();


--
-- Name: org_memberships org_memberships_set_updated_at; Type: TRIGGER; Schema: public; Owner: neondb_owner
--

CREATE TRIGGER org_memberships_set_updated_at BEFORE UPDATE ON public.org_memberships FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: organization_populations organization_populations_capture_organization_context_action; Type: TRIGGER; Schema: public; Owner: neondb_owner
--

CREATE TRIGGER organization_populations_capture_organization_context_action AFTER INSERT OR DELETE OR UPDATE ON public.organization_populations FOR EACH ROW EXECUTE FUNCTION public.capture_organization_context_action();


--
-- Name: organizations organizations_capture_organization_context_action; Type: TRIGGER; Schema: public; Owner: neondb_owner
--

CREATE TRIGGER organizations_capture_organization_context_action AFTER INSERT OR DELETE OR UPDATE ON public.organizations FOR EACH ROW EXECUTE FUNCTION public.capture_organization_context_action();


--
-- Name: organizations organizations_revoke_admin_contexts; Type: TRIGGER; Schema: public; Owner: neondb_owner
--

CREATE TRIGGER organizations_revoke_admin_contexts AFTER UPDATE OF kind, status ON public.organizations FOR EACH ROW EXECUTE FUNCTION public.revoke_admin_organization_contexts_for_ineligible_org();


--
-- Name: organizations organizations_set_updated_at; Type: TRIGGER; Schema: public; Owner: neondb_owner
--

CREATE TRIGGER organizations_set_updated_at BEFORE UPDATE ON public.organizations FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: participation_history participation_history_activity_trigger; Type: TRIGGER; Schema: public; Owner: neondb_owner
--

CREATE TRIGGER participation_history_activity_trigger AFTER INSERT ON public.participation_history FOR EACH ROW EXECUTE FUNCTION public.project_participation_history_to_activity();


--
-- Name: people people_capture_organization_context_action; Type: TRIGGER; Schema: public; Owner: neondb_owner
--

CREATE TRIGGER people_capture_organization_context_action AFTER INSERT OR DELETE OR UPDATE ON public.people FOR EACH ROW EXECUTE FUNCTION public.capture_organization_context_action();


--
-- Name: people people_protect_account_email_identity; Type: TRIGGER; Schema: public; Owner: neondb_owner
--

CREATE TRIGGER people_protect_account_email_identity BEFORE INSERT OR UPDATE ON public.people FOR EACH ROW EXECUTE FUNCTION public.protect_account_email_identity();


--
-- Name: people people_set_updated_at; Type: TRIGGER; Schema: public; Owner: neondb_owner
--

CREATE TRIGGER people_set_updated_at BEFORE UPDATE ON public.people FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: participation_history protect_participation_history_trigger; Type: TRIGGER; Schema: public; Owner: neondb_owner
--

CREATE TRIGGER protect_participation_history_trigger BEFORE DELETE OR UPDATE ON public.participation_history FOR EACH ROW EXECUTE FUNCTION public.protect_participation_history();


--
-- Name: item_pledges reopen_fulfilled_item_request_trigger; Type: TRIGGER; Schema: public; Owner: neondb_owner
--

CREATE TRIGGER reopen_fulfilled_item_request_trigger AFTER UPDATE ON public.item_pledges FOR EACH ROW EXECUTE FUNCTION public.reopen_fulfilled_item_request_after_pledge_cancel();


--
-- Name: request_revisions request_revisions_capture_organization_context; Type: TRIGGER; Schema: public; Owner: neondb_owner
--

CREATE TRIGGER request_revisions_capture_organization_context BEFORE INSERT ON public.request_revisions FOR EACH ROW EXECUTE FUNCTION public.capture_organization_context_attribution();


--
-- Name: users users_set_updated_at; Type: TRIGGER; Schema: public; Owner: neondb_owner
--

CREATE TRIGGER users_set_updated_at BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: volunteer_alert_preferences volunteer_alert_preferences_set_updated_at; Type: TRIGGER; Schema: public; Owner: neondb_owner
--

CREATE TRIGGER volunteer_alert_preferences_set_updated_at BEFORE UPDATE ON public.volunteer_alert_preferences FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: volunteer_request_categories volunteer_request_categories_capture_organization_context_actio; Type: TRIGGER; Schema: public; Owner: neondb_owner
--

CREATE TRIGGER volunteer_request_categories_capture_organization_context_actio AFTER INSERT OR DELETE OR UPDATE ON public.volunteer_request_categories FOR EACH ROW EXECUTE FUNCTION public.capture_organization_context_action();


--
-- Name: volunteer_requests volunteer_requests_capture_organization_context_action; Type: TRIGGER; Schema: public; Owner: neondb_owner
--

CREATE TRIGGER volunteer_requests_capture_organization_context_action AFTER INSERT OR DELETE OR UPDATE ON public.volunteer_requests FOR EACH ROW EXECUTE FUNCTION public.capture_organization_context_action();


--
-- Name: volunteer_requests volunteer_requests_guard_member_transitions; Type: TRIGGER; Schema: public; Owner: neondb_owner
--

CREATE TRIGGER volunteer_requests_guard_member_transitions BEFORE UPDATE ON public.volunteer_requests FOR EACH ROW EXECUTE FUNCTION public.guard_member_request_transitions('volunteer_request');


--
-- Name: volunteer_requests volunteer_requests_set_updated_at; Type: TRIGGER; Schema: public; Owner: neondb_owner
--

CREATE TRIGGER volunteer_requests_set_updated_at BEFORE UPDATE ON public.volunteer_requests FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: volunteer_roles volunteer_roles_capture_organization_context_action; Type: TRIGGER; Schema: public; Owner: neondb_owner
--

CREATE TRIGGER volunteer_roles_capture_organization_context_action AFTER INSERT OR DELETE OR UPDATE ON public.volunteer_roles FOR EACH ROW EXECUTE FUNCTION public.capture_organization_context_action();


--
-- Name: volunteer_roles volunteer_roles_guard_counters; Type: TRIGGER; Schema: public; Owner: neondb_owner
--

CREATE TRIGGER volunteer_roles_guard_counters BEFORE UPDATE ON public.volunteer_roles FOR EACH ROW EXECUTE FUNCTION public.guard_counter_columns();


--
-- Name: volunteer_roles volunteer_roles_set_updated_at; Type: TRIGGER; Schema: public; Owner: neondb_owner
--

CREATE TRIGGER volunteer_roles_set_updated_at BEFORE UPDATE ON public.volunteer_roles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: volunteer_signups volunteer_signups_set_updated_at; Type: TRIGGER; Schema: public; Owner: neondb_owner
--

CREATE TRIGGER volunteer_signups_set_updated_at BEFORE UPDATE ON public.volunteer_signups FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: item_pledges zy_item_pledge_participation_version; Type: TRIGGER; Schema: public; Owner: neondb_owner
--

CREATE TRIGGER zy_item_pledge_participation_version BEFORE UPDATE ON public.item_pledges FOR EACH ROW EXECUTE FUNCTION public.increment_participation_version();


--
-- Name: volunteer_signups zy_volunteer_signup_participation_version; Type: TRIGGER; Schema: public; Owner: neondb_owner
--

CREATE TRIGGER zy_volunteer_signup_participation_version BEFORE UPDATE ON public.volunteer_signups FOR EACH ROW EXECUTE FUNCTION public.increment_participation_version();


--
-- Name: item_pledges zz_round_item_pledge_updated_at; Type: TRIGGER; Schema: public; Owner: neondb_owner
--

CREATE TRIGGER zz_round_item_pledge_updated_at BEFORE INSERT OR UPDATE ON public.item_pledges FOR EACH ROW EXECUTE FUNCTION public.round_participation_updated_at();


--
-- Name: volunteer_signups zz_round_volunteer_signup_updated_at; Type: TRIGGER; Schema: public; Owner: neondb_owner
--

CREATE TRIGGER zz_round_volunteer_signup_updated_at BEFORE INSERT OR UPDATE ON public.volunteer_signups FOR EACH ROW EXECUTE FUNCTION public.round_participation_updated_at();


--
-- Name: account account_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.account
    ADD CONSTRAINT "account_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."user"(id) ON DELETE CASCADE;


--
-- Name: admin_organization_contexts admin_organization_contexts_admin_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.admin_organization_contexts
    ADD CONSTRAINT admin_organization_contexts_admin_user_id_fkey FOREIGN KEY (admin_user_id) REFERENCES public.users(id);


--
-- Name: admin_organization_contexts admin_organization_contexts_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.admin_organization_contexts
    ADD CONSTRAINT admin_organization_contexts_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: approval_events approval_events_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.approval_events
    ADD CONSTRAINT approval_events_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES public.users(id);


--
-- Name: approval_events approval_events_context_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.approval_events
    ADD CONSTRAINT approval_events_context_organization_id_fkey FOREIGN KEY (context_organization_id) REFERENCES public.organizations(id);


--
-- Name: approval_events approval_events_organization_context_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.approval_events
    ADD CONSTRAINT approval_events_organization_context_id_fkey FOREIGN KEY (organization_context_id) REFERENCES public.admin_organization_contexts(id);


--
-- Name: contact_admin_audit contact_admin_audit_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.contact_admin_audit
    ADD CONSTRAINT contact_admin_audit_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: contact_admin_audit contact_admin_audit_person_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.contact_admin_audit
    ADD CONSTRAINT contact_admin_audit_person_id_fkey FOREIGN KEY (person_id) REFERENCES public.people(id) ON DELETE SET NULL;


--
-- Name: digest_exclusions digest_exclusions_excluded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.digest_exclusions
    ADD CONSTRAINT digest_exclusions_excluded_by_fkey FOREIGN KEY (excluded_by) REFERENCES public.users(id);


--
-- Name: digest_subscribers digest_subscribers_person_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.digest_subscribers
    ADD CONSTRAINT digest_subscribers_person_id_fkey FOREIGN KEY (person_id) REFERENCES public.people(id);


--
-- Name: email_brand_settings email_brand_settings_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.email_brand_settings
    ADD CONSTRAINT email_brand_settings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: email_log email_log_resend_of_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.email_log
    ADD CONSTRAINT email_log_resend_of_id_fkey FOREIGN KEY (resend_of_id) REFERENCES public.email_log(id);


--
-- Name: email_log email_log_to_person_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.email_log
    ADD CONSTRAINT email_log_to_person_id_fkey FOREIGN KEY (to_person_id) REFERENCES public.people(id);


--
-- Name: email_schedules email_schedules_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.email_schedules
    ADD CONSTRAINT email_schedules_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id);


--
-- Name: email_template_overrides email_template_overrides_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.email_template_overrides
    ADD CONSTRAINT email_template_overrides_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id);


--
-- Name: item_pledge_lines item_pledge_lines_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.item_pledge_lines
    ADD CONSTRAINT item_pledge_lines_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.items(id);


--
-- Name: item_pledge_lines item_pledge_lines_item_pledge_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.item_pledge_lines
    ADD CONSTRAINT item_pledge_lines_item_pledge_id_fkey FOREIGN KEY (item_pledge_id) REFERENCES public.item_pledges(id) ON DELETE CASCADE;


--
-- Name: item_pledges item_pledges_cancelled_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.item_pledges
    ADD CONSTRAINT item_pledges_cancelled_by_fkey FOREIGN KEY (cancelled_by) REFERENCES public.users(id);


--
-- Name: item_pledges item_pledges_item_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.item_pledges
    ADD CONSTRAINT item_pledges_item_request_id_fkey FOREIGN KEY (item_request_id) REFERENCES public.item_requests(id);


--
-- Name: item_pledges item_pledges_person_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.item_pledges
    ADD CONSTRAINT item_pledges_person_id_fkey FOREIGN KEY (person_id) REFERENCES public.people(id);


--
-- Name: item_requests item_requests_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.item_requests
    ADD CONSTRAINT item_requests_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.users(id);


--
-- Name: item_requests item_requests_contact_person_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.item_requests
    ADD CONSTRAINT item_requests_contact_person_id_fkey FOREIGN KEY (contact_person_id) REFERENCES public.people(id);


--
-- Name: item_requests item_requests_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.item_requests
    ADD CONSTRAINT item_requests_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: item_requests item_requests_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.item_requests
    ADD CONSTRAINT item_requests_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id);


--
-- Name: items items_item_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.items
    ADD CONSTRAINT items_item_request_id_fkey FOREIGN KEY (item_request_id) REFERENCES public.item_requests(id) ON DELETE CASCADE;


--
-- Name: org_memberships org_memberships_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.org_memberships
    ADD CONSTRAINT org_memberships_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.users(id);


--
-- Name: org_memberships org_memberships_invited_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.org_memberships
    ADD CONSTRAINT org_memberships_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES public.users(id);


--
-- Name: org_memberships org_memberships_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.org_memberships
    ADD CONSTRAINT org_memberships_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: org_memberships org_memberships_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.org_memberships
    ADD CONSTRAINT org_memberships_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: organization_context_actions organization_context_actions_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.organization_context_actions
    ADD CONSTRAINT organization_context_actions_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES public.users(id);


--
-- Name: organization_context_actions organization_context_actions_organization_context_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.organization_context_actions
    ADD CONSTRAINT organization_context_actions_organization_context_id_fkey FOREIGN KEY (organization_context_id) REFERENCES public.admin_organization_contexts(id);


--
-- Name: organization_context_actions organization_context_actions_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.organization_context_actions
    ADD CONSTRAINT organization_context_actions_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: organization_populations organization_populations_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.organization_populations
    ADD CONSTRAINT organization_populations_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: organization_populations organization_populations_population_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.organization_populations
    ADD CONSTRAINT organization_populations_population_id_fkey FOREIGN KEY (population_id) REFERENCES public.populations(id);


--
-- Name: organization_revisions organization_revisions_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.organization_revisions
    ADD CONSTRAINT organization_revisions_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES public.users(id);


--
-- Name: organization_revisions organization_revisions_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.organization_revisions
    ADD CONSTRAINT organization_revisions_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: organizations organizations_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.users(id);


--
-- Name: organizations organizations_primary_contact_person_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_primary_contact_person_id_fkey FOREIGN KEY (primary_contact_person_id) REFERENCES public.people(id);


--
-- Name: participation_history participation_history_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.participation_history
    ADD CONSTRAINT participation_history_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES public.users(id);


--
-- Name: person_volunteer_interests person_volunteer_interests_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.person_volunteer_interests
    ADD CONSTRAINT person_volunteer_interests_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.volunteer_categories(id);


--
-- Name: person_volunteer_interests person_volunteer_interests_person_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.person_volunteer_interests
    ADD CONSTRAINT person_volunteer_interests_person_id_fkey FOREIGN KEY (person_id) REFERENCES public.people(id) ON DELETE CASCADE;


--
-- Name: request_engagement_events request_engagement_events_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.request_engagement_events
    ADD CONSTRAINT request_engagement_events_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.items(id) ON DELETE CASCADE;


--
-- Name: request_engagement_events request_engagement_events_item_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.request_engagement_events
    ADD CONSTRAINT request_engagement_events_item_request_id_fkey FOREIGN KEY (item_request_id) REFERENCES public.item_requests(id) ON DELETE CASCADE;


--
-- Name: request_engagement_events request_engagement_events_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.request_engagement_events
    ADD CONSTRAINT request_engagement_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: request_engagement_events request_engagement_events_volunteer_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.request_engagement_events
    ADD CONSTRAINT request_engagement_events_volunteer_request_id_fkey FOREIGN KEY (volunteer_request_id) REFERENCES public.volunteer_requests(id) ON DELETE CASCADE;


--
-- Name: request_engagement_events request_engagement_events_volunteer_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.request_engagement_events
    ADD CONSTRAINT request_engagement_events_volunteer_role_id_fkey FOREIGN KEY (volunteer_role_id) REFERENCES public.volunteer_roles(id) ON DELETE CASCADE;


--
-- Name: request_engagement_events request_engagement_item_ownership_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.request_engagement_events
    ADD CONSTRAINT request_engagement_item_ownership_fk FOREIGN KEY (item_id, item_request_id) REFERENCES public.items(id, item_request_id) ON DELETE CASCADE;


--
-- Name: request_engagement_events request_engagement_role_ownership_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.request_engagement_events
    ADD CONSTRAINT request_engagement_role_ownership_fk FOREIGN KEY (volunteer_role_id, volunteer_request_id) REFERENCES public.volunteer_roles(id, volunteer_request_id) ON DELETE CASCADE;


--
-- Name: request_revisions request_revisions_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.request_revisions
    ADD CONSTRAINT request_revisions_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES public.users(id);


--
-- Name: request_revisions request_revisions_context_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.request_revisions
    ADD CONSTRAINT request_revisions_context_organization_id_fkey FOREIGN KEY (context_organization_id) REFERENCES public.organizations(id);


--
-- Name: request_revisions request_revisions_organization_context_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.request_revisions
    ADD CONSTRAINT request_revisions_organization_context_id_fkey FOREIGN KEY (organization_context_id) REFERENCES public.admin_organization_contexts(id);


--
-- Name: session session_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.session
    ADD CONSTRAINT "session_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."user"(id) ON DELETE CASCADE;


--
-- Name: site_settings site_settings_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.site_settings
    ADD CONSTRAINT site_settings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: supporter_admin_audit supporter_admin_audit_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.supporter_admin_audit
    ADD CONSTRAINT supporter_admin_audit_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: supporter_admin_audit supporter_admin_audit_context_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.supporter_admin_audit
    ADD CONSTRAINT supporter_admin_audit_context_id_fkey FOREIGN KEY (context_id) REFERENCES public.supporter_impersonation_contexts(id) ON DELETE SET NULL;


--
-- Name: supporter_admin_audit supporter_admin_audit_target_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.supporter_admin_audit
    ADD CONSTRAINT supporter_admin_audit_target_user_id_fkey FOREIGN KEY (target_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: supporter_impersonation_contexts supporter_impersonation_contexts_admin_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.supporter_impersonation_contexts
    ADD CONSTRAINT supporter_impersonation_contexts_admin_user_id_fkey FOREIGN KEY (admin_user_id) REFERENCES public.users(id);


--
-- Name: supporter_impersonation_contexts supporter_impersonation_contexts_supporter_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.supporter_impersonation_contexts
    ADD CONSTRAINT supporter_impersonation_contexts_supporter_user_id_fkey FOREIGN KEY (supporter_user_id) REFERENCES public.users(id);


--
-- Name: users users_person_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_person_id_fkey FOREIGN KEY (person_id) REFERENCES public.people(id);


--
-- Name: volunteer_alert_preferences volunteer_alert_preferences_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.volunteer_alert_preferences
    ADD CONSTRAINT volunteer_alert_preferences_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: volunteer_match_alert_claims volunteer_match_alert_claims_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.volunteer_match_alert_claims
    ADD CONSTRAINT volunteer_match_alert_claims_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: volunteer_match_alert_claims volunteer_match_alert_claims_volunteer_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.volunteer_match_alert_claims
    ADD CONSTRAINT volunteer_match_alert_claims_volunteer_request_id_fkey FOREIGN KEY (volunteer_request_id) REFERENCES public.volunteer_requests(id) ON DELETE CASCADE;


--
-- Name: volunteer_request_categories volunteer_request_categories_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.volunteer_request_categories
    ADD CONSTRAINT volunteer_request_categories_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.volunteer_categories(id);


--
-- Name: volunteer_request_categories volunteer_request_categories_volunteer_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.volunteer_request_categories
    ADD CONSTRAINT volunteer_request_categories_volunteer_request_id_fkey FOREIGN KEY (volunteer_request_id) REFERENCES public.volunteer_requests(id) ON DELETE CASCADE;


--
-- Name: volunteer_requests volunteer_requests_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.volunteer_requests
    ADD CONSTRAINT volunteer_requests_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.users(id);


--
-- Name: volunteer_requests volunteer_requests_contact_person_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.volunteer_requests
    ADD CONSTRAINT volunteer_requests_contact_person_id_fkey FOREIGN KEY (contact_person_id) REFERENCES public.people(id);


--
-- Name: volunteer_requests volunteer_requests_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.volunteer_requests
    ADD CONSTRAINT volunteer_requests_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: volunteer_requests volunteer_requests_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.volunteer_requests
    ADD CONSTRAINT volunteer_requests_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id);


--
-- Name: volunteer_roles volunteer_roles_volunteer_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.volunteer_roles
    ADD CONSTRAINT volunteer_roles_volunteer_request_id_fkey FOREIGN KEY (volunteer_request_id) REFERENCES public.volunteer_requests(id) ON DELETE CASCADE;


--
-- Name: volunteer_signup_roles volunteer_signup_roles_volunteer_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.volunteer_signup_roles
    ADD CONSTRAINT volunteer_signup_roles_volunteer_role_id_fkey FOREIGN KEY (volunteer_role_id) REFERENCES public.volunteer_roles(id);


--
-- Name: volunteer_signup_roles volunteer_signup_roles_volunteer_signup_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.volunteer_signup_roles
    ADD CONSTRAINT volunteer_signup_roles_volunteer_signup_id_fkey FOREIGN KEY (volunteer_signup_id) REFERENCES public.volunteer_signups(id) ON DELETE CASCADE;


--
-- Name: volunteer_signups volunteer_signups_cancelled_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.volunteer_signups
    ADD CONSTRAINT volunteer_signups_cancelled_by_fkey FOREIGN KEY (cancelled_by) REFERENCES public.users(id);


--
-- Name: volunteer_signups volunteer_signups_person_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.volunteer_signups
    ADD CONSTRAINT volunteer_signups_person_id_fkey FOREIGN KEY (person_id) REFERENCES public.people(id);


--
-- Name: volunteer_signups volunteer_signups_volunteer_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.volunteer_signups
    ADD CONSTRAINT volunteer_signups_volunteer_request_id_fkey FOREIGN KEY (volunteer_request_id) REFERENCES public.volunteer_requests(id);


--
-- Name: admin_organization_contexts; Type: ROW SECURITY; Schema: public; Owner: neondb_owner
--

ALTER TABLE public.admin_organization_contexts ENABLE ROW LEVEL SECURITY;

--
-- Name: admin_organization_contexts admin_organization_contexts_system_staff_all; Type: POLICY; Schema: public; Owner: neondb_owner
--

CREATE POLICY admin_organization_contexts_system_staff_all ON public.admin_organization_contexts;


--
-- Name: approval_events; Type: ROW SECURITY; Schema: public; Owner: neondb_owner
--

ALTER TABLE public.approval_events ENABLE ROW LEVEL SECURITY;

--
-- Name: approval_events approval_events_member_insert; Type: POLICY; Schema: public; Owner: neondb_owner
--

CREATE POLICY approval_events_member_insert ON public.approval_events FOR INSERT WITH CHECK (((current_setting('app.context'::text, true) = 'member'::text) AND (entity_type = ANY (ARRAY['item_request'::text, 'volunteer_request'::text]))));


--
-- Name: approval_events approval_events_system_staff_all; Type: POLICY; Schema: public; Owner: neondb_owner
--

CREATE POLICY approval_events_system_staff_all ON public.approval_events;


--
-- Name: contact_admin_audit; Type: ROW SECURITY; Schema: public; Owner: neondb_owner
--

ALTER TABLE public.contact_admin_audit ENABLE ROW LEVEL SECURITY;

--
-- Name: contact_admin_audit contact_admin_audit_system_staff_all; Type: POLICY; Schema: public; Owner: neondb_owner
--

CREATE POLICY contact_admin_audit_system_staff_all ON public.contact_admin_audit USING ((current_setting('app.context'::text, true) = ANY (ARRAY['system'::text, 'staff'::text]))) WITH CHECK ((current_setting('app.context'::text, true) = ANY (ARRAY['system'::text, 'staff'::text])));


--
-- Name: digest_exclusions; Type: ROW SECURITY; Schema: public; Owner: neondb_owner
--

ALTER TABLE public.digest_exclusions ENABLE ROW LEVEL SECURITY;

--
-- Name: digest_exclusions digest_exclusions_system_staff_all; Type: POLICY; Schema: public; Owner: neondb_owner
--

CREATE POLICY digest_exclusions_system_staff_all ON public.digest_exclusions USING ((current_setting('app.context'::text, true) = ANY (ARRAY['system'::text, 'staff'::text]))) WITH CHECK ((current_setting('app.context'::text, true) = ANY (ARRAY['system'::text, 'staff'::text])));


--
-- Name: digest_runs; Type: ROW SECURITY; Schema: public; Owner: neondb_owner
--

ALTER TABLE public.digest_runs ENABLE ROW LEVEL SECURITY;

--
-- Name: digest_runs digest_runs_system_staff_all; Type: POLICY; Schema: public; Owner: neondb_owner
--

CREATE POLICY digest_runs_system_staff_all ON public.digest_runs USING ((current_setting('app.context'::text, true) = ANY (ARRAY['system'::text, 'staff'::text]))) WITH CHECK ((current_setting('app.context'::text, true) = ANY (ARRAY['system'::text, 'staff'::text])));


--
-- Name: digest_subscribers; Type: ROW SECURITY; Schema: public; Owner: neondb_owner
--

ALTER TABLE public.digest_subscribers ENABLE ROW LEVEL SECURITY;

--
-- Name: digest_subscribers digest_subscribers_system_staff_all; Type: POLICY; Schema: public; Owner: neondb_owner
--

CREATE POLICY digest_subscribers_system_staff_all ON public.digest_subscribers;


--
-- Name: email_brand_settings; Type: ROW SECURITY; Schema: public; Owner: neondb_owner
--

ALTER TABLE public.email_brand_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: email_brand_settings email_brand_settings_system_staff_all; Type: POLICY; Schema: public; Owner: neondb_owner
--

CREATE POLICY email_brand_settings_system_staff_all ON public.email_brand_settings USING ((current_setting('app.context'::text, true) = ANY (ARRAY['system'::text, 'staff'::text]))) WITH CHECK ((current_setting('app.context'::text, true) = ANY (ARRAY['system'::text, 'staff'::text])));


--
-- Name: email_log; Type: ROW SECURITY; Schema: public; Owner: neondb_owner
--

ALTER TABLE public.email_log ENABLE ROW LEVEL SECURITY;

--
-- Name: email_log email_log_system_staff_all; Type: POLICY; Schema: public; Owner: neondb_owner
--

CREATE POLICY email_log_system_staff_all ON public.email_log;


--
-- Name: email_schedules; Type: ROW SECURITY; Schema: public; Owner: neondb_owner
--

ALTER TABLE public.email_schedules ENABLE ROW LEVEL SECURITY;

--
-- Name: email_schedules email_schedules_system_staff_all; Type: POLICY; Schema: public; Owner: neondb_owner
--

CREATE POLICY email_schedules_system_staff_all ON public.email_schedules USING ((current_setting('app.context'::text, true) = ANY (ARRAY['system'::text, 'staff'::text]))) WITH CHECK ((current_setting('app.context'::text, true) = ANY (ARRAY['system'::text, 'staff'::text])));


--
-- Name: email_template_overrides; Type: ROW SECURITY; Schema: public; Owner: neondb_owner
--

ALTER TABLE public.email_template_overrides ENABLE ROW LEVEL SECURITY;

--
-- Name: email_template_overrides email_template_overrides_system_staff_all; Type: POLICY; Schema: public; Owner: neondb_owner
--

CREATE POLICY email_template_overrides_system_staff_all ON public.email_template_overrides USING ((current_setting('app.context'::text, true) = ANY (ARRAY['system'::text, 'staff'::text]))) WITH CHECK ((current_setting('app.context'::text, true) = ANY (ARRAY['system'::text, 'staff'::text])));


--
-- Name: item_pledge_lines; Type: ROW SECURITY; Schema: public; Owner: neondb_owner
--

ALTER TABLE public.item_pledge_lines ENABLE ROW LEVEL SECURITY;

--
-- Name: item_pledge_lines item_pledge_lines_member_select; Type: POLICY; Schema: public; Owner: neondb_owner
--

CREATE POLICY item_pledge_lines_member_select ON public.item_pledge_lines FOR SELECT;


--
-- Name: item_pledge_lines item_pledge_lines_system_staff_all; Type: POLICY; Schema: public; Owner: neondb_owner
--

CREATE POLICY item_pledge_lines_system_staff_all ON public.item_pledge_lines;


--
-- Name: item_pledges; Type: ROW SECURITY; Schema: public; Owner: neondb_owner
--

ALTER TABLE public.item_pledges ENABLE ROW LEVEL SECURITY;

--
-- Name: item_pledges item_pledges_member_select; Type: POLICY; Schema: public; Owner: neondb_owner
--

CREATE POLICY item_pledges_member_select ON public.item_pledges FOR SELECT;


--
-- Name: item_pledges item_pledges_system_staff_all; Type: POLICY; Schema: public; Owner: neondb_owner
--

CREATE POLICY item_pledges_system_staff_all ON public.item_pledges USING ((current_setting('app.context'::text, true) = ANY (ARRAY['system'::text, 'staff'::text]))) WITH CHECK ((current_setting('app.context'::text, true) = ANY (ARRAY['system'::text, 'staff'::text])));


--
-- Name: item_requests; Type: ROW SECURITY; Schema: public; Owner: neondb_owner
--

ALTER TABLE public.item_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: item_requests item_requests_member_insert; Type: POLICY; Schema: public; Owner: neondb_owner
--

CREATE POLICY item_requests_member_insert ON public.item_requests FOR INSERT;


--
-- Name: item_requests item_requests_member_select; Type: POLICY; Schema: public; Owner: neondb_owner
--

CREATE POLICY item_requests_member_select ON public.item_requests FOR SELECT;


--
-- Name: item_requests item_requests_member_update; Type: POLICY; Schema: public; Owner: neondb_owner
--

CREATE POLICY item_requests_member_update ON public.item_requests FOR UPDATE;


--
-- Name: item_requests item_requests_public_select; Type: POLICY; Schema: public; Owner: neondb_owner
--

CREATE POLICY item_requests_public_select ON public.item_requests FOR SELECT USING (((current_setting('app.context'::text, true) = 'public'::text) AND (status = 'active'::text) AND (NOT public.item_request_expired_on(deadline_type, deadline_date, expires_on, public.item_request_current_la_date())) AND (org_id IN ( SELECT o.id
   FROM public.organizations o
  WHERE ((o.status = 'approved'::text) AND (o.kind = ANY (ARRAY['member_org'::text, 'platform_owner'::text])))))));


--
-- Name: item_requests item_requests_system_staff_all; Type: POLICY; Schema: public; Owner: neondb_owner
--

CREATE POLICY item_requests_system_staff_all ON public.item_requests;


--
-- Name: items; Type: ROW SECURITY; Schema: public; Owner: neondb_owner
--

ALTER TABLE public.items ENABLE ROW LEVEL SECURITY;

--
-- Name: items items_member_all; Type: POLICY; Schema: public; Owner: neondb_owner
--

CREATE POLICY items_member_all ON public.items;


--
-- Name: items items_public_select; Type: POLICY; Schema: public; Owner: neondb_owner
--

CREATE POLICY items_public_select ON public.items FOR SELECT USING (((current_setting('app.context'::text, true) = 'public'::text) AND (EXISTS ( SELECT 1
   FROM (public.item_requests r
     JOIN public.organizations o ON ((o.id = r.org_id)))
  WHERE ((r.id = items.item_request_id) AND (r.status = 'active'::text) AND (NOT public.item_request_expired_on(r.deadline_type, r.deadline_date, r.expires_on, public.item_request_current_la_date())) AND (o.status = 'approved'::text) AND (o.kind = ANY (ARRAY['member_org'::text, 'platform_owner'::text])))))));


--
-- Name: items items_system_staff_all; Type: POLICY; Schema: public; Owner: neondb_owner
--

CREATE POLICY items_system_staff_all ON public.items;


--
-- Name: org_memberships; Type: ROW SECURITY; Schema: public; Owner: neondb_owner
--

ALTER TABLE public.org_memberships ENABLE ROW LEVEL SECURITY;

--
-- Name: org_memberships org_memberships_member_select_own; Type: POLICY; Schema: public; Owner: neondb_owner
--

CREATE POLICY org_memberships_member_select_own ON public.org_memberships FOR SELECT;


--
-- Name: org_memberships org_memberships_system_staff_all; Type: POLICY; Schema: public; Owner: neondb_owner
--

CREATE POLICY org_memberships_system_staff_all ON public.org_memberships;


--
-- Name: organization_context_actions; Type: ROW SECURITY; Schema: public; Owner: neondb_owner
--

ALTER TABLE public.organization_context_actions ENABLE ROW LEVEL SECURITY;

--
-- Name: organization_context_actions organization_context_actions_system_staff_all; Type: POLICY; Schema: public; Owner: neondb_owner
--

CREATE POLICY organization_context_actions_system_staff_all ON public.organization_context_actions;


--
-- Name: organization_populations; Type: ROW SECURITY; Schema: public; Owner: neondb_owner
--

ALTER TABLE public.organization_populations ENABLE ROW LEVEL SECURITY;

--
-- Name: organization_populations organization_populations_public_member_select; Type: POLICY; Schema: public; Owner: neondb_owner
--

CREATE POLICY organization_populations_public_member_select ON public.organization_populations FOR SELECT USING (((current_setting('app.context'::text, true) = ANY (ARRAY['public'::text, 'member'::text])) AND (EXISTS ( SELECT 1
   FROM public.organizations o
  WHERE ((o.id = organization_populations.org_id) AND (o.status = 'approved'::text))))));


--
-- Name: organization_populations organization_populations_system_staff_all; Type: POLICY; Schema: public; Owner: neondb_owner
--

CREATE POLICY organization_populations_system_staff_all ON public.organization_populations;


--
-- Name: organization_revisions; Type: ROW SECURITY; Schema: public; Owner: neondb_owner
--

ALTER TABLE public.organization_revisions ENABLE ROW LEVEL SECURITY;

--
-- Name: organization_revisions organization_revisions_system_staff_all; Type: POLICY; Schema: public; Owner: neondb_owner
--

CREATE POLICY organization_revisions_system_staff_all ON public.organization_revisions USING ((current_setting('app.context'::text, true) = ANY (ARRAY['system'::text, 'staff'::text]))) WITH CHECK ((current_setting('app.context'::text, true) = ANY (ARRAY['system'::text, 'staff'::text])));


--
-- Name: organizations; Type: ROW SECURITY; Schema: public; Owner: neondb_owner
--

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

--
-- Name: organizations organizations_member_select; Type: POLICY; Schema: public; Owner: neondb_owner
--

CREATE POLICY organizations_member_select ON public.organizations FOR SELECT;


--
-- Name: organizations organizations_member_update; Type: POLICY; Schema: public; Owner: neondb_owner
--

CREATE POLICY organizations_member_update ON public.organizations FOR UPDATE;


--
-- Name: organizations organizations_public_select; Type: POLICY; Schema: public; Owner: neondb_owner
--

CREATE POLICY organizations_public_select ON public.organizations FOR SELECT USING (((current_setting('app.context'::text, true) = 'public'::text) AND (status = 'approved'::text)));


--
-- Name: organizations organizations_system_staff_all; Type: POLICY; Schema: public; Owner: neondb_owner
--

CREATE POLICY organizations_system_staff_all ON public.organizations;


--
-- Name: participation_history; Type: ROW SECURITY; Schema: public; Owner: neondb_owner
--

ALTER TABLE public.participation_history ENABLE ROW LEVEL SECURITY;

--
-- Name: participation_history participation_history_system_staff_insert; Type: POLICY; Schema: public; Owner: neondb_owner
--

CREATE POLICY participation_history_system_staff_insert ON public.participation_history FOR INSERT WITH CHECK ((current_setting('app.context'::text, true) = ANY (ARRAY['system'::text, 'staff'::text])));


--
-- Name: participation_history participation_history_system_staff_select; Type: POLICY; Schema: public; Owner: neondb_owner
--

CREATE POLICY participation_history_system_staff_select ON public.participation_history FOR SELECT USING ((current_setting('app.context'::text, true) = ANY (ARRAY['system'::text, 'staff'::text])));


--
-- Name: people; Type: ROW SECURITY; Schema: public; Owner: neondb_owner
--

ALTER TABLE public.people ENABLE ROW LEVEL SECURITY;

--
-- Name: people people_member_select; Type: POLICY; Schema: public; Owner: neondb_owner
--

CREATE POLICY people_member_select ON public.people FOR SELECT;


--
-- Name: people people_system_staff_all; Type: POLICY; Schema: public; Owner: neondb_owner
--

CREATE POLICY people_system_staff_all ON public.people;


--
-- Name: person_volunteer_interests; Type: ROW SECURITY; Schema: public; Owner: neondb_owner
--

ALTER TABLE public.person_volunteer_interests ENABLE ROW LEVEL SECURITY;

--
-- Name: person_volunteer_interests person_volunteer_interests_member_delete; Type: POLICY; Schema: public; Owner: neondb_owner
--

CREATE POLICY person_volunteer_interests_member_delete ON public.person_volunteer_interests FOR DELETE;


--
-- Name: person_volunteer_interests person_volunteer_interests_member_insert; Type: POLICY; Schema: public; Owner: neondb_owner
--

CREATE POLICY person_volunteer_interests_member_insert ON public.person_volunteer_interests FOR INSERT;


--
-- Name: person_volunteer_interests person_volunteer_interests_member_select; Type: POLICY; Schema: public; Owner: neondb_owner
--

CREATE POLICY person_volunteer_interests_member_select ON public.person_volunteer_interests FOR SELECT;


--
-- Name: person_volunteer_interests person_volunteer_interests_system_staff_all; Type: POLICY; Schema: public; Owner: neondb_owner
--

CREATE POLICY person_volunteer_interests_system_staff_all ON public.person_volunteer_interests;


--
-- Name: populations; Type: ROW SECURITY; Schema: public; Owner: neondb_owner
--

ALTER TABLE public.populations ENABLE ROW LEVEL SECURITY;

--
-- Name: populations populations_public_member_select; Type: POLICY; Schema: public; Owner: neondb_owner
--

CREATE POLICY populations_public_member_select ON public.populations FOR SELECT;


--
-- Name: populations populations_system_staff_all; Type: POLICY; Schema: public; Owner: neondb_owner
--

CREATE POLICY populations_system_staff_all ON public.populations;


--
-- Name: request_engagement_events; Type: ROW SECURITY; Schema: public; Owner: neondb_owner
--

ALTER TABLE public.request_engagement_events ENABLE ROW LEVEL SECURITY;

--
-- Name: request_engagement_events request_engagement_events_system_staff_all; Type: POLICY; Schema: public; Owner: neondb_owner
--

CREATE POLICY request_engagement_events_system_staff_all ON public.request_engagement_events;


--
-- Name: request_revisions; Type: ROW SECURITY; Schema: public; Owner: neondb_owner
--

ALTER TABLE public.request_revisions ENABLE ROW LEVEL SECURITY;

--
-- Name: request_revisions request_revisions_system_staff_all; Type: POLICY; Schema: public; Owner: neondb_owner
--

CREATE POLICY request_revisions_system_staff_all ON public.request_revisions;


--
-- Name: site_settings; Type: ROW SECURITY; Schema: public; Owner: neondb_owner
--

ALTER TABLE public.site_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: site_settings site_settings_system_staff_all; Type: POLICY; Schema: public; Owner: neondb_owner
--

CREATE POLICY site_settings_system_staff_all ON public.site_settings USING ((current_setting('app.context'::text, true) = ANY (ARRAY['system'::text, 'staff'::text]))) WITH CHECK ((current_setting('app.context'::text, true) = ANY (ARRAY['system'::text, 'staff'::text])));


--
-- Name: storage_cleanup_queue; Type: ROW SECURITY; Schema: public; Owner: neondb_owner
--

ALTER TABLE public.storage_cleanup_queue ENABLE ROW LEVEL SECURITY;

--
-- Name: storage_cleanup_queue storage_cleanup_queue_system_staff_all; Type: POLICY; Schema: public; Owner: neondb_owner
--

CREATE POLICY storage_cleanup_queue_system_staff_all ON public.storage_cleanup_queue USING ((current_setting('app.context'::text, true) = ANY (ARRAY['system'::text, 'staff'::text]))) WITH CHECK ((current_setting('app.context'::text, true) = ANY (ARRAY['system'::text, 'staff'::text])));


--
-- Name: supporter_admin_audit; Type: ROW SECURITY; Schema: public; Owner: neondb_owner
--

ALTER TABLE public.supporter_admin_audit ENABLE ROW LEVEL SECURITY;

--
-- Name: supporter_admin_audit supporter_admin_audit_system_staff_all; Type: POLICY; Schema: public; Owner: neondb_owner
--

CREATE POLICY supporter_admin_audit_system_staff_all ON public.supporter_admin_audit USING ((current_setting('app.context'::text, true) = ANY (ARRAY['system'::text, 'staff'::text]))) WITH CHECK ((current_setting('app.context'::text, true) = ANY (ARRAY['system'::text, 'staff'::text])));


--
-- Name: supporter_impersonation_contexts; Type: ROW SECURITY; Schema: public; Owner: neondb_owner
--

ALTER TABLE public.supporter_impersonation_contexts ENABLE ROW LEVEL SECURITY;

--
-- Name: supporter_impersonation_contexts supporter_impersonation_contexts_system_staff_all; Type: POLICY; Schema: public; Owner: neondb_owner
--

CREATE POLICY supporter_impersonation_contexts_system_staff_all ON public.supporter_impersonation_contexts USING ((current_setting('app.context'::text, true) = ANY (ARRAY['system'::text, 'staff'::text]))) WITH CHECK ((current_setting('app.context'::text, true) = ANY (ARRAY['system'::text, 'staff'::text])));


--
-- Name: users; Type: ROW SECURITY; Schema: public; Owner: neondb_owner
--

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

--
-- Name: users users_member_select_self; Type: POLICY; Schema: public; Owner: neondb_owner
--

CREATE POLICY users_member_select_self ON public.users FOR SELECT;


--
-- Name: users users_system_staff_all; Type: POLICY; Schema: public; Owner: neondb_owner
--

CREATE POLICY users_system_staff_all ON public.users;


--
-- Name: volunteer_alert_preferences; Type: ROW SECURITY; Schema: public; Owner: neondb_owner
--

ALTER TABLE public.volunteer_alert_preferences ENABLE ROW LEVEL SECURITY;

--
-- Name: volunteer_alert_preferences volunteer_alert_preferences_member_insert; Type: POLICY; Schema: public; Owner: neondb_owner
--

CREATE POLICY volunteer_alert_preferences_member_insert ON public.volunteer_alert_preferences FOR INSERT;


--
-- Name: volunteer_alert_preferences volunteer_alert_preferences_member_select; Type: POLICY; Schema: public; Owner: neondb_owner
--

CREATE POLICY volunteer_alert_preferences_member_select ON public.volunteer_alert_preferences FOR SELECT;


--
-- Name: volunteer_alert_preferences volunteer_alert_preferences_member_update; Type: POLICY; Schema: public; Owner: neondb_owner
--

CREATE POLICY volunteer_alert_preferences_member_update ON public.volunteer_alert_preferences FOR UPDATE;


--
-- Name: volunteer_alert_preferences volunteer_alert_preferences_system_staff_all; Type: POLICY; Schema: public; Owner: neondb_owner
--

CREATE POLICY volunteer_alert_preferences_system_staff_all ON public.volunteer_alert_preferences;


--
-- Name: volunteer_categories; Type: ROW SECURITY; Schema: public; Owner: neondb_owner
--

ALTER TABLE public.volunteer_categories ENABLE ROW LEVEL SECURITY;

--
-- Name: volunteer_categories volunteer_categories_member_select; Type: POLICY; Schema: public; Owner: neondb_owner
--

CREATE POLICY volunteer_categories_member_select ON public.volunteer_categories FOR SELECT;


--
-- Name: volunteer_categories volunteer_categories_system_staff_all; Type: POLICY; Schema: public; Owner: neondb_owner
--

CREATE POLICY volunteer_categories_system_staff_all ON public.volunteer_categories;


--
-- Name: volunteer_match_alert_claims; Type: ROW SECURITY; Schema: public; Owner: neondb_owner
--

ALTER TABLE public.volunteer_match_alert_claims ENABLE ROW LEVEL SECURITY;

--
-- Name: volunteer_match_alert_claims volunteer_match_alert_claims_system_staff_all; Type: POLICY; Schema: public; Owner: neondb_owner
--

CREATE POLICY volunteer_match_alert_claims_system_staff_all ON public.volunteer_match_alert_claims;


--
-- Name: volunteer_request_categories; Type: ROW SECURITY; Schema: public; Owner: neondb_owner
--

ALTER TABLE public.volunteer_request_categories ENABLE ROW LEVEL SECURITY;

--
-- Name: volunteer_request_categories volunteer_request_categories_member_all; Type: POLICY; Schema: public; Owner: neondb_owner
--

CREATE POLICY volunteer_request_categories_member_all ON public.volunteer_request_categories;


--
-- Name: volunteer_request_categories volunteer_request_categories_system_staff_all; Type: POLICY; Schema: public; Owner: neondb_owner
--

CREATE POLICY volunteer_request_categories_system_staff_all ON public.volunteer_request_categories;


--
-- Name: volunteer_requests; Type: ROW SECURITY; Schema: public; Owner: neondb_owner
--

ALTER TABLE public.volunteer_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: volunteer_requests volunteer_requests_member_insert; Type: POLICY; Schema: public; Owner: neondb_owner
--

CREATE POLICY volunteer_requests_member_insert ON public.volunteer_requests FOR INSERT;


--
-- Name: volunteer_requests volunteer_requests_member_select; Type: POLICY; Schema: public; Owner: neondb_owner
--

CREATE POLICY volunteer_requests_member_select ON public.volunteer_requests FOR SELECT;


--
-- Name: volunteer_requests volunteer_requests_member_update; Type: POLICY; Schema: public; Owner: neondb_owner
--

CREATE POLICY volunteer_requests_member_update ON public.volunteer_requests FOR UPDATE;


--
-- Name: volunteer_requests volunteer_requests_public_select; Type: POLICY; Schema: public; Owner: neondb_owner
--

CREATE POLICY volunteer_requests_public_select ON public.volunteer_requests FOR SELECT USING (((current_setting('app.context'::text, true) = 'public'::text) AND (status = ANY (ARRAY['active'::text, 'archived'::text])) AND (org_id IN ( SELECT o.id
   FROM public.organizations o
  WHERE ((o.status = 'approved'::text) AND (o.kind = ANY (ARRAY['member_org'::text, 'platform_owner'::text])))))));


--
-- Name: volunteer_requests volunteer_requests_system_staff_all; Type: POLICY; Schema: public; Owner: neondb_owner
--

CREATE POLICY volunteer_requests_system_staff_all ON public.volunteer_requests;


--
-- Name: volunteer_roles; Type: ROW SECURITY; Schema: public; Owner: neondb_owner
--

ALTER TABLE public.volunteer_roles ENABLE ROW LEVEL SECURITY;

--
-- Name: volunteer_roles volunteer_roles_member_all; Type: POLICY; Schema: public; Owner: neondb_owner
--

CREATE POLICY volunteer_roles_member_all ON public.volunteer_roles;


--
-- Name: volunteer_roles volunteer_roles_public_select; Type: POLICY; Schema: public; Owner: neondb_owner
--

CREATE POLICY volunteer_roles_public_select ON public.volunteer_roles FOR SELECT USING (((current_setting('app.context'::text, true) = 'public'::text) AND (EXISTS ( SELECT 1
   FROM (public.volunteer_requests r
     JOIN public.organizations o ON ((o.id = r.org_id)))
  WHERE ((r.id = volunteer_roles.volunteer_request_id) AND (r.status = ANY (ARRAY['active'::text, 'archived'::text])) AND (o.status = 'approved'::text) AND (o.kind = ANY (ARRAY['member_org'::text, 'platform_owner'::text])))))));


--
-- Name: volunteer_roles volunteer_roles_system_staff_all; Type: POLICY; Schema: public; Owner: neondb_owner
--

CREATE POLICY volunteer_roles_system_staff_all ON public.volunteer_roles;


--
-- Name: volunteer_signup_roles; Type: ROW SECURITY; Schema: public; Owner: neondb_owner
--

ALTER TABLE public.volunteer_signup_roles ENABLE ROW LEVEL SECURITY;

--
-- Name: volunteer_signup_roles volunteer_signup_roles_member_select; Type: POLICY; Schema: public; Owner: neondb_owner
--

CREATE POLICY volunteer_signup_roles_member_select ON public.volunteer_signup_roles FOR SELECT;


--
-- Name: volunteer_signup_roles volunteer_signup_roles_system_staff_all; Type: POLICY; Schema: public; Owner: neondb_owner
--

CREATE POLICY volunteer_signup_roles_system_staff_all ON public.volunteer_signup_roles;


--
-- Name: volunteer_signups; Type: ROW SECURITY; Schema: public; Owner: neondb_owner
--

ALTER TABLE public.volunteer_signups ENABLE ROW LEVEL SECURITY;

--
-- Name: volunteer_signups volunteer_signups_member_select; Type: POLICY; Schema: public; Owner: neondb_owner
--

CREATE POLICY volunteer_signups_member_select ON public.volunteer_signups FOR SELECT;


--
-- Name: volunteer_signups volunteer_signups_system_staff_all; Type: POLICY; Schema: public; Owner: neondb_owner
--

CREATE POLICY volunteer_signups_system_staff_all ON public.volunteer_signups USING ((current_setting('app.context'::text, true) = ANY (ARRAY['system'::text, 'staff'::text]))) WITH CHECK ((current_setting('app.context'::text, true) = ANY (ARRAY['system'::text, 'staff'::text])));


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: cloud_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE cloud_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO neon_superuser WITH GRANT OPTION;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: cloud_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE cloud_admin IN SCHEMA public GRANT ALL ON TABLES TO neon_superuser WITH GRANT OPTION;


--
-- PostgreSQL database dump complete
--

\unrestrict GNBVqP7cppzR6h25gHRRsDbHQIvuZY2I209zuSlbwtIOErp93h0lAnNvMOo7rSK

