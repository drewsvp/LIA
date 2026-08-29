-- Protect login-account email identity at the database boundary.
--
-- Application DAL checks provide readable errors, while this trigger prevents
-- an out-of-band people update from changing the email behind an account.
-- Existing mismatches are intentionally not repaired; the admin integrity
-- report exposes them for explicit review.

create or replace function protect_account_email_identity()
returns trigger as $$
begin
  if lower(btrim(old.email)) is distinct from lower(btrim(new.email))
     and exists (select 1 from users where person_id = old.id) then
    raise exception 'account_email_immutable'
      using hint = 'A linked login account must retain its email identity.';
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists people_protect_account_email_identity on people;
create trigger people_protect_account_email_identity
  before update of email on people
  for each row execute function protect_account_email_identity();

-- Keep the SQL merge routine safe when called without the application service.
create or replace function public.merge_people(p_duplicate uuid, p_survivor uuid)
returns jsonb
language plpgsql
as $function$
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
$function$;