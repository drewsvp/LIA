-- Restore routine parity between development and production.
--
-- Why this exists: production's schema is kept in step by Replit's publish
-- diff, which carries tables and columns but NOT functions or triggers. Every
-- migration from 0008 onward was applied to development only, so production
-- ended up with the right tables and a shrinking set of the routines those
-- tables depend on — item pledges on an expired request, for example, were no
-- longer rejected at the database level because reject_expired_item_pledge()
-- and the trigger that calls it were never created there.
--
-- Every statement below is idempotent: functions are replaced, triggers are
-- dropped and recreated. Applying this to a database that already has all of
-- them is a no-op in effect. The definitions are taken verbatim from the
-- development database, which is the applied state of migrations 0001-0044.
--
-- This is a repair migration. New routines still belong in their own
-- migration; do not extend this file.


-- Functions

CREATE OR REPLACE FUNCTION public.guard_counter_columns()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.guard_member_request_transitions()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.item_request_current_la_date()
 RETURNS date
 LANGUAGE sql
AS $function$
  select (clock_timestamp() at time zone 'America/Los_Angeles')::date;
$function$;

CREATE OR REPLACE FUNCTION public.item_request_expired_on(p_deadline_type text, p_deadline_date date, p_expires_on date, p_today date)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select
    (p_expires_on is not null and p_expires_on < p_today)
    or (
      p_deadline_type = 'date_specific'
      and p_deadline_date is not null
      and p_deadline_date < p_today
    );
$function$;

CREATE OR REPLACE FUNCTION public.merge_people(p_duplicate uuid, p_survivor uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
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
    from person_volunteer_interests
   where person_id = p_duplicate;

  insert into person_volunteer_interests (person_id, category_id)
  select p_survivor, category_id
    from person_volunteer_interests
   where person_id = p_duplicate
  on conflict do nothing;

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
$function$;

CREATE OR REPLACE FUNCTION public.record_item_pledge(p_first_name text, p_last_name text, p_email text, p_phone text, p_request_id uuid, p_notes text, p_lines jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.record_volunteer_signup(p_first_name text, p_last_name text, p_email text, p_phone text, p_request_id uuid, p_notes text, p_role_ids uuid[])
 RETURNS uuid
 LANGUAGE plpgsql
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.reject_expired_item_pledge()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;


-- Triggers

drop trigger if exists item_pledges_reject_expired_request on public.item_pledges;
CREATE TRIGGER item_pledges_reject_expired_request BEFORE INSERT ON public.item_pledges FOR EACH ROW EXECUTE FUNCTION reject_expired_item_pledge();

drop trigger if exists item_pledges_set_updated_at on public.item_pledges;
CREATE TRIGGER item_pledges_set_updated_at BEFORE UPDATE ON public.item_pledges FOR EACH ROW EXECUTE FUNCTION set_updated_at();

drop trigger if exists item_requests_guard_member_transitions on public.item_requests;
CREATE TRIGGER item_requests_guard_member_transitions BEFORE UPDATE ON public.item_requests FOR EACH ROW EXECUTE FUNCTION guard_member_request_transitions('item_request');

drop trigger if exists item_requests_set_updated_at on public.item_requests;
CREATE TRIGGER item_requests_set_updated_at BEFORE UPDATE ON public.item_requests FOR EACH ROW EXECUTE FUNCTION set_updated_at();

drop trigger if exists items_guard_counters on public.items;
CREATE TRIGGER items_guard_counters BEFORE UPDATE ON public.items FOR EACH ROW EXECUTE FUNCTION guard_counter_columns();

drop trigger if exists items_set_updated_at on public.items;
CREATE TRIGGER items_set_updated_at BEFORE UPDATE ON public.items FOR EACH ROW EXECUTE FUNCTION set_updated_at();

drop trigger if exists org_memberships_set_updated_at on public.org_memberships;
CREATE TRIGGER org_memberships_set_updated_at BEFORE UPDATE ON public.org_memberships FOR EACH ROW EXECUTE FUNCTION set_updated_at();

drop trigger if exists organizations_set_updated_at on public.organizations;
CREATE TRIGGER organizations_set_updated_at BEFORE UPDATE ON public.organizations FOR EACH ROW EXECUTE FUNCTION set_updated_at();

drop trigger if exists people_set_updated_at on public.people;
CREATE TRIGGER people_set_updated_at BEFORE UPDATE ON public.people FOR EACH ROW EXECUTE FUNCTION set_updated_at();

drop trigger if exists users_set_updated_at on public.users;
CREATE TRIGGER users_set_updated_at BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION set_updated_at();

drop trigger if exists volunteer_alert_preferences_set_updated_at on public.volunteer_alert_preferences;
CREATE TRIGGER volunteer_alert_preferences_set_updated_at BEFORE UPDATE ON public.volunteer_alert_preferences FOR EACH ROW EXECUTE FUNCTION set_updated_at();

drop trigger if exists volunteer_requests_guard_member_transitions on public.volunteer_requests;
CREATE TRIGGER volunteer_requests_guard_member_transitions BEFORE UPDATE ON public.volunteer_requests FOR EACH ROW EXECUTE FUNCTION guard_member_request_transitions('volunteer_request');

drop trigger if exists volunteer_requests_set_updated_at on public.volunteer_requests;
CREATE TRIGGER volunteer_requests_set_updated_at BEFORE UPDATE ON public.volunteer_requests FOR EACH ROW EXECUTE FUNCTION set_updated_at();

drop trigger if exists volunteer_roles_guard_counters on public.volunteer_roles;
CREATE TRIGGER volunteer_roles_guard_counters BEFORE UPDATE ON public.volunteer_roles FOR EACH ROW EXECUTE FUNCTION guard_counter_columns();

drop trigger if exists volunteer_roles_set_updated_at on public.volunteer_roles;
CREATE TRIGGER volunteer_roles_set_updated_at BEFORE UPDATE ON public.volunteer_roles FOR EACH ROW EXECUTE FUNCTION set_updated_at();

drop trigger if exists volunteer_signups_set_updated_at on public.volunteer_signups;
CREATE TRIGGER volunteer_signups_set_updated_at BEFORE UPDATE ON public.volunteer_signups FOR EACH ROW EXECUTE FUNCTION set_updated_at();

