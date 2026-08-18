-- 0006_close_rls_and_counter_gaps.sql
--
-- Closes three gaps found in the 2026-08-17 schema audit:
--
--   1. Member orgs could update their own requests to status = 'active',
--      bypassing staff approval entirely. The approval gate existed only in
--      application code.
--   2. items_member_all and volunteer_roles_member_all are ALL policies, so a
--      member-context connection could write quantity_claimed and
--      quantity_interested directly. Counter drift is the fault this rebuild
--      exists to eliminate; the guarantee needs to hold in the database.
--   3. merge_people() did not write the approval_events row that 0001 declares
--      it writes, leaving the only irreversible operation in the system
--      unaudited unless the ADMIN-04 handler remembered.
--   4. The two counter functions were unreachable from the public pledge and
--      signup flows: people carries no public policy, so the person insert
--      failed under app.context = 'public'. They now run their bodies as
--      system and restore the caller's context before returning.
--
-- Approach: RLS scopes which ROWS an actor reaches. Triggers govern which
-- TRANSITIONS and which COLUMNS an actor may change. The two are not
-- interchangeable and this migration uses each for what it does.

begin;


-- ============================================================
-- 1. Counter write guard
-- ============================================================

-- items.quantity_claimed and volunteer_roles.quantity_interested are writable
-- only while app.counter_write is on. The two counter functions set that flag
-- transaction-locally around their own writes and clear it immediately. No
-- other code path sets it. This makes the "only these two functions write
-- counters" rule true rather than merely documented.
--
-- UPDATE only, deliberately: the migration load inserts items and roles with
-- counters already populated from legacy data, and \copy fires triggers.

create function guard_counter_columns() returns trigger as $$
begin
  if current_setting('app.counter_write', true) = 'on' then
    return new;
  end if;

  if tg_table_name = 'items'
     and new.quantity_claimed is distinct from old.quantity_claimed then
    raise exception
      'items.quantity_claimed is written only by record_item_pledge()';
  end if;

  if tg_table_name = 'volunteer_roles'
     and new.quantity_interested is distinct from old.quantity_interested then
    raise exception
      'volunteer_roles.quantity_interested is written only by record_volunteer_signup()';
  end if;

  return new;
end;
$$ language plpgsql;

create trigger items_guard_counters
  before update on items
  for each row execute function guard_counter_columns();

create trigger volunteer_roles_guard_counters
  before update on volunteer_roles
  for each row execute function guard_counter_columns();


-- ============================================================
-- 2. Member request transition guard
-- ============================================================

-- Allowed member transitions:
--   draft   -> pending    submit for approval
--   pending -> draft      withdraw a submission
--   active  -> archived   the org closes its own request early
--
-- Everything else, including any transition INTO 'active', is staff only.
-- Members also cannot stamp approval fields or move a request to another org.

create function guard_member_request_transitions() returns trigger as $$
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
$$ language plpgsql;

create trigger item_requests_guard_member_transitions
  before update on item_requests
  for each row execute function guard_member_request_transitions('item_request');

create trigger volunteer_requests_guard_member_transitions
  before update on volunteer_requests
  for each row execute function guard_member_request_transitions('volunteer_request');

-- The trigger above runs in member context, and approval_events currently
-- admits only system and staff. Narrow insert grant so the audit row lands.
create policy approval_events_member_insert on approval_events
  for insert
  with check (
    current_setting('app.context', true) = 'member'
    and entity_type in ('item_request', 'volunteer_request')
  );


-- ============================================================
-- 3. Counter functions: raise the write flag
-- ============================================================

-- Bodies are otherwise unchanged from the live definitions. The only edits are
-- the set_config() pair bracketing each counter write.

create or replace function record_item_pledge(
  p_first_name  text,
  p_last_name   text,
  p_email       text,
  p_phone       text,
  p_request_id  uuid,
  p_notes       text,
  p_lines       jsonb
) returns uuid as $$
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
$$ language plpgsql;


create or replace function record_volunteer_signup(
  p_first_name  text,
  p_last_name   text,
  p_email       text,
  p_phone       text,
  p_request_id  uuid,
  p_notes       text,
  p_role_ids    uuid[]
) returns uuid as $$
declare
  v_person_id         uuid;
  v_signup_id         uuid;
  v_role_id           uuid;
  v_remaining         integer;
  v_status            text;
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

  select status into v_status from volunteer_requests where id = p_request_id for update;
  if v_status is null then
    raise exception 'request_not_found';
  end if;
  if v_status is distinct from 'active' then
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
$$ language plpgsql;


-- ============================================================
-- 4. merge_people writes its audit row
-- ============================================================

-- Actor comes from app.user_id rather than a new parameter, so every existing
-- two-argument call site keeps working unchanged. ADMIN-04 already sets
-- app.user_id in staff context.

create or replace function merge_people(p_duplicate uuid, p_survivor uuid)
returns jsonb as $$
declare
  n_pledges int;
  n_signups int;
  n_users int;
  n_digest int;
  n_org_contacts int;
  n_email int;
  n_item_req_contacts int;
  n_vol_req_contacts int;
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

  -- Capture identifying detail before the row is gone, so the audit row still
  -- means something once the person no longer exists.
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

  -- Written before the delete: approval_events.entity_id is not a foreign key,
  -- but ordering keeps the row correct even if that ever changes.
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
    'volunteerRequestContacts', n_vol_req_contacts);
end;
$$ language plpgsql;

commit;