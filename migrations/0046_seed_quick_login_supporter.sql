-- Create the supporter quick-login account in every environment where the seed
-- has not been run.
--
-- Context: the quick-login panel checks that all four test accounts exist and
-- are active before showing clickable buttons. Three of the four (staff admin,
-- staff approver, org owner) were created by hand in production while setting
-- up the real Alliance data. Only supporter@example.org was missing, so the
-- panel always showed "Seed not yet run" and blocked all four buttons.
--
-- This migration is idempotent: both inserts are guarded by a people-email
-- lookup and a users-person_id lookup, so re-running against a database that
-- already has Alex Rivera is a no-op.

do $$
declare
  v_person_id uuid;
  v_user_id   uuid;
begin
  -- 1. Find or create the person row.
  select id into v_person_id
    from people
   where lower(email) = 'supporter@example.org'
   limit 1;

  if v_person_id is null then
    insert into people (first_name, last_name, email, source_note)
    values ('Alex', 'Rivera', 'supporter@example.org', 'migration')
    returning id into v_person_id;
  end if;

  -- 2. Find or create the user row.
  select id into v_user_id
    from users
   where person_id = v_person_id
   limit 1;

  if v_user_id is null then
    insert into users (person_id, status, kind)
    values (v_person_id, 'active', 'supporter');
  end if;
end $$;
