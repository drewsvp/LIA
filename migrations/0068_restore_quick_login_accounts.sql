-- Production intentionally keeps Quick Login enabled for owner testing.
-- Restore only the four allowlisted test identities and the minimum
-- organization memberships they need. Do not run the full demo seed against
-- a live database and do not create Better Auth-owned user/account rows:
-- Better Auth links auth_subject on the first quick login.

do $migration$
declare
  v_tiffany_person uuid;
  v_riley_person uuid;
  v_dana_person uuid;
  v_alex_person uuid;
  v_tiffany_user uuid;
  v_riley_user uuid;
  v_dana_user uuid;
  v_alex_user uuid;
  v_alliance uuid;
  v_hearts uuid;
  v_status text;
  v_kind text;
  v_role text;
  v_membership_status text;
begin
  perform pg_advisory_xact_lock(hashtextextended('lia.quick-login-accounts.v1', 0));

  insert into people (first_name, last_name, email, source_note)
  values ('Tiffany', 'Loeffler', 'tiffany@defendingthecause.org', 'quick-login migration')
  on conflict do nothing;
  insert into people (first_name, last_name, email, source_note)
  values ('Riley', 'Chen', 'approver@thealliance.example.org', 'quick-login migration')
  on conflict do nothing;
  insert into people (first_name, last_name, email, source_note)
  values ('Dana', 'Whitfield', 'dana@heartsandhands.example.org', 'quick-login migration')
  on conflict do nothing;
  insert into people (first_name, last_name, email, source_note)
  values ('Alex', 'Rivera', 'supporter@example.org', 'quick-login migration')
  on conflict do nothing;

  select id into strict v_tiffany_person from people where lower(btrim(email)) = 'tiffany@defendingthecause.org';
  select id into strict v_riley_person from people where lower(btrim(email)) = 'approver@thealliance.example.org';
  select id into strict v_dana_person from people where lower(btrim(email)) = 'dana@heartsandhands.example.org';
  select id into strict v_alex_person from people where lower(btrim(email)) = 'supporter@example.org';

  insert into users (person_id, status, kind)
  values (v_tiffany_person, 'active', 'member')
  on conflict (person_id) do nothing;
  insert into users (person_id, status, kind)
  values (v_riley_person, 'active', 'member')
  on conflict (person_id) do nothing;
  insert into users (person_id, status, kind)
  values (v_dana_person, 'active', 'member')
  on conflict (person_id) do nothing;
  insert into users (person_id, status, kind)
  values (v_alex_person, 'active', 'supporter')
  on conflict (person_id) do nothing;

  select id, status, kind into strict v_tiffany_user, v_status, v_kind from users where person_id = v_tiffany_person;
  if v_kind <> 'member' or v_status = 'disabled' then
    raise exception 'quick-login Tiffany account has unexpected kind/status: %/%', v_kind, v_status;
  end if;
  update users set status = 'active', updated_at = now()
  where id = v_tiffany_user and status = 'invited';

  select id, status, kind into strict v_riley_user, v_status, v_kind from users where person_id = v_riley_person;
  if v_kind <> 'member' or v_status = 'disabled' then
    raise exception 'quick-login Riley account has unexpected kind/status: %/%', v_kind, v_status;
  end if;
  update users set status = 'active', updated_at = now()
  where id = v_riley_user and status = 'invited';

  select id, status, kind into strict v_dana_user, v_status, v_kind from users where person_id = v_dana_person;
  if v_kind <> 'member' or v_status = 'disabled' then
    raise exception 'quick-login Dana account has unexpected kind/status: %/%', v_kind, v_status;
  end if;
  update users set status = 'active', updated_at = now()
  where id = v_dana_user and status = 'invited';

  select id, status, kind into strict v_alex_user, v_status, v_kind from users where person_id = v_alex_person;
  if v_kind <> 'supporter' or v_status = 'disabled' then
    raise exception 'quick-login Alex account has unexpected kind/status: %/%', v_kind, v_status;
  end if;
  update users set status = 'active', updated_at = now()
  where id = v_alex_user and status = 'invited';

  select id into v_alliance
  from organizations
  where slug = 'the-alliance' and kind = 'platform_owner' and status = 'approved';
  if v_alliance is null then
    raise exception 'quick-login migration requires approved platform owner organization "the-alliance"';
  end if;

  insert into organizations (
    kind, name, slug, website_url, mission, city, state,
    primary_contact_person_id, status, approved_at, approved_by
  )
  values (
    'member_org',
    'Hearts & Hands Family Services',
    'hearts-hands-family-services',
    'https://heartsandhands.example.org',
    'Wrapping foster and adoptive families in practical, hands-on support from placement day forward.',
    'Roseville',
    'CA',
    v_dana_person,
    'approved',
    now(),
    v_tiffany_user
  )
  on conflict (slug) do nothing;

  select id into v_hearts
  from organizations
  where slug = 'hearts-hands-family-services'
    and kind = 'member_org'
    and status = 'approved';
  if v_hearts is null then
    raise exception 'quick-login organization "hearts-hands-family-services" has unexpected kind/status';
  end if;

  insert into org_memberships (org_id, user_id, role, status, approved_at, approved_by)
  values
    (v_alliance, v_tiffany_user, 'staff_admin', 'active', now(), v_tiffany_user),
    (v_alliance, v_riley_user, 'staff_approver', 'active', now(), v_tiffany_user),
    (v_hearts, v_dana_user, 'owner', 'active', now(), v_tiffany_user)
  on conflict (org_id, user_id) do nothing;

  select role, status into strict v_role, v_membership_status
  from org_memberships where org_id = v_alliance and user_id = v_tiffany_user;
  if v_role <> 'staff_admin' or v_membership_status <> 'active' then
    raise exception 'quick-login Tiffany membership has unexpected role/status: %/%', v_role, v_membership_status;
  end if;

  select role, status into strict v_role, v_membership_status
  from org_memberships where org_id = v_alliance and user_id = v_riley_user;
  if v_role <> 'staff_approver' or v_membership_status <> 'active' then
    raise exception 'quick-login Riley membership has unexpected role/status: %/%', v_role, v_membership_status;
  end if;

  select role, status into strict v_role, v_membership_status
  from org_memberships where org_id = v_hearts and user_id = v_dana_user;
  if v_role <> 'owner' or v_membership_status <> 'active' then
    raise exception 'quick-login Dana membership has unexpected role/status: %/%', v_role, v_membership_status;
  end if;
end
$migration$;