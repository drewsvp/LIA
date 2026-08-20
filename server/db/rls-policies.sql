-- rls-policies.sql
-- Row-level security for the application tables (Handbook §6: permission
-- checks enforced with row-level security in addition to the server-side
-- guards). This file is AUTH INFRASTRUCTURE, applied idempotently at setup by
-- `npm run db:apply-rls`. It is not a numbered schema migration and it does
-- not alter any table, column, index, function, or view defined in
-- migrations/0001_initial_schema.sql.
--
-- Model
-- -----
-- The app connects as a single role (the table owner), so RLS is FORCEd and
-- policies read two transaction-local GUCs set by server/db/client.ts:
--
--   app.context: 'system' | 'public' | 'member' | 'staff'
--   app.user_id: application users.id for member/staff contexts
--
-- system  — trusted server paths: the seed, the counter functions' callers,
--           narrow DAL operations that run after a guard has already verified
--           access (e.g. creating people during an invite).
-- staff   — set by the staff guard after verifying an active staff membership
--           in the platform_owner organization.
-- member  — set by the organization guard; policies scope every read/write to
--           organizations where app.user_id holds an ACTIVE membership.
-- public  — unauthenticated browsing; read-only, approved orgs, active (and
--           archived, for fulfilled-request pages) requests only.
--
-- A query with no context set matches no policy and sees nothing: loud
-- failure by default.
--
-- This protects against the bug class that matters most here — a missing or
-- wrong org filter leaking one organization's data to another, or draft/
-- pending data to the public. The GUC is asserted by our own server, so this
-- is defense in depth behind the guards, not a substitute for them.
--
-- org_memberships' member policy is deliberately "own rows only" (a policy
-- must not subquery its own table — Postgres raises infinite recursion).
-- Surfaces that list an organization's other members run through the DAL in
-- system context after the guard has verified org access.

-- ---------------------------------------------------------------- helpers
-- (inlined into policies: current_setting(..., true) returns NULL when unset)

-- ---------------------------------------------------------------- people

alter table people enable row level security;
alter table people force row level security;

drop policy if exists people_system_staff_all on people;
create policy people_system_staff_all on people
  using (current_setting('app.context', true) in ('system','staff'))
  with check (current_setting('app.context', true) in ('system','staff'));

drop policy if exists people_member_select on people;
create policy people_member_select on people for select
  using (
    current_setting('app.context', true) = 'member'
    and (
      exists (
        select 1 from item_pledges ip
        join item_requests ir on ir.id = ip.item_request_id
        where ip.person_id = people.id
          and ir.org_id in (
            select om.org_id from org_memberships om
            where om.user_id = nullif(current_setting('app.user_id', true), '')::uuid
              and om.status = 'active')
      )
      or exists (
        select 1 from volunteer_signups vs
        join volunteer_requests vr on vr.id = vs.volunteer_request_id
        where vs.person_id = people.id
          and vr.org_id in (
            select om.org_id from org_memberships om
            where om.user_id = nullif(current_setting('app.user_id', true), '')::uuid
              and om.status = 'active')
      )
      or exists (
        select 1 from organizations o
        where o.primary_contact_person_id = people.id
          and o.id in (
            select om.org_id from org_memberships om
            where om.user_id = nullif(current_setting('app.user_id', true), '')::uuid
              and om.status = 'active')
      )
      or exists (
        select 1 from users u
        where u.person_id = people.id
          and u.id = nullif(current_setting('app.user_id', true), '')::uuid
      )
    )
  );

-- ---------------------------------------------------------------- users

alter table users enable row level security;
alter table users force row level security;

drop policy if exists users_system_staff_all on users;
create policy users_system_staff_all on users
  using (current_setting('app.context', true) in ('system','staff'))
  with check (current_setting('app.context', true) in ('system','staff'));

drop policy if exists users_member_select_self on users;
create policy users_member_select_self on users for select
  using (
    current_setting('app.context', true) = 'member'
    and id = nullif(current_setting('app.user_id', true), '')::uuid
  );

-- ---------------------------------------------------------------- organizations

alter table organizations enable row level security;
alter table organizations force row level security;

drop policy if exists organizations_system_staff_all on organizations;
create policy organizations_system_staff_all on organizations
  using (current_setting('app.context', true) in ('system','staff'))
  with check (current_setting('app.context', true) in ('system','staff'));

drop policy if exists organizations_public_select on organizations;
create policy organizations_public_select on organizations for select
  using (
    current_setting('app.context', true) = 'public'
    and kind = 'member_org' and status = 'approved'
  );

drop policy if exists organizations_member_select on organizations;
create policy organizations_member_select on organizations for select
  using (
    current_setting('app.context', true) = 'member'
    and (
      id in (
        select om.org_id from org_memberships om
        where om.user_id = nullif(current_setting('app.user_id', true), '')::uuid
          and om.status = 'active')
      or (kind = 'member_org' and status = 'approved')
    )
  );

drop policy if exists organizations_member_update on organizations;
create policy organizations_member_update on organizations for update
  using (
    current_setting('app.context', true) = 'member'
    and id in (
      select om.org_id from org_memberships om
      where om.user_id = nullif(current_setting('app.user_id', true), '')::uuid
        and om.status = 'active')
  )
  with check (
    current_setting('app.context', true) = 'member'
    and id in (
      select om.org_id from org_memberships om
      where om.user_id = nullif(current_setting('app.user_id', true), '')::uuid
        and om.status = 'active')
  );

-- ---------------------------------------------------------------- org_memberships

alter table org_memberships enable row level security;
alter table org_memberships force row level security;

drop policy if exists org_memberships_system_staff_all on org_memberships;
create policy org_memberships_system_staff_all on org_memberships
  using (current_setting('app.context', true) in ('system','staff'))
  with check (current_setting('app.context', true) in ('system','staff'));

drop policy if exists org_memberships_member_select_own on org_memberships;
create policy org_memberships_member_select_own on org_memberships for select
  using (
    current_setting('app.context', true) = 'member'
    and user_id = nullif(current_setting('app.user_id', true), '')::uuid
  );

-- ---------------------------------------------------------------- populations

alter table populations enable row level security;
alter table populations force row level security;

drop policy if exists populations_system_staff_all on populations;
create policy populations_system_staff_all on populations
  using (current_setting('app.context', true) in ('system','staff'))
  with check (current_setting('app.context', true) in ('system','staff'));

drop policy if exists populations_public_member_select on populations;
create policy populations_public_member_select on populations for select
  using (
    current_setting('app.context', true) in ('public','member')
    and is_active
  );

-- ---------------------------------------------------------------- organization_populations

alter table organization_populations enable row level security;
alter table organization_populations force row level security;

drop policy if exists organization_populations_system_staff_all on organization_populations;
create policy organization_populations_system_staff_all on organization_populations
  using (current_setting('app.context', true) in ('system','staff'))
  with check (current_setting('app.context', true) in ('system','staff'));

drop policy if exists organization_populations_public_member_select on organization_populations;
-- Restates the parent org predicates (kept in lockstep with migration
-- 0007_scope_public_child_policies.sql). Member context keeps its broader
-- reach here: a member org reads populations for any approved member org,
-- matching organizations_member_select.
create policy organization_populations_public_member_select on organization_populations
  for select
  using (
    current_setting('app.context', true) in ('public', 'member')
    and exists (
      select 1
        from organizations o
       where o.id = organization_populations.org_id
         and o.kind = 'member_org'
         and o.status = 'approved'
    )
  );

-- ---------------------------------------------------------------- volunteer_categories

alter table volunteer_categories enable row level security;
alter table volunteer_categories force row level security;

drop policy if exists volunteer_categories_system_staff_all on volunteer_categories;
create policy volunteer_categories_system_staff_all on volunteer_categories
  using (current_setting('app.context', true) in ('system','staff'))
  with check (current_setting('app.context', true) in ('system','staff'));

drop policy if exists volunteer_categories_member_select on volunteer_categories;
create policy volunteer_categories_member_select on volunteer_categories for select
  using (
    current_setting('app.context', true) = 'member'
  );

-- -------------------------------------------------------- person_volunteer_interests

alter table person_volunteer_interests enable row level security;
alter table person_volunteer_interests force row level security;

drop policy if exists person_volunteer_interests_system_staff_all on person_volunteer_interests;
create policy person_volunteer_interests_system_staff_all on person_volunteer_interests
  using (current_setting('app.context', true) in ('system','staff'))
  with check (current_setting('app.context', true) in ('system','staff'));

drop policy if exists person_volunteer_interests_member_select on person_volunteer_interests;
create policy person_volunteer_interests_member_select on person_volunteer_interests for select
  using (
    current_setting('app.context', true) = 'member'
    and exists (
      select 1 from users u
       where u.person_id = person_volunteer_interests.person_id
         and u.id = nullif(current_setting('app.user_id', true), '')::uuid
    )
  );

drop policy if exists person_volunteer_interests_member_insert on person_volunteer_interests;
create policy person_volunteer_interests_member_insert on person_volunteer_interests for insert
  with check (
    current_setting('app.context', true) = 'member'
    and exists (
      select 1 from users u
       where u.person_id = person_volunteer_interests.person_id
         and u.id = nullif(current_setting('app.user_id', true), '')::uuid
    )
    and exists (
      select 1 from volunteer_categories vc
       where vc.id = person_volunteer_interests.category_id
         and vc.is_active
    )
  );

drop policy if exists person_volunteer_interests_member_delete on person_volunteer_interests;
create policy person_volunteer_interests_member_delete on person_volunteer_interests for delete
  using (
    current_setting('app.context', true) = 'member'
    and exists (
      select 1 from users u
       where u.person_id = person_volunteer_interests.person_id
         and u.id = nullif(current_setting('app.user_id', true), '')::uuid
    )
  );

-- ---------------------------------------------------------- volunteer alert consent

alter table volunteer_alert_preferences enable row level security;
alter table volunteer_alert_preferences force row level security;

drop policy if exists volunteer_alert_preferences_system_staff_all on volunteer_alert_preferences;
create policy volunteer_alert_preferences_system_staff_all on volunteer_alert_preferences
  using (current_setting('app.context', true) in ('system','staff'))
  with check (current_setting('app.context', true) in ('system','staff'));

drop policy if exists volunteer_alert_preferences_member_select on volunteer_alert_preferences;
create policy volunteer_alert_preferences_member_select on volunteer_alert_preferences for select
  using (
    current_setting('app.context', true) = 'member'
    and user_id = nullif(current_setting('app.user_id', true), '')::uuid
  );

drop policy if exists volunteer_alert_preferences_member_insert on volunteer_alert_preferences;
create policy volunteer_alert_preferences_member_insert on volunteer_alert_preferences for insert
  with check (
    current_setting('app.context', true) = 'member'
    and user_id = nullif(current_setting('app.user_id', true), '')::uuid
    and exists (
      select 1 from users u
       where u.id = volunteer_alert_preferences.user_id
         and u.kind = 'supporter'
         and u.status = 'active'
    )
  );

drop policy if exists volunteer_alert_preferences_member_update on volunteer_alert_preferences;
create policy volunteer_alert_preferences_member_update on volunteer_alert_preferences for update
  using (
    current_setting('app.context', true) = 'member'
    and user_id = nullif(current_setting('app.user_id', true), '')::uuid
  )
  with check (
    current_setting('app.context', true) = 'member'
    and user_id = nullif(current_setting('app.user_id', true), '')::uuid
    and exists (
      select 1 from users u
       where u.id = volunteer_alert_preferences.user_id
         and u.kind = 'supporter'
         and u.status = 'active'
    )
  );

alter table volunteer_match_alert_claims enable row level security;
alter table volunteer_match_alert_claims force row level security;

drop policy if exists volunteer_match_alert_claims_system_staff_all on volunteer_match_alert_claims;
create policy volunteer_match_alert_claims_system_staff_all on volunteer_match_alert_claims
  using (current_setting('app.context', true) in ('system','staff'))
  with check (current_setting('app.context', true) in ('system','staff'));

-- ---------------------------------------------------------------- item_requests

alter table item_requests enable row level security;
alter table item_requests force row level security;

drop policy if exists item_requests_system_staff_all on item_requests;
create policy item_requests_system_staff_all on item_requests
  using (current_setting('app.context', true) in ('system','staff'))
  with check (current_setting('app.context', true) in ('system','staff'));

-- Public sees active requests of approved member orgs, plus archived ones so a
-- fulfilled request's page can say "this need has been met" instead of dying.
-- Draft and pending are never public.
drop policy if exists item_requests_public_select on item_requests;
create policy item_requests_public_select on item_requests for select
  using (
    current_setting('app.context', true) = 'public'
    and status in ('active','archived')
    and org_id in (select o.id from organizations o where o.kind = 'member_org' and o.status = 'approved')
  );

drop policy if exists item_requests_member_select on item_requests;
create policy item_requests_member_select on item_requests for select
  using (
    current_setting('app.context', true) = 'member'
    and org_id in (
      select om.org_id from org_memberships om
      where om.user_id = nullif(current_setting('app.user_id', true), '')::uuid
        and om.status = 'active')
  );

drop policy if exists item_requests_member_insert on item_requests;
create policy item_requests_member_insert on item_requests for insert
  with check (
    current_setting('app.context', true) = 'member'
    and status = 'draft'
    and org_id in (
      select om.org_id from org_memberships om
      where om.user_id = nullif(current_setting('app.user_id', true), '')::uuid
        and om.status = 'active')
  );

drop policy if exists item_requests_member_update on item_requests;
create policy item_requests_member_update on item_requests for update
  using (
    current_setting('app.context', true) = 'member'
    and org_id in (
      select om.org_id from org_memberships om
      where om.user_id = nullif(current_setting('app.user_id', true), '')::uuid
        and om.status = 'active')
  )
  with check (
    current_setting('app.context', true) = 'member'
    and org_id in (
      select om.org_id from org_memberships om
      where om.user_id = nullif(current_setting('app.user_id', true), '')::uuid
        and om.status = 'active')
  );

-- ---------------------------------------------------------------- items

alter table items enable row level security;
alter table items force row level security;

drop policy if exists items_system_staff_all on items;
create policy items_system_staff_all on items
  using (current_setting('app.context', true) in ('system','staff'))
  with check (current_setting('app.context', true) in ('system','staff'));

drop policy if exists items_public_select on items;
-- Restates the parent predicates (kept in lockstep with migration
-- 0007_scope_public_child_policies.sql): the child states its own scope so a
-- future edit to item_requests_public_select cannot silently widen it.
create policy items_public_select on items
  for select
  using (
    current_setting('app.context', true) = 'public'
    and exists (
      select 1
        from item_requests r
        join organizations o on o.id = r.org_id
       where r.id = items.item_request_id
         and r.status in ('active', 'archived')
         and o.kind = 'member_org'
         and o.status = 'approved'
    )
  );

drop policy if exists items_member_all on items;
create policy items_member_all on items
  using (
    current_setting('app.context', true) = 'member'
    and item_request_id in (
      select r.id from item_requests r where r.org_id in (
        select om.org_id from org_memberships om
        where om.user_id = nullif(current_setting('app.user_id', true), '')::uuid
          and om.status = 'active'))
  )
  with check (
    current_setting('app.context', true) = 'member'
    and item_request_id in (
      select r.id from item_requests r where r.org_id in (
        select om.org_id from org_memberships om
        where om.user_id = nullif(current_setting('app.user_id', true), '')::uuid
          and om.status = 'active'))
  );

-- ---------------------------------------------------------------- volunteer_requests

alter table volunteer_requests enable row level security;
alter table volunteer_requests force row level security;

drop policy if exists volunteer_requests_system_staff_all on volunteer_requests;
create policy volunteer_requests_system_staff_all on volunteer_requests
  using (current_setting('app.context', true) in ('system','staff'))
  with check (current_setting('app.context', true) in ('system','staff'));

drop policy if exists volunteer_requests_public_select on volunteer_requests;
create policy volunteer_requests_public_select on volunteer_requests for select
  using (
    current_setting('app.context', true) = 'public'
    and status in ('active','archived')
    and org_id in (select o.id from organizations o where o.kind = 'member_org' and o.status = 'approved')
  );

drop policy if exists volunteer_requests_member_select on volunteer_requests;
create policy volunteer_requests_member_select on volunteer_requests for select
  using (
    current_setting('app.context', true) = 'member'
    and org_id in (
      select om.org_id from org_memberships om
      where om.user_id = nullif(current_setting('app.user_id', true), '')::uuid
        and om.status = 'active')
  );

drop policy if exists volunteer_requests_member_insert on volunteer_requests;
create policy volunteer_requests_member_insert on volunteer_requests for insert
  with check (
    current_setting('app.context', true) = 'member'
    and status = 'draft'
    and org_id in (
      select om.org_id from org_memberships om
      where om.user_id = nullif(current_setting('app.user_id', true), '')::uuid
        and om.status = 'active')
  );

drop policy if exists volunteer_requests_member_update on volunteer_requests;
create policy volunteer_requests_member_update on volunteer_requests for update
  using (
    current_setting('app.context', true) = 'member'
    and org_id in (
      select om.org_id from org_memberships om
      where om.user_id = nullif(current_setting('app.user_id', true), '')::uuid
        and om.status = 'active')
  )
  with check (
    current_setting('app.context', true) = 'member'
    and org_id in (
      select om.org_id from org_memberships om
      where om.user_id = nullif(current_setting('app.user_id', true), '')::uuid
        and om.status = 'active')
  );

-- ---------------------------------------------------------------- volunteer_roles

alter table volunteer_roles enable row level security;
alter table volunteer_roles force row level security;

drop policy if exists volunteer_roles_system_staff_all on volunteer_roles;
create policy volunteer_roles_system_staff_all on volunteer_roles
  using (current_setting('app.context', true) in ('system','staff'))
  with check (current_setting('app.context', true) in ('system','staff'));

drop policy if exists volunteer_roles_public_select on volunteer_roles;
-- Restates the parent predicates (kept in lockstep with migration
-- 0007_scope_public_child_policies.sql).
create policy volunteer_roles_public_select on volunteer_roles
  for select
  using (
    current_setting('app.context', true) = 'public'
    and exists (
      select 1
        from volunteer_requests r
        join organizations o on o.id = r.org_id
       where r.id = volunteer_roles.volunteer_request_id
         and r.status in ('active', 'archived')
         and o.kind = 'member_org'
         and o.status = 'approved'
    )
  );

drop policy if exists volunteer_roles_member_all on volunteer_roles;
create policy volunteer_roles_member_all on volunteer_roles
  using (
    current_setting('app.context', true) = 'member'
    and volunteer_request_id in (
      select r.id from volunteer_requests r where r.org_id in (
        select om.org_id from org_memberships om
        where om.user_id = nullif(current_setting('app.user_id', true), '')::uuid
          and om.status = 'active'))
  )
  with check (
    current_setting('app.context', true) = 'member'
    and volunteer_request_id in (
      select r.id from volunteer_requests r where r.org_id in (
        select om.org_id from org_memberships om
        where om.user_id = nullif(current_setting('app.user_id', true), '')::uuid
          and om.status = 'active'))
  );

-- ------------------------------------------------------ volunteer_request_categories

alter table volunteer_request_categories enable row level security;
alter table volunteer_request_categories force row level security;

drop policy if exists volunteer_request_categories_system_staff_all on volunteer_request_categories;
create policy volunteer_request_categories_system_staff_all on volunteer_request_categories
  using (current_setting('app.context', true) in ('system','staff'))
  with check (current_setting('app.context', true) in ('system','staff'));

drop policy if exists volunteer_request_categories_member_all on volunteer_request_categories;
create policy volunteer_request_categories_member_all on volunteer_request_categories
  using (
    current_setting('app.context', true) = 'member'
    and exists (
      select 1 from volunteer_requests r
       where r.id = volunteer_request_categories.volunteer_request_id
         and r.org_id in (
           select om.org_id from org_memberships om
            where om.user_id = nullif(current_setting('app.user_id', true), '')::uuid
              and om.status = 'active'
         )
    )
  )
  with check (
    current_setting('app.context', true) = 'member'
    and exists (
      select 1 from volunteer_requests r
       where r.id = volunteer_request_categories.volunteer_request_id
         and r.org_id in (
           select om.org_id from org_memberships om
            where om.user_id = nullif(current_setting('app.user_id', true), '')::uuid
              and om.status = 'active'
         )
    )
  );

-- ---------------------------------------------------------------- item_pledges

alter table item_pledges enable row level security;
alter table item_pledges force row level security;

drop policy if exists item_pledges_system_staff_all on item_pledges;
create policy item_pledges_system_staff_all on item_pledges
  using (current_setting('app.context', true) in ('system','staff'))
  with check (current_setting('app.context', true) in ('system','staff'));

drop policy if exists item_pledges_member_select on item_pledges;
create policy item_pledges_member_select on item_pledges for select
  using (
    current_setting('app.context', true) = 'member'
    and item_request_id in (
      select r.id from item_requests r where r.org_id in (
        select om.org_id from org_memberships om
        where om.user_id = nullif(current_setting('app.user_id', true), '')::uuid
          and om.status = 'active'))
  );

-- Public pledge writes happen only inside record_item_pledge(), which the DAL
-- calls in system context. There is no public write policy on purpose.

-- ---------------------------------------------------------------- item_pledge_lines

alter table item_pledge_lines enable row level security;
alter table item_pledge_lines force row level security;

drop policy if exists item_pledge_lines_system_staff_all on item_pledge_lines;
create policy item_pledge_lines_system_staff_all on item_pledge_lines
  using (current_setting('app.context', true) in ('system','staff'))
  with check (current_setting('app.context', true) in ('system','staff'));

drop policy if exists item_pledge_lines_member_select on item_pledge_lines;
create policy item_pledge_lines_member_select on item_pledge_lines for select
  using (
    current_setting('app.context', true) = 'member'
    and item_pledge_id in (
      select ip.id from item_pledges ip
      join item_requests r on r.id = ip.item_request_id
      where r.org_id in (
        select om.org_id from org_memberships om
        where om.user_id = nullif(current_setting('app.user_id', true), '')::uuid
          and om.status = 'active'))
  );

-- ---------------------------------------------------------------- volunteer_signups

alter table volunteer_signups enable row level security;
alter table volunteer_signups force row level security;

drop policy if exists volunteer_signups_system_staff_all on volunteer_signups;
create policy volunteer_signups_system_staff_all on volunteer_signups
  using (current_setting('app.context', true) in ('system','staff'))
  with check (current_setting('app.context', true) in ('system','staff'));

drop policy if exists volunteer_signups_member_select on volunteer_signups;
create policy volunteer_signups_member_select on volunteer_signups for select
  using (
    current_setting('app.context', true) = 'member'
    and volunteer_request_id in (
      select r.id from volunteer_requests r where r.org_id in (
        select om.org_id from org_memberships om
        where om.user_id = nullif(current_setting('app.user_id', true), '')::uuid
          and om.status = 'active'))
  );

-- ---------------------------------------------------------------- volunteer_signup_roles

alter table volunteer_signup_roles enable row level security;
alter table volunteer_signup_roles force row level security;

drop policy if exists volunteer_signup_roles_system_staff_all on volunteer_signup_roles;
create policy volunteer_signup_roles_system_staff_all on volunteer_signup_roles
  using (current_setting('app.context', true) in ('system','staff'))
  with check (current_setting('app.context', true) in ('system','staff'));

drop policy if exists volunteer_signup_roles_member_select on volunteer_signup_roles;
create policy volunteer_signup_roles_member_select on volunteer_signup_roles for select
  using (
    current_setting('app.context', true) = 'member'
    and volunteer_signup_id in (
      select vs.id from volunteer_signups vs
      join volunteer_requests r on r.id = vs.volunteer_request_id
      where r.org_id in (
        select om.org_id from org_memberships om
        where om.user_id = nullif(current_setting('app.user_id', true), '')::uuid
          and om.status = 'active'))
  );

-- ---------------------------------------------------------------- approval_events

-- --------------------------------------------------------- request engagement

alter table request_engagement_events enable row level security;
alter table request_engagement_events force row level security;

drop policy if exists request_engagement_events_system_staff_all on request_engagement_events;
create policy request_engagement_events_system_staff_all on request_engagement_events
  using (current_setting('app.context', true) in ('system','staff'))
  with check (current_setting('app.context', true) in ('system','staff'));

alter table approval_events enable row level security;
alter table approval_events force row level security;

drop policy if exists approval_events_system_staff_all on approval_events;
create policy approval_events_system_staff_all on approval_events
  using (current_setting('app.context', true) in ('system','staff'))
  with check (current_setting('app.context', true) in ('system','staff'));

-- ---------------------------------------------------------------- email_log

alter table email_log enable row level security;
alter table email_log force row level security;

drop policy if exists email_log_system_staff_all on email_log;
create policy email_log_system_staff_all on email_log
  using (current_setting('app.context', true) in ('system','staff'))
  with check (current_setting('app.context', true) in ('system','staff'));

-- ---------------------------------------------------------------- email_template_overrides

alter table email_template_overrides add column if not exists updated_by uuid references users(id);

alter table email_template_overrides enable row level security;
alter table email_template_overrides force row level security;

drop policy if exists email_template_overrides_system_staff_all on email_template_overrides;
create policy email_template_overrides_system_staff_all on email_template_overrides
  using (current_setting('app.context', true) in ('system','staff'))
  with check (current_setting('app.context', true) in ('system','staff'));

-- ---------------------------------------------------------------- email_schedules

alter table email_schedules enable row level security;
alter table email_schedules force row level security;

drop policy if exists email_schedules_system_staff_all on email_schedules;
create policy email_schedules_system_staff_all on email_schedules
  using (current_setting('app.context', true) in ('system','staff'))
  with check (current_setting('app.context', true) in ('system','staff'));

-- ---------------------------------------------------------------- digest_subscribers

alter table digest_subscribers enable row level security;
alter table digest_subscribers force row level security;

drop policy if exists digest_subscribers_system_staff_all on digest_subscribers;
create policy digest_subscribers_system_staff_all on digest_subscribers
  using (current_setting('app.context', true) in ('system','staff'))
  with check (current_setting('app.context', true) in ('system','staff'));

-- ---------------------------------------------------------------- digest_runs

alter table digest_runs enable row level security;
alter table digest_runs force row level security;

drop policy if exists digest_runs_system_staff_all on digest_runs;
create policy digest_runs_system_staff_all on digest_runs
  using (current_setting('app.context', true) in ('system','staff'))
  with check (current_setting('app.context', true) in ('system','staff'));

-- ---------------------------------------------------------------- digest_exclusions

alter table digest_exclusions enable row level security;
alter table digest_exclusions force row level security;

drop policy if exists digest_exclusions_system_staff_all on digest_exclusions;
create policy digest_exclusions_system_staff_all on digest_exclusions
  using (current_setting('app.context', true) in ('system','staff'))
  with check (current_setting('app.context', true) in ('system','staff'));
