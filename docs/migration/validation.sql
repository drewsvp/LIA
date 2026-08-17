-- docs/migration/validation.sql
--
-- Post-import validation for the one-time legacy load. Run after the import
-- script completes and after counter recomputation. Every check returns rows
-- ONLY on failure, except the counts block, which always reports.
--
-- This is not a migration. It creates nothing and changes nothing. Run it with
-- psql -f and commit the output as the validation report required by
-- Handbook.md section 18.
--
-- Expected values are from docs/migration/data-audit.md, measured against the
-- 2026-08-14 export. If the source is re-pulled, re-run the audit first and
-- update the constants in section 1 before trusting a pass.
--
-- Usage:
--   psql "$DATABASE_URL" -f docs/migration/validation.sql > migration-validation-report.txt

\timing off
\pset pager off

\echo '======================================================================'
\echo ' LIA MIGRATION VALIDATION'
\echo '======================================================================'
\echo ''

-- ============================================================
-- 1. Row counts
-- ============================================================
-- Always reports. `delta` must be zero on every row except `people`, which has
-- no predictable expected value and is the duplicate-collapse headline number.

\echo '--- 1. ROW COUNTS ---'

with expected(tbl, n) as (values
  ('organizations',        50),   -- 49 migrated + 1 platform_owner
  ('item_requests',       116),   -- 120 source - 4 excluded
  ('items',               400),   -- 403 source - 3 excluded
  ('volunteer_requests',   24),
  ('volunteer_roles',      54),   -- 58 source - 4 excluded
  ('item_pledges',         83),
  ('volunteer_signups',    38),
  ('item_pledge_lines',   170),
  ('email_log',            47)    -- seeded org_approved rows
),
actual(tbl, n) as (
  select 'organizations',      count(*) from organizations
  union all select 'item_requests',      count(*) from item_requests
  union all select 'items',              count(*) from items
  union all select 'volunteer_requests', count(*) from volunteer_requests
  union all select 'volunteer_roles',    count(*) from volunteer_roles
  union all select 'item_pledges',       count(*) from item_pledges
  union all select 'volunteer_signups',  count(*) from volunteer_signups
  union all select 'item_pledge_lines',  count(*) from item_pledge_lines
  union all select 'email_log',          count(*) from email_log
)
select e.tbl, e.n as expected, a.n as actual, a.n - e.n as delta,
       case when a.n = e.n then 'PASS' else 'FAIL' end as result
  from expected e join actual a using (tbl)
 order by e.tbl;

\echo ''
\echo '--- 1b. PEOPLE (report only, no expected value) ---'
select count(*) as people_total,
       count(*) filter (where needs_review) as needs_review
  from people;

\echo ''
\echo '--- 1c. DUPLICATE COLLAPSE (judging package number) ---'
-- Source had 127 donor rows across 81 distinct emails.
select count(distinct p.id) as distinct_supporters,
       (select count(*) from item_pledges) + (select count(*) from volunteer_signups)
         as supporter_records,
       (select count(*) from item_pledges) + (select count(*) from volunteer_signups)
         - count(distinct p.id) as duplicates_collapsed
  from people p
 where exists (select 1 from item_pledges     ip where ip.person_id = p.id)
    or exists (select 1 from volunteer_signups vs where vs.person_id = p.id);

\echo ''
\echo '--- 1d. STATUS DISTRIBUTION (expect 43/69/6 and 12/11/1) ---'
select 'item_request' as kind, status, count(*) from item_requests group by status
union all
select 'volunteer_request', status, count(*) from volunteer_requests group by status
order by 1, 2;


-- ============================================================
-- 2. Referential integrity
-- ============================================================
-- Every query below MUST return zero rows.

\echo ''
\echo '--- 2. REFERENTIAL INTEGRITY (all must return 0 rows) ---'

\echo '2.1 item_requests with no organization'
select id, title from item_requests r
 where not exists (select 1 from organizations o where o.id = r.org_id);

\echo '2.2 volunteer_requests with no organization'
select id, title from volunteer_requests r
 where not exists (select 1 from organizations o where o.id = r.org_id);

\echo '2.3 items with no parent request'
select id, name from items i
 where not exists (select 1 from item_requests r where r.id = i.item_request_id);

\echo '2.4 volunteer_roles with no parent request'
select id, name from volunteer_roles vr
 where not exists (select 1 from volunteer_requests r where r.id = vr.volunteer_request_id);

\echo '2.5 pledge lines whose item belongs to a DIFFERENT request than the pledge'
-- The FK guarantees the item exists. This catches a cross-request line, which
-- the schema does not prevent and which record_item_pledge() would reject.
select l.id, l.item_pledge_id, l.item_id
  from item_pledge_lines l
  join item_pledges p on p.id = l.item_pledge_id
  join items i        on i.id = l.item_id
 where i.item_request_id <> p.item_request_id;

\echo '2.6 signup roles whose role belongs to a DIFFERENT request than the signup'
select sr.id, sr.volunteer_signup_id, sr.volunteer_role_id
  from volunteer_signup_roles sr
  join volunteer_signups s  on s.id  = sr.volunteer_signup_id
  join volunteer_roles   r  on r.id  = sr.volunteer_role_id
 where r.volunteer_request_id <> s.volunteer_request_id;

\echo '2.7 org_memberships with no user or no organization'
select m.id from org_memberships m
 where not exists (select 1 from users u         where u.id = m.user_id)
    or not exists (select 1 from organizations o where o.id = m.org_id);

\echo '2.8 pledges or signups with no person'
select 'item_pledge' as kind, id from item_pledges p
 where not exists (select 1 from people pe where pe.id = p.person_id)
union all
select 'volunteer_signup', id from volunteer_signups s
 where not exists (select 1 from people pe where pe.id = s.person_id);


-- ============================================================
-- 3. Counter integrity
-- ============================================================

\echo ''
\echo '--- 3. COUNTERS (all must return 0 rows) ---'

\echo '3.1 counter_drift view (the canonical check)'
select * from counter_drift;

\echo '3.2 items where claimed exceeds requested'
-- Five rows in the SOURCE had this. Zero are permitted after import.
select id, name, quantity_requested, quantity_claimed from items
 where quantity_claimed > quantity_requested;

\echo '3.3 volunteer roles where interested exceeds needed'
-- Not forbidden by the schema and not necessarily wrong, but worth seeing.
-- Report only; a row here is not a failure.
select id, name, quantity_needed, quantity_interested from volunteer_roles
 where quantity_interested > quantity_needed;

\echo '3.4 total pledge line quantity (expect 170 lines)'
select count(*) as lines, sum(quantity) as total_units from item_pledge_lines;


-- ============================================================
-- 4. Required-value integrity
-- ============================================================

\echo ''
\echo '--- 4. REQUIRED VALUES (all must return 0 rows) ---'

\echo '4.1 approved organizations with no city  [BLOCKING per field-map section 8]'
select id, name from organizations
 where status = 'approved' and (city is null or btrim(city) = '');

\echo '4.2 organizations with a missing or duplicate slug'
select id, name, slug from organizations where slug is null or btrim(slug) = ''
union all
select id, name, slug from organizations
 where slug in (select slug from organizations group by slug having count(*) > 1);

\echo '4.3 duplicate emails in people, case-insensitive'
select lower(email) as email, count(*) from people
 group by lower(email) having count(*) > 1;

\echo '4.4 active requests with no image_url'
select 'item_request' as kind, id, title from item_requests
 where status = 'active' and (image_url is null or image_url = '')
union all
select 'volunteer_request', id, title from volunteer_requests
 where status = 'active' and (image_url is null or image_url = '');

\echo '4.5 organizations with no logo_url'
select id, name from organizations
 where kind = 'member_org' and (logo_url is null or logo_url = '');

\echo '4.6 any image or logo URL still pointing at the source host  [D38]'
select 'item_request' as kind, id, image_url from item_requests where image_url like '%wixstatic%' or image_url like 'wix:%'
union all
select 'volunteer_request', id, image_url from volunteer_requests where image_url like '%wixstatic%' or image_url like 'wix:%'
union all
select 'organization', id, logo_url from organizations where logo_url like '%wixstatic%' or logo_url like 'wix:%';

\echo '4.7 date_specific requests with no deadline_date  [CHECK constraint backstop]'
select 'item_request' as kind, id from item_requests
 where deadline_type = 'date_specific' and deadline_date is null
union all
select 'volunteer_request', id from volunteer_requests
 where deadline_type = 'date_specific' and deadline_date is null;


-- ============================================================
-- 5. Policy compliance
-- ============================================================

\echo ''
\echo '--- 5. POLICY (all must return 0 rows) ---'

\echo '5.1 historical batch rows with a non-null approved_at or submitted_at  [D43, D48]'
-- Migrated rows carry legacy_wix_id. Any of them with an approval timestamp
-- means the import fabricated history.
select 'item_request' as kind, id, approved_at, submitted_at from item_requests
 where legacy_wix_id is not null and (approved_at is not null or submitted_at is not null)
union all
select 'volunteer_request', id, approved_at, submitted_at from volunteer_requests
 where legacy_wix_id is not null and (approved_at is not null or submitted_at is not null);

\echo '5.2 backfilled approval_events  [D36 forbids any]'
select count(*) as events_before_cutover from approval_events;

\echo '5.3 migrated rows carrying an archived_reason  [source cannot distinguish]'
select 'item_request' as kind, id, archived_reason from item_requests
 where legacy_wix_id is not null and archived_reason is not null
union all
select 'volunteer_request', id, archived_reason from volunteer_requests
 where legacy_wix_id is not null and archived_reason is not null;

\echo '5.4 people with no email should never load (ADMIN-04)'
-- Missing-email records are excluded at transform time; this should always return zero rows.
select p.id, p.email
  from people p
 where p.email is null or trim(p.email) = '';

\echo '5.5 duplicate legacy_wix_id within a table'
select 'organizations' as tbl, legacy_wix_id from organizations
 where legacy_wix_id is not null group by 1,2 having count(*) > 1
union all select 'item_requests', legacy_wix_id from item_requests
 where legacy_wix_id is not null group by 1,2 having count(*) > 1
union all select 'items', legacy_wix_id from items
 where legacy_wix_id is not null group by 1,2 having count(*) > 1
union all select 'volunteer_requests', legacy_wix_id from volunteer_requests
 where legacy_wix_id is not null group by 1,2 having count(*) > 1
union all select 'volunteer_roles', legacy_wix_id from volunteer_roles
 where legacy_wix_id is not null group by 1,2 having count(*) > 1;


-- ============================================================
-- 6. Public-surface smoke checks
-- ============================================================
-- Not integrity failures, but a row here means something renders wrong on a
-- public page. Section 16 of Handbook.md, failure two: "blank org website".

\echo ''
\echo '--- 6. PUBLIC SURFACE (all must return 0 rows) ---'

\echo '6.1 active requests whose organization is not an approved member_org'
select 'item_request' as kind, r.id, r.title, o.name, o.status, o.kind
  from item_requests r join organizations o on o.id = r.org_id
 where r.status = 'active' and (o.status <> 'approved' or o.kind <> 'member_org')
union all
select 'volunteer_request', r.id, r.title, o.name, o.status, o.kind
  from volunteer_requests r join organizations o on o.id = r.org_id
 where r.status = 'active' and (o.status <> 'approved' or o.kind <> 'member_org');

\echo '6.2 active item requests with zero items'
select r.id, r.title from item_requests r
 where r.status = 'active'
   and not exists (select 1 from items i where i.item_request_id = r.id);

\echo '6.3 active volunteer requests with zero roles'
select r.id, r.title from volunteer_requests r
 where r.status = 'active'
   and not exists (select 1 from volunteer_roles vr where vr.volunteer_request_id = r.id);

\echo '6.4 organizations with no populations assigned'
select o.id, o.name from organizations o
 where o.kind = 'member_org'
   and not exists (select 1 from organization_populations op where op.org_id = o.id);

\echo '6.5 populations count (expect 11: ten canonical plus Other per D61)'
select count(*) as populations, count(*) filter (where is_active) as active from populations;


-- ============================================================
-- 7. Legacy redirects
-- ============================================================

\echo ''
\echo '--- 7. REDIRECTS ---'
\echo '7.1 legacy_wix_id coverage on request tables (drives /area-needs-request/:id)'
select 'item_requests' as tbl,
       count(*) as total,
       count(legacy_wix_id) as with_legacy_id,
       count(*) - count(legacy_wix_id) as missing
  from item_requests
union all
select 'volunteer_requests', count(*), count(legacy_wix_id), count(*) - count(legacy_wix_id)
  from volunteer_requests;

\echo ''
\echo '======================================================================'
\echo ' END. Every section above except 1 and 7 must show zero rows.'
\echo ' Commit this output as migration-validation-report.txt.'
\echo '======================================================================'
