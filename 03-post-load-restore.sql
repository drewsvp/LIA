\set ON_ERROR_STOP on
begin;

insert into email_schedules select * from _cutover_keep_email_schedules on conflict do nothing;
update email_schedules set updated_by = null where updated_by is not null;

insert into site_settings select * from _cutover_keep_site_settings on conflict do nothing;
update site_settings set updated_by = null where updated_by is not null;

insert into email_brand_settings select * from _cutover_keep_email_brand_settings on conflict do nothing;
update email_brand_settings set updated_by = null where updated_by is not null;

insert into email_template_overrides select * from _cutover_keep_email_template_overrides on conflict do nothing;
update email_template_overrides set updated_by = null where updated_by is not null;

insert into people (id, first_name, last_name, email, needs_review)
values (gen_random_uuid(), 'Christina', 'Moe', 'christina@defendingthecause.org', false)
on conflict (lower(btrim(email))) do nothing;

insert into people (id, first_name, last_name, email, needs_review)
values (gen_random_uuid(), 'Tiffany', 'Loeffler', 'tiffany@defendingthecause.org', false)
on conflict (lower(btrim(email))) do nothing;

insert into users (id, person_id, status, kind)
select gen_random_uuid(), p.id, 'active', 'member'
from people p
where lower(btrim(p.email)) in
      ('christina@defendingthecause.org', 'tiffany@defendingthecause.org')
  and not exists (select 1 from users u where u.person_id = p.id);

insert into org_memberships (id, org_id, user_id, role, status)
select gen_random_uuid(), o.id, u.id, 'staff_admin', 'active'
from organizations o
join people p on lower(btrim(p.email)) in
     ('christina@defendingthecause.org', 'tiffany@defendingthecause.org')
join users u on u.person_id = p.id
where o.kind = 'platform_owner'
  and not exists (
    select 1 from org_memberships m where m.org_id = o.id and m.user_id = u.id
  );

update org_memberships m
   set role = 'staff_admin', status = 'active'
  from organizations o, users u, people p
 where m.org_id = o.id
   and o.kind = 'platform_owner'
   and m.user_id = u.id
   and u.person_id = p.id
   and lower(btrim(p.email)) in
       ('christina@defendingthecause.org', 'tiffany@defendingthecause.org')
   and (m.role <> 'staff_admin' or m.status <> 'active');

commit;
