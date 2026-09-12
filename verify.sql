\pset pager off
\echo '--- A. quick-login accounts (all four must exist and be active) ---'
select a.email,
       case when u.id is null then 'MISSING' else u.status end as user_status,
       u.kind
from (values ('tiffany@defendingthecause.org'),
             ('approver@thealliance.example.org'),
             ('dana@heartsandhands.example.org'),
             ('supporter@example.org')) as a(email)
left join people p on lower(btrim(p.email)) = a.email
left join users u on u.person_id = p.id
order by a.email;

\echo ''
\echo '--- B. public item browse ---'
select count(*) as active_item_requests_public
from item_requests r join organizations o on o.id = r.org_id
where r.status = 'active' and o.status = 'approved';

\echo ''
\echo '--- C. public volunteer browse ---'
select count(*) as active_volunteer_requests_public
from volunteer_requests r join organizations o on o.id = r.org_id
where r.status = 'active' and o.status = 'approved';

\echo ''
\echo '--- D. org profile pages that resolve ---'
select count(*) as approved_orgs_with_slug
from organizations where status = 'approved' and slug is not null;

\echo ''
\echo '--- E. digest audience ---'
select status, count(*) from digest_subscribers group by status order by status;

\echo ''
\echo '--- F. accounts by kind and status ---'
select u.kind, u.status, count(*) from users u group by u.kind, u.status order by u.kind, u.status;

\echo ''
\echo '--- G. sample active needs as the public sees them ---'
select o.name as org, r.title, r.deadline_type
from item_requests r join organizations o on o.id = r.org_id
where r.status = 'active' and o.status = 'approved'
order by r.created_at desc limit 5;
