# CUTOVER-AUDIT

Generated: 2026-08-24 (America/Los_Angeles)
Commit at time of audit: e3c3e8e91093cfbf338bfee609424f5661c8e651
Working tree at time of audit: clean (`git status --short` empty)

Raw data only. No summarizing, interpretation, or commentary.

---

## 1. File tree

Roots: `server/`, `client/`, `shared/`, `migrations/`, `docs/`, `scripts/`.
Excluded: `node_modules`, `.git`, `dist`.

```
client/index.html
client/public/email-header.png
client/public/favicon.ico
client/public/favicon.png
client/public/og-image.jpg
client/src/App.tsx
client/src/assets/alliance-logo-blue.png
client/src/assets/dashboard/hero.png
client/src/assets/dashboard/tile-community.png
client/src/assets/dashboard/tile-donors.png
client/src/assets/dashboard/tile-item.png
client/src/assets/dashboard/tile-org.png
client/src/assets/dashboard/tile-users.png
client/src/assets/dashboard/tile-volunteer.png
client/src/assets/headers/LIA-Main-Page-Header.png
client/src/assets/headers/Provide-an-Item-Header.png
client/src/assets/headers/Volunteer-your-Time-Header.png
client/src/assets/requests/item-hero.png
client/src/assets/requests/volunteer-hero.png
client/src/components/admin/AdminShell.tsx
client/src/components/analytics/EngagementReport.tsx
client/src/components/EmailBodyEditor.tsx
client/src/components/member/DashboardGate.tsx
client/src/components/member/DeadlineField.tsx
client/src/components/NavBar.tsx
client/src/components/public/Footer.tsx
client/src/components/public/PublicLayout.tsx
client/src/components/public/RequestCard.tsx
client/src/components/public/ShareButton.tsx
client/src/hooks/useDebouncedValue.ts
client/src/hooks/useNavigationGuard.ts
client/src/hooks/useSession.ts
client/src/hooks/useSiteSettings.ts
client/src/index.css
client/src/lib/engagement.ts
client/src/lib/queryClient.ts
client/src/main.tsx
client/src/pages/admin/ActivityPage.tsx
client/src/pages/admin/AnalyticsPage.tsx
client/src/pages/admin/EmailLogPage.tsx
client/src/pages/admin/EmailTemplatesPage.tsx
client/src/pages/admin/MembersPage.tsx
client/src/pages/admin/OrganizationsPage.tsx
client/src/pages/admin/PeopleReviewPage.tsx
client/src/pages/admin/PopulationsPage.tsx
client/src/pages/admin/RequestsPage.tsx
client/src/pages/admin/RolesPage.tsx
client/src/pages/admin/SettingsPage.tsx
client/src/pages/admin/SubscribersPage.tsx
client/src/pages/admin/VolunteerCategoriesPage.tsx
client/src/pages/member/DashboardPage.tsx
client/src/pages/member/ItemsAddPage.tsx
client/src/pages/member/ItemsEditPage.tsx
client/src/pages/member/ItemsNewPage.tsx
client/src/pages/member/LoginPage.tsx
client/src/pages/member/LoginVerifyPage.tsx
client/src/pages/member/MembersNewPage.tsx
client/src/pages/member/OrganizationSettingsPage.tsx
client/src/pages/member/SignupPage.tsx
client/src/pages/member/SupportersPage.tsx
client/src/pages/member/VolunteersAddPage.tsx
client/src/pages/member/VolunteersEditPage.tsx
client/src/pages/member/VolunteersNewPage.tsx
client/src/pages/NotFound.tsx
client/src/pages/PlaceholderPage.tsx
client/src/pages/public/AboutPage.tsx
client/src/pages/public/DigestPage.tsx
client/src/pages/public/HomePage.tsx
client/src/pages/public/ItemDetailPage.tsx
client/src/pages/public/ItemsBrowsePage.tsx
client/src/pages/public/OrganizationProfilePage.tsx
client/src/pages/public/VolunteerAlertOptOutPage.tsx
client/src/pages/public/VolunteerBrowsePage.tsx
client/src/pages/public/VolunteerDetailPage.tsx
client/src/pages/supporter/ProfilePage.tsx
docs/build-log.md
docs/CONFORMANCE.md
docs/data-access.md
docs/Design.md
docs/email/previews/donor_item_confirmation.html
docs/email/previews/donor_item_confirmation.txt
docs/email/previews/donor_volunteer_confirmation.html
docs/email/previews/donor_volunteer_confirmation.txt
docs/email/previews/org_approved.html
docs/email/previews/org_approved.txt
docs/email/previews/org_member_approved.html
docs/email/previews/org_member_approved.txt
docs/email/previews/org_new_item_donation.html
docs/email/previews/org_new_item_donation.txt
docs/email/previews/org_new_volunteer.html
docs/email/previews/org_new_volunteer.txt
docs/email/previews/org_request_approved.html
docs/email/previews/org_request_approved.txt
docs/email/previews/org_request_received.html
docs/email/previews/org_request_received.txt
docs/email/previews/staff_new_item_request.html
docs/email/previews/staff_new_item_request.txt
docs/email/previews/staff_new_org.html
docs/email/previews/staff_new_org.txt
docs/email/previews/staff_new_user.html
docs/email/previews/staff_new_user.txt
docs/email/previews/staff_new_volunteer_request.html
docs/email/previews/staff_new_volunteer_request.txt
docs/email/TEMPLATES.md
docs/migration/data-audit.md
docs/migration/dropped-fields.csv
docs/migration/exclusions.csv
docs/migration/field-map.md
docs/migration/validation.sql
docs/phase-3-report.md
docs/screenshots/MP-01-desktop.png
docs/screenshots/MP-01-mobile.png
docs/screenshots/MP-03-desktop.png
docs/screenshots/MP-04-desktop.png
docs/screenshots/MP-04-mobile.png
docs/screenshots/MP-05-desktop.png
docs/screenshots/MP-05-mobile.png
docs/screenshots/MP-06-desktop.png
docs/screenshots/MP-06-mobile.png
docs/screenshots/MP-07-desktop.png
docs/screenshots/MP-07-mobile.png
docs/screenshots/MP-08-desktop.png
docs/screenshots/MP-09-desktop.png
docs/screenshots/MP-09-mobile.png
docs/screenshots/MP-10-desktop.png
docs/screenshots/MP-10-mobile.png
docs/screenshots/MP-11-desktop.png
docs/screenshots/MP-12-desktop.png
docs/screenshots/MP-12-mobile.png
docs/screenshots/MP-13-desktop.png
docs/screenshots/PB-00-desktop.png
docs/screenshots/PB-00-mobile.png
docs/screenshots/PB-01-desktop.png
docs/screenshots/PB-01-mobile.png
docs/screenshots/PB-02-desktop.png
docs/screenshots/PB-02-mobile.png
docs/screenshots/PB-03-desktop.png
docs/screenshots/PB-03-mobile.png
docs/screenshots/PB-04-desktop.png
docs/screenshots/PB-04-mobile.png
docs/screenshots/PB-05-desktop.png
docs/specs/ADMIN-01.md
docs/specs/ADMIN-02.md
docs/specs/ADMIN-03.md
docs/specs/ADMIN-04.md
docs/specs/ADMIN-05.md
docs/specs/ADMIN-06.md
docs/specs/ADMIN-07.md
docs/specs/ADMIN-08.md
docs/specs/MP-01.md
docs/specs/MP-02.md
docs/specs/MP-03.md
docs/specs/MP-04.md
docs/specs/MP-05.md
docs/specs/MP-06.md
docs/specs/MP-07.md
docs/specs/MP-08.md
docs/specs/MP-09.md
docs/specs/MP-10.md
docs/specs/MP-11.md
docs/specs/MP-12.md
docs/specs/MP-13.md
docs/specs/PB-00.md
docs/specs/PB-01.md
docs/specs/PB-02.md
docs/specs/PB-03.md
docs/specs/PB-04.md
docs/specs/PB-05.md
docs/specs/PB-06.md
docs/specs/_TEMPLATE.md
docs/test-plans/volunteer-donor-flow-test-cases.csv
docs/test-plans/volunteer-donor-flow-test-plan.md
migrations/0001_initial_schema.sql
migrations/0002_phone_match_names_all_duplicates.sql
migrations/0003_merge_people_function.sql
migrations/0004_digest_subscriber_names.sql
migrations/0005_email_dispatch_claim.sql
migrations/0006_close_rls_and_counter_gaps.sql
migrations/0007_scope_public_child_policies.sql
migrations/0008_email_template_overrides.sql
migrations/0008_item_image_generation.sql
migrations/0009_digest_runs.sql
migrations/0009_email_template_overrides_updated_by.sql
migrations/0010_digest_run_needs_snapshot.sql
migrations/0011_image_gen_retries.sql
migrations/0012_digest_exclusions.sql
migrations/0012_email_log_failure_structured.sql
migrations/0013_digest_exclusions_simpler_key.sql
migrations/0014_supporter_user_kind.sql
migrations/0034_split_counter_trigger_branches.sql
migrations/0035_volunteer_image_generation.sql
migrations/0036_item_request_deadline_expiry.sql
migrations/0037_email_schedules.sql
migrations/0037_volunteer_interests.sql
migrations/0038_digest_run_occurrences.sql
migrations/0038_volunteer_request_categories.sql
migrations/0039_matching_volunteer_alerts.sql
migrations/0040_request_analytics_parent_ownership_keys.sql
migrations/0041_request_engagement.sql
migrations/0042_engagement_child_ownership.sql
migrations/0043_request_revisions.sql
migrations/0043_volunteer_signup_expiry_check.sql
migrations/0044_repair_item_request_expiry_functions.sql
migrations/0045_restore_routine_parity.sql
migrations/0046_seed_quick_login_supporter.sql
migrations/0046_seed_volunteer_categories.sql
migrations/0047_email_body_blocks.sql
migrations/0047_email_brand_settings.sql
migrations/0048_email_body_blocks_check.sql
migrations/0049_site_settings.sql
scripts/backfill-need-images.ts
scripts/check-db-routines.ts
scripts/fill-need-images-offline.ts
scripts/lint-adm-btn.sh
scripts/lint-fixture-queries.sh
scripts/post-merge.sh
scripts/print-need-image-prompt.ts
scripts/render-email-previews.ts
scripts/test-admin-requests-filter.ts
scripts/test-admin-styles.ts
scripts/test-admin-tabs.ts
scripts/test-approval-email.ts
scripts/test-brand-header-image.ts
scripts/test-digest.ts
scripts/test-email-admin-guard.ts
scripts/test-email-copy-override-preview.ts
scripts/test-email-editor-close-scroll.ts
scripts/test-email-failure-diagnostics.ts
scripts/test-email-preview-panel.ts
scripts/test-email-render-regression.ts
scripts/test-email-row-expansion.ts
scripts/test-email-send.ts
scripts/test-image-sweep.ts
scripts/test-item-product-urls.ts
scripts/test-item-request-expiry.ts
scripts/test-login-error-ui.ts
scripts/test-magic-link-finalize-throw.ts
scripts/test-magic-link-http-error.ts
scripts/test-magic-link-rate-limit-failure.ts
scripts/test-matching-volunteer-alerts.ts
scripts/test-nav-guard.ts
scripts/test-need-image.ts
scripts/test-public-org-profile.ts
scripts/test-quick-login.ts
scripts/test-request-engagement.ts
scripts/test-request-engagement-ui.ts
scripts/test-request-outreach.ts
scripts/test-responsive-nav.ts
scripts/test-role-last-admin.ts
scripts/test-save-edit.ts
scripts/test-send-pipeline-finalize-throw.ts
scripts/test-send-pipeline-intx-finalize-throw.ts
scripts/test-send-pipeline-intx-leftover.ts
scripts/test-send-pipeline-intx-render-throw.ts
scripts/test-send-pipeline-leftover.ts
scripts/test-send-pipeline-render-throw.ts
scripts/test-share-preview.ts
scripts/test-site-settings.ts
scripts/test-skipped-reenable.ts
scripts/test-staff-admin-access.ts
scripts/test-staff-request-edits.ts
scripts/test-startup-db-check.ts
scripts/test-startup-trigger-check.ts
scripts/test-volunteer-interests.ts
scripts/test-volunteer-request-categories.ts
scripts/test-volunteer-request-expiry.ts
server/auth/apply-auth-schema.ts
server/auth/auth-schema.sql
server/auth/auth.ts
server/auth/guards.ts
server/auth/rate-limit.ts
server/auth/session.ts
server/dal/admin-counts.ts
server/dal/admin-requests.ts
server/dal/approval-events.ts
server/dal/auth-provider.ts
server/dal/digest-runs.ts
server/dal/digest-subscribers.ts
server/dal/email-brand-settings.ts
server/dal/email-log.ts
server/dal/email-resend-data.ts
server/dal/email-schedules.ts
server/dal/email-template-overrides.ts
server/dal/index.ts
server/dal/item-requests.ts
server/dal/items.ts
server/dal/legacy-staff.ts
server/dal/memberships.ts
server/dal/organizations.ts
server/dal/people-review.ts
server/dal/people.ts
server/dal/pledges.ts
server/dal/populations.ts
server/dal/request-engagement.ts
server/dal/request-revisions.ts
server/dal/signups.ts
server/dal/site-settings.ts
server/dal/users.ts
server/dal/validation.ts
server/dal/volunteer-alerts.ts
server/dal/volunteer-interests.ts
server/dal/volunteer-requests.ts
server/dal/volunteer-roles.ts
server/db/apply-migrations.ts
server/db/apply-rls.ts
server/db/client.ts
server/db/rls-policies.sql
server/db/seed.ts
server/db/startup-checks.ts
server/digest-schedule.ts
server/email/overrides.ts
server/email/render.ts
server/email/send.ts
server/email/templates/auth-magic-link.ts
server/email/templates/digest-new-needs.ts
server/email/templates/donor-item-confirmation.ts
server/email/templates/donor-volunteer-confirmation.ts
server/email/templates/index.ts
server/email/templates/org-approved.ts
server/email/templates/org-member-approved.ts
server/email/templates/org-new-item-donation.ts
server/email/templates/org-new-volunteer.ts
server/email/templates/org-request-approved.ts
server/email/templates/org-request-received.ts
server/email/templates/staff-invited.ts
server/email/templates/staff-new-item-request.ts
server/email/templates/staff-new-org.ts
server/email/templates/staff-new-user.ts
server/email/templates/staff-new-volunteer-request.ts
server/email/templates/supporter-volunteer-match.ts
server/email/templates/types.ts
server/index.ts
server/jobs/digest.ts
server/jobs/email-sweep.ts
server/jobs/expiry.ts
server/jobs/image-sweep.ts
server/routes/admin-email-templates.ts
server/routes/admin-settings.ts
server/routes/admin.ts
server/routes/engagement-reporting.ts
server/routes/index.ts
server/routes/member.ts
server/routes/public.ts
server/services/email-resend.ts
server/services/item-request-edit.ts
server/services/item-submit.ts
server/services/member-approval.ts
server/services/member-invite.ts
server/services/need-image.ts
server/services/org-approval.ts
server/services/org-settings.ts
server/services/org-signup.ts
server/services/person-merge.ts
server/services/request-approval.ts
server/services/staff-invite.ts
server/services/staff-request-edit.ts
server/services/volunteer-request-edit.ts
server/services/volunteer-submit.ts
server/share-preview.ts
server/storage/object-storage.ts
server/vite.ts
shared/email-templates.ts
shared/item-product-url.ts
shared/routes.ts
shared/share-copy.ts
shared/transitions.ts
shared/types.ts
```

File count by root:

```
server       95
client       75
shared       6
migrations   38
docs         97
scripts      56
```

---

## 2. Schema (`pg_dump --schema-only`)

**Did this run against production? NO.**

Environment actually dumped: **development** (`$DATABASE_URL`, host `helium`, database `heliumdb`, PostgreSQL 16.10).

Reason it did not run against production: no production connection string is exposed inside the
workspace. `$DATABASE_URL` resolves to the development database. The only available production
access path is a read-only replica that accepts `SELECT` statements one query at a time; it does
not accept a `pg_dump` client connection, so `pg_dump --schema-only` cannot be pointed at
production from here.

Command that was run:

```
pg_dump --schema-only --no-owner --no-privileges "$DATABASE_URL"
```

Exit code: 0. Output: 3163 lines / 110095 bytes. Reproduced verbatim below.

### 2a. Production schema inventory (directly verified against production)

The following was read directly from the production database via read-only `SELECT`, so it is
production data, not development data.

Production base tables in schema `public`:

```
account
approval_events
digest_exclusions
digest_runs
digest_subscribers
email_brand_settings
email_log
email_schedules
email_template_overrides
item_pledge_lines
item_pledges
item_requests
items
org_memberships
organization_populations
organizations
people
person_volunteer_interests
populations
request_engagement_events
request_revisions
schema_migrations
session
site_settings
user
users
verification
volunteer_alert_preferences
volunteer_categories
volunteer_match_alert_claims
volunteer_request_categories
volunteer_requests
volunteer_roles
volunteer_signup_roles
volunteer_signups
```

Count: 35 base tables in production.
Count: 35 `CREATE TABLE` statements in the development dump below.

Production routines in schema `public` (`information_schema.routines`):

```
routine_name,routine_type
armor,FUNCTION
armor,FUNCTION
crypt,FUNCTION
dearmor,FUNCTION
decrypt,FUNCTION
decrypt_iv,FUNCTION
digest,FUNCTION
digest,FUNCTION
encrypt,FUNCTION
encrypt_iv,FUNCTION
gen_random_bytes,FUNCTION
gen_random_uuid,FUNCTION
gen_salt,FUNCTION
gen_salt,FUNCTION
guard_counter_columns,FUNCTION
guard_member_request_transitions,FUNCTION
hmac,FUNCTION
hmac,FUNCTION
item_request_current_la_date,FUNCTION
item_request_expired_on,FUNCTION
merge_people,FUNCTION
pgp_armor_headers,FUNCTION
pgp_key_id,FUNCTION
pgp_pub_decrypt,FUNCTION
pgp_pub_decrypt,FUNCTION
pgp_pub_decrypt,FUNCTION
pgp_pub_decrypt_bytea,FUNCTION
pgp_pub_decrypt_bytea,FUNCTION
pgp_pub_decrypt_bytea,FUNCTION
pgp_pub_encrypt,FUNCTION
pgp_pub_encrypt,FUNCTION
pgp_pub_encrypt_bytea,FUNCTION
pgp_pub_encrypt_bytea,FUNCTION
pgp_sym_decrypt,FUNCTION
pgp_sym_decrypt,FUNCTION
pgp_sym_decrypt_bytea,FUNCTION
pgp_sym_decrypt_bytea,FUNCTION
pgp_sym_encrypt,FUNCTION
pgp_sym_encrypt,FUNCTION
pgp_sym_encrypt_bytea,FUNCTION
pgp_sym_encrypt_bytea,FUNCTION
record_item_pledge,FUNCTION
record_volunteer_signup,FUNCTION
reject_expired_item_pledge,FUNCTION
set_updated_at,FUNCTION
```

Production triggers in schema `public` (`information_schema.triggers`):

```
event_object_table,trigger_name,action_timing,events
item_pledges,item_pledges_reject_expired_request,BEFORE,INSERT
item_pledges,item_pledges_set_updated_at,BEFORE,UPDATE
item_requests,item_requests_guard_member_transitions,BEFORE,UPDATE
item_requests,item_requests_set_updated_at,BEFORE,UPDATE
items,items_guard_counters,BEFORE,UPDATE
items,items_set_updated_at,BEFORE,UPDATE
org_memberships,org_memberships_set_updated_at,BEFORE,UPDATE
organizations,organizations_set_updated_at,BEFORE,UPDATE
people,people_set_updated_at,BEFORE,UPDATE
users,users_set_updated_at,BEFORE,UPDATE
volunteer_alert_preferences,volunteer_alert_preferences_set_updated_at,BEFORE,UPDATE
volunteer_requests,volunteer_requests_guard_member_transitions,BEFORE,UPDATE
volunteer_requests,volunteer_requests_set_updated_at,BEFORE,UPDATE
volunteer_roles,volunteer_roles_guard_counters,BEFORE,UPDATE
volunteer_roles,volunteer_roles_set_updated_at,BEFORE,UPDATE
volunteer_signups,volunteer_signups_set_updated_at,BEFORE,UPDATE
```

### 2b. Development `pg_dump --schema-only` output (verbatim)

```sql
--
-- PostgreSQL database dump
--

\restrict 5qaY9W9bWEVj4xpIEfWL36scy4MgNR9Ks529W6dIo4SHucrijhODIG1DbCxgQDB

-- Dumped from database version 16.10
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
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;


--
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';


--
-- Name: guard_counter_columns(); Type: FUNCTION; Schema: public; Owner: -
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


--
-- Name: guard_member_request_transitions(); Type: FUNCTION; Schema: public; Owner: -
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


--
-- Name: item_request_current_la_date(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.item_request_current_la_date() RETURNS date
    LANGUAGE sql
    AS $$
  select (clock_timestamp() at time zone 'America/Los_Angeles')::date;
$$;


--
-- Name: item_request_expired_on(text, date, date, date); Type: FUNCTION; Schema: public; Owner: -
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


--
-- Name: merge_people(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
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
$$;


--
-- Name: record_item_pledge(text, text, text, text, uuid, text, jsonb); Type: FUNCTION; Schema: public; Owner: -
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


--
-- Name: record_volunteer_signup(text, text, text, text, uuid, text, uuid[]); Type: FUNCTION; Schema: public; Owner: -
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


--
-- Name: reject_expired_item_pledge(); Type: FUNCTION; Schema: public; Owner: -
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


--
-- Name: set_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: account; Type: TABLE; Schema: public; Owner: -
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


--
-- Name: approval_events; Type: TABLE; Schema: public; Owner: -
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
    CONSTRAINT approval_events_entity_type_check CHECK ((entity_type = ANY (ARRAY['organization'::text, 'org_membership'::text, 'item_request'::text, 'volunteer_request'::text, 'person'::text])))
);

ALTER TABLE ONLY public.approval_events FORCE ROW LEVEL SECURITY;


--
-- Name: item_pledge_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.item_pledge_lines (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    item_pledge_id uuid NOT NULL,
    item_id uuid NOT NULL,
    quantity integer NOT NULL,
    CONSTRAINT item_pledge_lines_quantity_check CHECK ((quantity > 0))
);

ALTER TABLE ONLY public.item_pledge_lines FORCE ROW LEVEL SECURITY;


--
-- Name: items; Type: TABLE; Schema: public; Owner: -
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


--
-- Name: volunteer_roles; Type: TABLE; Schema: public; Owner: -
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


--
-- Name: volunteer_signup_roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.volunteer_signup_roles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    volunteer_signup_id uuid NOT NULL,
    volunteer_role_id uuid NOT NULL
);

ALTER TABLE ONLY public.volunteer_signup_roles FORCE ROW LEVEL SECURITY;


--
-- Name: counter_drift; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.counter_drift AS
 SELECT 'item'::text AS kind,
    i.id,
    i.quantity_claimed AS stored,
    COALESCE(sum(l.quantity), (0)::bigint) AS actual
   FROM (public.items i
     LEFT JOIN public.item_pledge_lines l ON ((l.item_id = i.id)))
  GROUP BY i.id, i.quantity_claimed
 HAVING (i.quantity_claimed <> COALESCE(sum(l.quantity), (0)::bigint))
UNION ALL
 SELECT 'role'::text AS kind,
    r.id,
    r.quantity_interested AS stored,
    COALESCE(count(sr.id), (0)::bigint) AS actual
   FROM (public.volunteer_roles r
     LEFT JOIN public.volunteer_signup_roles sr ON ((sr.volunteer_role_id = r.id)))
  GROUP BY r.id, r.quantity_interested
 HAVING (r.quantity_interested <> COALESCE(count(sr.id), (0)::bigint));


--
-- Name: digest_exclusions; Type: TABLE; Schema: public; Owner: -
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


--
-- Name: TABLE digest_exclusions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.digest_exclusions IS 'Per-need exclusions for a digest run window; scoped to window_start so they expire naturally once the run completes and the watermark advances.';


--
-- Name: digest_runs; Type: TABLE; Schema: public; Owner: -
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


--
-- Name: COLUMN digest_runs.needs_payload; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.digest_runs.needs_payload IS 'Canonical DigestNeed[] snapshot for this run; set once after selection, reused verbatim on resume.';


--
-- Name: COLUMN digest_runs.occurrence_key; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.digest_runs.occurrence_key IS 'Durable schedule occurrence claim: weekly:YYYY-MM-DD, once:<ISO instant>, or date:<YYYY-MM-DD> for direct verification passes.';


--
-- Name: digest_subscribers; Type: TABLE; Schema: public; Owner: -
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


--
-- Name: COLUMN digest_subscribers.first_name; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.digest_subscribers.first_name IS 'PB-05 form value, stored exactly as entered. Null on rows created before 0004 or imported without a name.';


--
-- Name: COLUMN digest_subscribers.last_name; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.digest_subscribers.last_name IS 'PB-05 form value, stored exactly as entered. Null on rows created before 0004 or imported without a name.';


--
-- Name: email_brand_settings; Type: TABLE; Schema: public; Owner: -
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


--
-- Name: email_log; Type: TABLE; Schema: public; Owner: -
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


--
-- Name: COLUMN email_log.status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.email_log.status IS 'queued -> sending (dispatch claim) -> sent | failed. skipped = template disabled by staff; never dispatched.';


--
-- Name: email_schedules; Type: TABLE; Schema: public; Owner: -
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


--
-- Name: email_template_overrides; Type: TABLE; Schema: public; Owner: -
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


--
-- Name: item_pledges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.item_pledges (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    legacy_wix_id text,
    person_id uuid NOT NULL,
    item_request_id uuid NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.item_pledges FORCE ROW LEVEL SECURITY;


--
-- Name: item_requests; Type: TABLE; Schema: public; Owner: -
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


--
-- Name: org_memberships; Type: TABLE; Schema: public; Owner: -
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


--
-- Name: organization_populations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organization_populations (
    org_id uuid NOT NULL,
    population_id uuid NOT NULL
);

ALTER TABLE ONLY public.organization_populations FORCE ROW LEVEL SECURITY;


--
-- Name: organizations; Type: TABLE; Schema: public; Owner: -
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


--
-- Name: people; Type: TABLE; Schema: public; Owner: -
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


--
-- Name: person_volunteer_interests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.person_volunteer_interests (
    person_id uuid NOT NULL,
    category_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: populations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.populations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL
);

ALTER TABLE ONLY public.populations FORCE ROW LEVEL SECURITY;


--
-- Name: request_engagement_events; Type: TABLE; Schema: public; Owner: -
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


--
-- Name: TABLE request_engagement_events; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.request_engagement_events IS 'Allowlisted public request interactions. Anonymous rows have no persistent visitor identity; pledges/signups remain authoritative conversions.';


--
-- Name: COLUMN request_engagement_events.client_event_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.request_engagement_events.client_event_id IS 'Fresh UUID for one client interaction, used only to make duplicate delivery idempotent.';


--
-- Name: request_revisions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.request_revisions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    entity_type text NOT NULL,
    entity_id uuid NOT NULL,
    actor_user_id uuid NOT NULL,
    summary text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT request_revisions_entity_type_check CHECK ((entity_type = ANY (ARRAY['item_request'::text, 'volunteer_request'::text])))
);


--
-- Name: schema_migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schema_migrations (
    filename text NOT NULL,
    sha256 text NOT NULL,
    applied_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: session; Type: TABLE; Schema: public; Owner: -
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


--
-- Name: site_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.site_settings (
    id integer NOT NULL,
    site_name text DEFAULT 'Love in Action Database'::text NOT NULL,
    contact_email text DEFAULT 'info@defendingthecause.org'::text NOT NULL,
    response_time_language text DEFAULT '1-3 business days'::text NOT NULL,
    updated_at timestamp with time zone,
    updated_by uuid,
    CONSTRAINT site_settings_singleton CHECK ((id = 1))
);

ALTER TABLE ONLY public.site_settings FORCE ROW LEVEL SECURITY;


--
-- Name: user; Type: TABLE; Schema: public; Owner: -
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


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
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


--
-- Name: verification; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.verification (
    id text NOT NULL,
    identifier text NOT NULL,
    value text NOT NULL,
    "expiresAt" timestamp without time zone NOT NULL,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: volunteer_alert_preferences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.volunteer_alert_preferences (
    user_id uuid NOT NULL,
    enabled boolean DEFAULT false NOT NULL,
    unsubscribe_token uuid DEFAULT gen_random_uuid() NOT NULL,
    enabled_at timestamp with time zone,
    disabled_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE volunteer_alert_preferences; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.volunteer_alert_preferences IS 'Explicit per-supporter consent for immediate matching-volunteer email alerts. No row is equivalent to enabled=false.';


--
-- Name: COLUMN volunteer_alert_preferences.unsubscribe_token; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.volunteer_alert_preferences.unsubscribe_token IS 'Opaque one-way capability used only to disable future matching alerts.';


--
-- Name: volunteer_categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.volunteer_categories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    CONSTRAINT volunteer_categories_name_check CHECK ((btrim(name) <> ''::text))
);


--
-- Name: volunteer_match_alert_claims; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.volunteer_match_alert_claims (
    volunteer_request_id uuid NOT NULL,
    user_id uuid NOT NULL,
    to_email text NOT NULL,
    claimed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT volunteer_match_alert_claims_to_email_check CHECK ((btrim(to_email) <> ''::text))
);


--
-- Name: TABLE volunteer_match_alert_claims; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.volunteer_match_alert_claims IS 'Durable once-only claim for approval-triggered matching alerts, independent of retryable email_log status.';


--
-- Name: volunteer_request_categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.volunteer_request_categories (
    volunteer_request_id uuid NOT NULL,
    category_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: volunteer_requests; Type: TABLE; Schema: public; Owner: -
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


--
-- Name: volunteer_signups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.volunteer_signups (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    legacy_wix_id text,
    person_id uuid NOT NULL,
    volunteer_request_id uuid NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.volunteer_signups FORCE ROW LEVEL SECURITY;


--
-- Name: account account_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account
    ADD CONSTRAINT account_pkey PRIMARY KEY (id);


--
-- Name: approval_events approval_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approval_events
    ADD CONSTRAINT approval_events_pkey PRIMARY KEY (id);


--
-- Name: digest_exclusions digest_exclusions_need_type_need_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.digest_exclusions
    ADD CONSTRAINT digest_exclusions_need_type_need_id_key UNIQUE (need_type, need_id);


--
-- Name: digest_exclusions digest_exclusions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.digest_exclusions
    ADD CONSTRAINT digest_exclusions_pkey PRIMARY KEY (id);


--
-- Name: digest_runs digest_runs_occurrence_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.digest_runs
    ADD CONSTRAINT digest_runs_occurrence_key_key UNIQUE (occurrence_key);


--
-- Name: digest_runs digest_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.digest_runs
    ADD CONSTRAINT digest_runs_pkey PRIMARY KEY (id);


--
-- Name: digest_subscribers digest_subscribers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.digest_subscribers
    ADD CONSTRAINT digest_subscribers_pkey PRIMARY KEY (id);


--
-- Name: email_brand_settings email_brand_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_brand_settings
    ADD CONSTRAINT email_brand_settings_pkey PRIMARY KEY (id);


--
-- Name: email_log email_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_log
    ADD CONSTRAINT email_log_pkey PRIMARY KEY (id);


--
-- Name: email_schedules email_schedules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_schedules
    ADD CONSTRAINT email_schedules_pkey PRIMARY KEY (template_key);


--
-- Name: email_template_overrides email_template_overrides_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_template_overrides
    ADD CONSTRAINT email_template_overrides_pkey PRIMARY KEY (template_key);


--
-- Name: item_pledge_lines item_pledge_lines_item_pledge_id_item_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_pledge_lines
    ADD CONSTRAINT item_pledge_lines_item_pledge_id_item_id_key UNIQUE (item_pledge_id, item_id);


--
-- Name: item_pledge_lines item_pledge_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_pledge_lines
    ADD CONSTRAINT item_pledge_lines_pkey PRIMARY KEY (id);


--
-- Name: item_pledges item_pledges_legacy_wix_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_pledges
    ADD CONSTRAINT item_pledges_legacy_wix_id_key UNIQUE (legacy_wix_id);


--
-- Name: item_pledges item_pledges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_pledges
    ADD CONSTRAINT item_pledges_pkey PRIMARY KEY (id);


--
-- Name: item_requests item_requests_legacy_wix_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_requests
    ADD CONSTRAINT item_requests_legacy_wix_id_key UNIQUE (legacy_wix_id);


--
-- Name: item_requests item_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_requests
    ADD CONSTRAINT item_requests_pkey PRIMARY KEY (id);


--
-- Name: items items_id_item_request_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.items
    ADD CONSTRAINT items_id_item_request_id_key UNIQUE (id, item_request_id);


--
-- Name: items items_legacy_wix_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.items
    ADD CONSTRAINT items_legacy_wix_id_key UNIQUE (legacy_wix_id);


--
-- Name: items items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.items
    ADD CONSTRAINT items_pkey PRIMARY KEY (id);


--
-- Name: org_memberships org_memberships_org_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_memberships
    ADD CONSTRAINT org_memberships_org_id_user_id_key UNIQUE (org_id, user_id);


--
-- Name: org_memberships org_memberships_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_memberships
    ADD CONSTRAINT org_memberships_pkey PRIMARY KEY (id);


--
-- Name: organization_populations organization_populations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_populations
    ADD CONSTRAINT organization_populations_pkey PRIMARY KEY (org_id, population_id);


--
-- Name: organizations organizations_legacy_wix_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_legacy_wix_id_key UNIQUE (legacy_wix_id);


--
-- Name: organizations organizations_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_name_key UNIQUE (name);


--
-- Name: organizations organizations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_pkey PRIMARY KEY (id);


--
-- Name: organizations organizations_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_slug_key UNIQUE (slug);


--
-- Name: people people_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.people
    ADD CONSTRAINT people_pkey PRIMARY KEY (id);


--
-- Name: person_volunteer_interests person_volunteer_interests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.person_volunteer_interests
    ADD CONSTRAINT person_volunteer_interests_pkey PRIMARY KEY (person_id, category_id);


--
-- Name: populations populations_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.populations
    ADD CONSTRAINT populations_name_key UNIQUE (name);


--
-- Name: populations populations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.populations
    ADD CONSTRAINT populations_pkey PRIMARY KEY (id);


--
-- Name: populations populations_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.populations
    ADD CONSTRAINT populations_slug_key UNIQUE (slug);


--
-- Name: request_engagement_events request_engagement_events_client_event_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.request_engagement_events
    ADD CONSTRAINT request_engagement_events_client_event_id_key UNIQUE (client_event_id);


--
-- Name: request_engagement_events request_engagement_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.request_engagement_events
    ADD CONSTRAINT request_engagement_events_pkey PRIMARY KEY (id);


--
-- Name: request_revisions request_revisions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.request_revisions
    ADD CONSTRAINT request_revisions_pkey PRIMARY KEY (id);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (filename);


--
-- Name: session session_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session
    ADD CONSTRAINT session_pkey PRIMARY KEY (id);


--
-- Name: session session_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session
    ADD CONSTRAINT session_token_key UNIQUE (token);


--
-- Name: site_settings site_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.site_settings
    ADD CONSTRAINT site_settings_pkey PRIMARY KEY (id);


--
-- Name: user user_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."user"
    ADD CONSTRAINT user_email_key UNIQUE (email);


--
-- Name: user user_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."user"
    ADD CONSTRAINT user_pkey PRIMARY KEY (id);


--
-- Name: users users_auth_subject_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_auth_subject_key UNIQUE (auth_subject);


--
-- Name: users users_person_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_person_id_key UNIQUE (person_id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: verification verification_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.verification
    ADD CONSTRAINT verification_pkey PRIMARY KEY (id);


--
-- Name: volunteer_alert_preferences volunteer_alert_preferences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.volunteer_alert_preferences
    ADD CONSTRAINT volunteer_alert_preferences_pkey PRIMARY KEY (user_id);


--
-- Name: volunteer_alert_preferences volunteer_alert_preferences_unsubscribe_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.volunteer_alert_preferences
    ADD CONSTRAINT volunteer_alert_preferences_unsubscribe_token_key UNIQUE (unsubscribe_token);


--
-- Name: volunteer_categories volunteer_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.volunteer_categories
    ADD CONSTRAINT volunteer_categories_pkey PRIMARY KEY (id);


--
-- Name: volunteer_match_alert_claims volunteer_match_alert_claims_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.volunteer_match_alert_claims
    ADD CONSTRAINT volunteer_match_alert_claims_pkey PRIMARY KEY (volunteer_request_id, user_id);


--
-- Name: volunteer_request_categories volunteer_request_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.volunteer_request_categories
    ADD CONSTRAINT volunteer_request_categories_pkey PRIMARY KEY (volunteer_request_id, category_id);


--
-- Name: volunteer_requests volunteer_requests_legacy_wix_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.volunteer_requests
    ADD CONSTRAINT volunteer_requests_legacy_wix_id_key UNIQUE (legacy_wix_id);


--
-- Name: volunteer_requests volunteer_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.volunteer_requests
    ADD CONSTRAINT volunteer_requests_pkey PRIMARY KEY (id);


--
-- Name: volunteer_roles volunteer_roles_id_volunteer_request_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.volunteer_roles
    ADD CONSTRAINT volunteer_roles_id_volunteer_request_id_key UNIQUE (id, volunteer_request_id);


--
-- Name: volunteer_roles volunteer_roles_legacy_wix_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.volunteer_roles
    ADD CONSTRAINT volunteer_roles_legacy_wix_id_key UNIQUE (legacy_wix_id);


--
-- Name: volunteer_roles volunteer_roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.volunteer_roles
    ADD CONSTRAINT volunteer_roles_pkey PRIMARY KEY (id);


--
-- Name: volunteer_signup_roles volunteer_signup_roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.volunteer_signup_roles
    ADD CONSTRAINT volunteer_signup_roles_pkey PRIMARY KEY (id);


--
-- Name: volunteer_signup_roles volunteer_signup_roles_volunteer_signup_id_volunteer_role_i_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.volunteer_signup_roles
    ADD CONSTRAINT volunteer_signup_roles_volunteer_signup_id_volunteer_role_i_key UNIQUE (volunteer_signup_id, volunteer_role_id);


--
-- Name: volunteer_signups volunteer_signups_legacy_wix_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.volunteer_signups
    ADD CONSTRAINT volunteer_signups_legacy_wix_id_key UNIQUE (legacy_wix_id);


--
-- Name: volunteer_signups volunteer_signups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.volunteer_signups
    ADD CONSTRAINT volunteer_signups_pkey PRIMARY KEY (id);


--
-- Name: account_userId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "account_userId_idx" ON public.account USING btree ("userId");


--
-- Name: approval_events_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX approval_events_created_idx ON public.approval_events USING btree (created_at DESC);


--
-- Name: approval_events_entity_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX approval_events_entity_idx ON public.approval_events USING btree (entity_type, entity_id, created_at DESC);


--
-- Name: digest_subscribers_email_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX digest_subscribers_email_key ON public.digest_subscribers USING btree (lower(email));


--
-- Name: digest_subscribers_token_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX digest_subscribers_token_key ON public.digest_subscribers USING btree (unsubscribe_token);


--
-- Name: email_log_entity_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX email_log_entity_idx ON public.email_log USING btree (entity_type, entity_id);


--
-- Name: email_log_once_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX email_log_once_idx ON public.email_log USING btree (template_key, entity_type, entity_id, lower(to_email)) WHERE ((entity_id IS NOT NULL) AND (status <> ALL (ARRAY['failed'::text, 'skipped'::text])));


--
-- Name: email_log_resend_of_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX email_log_resend_of_idx ON public.email_log USING btree (resend_of_id) WHERE (resend_of_id IS NOT NULL);


--
-- Name: email_log_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX email_log_status_idx ON public.email_log USING btree (status, created_at DESC);


--
-- Name: item_pledge_lines_item_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX item_pledge_lines_item_idx ON public.item_pledge_lines USING btree (item_id);


--
-- Name: item_pledges_person_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX item_pledges_person_idx ON public.item_pledges USING btree (person_id);


--
-- Name: item_pledges_request_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX item_pledges_request_idx ON public.item_pledges USING btree (item_request_id);


--
-- Name: item_requests_org_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX item_requests_org_idx ON public.item_requests USING btree (org_id);


--
-- Name: item_requests_public_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX item_requests_public_idx ON public.item_requests USING btree (status, created_at DESC) WHERE (status = 'active'::text);


--
-- Name: items_request_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX items_request_idx ON public.items USING btree (item_request_id, sort_order);


--
-- Name: org_memberships_org_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX org_memberships_org_idx ON public.org_memberships USING btree (org_id) WHERE (status = 'active'::text);


--
-- Name: org_memberships_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX org_memberships_user_idx ON public.org_memberships USING btree (user_id) WHERE (status = 'active'::text);


--
-- Name: organizations_kind_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX organizations_kind_status_idx ON public.organizations USING btree (kind, status);


--
-- Name: people_email_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX people_email_key ON public.people USING btree (lower(email));


--
-- Name: people_needs_review_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX people_needs_review_idx ON public.people USING btree (needs_review) WHERE needs_review;


--
-- Name: person_volunteer_interests_category_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX person_volunteer_interests_category_idx ON public.person_volunteer_interests USING btree (category_id);


--
-- Name: request_engagement_item_reporting_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX request_engagement_item_reporting_idx ON public.request_engagement_events USING btree (item_request_id, created_at DESC) WHERE (item_request_id IS NOT NULL);


--
-- Name: request_engagement_type_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX request_engagement_type_created_idx ON public.request_engagement_events USING btree (event_type, created_at DESC);


--
-- Name: request_engagement_user_history_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX request_engagement_user_history_idx ON public.request_engagement_events USING btree (user_id, created_at DESC) WHERE ((user_id IS NOT NULL) AND (event_type = 'detail_view'::text));


--
-- Name: request_engagement_volunteer_reporting_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX request_engagement_volunteer_reporting_idx ON public.request_engagement_events USING btree (volunteer_request_id, created_at DESC) WHERE (volunteer_request_id IS NOT NULL);


--
-- Name: request_revisions_entity_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX request_revisions_entity_idx ON public.request_revisions USING btree (entity_type, entity_id, created_at DESC);


--
-- Name: session_userId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "session_userId_idx" ON public.session USING btree ("userId");


--
-- Name: verification_identifier_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX verification_identifier_idx ON public.verification USING btree (identifier);


--
-- Name: volunteer_categories_name_ci_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX volunteer_categories_name_ci_key ON public.volunteer_categories USING btree (lower(btrim(name)));


--
-- Name: volunteer_match_alert_claims_email_once_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX volunteer_match_alert_claims_email_once_idx ON public.volunteer_match_alert_claims USING btree (volunteer_request_id, lower(btrim(to_email)));


--
-- Name: volunteer_request_categories_category_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX volunteer_request_categories_category_idx ON public.volunteer_request_categories USING btree (category_id);


--
-- Name: volunteer_requests_org_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX volunteer_requests_org_idx ON public.volunteer_requests USING btree (org_id);


--
-- Name: volunteer_requests_public_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX volunteer_requests_public_idx ON public.volunteer_requests USING btree (status, created_at DESC) WHERE (status = 'active'::text);


--
-- Name: volunteer_roles_request_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX volunteer_roles_request_idx ON public.volunteer_roles USING btree (volunteer_request_id, sort_order);


--
-- Name: volunteer_signup_roles_role_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX volunteer_signup_roles_role_idx ON public.volunteer_signup_roles USING btree (volunteer_role_id);


--
-- Name: volunteer_signups_person_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX volunteer_signups_person_idx ON public.volunteer_signups USING btree (person_id);


--
-- Name: volunteer_signups_request_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX volunteer_signups_request_idx ON public.volunteer_signups USING btree (volunteer_request_id);


--
-- Name: item_pledges item_pledges_reject_expired_request; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER item_pledges_reject_expired_request BEFORE INSERT ON public.item_pledges FOR EACH ROW EXECUTE FUNCTION public.reject_expired_item_pledge();


--
-- Name: item_pledges item_pledges_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER item_pledges_set_updated_at BEFORE UPDATE ON public.item_pledges FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: item_requests item_requests_guard_member_transitions; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER item_requests_guard_member_transitions BEFORE UPDATE ON public.item_requests FOR EACH ROW EXECUTE FUNCTION public.guard_member_request_transitions('item_request');


--
-- Name: item_requests item_requests_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER item_requests_set_updated_at BEFORE UPDATE ON public.item_requests FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: items items_guard_counters; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER items_guard_counters BEFORE UPDATE ON public.items FOR EACH ROW EXECUTE FUNCTION public.guard_counter_columns();


--
-- Name: items items_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER items_set_updated_at BEFORE UPDATE ON public.items FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: org_memberships org_memberships_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER org_memberships_set_updated_at BEFORE UPDATE ON public.org_memberships FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: organizations organizations_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER organizations_set_updated_at BEFORE UPDATE ON public.organizations FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: people people_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER people_set_updated_at BEFORE UPDATE ON public.people FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: users users_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER users_set_updated_at BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: volunteer_alert_preferences volunteer_alert_preferences_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER volunteer_alert_preferences_set_updated_at BEFORE UPDATE ON public.volunteer_alert_preferences FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: volunteer_requests volunteer_requests_guard_member_transitions; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER volunteer_requests_guard_member_transitions BEFORE UPDATE ON public.volunteer_requests FOR EACH ROW EXECUTE FUNCTION public.guard_member_request_transitions('volunteer_request');


--
-- Name: volunteer_requests volunteer_requests_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER volunteer_requests_set_updated_at BEFORE UPDATE ON public.volunteer_requests FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: volunteer_roles volunteer_roles_guard_counters; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER volunteer_roles_guard_counters BEFORE UPDATE ON public.volunteer_roles FOR EACH ROW EXECUTE FUNCTION public.guard_counter_columns();


--
-- Name: volunteer_roles volunteer_roles_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER volunteer_roles_set_updated_at BEFORE UPDATE ON public.volunteer_roles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: volunteer_signups volunteer_signups_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER volunteer_signups_set_updated_at BEFORE UPDATE ON public.volunteer_signups FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: account account_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account
    ADD CONSTRAINT "account_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."user"(id) ON DELETE CASCADE;


--
-- Name: approval_events approval_events_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approval_events
    ADD CONSTRAINT approval_events_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES public.users(id);


--
-- Name: digest_exclusions digest_exclusions_excluded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.digest_exclusions
    ADD CONSTRAINT digest_exclusions_excluded_by_fkey FOREIGN KEY (excluded_by) REFERENCES public.users(id);


--
-- Name: digest_subscribers digest_subscribers_person_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.digest_subscribers
    ADD CONSTRAINT digest_subscribers_person_id_fkey FOREIGN KEY (person_id) REFERENCES public.people(id);


--
-- Name: email_brand_settings email_brand_settings_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_brand_settings
    ADD CONSTRAINT email_brand_settings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: email_log email_log_resend_of_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_log
    ADD CONSTRAINT email_log_resend_of_id_fkey FOREIGN KEY (resend_of_id) REFERENCES public.email_log(id);


--
-- Name: email_log email_log_to_person_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_log
    ADD CONSTRAINT email_log_to_person_id_fkey FOREIGN KEY (to_person_id) REFERENCES public.people(id);


--
-- Name: email_schedules email_schedules_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_schedules
    ADD CONSTRAINT email_schedules_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id);


--
-- Name: email_template_overrides email_template_overrides_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_template_overrides
    ADD CONSTRAINT email_template_overrides_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id);


--
-- Name: item_pledge_lines item_pledge_lines_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_pledge_lines
    ADD CONSTRAINT item_pledge_lines_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.items(id);


--
-- Name: item_pledge_lines item_pledge_lines_item_pledge_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_pledge_lines
    ADD CONSTRAINT item_pledge_lines_item_pledge_id_fkey FOREIGN KEY (item_pledge_id) REFERENCES public.item_pledges(id) ON DELETE CASCADE;


--
-- Name: item_pledges item_pledges_item_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_pledges
    ADD CONSTRAINT item_pledges_item_request_id_fkey FOREIGN KEY (item_request_id) REFERENCES public.item_requests(id);


--
-- Name: item_pledges item_pledges_person_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_pledges
    ADD CONSTRAINT item_pledges_person_id_fkey FOREIGN KEY (person_id) REFERENCES public.people(id);


--
-- Name: item_requests item_requests_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_requests
    ADD CONSTRAINT item_requests_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.users(id);


--
-- Name: item_requests item_requests_contact_person_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_requests
    ADD CONSTRAINT item_requests_contact_person_id_fkey FOREIGN KEY (contact_person_id) REFERENCES public.people(id);


--
-- Name: item_requests item_requests_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_requests
    ADD CONSTRAINT item_requests_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: item_requests item_requests_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_requests
    ADD CONSTRAINT item_requests_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id);


--
-- Name: items items_item_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.items
    ADD CONSTRAINT items_item_request_id_fkey FOREIGN KEY (item_request_id) REFERENCES public.item_requests(id) ON DELETE CASCADE;


--
-- Name: org_memberships org_memberships_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_memberships
    ADD CONSTRAINT org_memberships_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.users(id);


--
-- Name: org_memberships org_memberships_invited_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_memberships
    ADD CONSTRAINT org_memberships_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES public.users(id);


--
-- Name: org_memberships org_memberships_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_memberships
    ADD CONSTRAINT org_memberships_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: org_memberships org_memberships_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_memberships
    ADD CONSTRAINT org_memberships_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: organization_populations organization_populations_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_populations
    ADD CONSTRAINT organization_populations_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: organization_populations organization_populations_population_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_populations
    ADD CONSTRAINT organization_populations_population_id_fkey FOREIGN KEY (population_id) REFERENCES public.populations(id);


--
-- Name: organizations organizations_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.users(id);


--
-- Name: organizations organizations_primary_contact_person_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_primary_contact_person_id_fkey FOREIGN KEY (primary_contact_person_id) REFERENCES public.people(id);


--
-- Name: person_volunteer_interests person_volunteer_interests_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.person_volunteer_interests
    ADD CONSTRAINT person_volunteer_interests_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.volunteer_categories(id);


--
-- Name: person_volunteer_interests person_volunteer_interests_person_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.person_volunteer_interests
    ADD CONSTRAINT person_volunteer_interests_person_id_fkey FOREIGN KEY (person_id) REFERENCES public.people(id) ON DELETE CASCADE;


--
-- Name: request_engagement_events request_engagement_events_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.request_engagement_events
    ADD CONSTRAINT request_engagement_events_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.items(id) ON DELETE CASCADE;


--
-- Name: request_engagement_events request_engagement_events_item_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.request_engagement_events
    ADD CONSTRAINT request_engagement_events_item_request_id_fkey FOREIGN KEY (item_request_id) REFERENCES public.item_requests(id) ON DELETE CASCADE;


--
-- Name: request_engagement_events request_engagement_events_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.request_engagement_events
    ADD CONSTRAINT request_engagement_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: request_engagement_events request_engagement_events_volunteer_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.request_engagement_events
    ADD CONSTRAINT request_engagement_events_volunteer_request_id_fkey FOREIGN KEY (volunteer_request_id) REFERENCES public.volunteer_requests(id) ON DELETE CASCADE;


--
-- Name: request_engagement_events request_engagement_events_volunteer_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.request_engagement_events
    ADD CONSTRAINT request_engagement_events_volunteer_role_id_fkey FOREIGN KEY (volunteer_role_id) REFERENCES public.volunteer_roles(id) ON DELETE CASCADE;


--
-- Name: request_engagement_events request_engagement_item_ownership_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.request_engagement_events
    ADD CONSTRAINT request_engagement_item_ownership_fk FOREIGN KEY (item_id, item_request_id) REFERENCES public.items(id, item_request_id) ON DELETE CASCADE;


--
-- Name: request_engagement_events request_engagement_role_ownership_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.request_engagement_events
    ADD CONSTRAINT request_engagement_role_ownership_fk FOREIGN KEY (volunteer_role_id, volunteer_request_id) REFERENCES public.volunteer_roles(id, volunteer_request_id) ON DELETE CASCADE;


--
-- Name: request_revisions request_revisions_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.request_revisions
    ADD CONSTRAINT request_revisions_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES public.users(id);


--
-- Name: session session_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session
    ADD CONSTRAINT "session_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."user"(id) ON DELETE CASCADE;


--
-- Name: site_settings site_settings_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.site_settings
    ADD CONSTRAINT site_settings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: users users_person_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_person_id_fkey FOREIGN KEY (person_id) REFERENCES public.people(id);


--
-- Name: volunteer_alert_preferences volunteer_alert_preferences_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.volunteer_alert_preferences
    ADD CONSTRAINT volunteer_alert_preferences_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: volunteer_match_alert_claims volunteer_match_alert_claims_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.volunteer_match_alert_claims
    ADD CONSTRAINT volunteer_match_alert_claims_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: volunteer_match_alert_claims volunteer_match_alert_claims_volunteer_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.volunteer_match_alert_claims
    ADD CONSTRAINT volunteer_match_alert_claims_volunteer_request_id_fkey FOREIGN KEY (volunteer_request_id) REFERENCES public.volunteer_requests(id) ON DELETE CASCADE;


--
-- Name: volunteer_request_categories volunteer_request_categories_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.volunteer_request_categories
    ADD CONSTRAINT volunteer_request_categories_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.volunteer_categories(id);


--
-- Name: volunteer_request_categories volunteer_request_categories_volunteer_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.volunteer_request_categories
    ADD CONSTRAINT volunteer_request_categories_volunteer_request_id_fkey FOREIGN KEY (volunteer_request_id) REFERENCES public.volunteer_requests(id) ON DELETE CASCADE;


--
-- Name: volunteer_requests volunteer_requests_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.volunteer_requests
    ADD CONSTRAINT volunteer_requests_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.users(id);


--
-- Name: volunteer_requests volunteer_requests_contact_person_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.volunteer_requests
    ADD CONSTRAINT volunteer_requests_contact_person_id_fkey FOREIGN KEY (contact_person_id) REFERENCES public.people(id);


--
-- Name: volunteer_requests volunteer_requests_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.volunteer_requests
    ADD CONSTRAINT volunteer_requests_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: volunteer_requests volunteer_requests_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.volunteer_requests
    ADD CONSTRAINT volunteer_requests_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id);


--
-- Name: volunteer_roles volunteer_roles_volunteer_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.volunteer_roles
    ADD CONSTRAINT volunteer_roles_volunteer_request_id_fkey FOREIGN KEY (volunteer_request_id) REFERENCES public.volunteer_requests(id) ON DELETE CASCADE;


--
-- Name: volunteer_signup_roles volunteer_signup_roles_volunteer_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.volunteer_signup_roles
    ADD CONSTRAINT volunteer_signup_roles_volunteer_role_id_fkey FOREIGN KEY (volunteer_role_id) REFERENCES public.volunteer_roles(id);


--
-- Name: volunteer_signup_roles volunteer_signup_roles_volunteer_signup_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.volunteer_signup_roles
    ADD CONSTRAINT volunteer_signup_roles_volunteer_signup_id_fkey FOREIGN KEY (volunteer_signup_id) REFERENCES public.volunteer_signups(id) ON DELETE CASCADE;


--
-- Name: volunteer_signups volunteer_signups_person_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.volunteer_signups
    ADD CONSTRAINT volunteer_signups_person_id_fkey FOREIGN KEY (person_id) REFERENCES public.people(id);


--
-- Name: volunteer_signups volunteer_signups_volunteer_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.volunteer_signups
    ADD CONSTRAINT volunteer_signups_volunteer_request_id_fkey FOREIGN KEY (volunteer_request_id) REFERENCES public.volunteer_requests(id);


--
-- Name: approval_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.approval_events ENABLE ROW LEVEL SECURITY;

--
-- Name: approval_events approval_events_member_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY approval_events_member_insert ON public.approval_events FOR INSERT WITH CHECK (((current_setting('app.context'::text, true) = 'member'::text) AND (entity_type = ANY (ARRAY['item_request'::text, 'volunteer_request'::text]))));


--
-- Name: approval_events approval_events_system_staff_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY approval_events_system_staff_all ON public.approval_events USING ((current_setting('app.context'::text, true) = ANY (ARRAY['system'::text, 'staff'::text]))) WITH CHECK ((current_setting('app.context'::text, true) = ANY (ARRAY['system'::text, 'staff'::text])));


--
-- Name: digest_exclusions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.digest_exclusions ENABLE ROW LEVEL SECURITY;

--
-- Name: digest_exclusions digest_exclusions_system_staff_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY digest_exclusions_system_staff_all ON public.digest_exclusions USING ((current_setting('app.context'::text, true) = ANY (ARRAY['system'::text, 'staff'::text]))) WITH CHECK ((current_setting('app.context'::text, true) = ANY (ARRAY['system'::text, 'staff'::text])));


--
-- Name: digest_runs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.digest_runs ENABLE ROW LEVEL SECURITY;

--
-- Name: digest_runs digest_runs_system_staff_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY digest_runs_system_staff_all ON public.digest_runs USING ((current_setting('app.context'::text, true) = ANY (ARRAY['system'::text, 'staff'::text]))) WITH CHECK ((current_setting('app.context'::text, true) = ANY (ARRAY['system'::text, 'staff'::text])));


--
-- Name: digest_subscribers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.digest_subscribers ENABLE ROW LEVEL SECURITY;

--
-- Name: digest_subscribers digest_subscribers_system_staff_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY digest_subscribers_system_staff_all ON public.digest_subscribers USING ((current_setting('app.context'::text, true) = ANY (ARRAY['system'::text, 'staff'::text]))) WITH CHECK ((current_setting('app.context'::text, true) = ANY (ARRAY['system'::text, 'staff'::text])));


--
-- Name: email_brand_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.email_brand_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: email_brand_settings email_brand_settings_system_staff_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY email_brand_settings_system_staff_all ON public.email_brand_settings USING ((current_setting('app.context'::text, true) = ANY (ARRAY['system'::text, 'staff'::text]))) WITH CHECK ((current_setting('app.context'::text, true) = ANY (ARRAY['system'::text, 'staff'::text])));


--
-- Name: email_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.email_log ENABLE ROW LEVEL SECURITY;

--
-- Name: email_log email_log_system_staff_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY email_log_system_staff_all ON public.email_log USING ((current_setting('app.context'::text, true) = ANY (ARRAY['system'::text, 'staff'::text]))) WITH CHECK ((current_setting('app.context'::text, true) = ANY (ARRAY['system'::text, 'staff'::text])));


--
-- Name: email_schedules; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.email_schedules ENABLE ROW LEVEL SECURITY;

--
-- Name: email_schedules email_schedules_system_staff_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY email_schedules_system_staff_all ON public.email_schedules USING ((current_setting('app.context'::text, true) = ANY (ARRAY['system'::text, 'staff'::text]))) WITH CHECK ((current_setting('app.context'::text, true) = ANY (ARRAY['system'::text, 'staff'::text])));


--
-- Name: email_template_overrides; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.email_template_overrides ENABLE ROW LEVEL SECURITY;

--
-- Name: email_template_overrides email_template_overrides_system_staff_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY email_template_overrides_system_staff_all ON public.email_template_overrides USING ((current_setting('app.context'::text, true) = ANY (ARRAY['system'::text, 'staff'::text]))) WITH CHECK ((current_setting('app.context'::text, true) = ANY (ARRAY['system'::text, 'staff'::text])));


--
-- Name: item_pledge_lines; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.item_pledge_lines ENABLE ROW LEVEL SECURITY;

--
-- Name: item_pledge_lines item_pledge_lines_member_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY item_pledge_lines_member_select ON public.item_pledge_lines FOR SELECT USING (((current_setting('app.context'::text, true) = 'member'::text) AND (item_pledge_id IN ( SELECT ip.id
   FROM (public.item_pledges ip
     JOIN public.item_requests r ON ((r.id = ip.item_request_id)))
  WHERE (r.org_id IN ( SELECT om.org_id
           FROM public.org_memberships om
          WHERE ((om.user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) AND (om.status = 'active'::text))))))));


--
-- Name: item_pledge_lines item_pledge_lines_system_staff_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY item_pledge_lines_system_staff_all ON public.item_pledge_lines USING ((current_setting('app.context'::text, true) = ANY (ARRAY['system'::text, 'staff'::text]))) WITH CHECK ((current_setting('app.context'::text, true) = ANY (ARRAY['system'::text, 'staff'::text])));


--
-- Name: item_pledges; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.item_pledges ENABLE ROW LEVEL SECURITY;

--
-- Name: item_pledges item_pledges_member_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY item_pledges_member_select ON public.item_pledges FOR SELECT USING (((current_setting('app.context'::text, true) = 'member'::text) AND (item_request_id IN ( SELECT r.id
   FROM public.item_requests r
  WHERE (r.org_id IN ( SELECT om.org_id
           FROM public.org_memberships om
          WHERE ((om.user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) AND (om.status = 'active'::text))))))));


--
-- Name: item_pledges item_pledges_system_staff_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY item_pledges_system_staff_all ON public.item_pledges USING ((current_setting('app.context'::text, true) = ANY (ARRAY['system'::text, 'staff'::text]))) WITH CHECK ((current_setting('app.context'::text, true) = ANY (ARRAY['system'::text, 'staff'::text])));


--
-- Name: item_requests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.item_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: item_requests item_requests_member_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY item_requests_member_insert ON public.item_requests FOR INSERT WITH CHECK (((current_setting('app.context'::text, true) = 'member'::text) AND (status = 'draft'::text) AND (org_id IN ( SELECT om.org_id
   FROM public.org_memberships om
  WHERE ((om.user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) AND (om.status = 'active'::text))))));


--
-- Name: item_requests item_requests_member_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY item_requests_member_select ON public.item_requests FOR SELECT USING (((current_setting('app.context'::text, true) = 'member'::text) AND (org_id IN ( SELECT om.org_id
   FROM public.org_memberships om
  WHERE ((om.user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) AND (om.status = 'active'::text))))));


--
-- Name: item_requests item_requests_member_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY item_requests_member_update ON public.item_requests FOR UPDATE USING (((current_setting('app.context'::text, true) = 'member'::text) AND (org_id IN ( SELECT om.org_id
   FROM public.org_memberships om
  WHERE ((om.user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) AND (om.status = 'active'::text)))))) WITH CHECK (((current_setting('app.context'::text, true) = 'member'::text) AND (org_id IN ( SELECT om.org_id
   FROM public.org_memberships om
  WHERE ((om.user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) AND (om.status = 'active'::text))))));


--
-- Name: item_requests item_requests_public_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY item_requests_public_select ON public.item_requests FOR SELECT USING (((current_setting('app.context'::text, true) = 'public'::text) AND (status = ANY (ARRAY['active'::text, 'archived'::text])) AND (org_id IN ( SELECT o.id
   FROM public.organizations o
  WHERE ((o.kind = 'member_org'::text) AND (o.status = 'approved'::text))))));


--
-- Name: item_requests item_requests_system_staff_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY item_requests_system_staff_all ON public.item_requests USING ((current_setting('app.context'::text, true) = ANY (ARRAY['system'::text, 'staff'::text]))) WITH CHECK ((current_setting('app.context'::text, true) = ANY (ARRAY['system'::text, 'staff'::text])));


--
-- Name: items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.items ENABLE ROW LEVEL SECURITY;

--
-- Name: items items_member_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY items_member_all ON public.items USING (((current_setting('app.context'::text, true) = 'member'::text) AND (item_request_id IN ( SELECT r.id
   FROM public.item_requests r
  WHERE (r.org_id IN ( SELECT om.org_id
           FROM public.org_memberships om
          WHERE ((om.user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) AND (om.status = 'active'::text)))))))) WITH CHECK (((current_setting('app.context'::text, true) = 'member'::text) AND (item_request_id IN ( SELECT r.id
   FROM public.item_requests r
  WHERE (r.org_id IN ( SELECT om.org_id
           FROM public.org_memberships om
          WHERE ((om.user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) AND (om.status = 'active'::text))))))));


--
-- Name: items items_public_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY items_public_select ON public.items FOR SELECT USING (((current_setting('app.context'::text, true) = 'public'::text) AND (EXISTS ( SELECT 1
   FROM (public.item_requests r
     JOIN public.organizations o ON ((o.id = r.org_id)))
  WHERE ((r.id = items.item_request_id) AND (r.status = ANY (ARRAY['active'::text, 'archived'::text])) AND (o.kind = 'member_org'::text) AND (o.status = 'approved'::text))))));


--
-- Name: items items_system_staff_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY items_system_staff_all ON public.items USING ((current_setting('app.context'::text, true) = ANY (ARRAY['system'::text, 'staff'::text]))) WITH CHECK ((current_setting('app.context'::text, true) = ANY (ARRAY['system'::text, 'staff'::text])));


--
-- Name: org_memberships; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.org_memberships ENABLE ROW LEVEL SECURITY;

--
-- Name: org_memberships org_memberships_member_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY org_memberships_member_select_own ON public.org_memberships FOR SELECT USING (((current_setting('app.context'::text, true) = 'member'::text) AND (user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid)));


--
-- Name: org_memberships org_memberships_system_staff_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY org_memberships_system_staff_all ON public.org_memberships USING ((current_setting('app.context'::text, true) = ANY (ARRAY['system'::text, 'staff'::text]))) WITH CHECK ((current_setting('app.context'::text, true) = ANY (ARRAY['system'::text, 'staff'::text])));


--
-- Name: organization_populations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.organization_populations ENABLE ROW LEVEL SECURITY;

--
-- Name: organization_populations organization_populations_public_member_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY organization_populations_public_member_select ON public.organization_populations FOR SELECT USING (((current_setting('app.context'::text, true) = ANY (ARRAY['public'::text, 'member'::text])) AND (EXISTS ( SELECT 1
   FROM public.organizations o
  WHERE ((o.id = organization_populations.org_id) AND (o.kind = 'member_org'::text) AND (o.status = 'approved'::text))))));


--
-- Name: organization_populations organization_populations_system_staff_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY organization_populations_system_staff_all ON public.organization_populations USING ((current_setting('app.context'::text, true) = ANY (ARRAY['system'::text, 'staff'::text]))) WITH CHECK ((current_setting('app.context'::text, true) = ANY (ARRAY['system'::text, 'staff'::text])));


--
-- Name: organizations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

--
-- Name: organizations organizations_member_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY organizations_member_select ON public.organizations FOR SELECT USING (((current_setting('app.context'::text, true) = 'member'::text) AND ((id IN ( SELECT om.org_id
   FROM public.org_memberships om
  WHERE ((om.user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) AND (om.status = 'active'::text)))) OR ((kind = 'member_org'::text) AND (status = 'approved'::text)))));


--
-- Name: organizations organizations_member_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY organizations_member_update ON public.organizations FOR UPDATE USING (((current_setting('app.context'::text, true) = 'member'::text) AND (id IN ( SELECT om.org_id
   FROM public.org_memberships om
  WHERE ((om.user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) AND (om.status = 'active'::text)))))) WITH CHECK (((current_setting('app.context'::text, true) = 'member'::text) AND (id IN ( SELECT om.org_id
   FROM public.org_memberships om
  WHERE ((om.user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) AND (om.status = 'active'::text))))));


--
-- Name: organizations organizations_public_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY organizations_public_select ON public.organizations FOR SELECT USING (((current_setting('app.context'::text, true) = 'public'::text) AND (kind = 'member_org'::text) AND (status = 'approved'::text)));


--
-- Name: organizations organizations_system_staff_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY organizations_system_staff_all ON public.organizations USING ((current_setting('app.context'::text, true) = ANY (ARRAY['system'::text, 'staff'::text]))) WITH CHECK ((current_setting('app.context'::text, true) = ANY (ARRAY['system'::text, 'staff'::text])));


--
-- Name: people; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.people ENABLE ROW LEVEL SECURITY;

--
-- Name: people people_member_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY people_member_select ON public.people FOR SELECT USING (((current_setting('app.context'::text, true) = 'member'::text) AND ((EXISTS ( SELECT 1
   FROM (public.item_pledges ip
     JOIN public.item_requests ir ON ((ir.id = ip.item_request_id)))
  WHERE ((ip.person_id = people.id) AND (ir.org_id IN ( SELECT om.org_id
           FROM public.org_memberships om
          WHERE ((om.user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) AND (om.status = 'active'::text))))))) OR (EXISTS ( SELECT 1
   FROM (public.volunteer_signups vs
     JOIN public.volunteer_requests vr ON ((vr.id = vs.volunteer_request_id)))
  WHERE ((vs.person_id = people.id) AND (vr.org_id IN ( SELECT om.org_id
           FROM public.org_memberships om
          WHERE ((om.user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) AND (om.status = 'active'::text))))))) OR (EXISTS ( SELECT 1
   FROM public.organizations o
  WHERE ((o.primary_contact_person_id = people.id) AND (o.id IN ( SELECT om.org_id
           FROM public.org_memberships om
          WHERE ((om.user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) AND (om.status = 'active'::text))))))) OR (EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.person_id = people.id) AND (u.id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid)))))));


--
-- Name: people people_system_staff_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY people_system_staff_all ON public.people USING ((current_setting('app.context'::text, true) = ANY (ARRAY['system'::text, 'staff'::text]))) WITH CHECK ((current_setting('app.context'::text, true) = ANY (ARRAY['system'::text, 'staff'::text])));


--
-- Name: populations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.populations ENABLE ROW LEVEL SECURITY;

--
-- Name: populations populations_public_member_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY populations_public_member_select ON public.populations FOR SELECT USING (((current_setting('app.context'::text, true) = ANY (ARRAY['public'::text, 'member'::text])) AND is_active));


--
-- Name: populations populations_system_staff_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY populations_system_staff_all ON public.populations USING ((current_setting('app.context'::text, true) = ANY (ARRAY['system'::text, 'staff'::text]))) WITH CHECK ((current_setting('app.context'::text, true) = ANY (ARRAY['system'::text, 'staff'::text])));


--
-- Name: site_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.site_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: site_settings site_settings_system_staff_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY site_settings_system_staff_all ON public.site_settings USING ((current_setting('app.context'::text, true) = ANY (ARRAY['system'::text, 'staff'::text]))) WITH CHECK ((current_setting('app.context'::text, true) = ANY (ARRAY['system'::text, 'staff'::text])));


--
-- Name: users; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

--
-- Name: users users_member_select_self; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY users_member_select_self ON public.users FOR SELECT USING (((current_setting('app.context'::text, true) = 'member'::text) AND (id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid)));


--
-- Name: users users_system_staff_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY users_system_staff_all ON public.users USING ((current_setting('app.context'::text, true) = ANY (ARRAY['system'::text, 'staff'::text]))) WITH CHECK ((current_setting('app.context'::text, true) = ANY (ARRAY['system'::text, 'staff'::text])));


--
-- Name: volunteer_requests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.volunteer_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: volunteer_requests volunteer_requests_member_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY volunteer_requests_member_insert ON public.volunteer_requests FOR INSERT WITH CHECK (((current_setting('app.context'::text, true) = 'member'::text) AND (status = 'draft'::text) AND (org_id IN ( SELECT om.org_id
   FROM public.org_memberships om
  WHERE ((om.user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) AND (om.status = 'active'::text))))));


--
-- Name: volunteer_requests volunteer_requests_member_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY volunteer_requests_member_select ON public.volunteer_requests FOR SELECT USING (((current_setting('app.context'::text, true) = 'member'::text) AND (org_id IN ( SELECT om.org_id
   FROM public.org_memberships om
  WHERE ((om.user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) AND (om.status = 'active'::text))))));


--
-- Name: volunteer_requests volunteer_requests_member_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY volunteer_requests_member_update ON public.volunteer_requests FOR UPDATE USING (((current_setting('app.context'::text, true) = 'member'::text) AND (org_id IN ( SELECT om.org_id
   FROM public.org_memberships om
  WHERE ((om.user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) AND (om.status = 'active'::text)))))) WITH CHECK (((current_setting('app.context'::text, true) = 'member'::text) AND (org_id IN ( SELECT om.org_id
   FROM public.org_memberships om
  WHERE ((om.user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) AND (om.status = 'active'::text))))));


--
-- Name: volunteer_requests volunteer_requests_public_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY volunteer_requests_public_select ON public.volunteer_requests FOR SELECT USING (((current_setting('app.context'::text, true) = 'public'::text) AND (status = ANY (ARRAY['active'::text, 'archived'::text])) AND (org_id IN ( SELECT o.id
   FROM public.organizations o
  WHERE ((o.kind = 'member_org'::text) AND (o.status = 'approved'::text))))));


--
-- Name: volunteer_requests volunteer_requests_system_staff_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY volunteer_requests_system_staff_all ON public.volunteer_requests USING ((current_setting('app.context'::text, true) = ANY (ARRAY['system'::text, 'staff'::text]))) WITH CHECK ((current_setting('app.context'::text, true) = ANY (ARRAY['system'::text, 'staff'::text])));


--
-- Name: volunteer_roles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.volunteer_roles ENABLE ROW LEVEL SECURITY;

--
-- Name: volunteer_roles volunteer_roles_member_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY volunteer_roles_member_all ON public.volunteer_roles USING (((current_setting('app.context'::text, true) = 'member'::text) AND (volunteer_request_id IN ( SELECT r.id
   FROM public.volunteer_requests r
  WHERE (r.org_id IN ( SELECT om.org_id
           FROM public.org_memberships om
          WHERE ((om.user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) AND (om.status = 'active'::text)))))))) WITH CHECK (((current_setting('app.context'::text, true) = 'member'::text) AND (volunteer_request_id IN ( SELECT r.id
   FROM public.volunteer_requests r
  WHERE (r.org_id IN ( SELECT om.org_id
           FROM public.org_memberships om
          WHERE ((om.user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) AND (om.status = 'active'::text))))))));


--
-- Name: volunteer_roles volunteer_roles_public_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY volunteer_roles_public_select ON public.volunteer_roles FOR SELECT USING (((current_setting('app.context'::text, true) = 'public'::text) AND (EXISTS ( SELECT 1
   FROM (public.volunteer_requests r
     JOIN public.organizations o ON ((o.id = r.org_id)))
  WHERE ((r.id = volunteer_roles.volunteer_request_id) AND (r.status = ANY (ARRAY['active'::text, 'archived'::text])) AND (o.kind = 'member_org'::text) AND (o.status = 'approved'::text))))));


--
-- Name: volunteer_roles volunteer_roles_system_staff_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY volunteer_roles_system_staff_all ON public.volunteer_roles USING ((current_setting('app.context'::text, true) = ANY (ARRAY['system'::text, 'staff'::text]))) WITH CHECK ((current_setting('app.context'::text, true) = ANY (ARRAY['system'::text, 'staff'::text])));


--
-- Name: volunteer_signup_roles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.volunteer_signup_roles ENABLE ROW LEVEL SECURITY;

--
-- Name: volunteer_signup_roles volunteer_signup_roles_member_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY volunteer_signup_roles_member_select ON public.volunteer_signup_roles FOR SELECT USING (((current_setting('app.context'::text, true) = 'member'::text) AND (volunteer_signup_id IN ( SELECT vs.id
   FROM (public.volunteer_signups vs
     JOIN public.volunteer_requests r ON ((r.id = vs.volunteer_request_id)))
  WHERE (r.org_id IN ( SELECT om.org_id
           FROM public.org_memberships om
          WHERE ((om.user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) AND (om.status = 'active'::text))))))));


--
-- Name: volunteer_signup_roles volunteer_signup_roles_system_staff_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY volunteer_signup_roles_system_staff_all ON public.volunteer_signup_roles USING ((current_setting('app.context'::text, true) = ANY (ARRAY['system'::text, 'staff'::text]))) WITH CHECK ((current_setting('app.context'::text, true) = ANY (ARRAY['system'::text, 'staff'::text])));


--
-- Name: volunteer_signups; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.volunteer_signups ENABLE ROW LEVEL SECURITY;

--
-- Name: volunteer_signups volunteer_signups_member_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY volunteer_signups_member_select ON public.volunteer_signups FOR SELECT USING (((current_setting('app.context'::text, true) = 'member'::text) AND (volunteer_request_id IN ( SELECT r.id
   FROM public.volunteer_requests r
  WHERE (r.org_id IN ( SELECT om.org_id
           FROM public.org_memberships om
          WHERE ((om.user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) AND (om.status = 'active'::text))))))));


--
-- Name: volunteer_signups volunteer_signups_system_staff_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY volunteer_signups_system_staff_all ON public.volunteer_signups USING ((current_setting('app.context'::text, true) = ANY (ARRAY['system'::text, 'staff'::text]))) WITH CHECK ((current_setting('app.context'::text, true) = ANY (ARRAY['system'::text, 'staff'::text])));


--
-- PostgreSQL database dump complete
--

\unrestrict 5qaY9W9bWEVj4xpIEfWL36scy4MgNR9Ks529W6dIo4SHucrijhODIG1DbCxgQDB

```

---

## 3. Migration ledger

Files present in `migrations/`: 38.
Rows present in production `schema_migrations`: 38.

Column `filename` is the primary key of `schema_migrations` (`filename` text, `sha256` text,
`applied_at` timestamptz).

| # | Migration filename | Row in production `schema_migrations` |
| --- | --- | --- |
| 1 | `0001_initial_schema.sql` | yes |
| 2 | `0002_phone_match_names_all_duplicates.sql` | yes |
| 3 | `0003_merge_people_function.sql` | yes |
| 4 | `0004_digest_subscriber_names.sql` | yes |
| 5 | `0005_email_dispatch_claim.sql` | yes |
| 6 | `0006_close_rls_and_counter_gaps.sql` | yes |
| 7 | `0007_scope_public_child_policies.sql` | yes |
| 8 | `0008_email_template_overrides.sql` | yes |
| 9 | `0008_item_image_generation.sql` | yes |
| 10 | `0009_digest_runs.sql` | yes |
| 11 | `0009_email_template_overrides_updated_by.sql` | yes |
| 12 | `0010_digest_run_needs_snapshot.sql` | yes |
| 13 | `0011_image_gen_retries.sql` | yes |
| 14 | `0012_digest_exclusions.sql` | yes |
| 15 | `0012_email_log_failure_structured.sql` | yes |
| 16 | `0013_digest_exclusions_simpler_key.sql` | yes |
| 17 | `0014_supporter_user_kind.sql` | yes |
| 18 | `0034_split_counter_trigger_branches.sql` | yes |
| 19 | `0035_volunteer_image_generation.sql` | yes |
| 20 | `0036_item_request_deadline_expiry.sql` | yes |
| 21 | `0037_email_schedules.sql` | yes |
| 22 | `0037_volunteer_interests.sql` | yes |
| 23 | `0038_digest_run_occurrences.sql` | yes |
| 24 | `0038_volunteer_request_categories.sql` | yes |
| 25 | `0039_matching_volunteer_alerts.sql` | yes |
| 26 | `0040_request_analytics_parent_ownership_keys.sql` | yes |
| 27 | `0041_request_engagement.sql` | yes |
| 28 | `0042_engagement_child_ownership.sql` | yes |
| 29 | `0043_request_revisions.sql` | yes |
| 30 | `0043_volunteer_signup_expiry_check.sql` | yes |
| 31 | `0044_repair_item_request_expiry_functions.sql` | yes |
| 32 | `0045_restore_routine_parity.sql` | yes |
| 33 | `0046_seed_quick_login_supporter.sql` | yes |
| 34 | `0046_seed_volunteer_categories.sql` | yes |
| 35 | `0047_email_body_blocks.sql` | yes |
| 36 | `0047_email_brand_settings.sql` | yes |
| 37 | `0048_email_body_blocks_check.sql` | yes |
| 38 | `0049_site_settings.sql` | yes |

Migration files with **no** matching `schema_migrations` row in production: **none**.

`schema_migrations` rows in production with no matching file in `migrations/`: **none**.

---

## 4. Row counts (production)

`SELECT COUNT(*)` per base table, run against the production database.

| Table | Row count |
| --- | --- |
| account | 0 |
| approval_events | 122 |
| digest_exclusions | 0 |
| digest_runs | 0 |
| digest_subscribers | 17 |
| email_brand_settings | 1 |
| email_log | 215 |
| email_schedules | 1 |
| email_template_overrides | 1 |
| item_pledge_lines | 16 |
| item_pledges | 11 |
| item_requests | 21 |
| items | 45 |
| org_memberships | 22 |
| organization_populations | 26 |
| organizations | 16 |
| people | 38 |
| person_volunteer_interests | 0 |
| populations | 13 |
| request_engagement_events | 0 |
| request_revisions | 12 |
| schema_migrations | 38 |
| session | 38 |
| site_settings | 1 |
| user | 17 |
| users | 22 |
| verification | 4 |
| volunteer_alert_preferences | 0 |
| volunteer_categories | 12 |
| volunteer_match_alert_claims | 0 |
| volunteer_request_categories | 0 |
| volunteer_requests | 13 |
| volunteer_roles | 23 |
| volunteer_signup_roles | 15 |
| volunteer_signups | 14 |

---

## 5. Digest schedule state

Backing table: `email_schedules` (referenced by `server/dal/email-schedules.ts`, consumed by
`server/digest-schedule.ts` and `server/jobs/digest.ts`).
Digest template key constant: `digest_new_needs` (`DIGEST_TEMPLATE_KEY` in `server/digest-schedule.ts`).

Query run against production:

```sql
select template_key, active, weekly_weekday, weekly_minutes, one_time_at, updated_at, updated_by
from email_schedules order by template_key
```

Result (1 row):

```
template_key,active,weekly_weekday,weekly_minutes,one_time_at,updated_at,updated_by
digest_new_needs,t,4,540,,2026-08-20 23:37:23.296931+00,
```

Values exactly as stored:

| Field | Stored value |
| --- | --- |
| `template_key` | `digest_new_needs` |
| `active` | `t` (true) |
| `weeklyWeekday` (`weekly_weekday`) | `4` |
| `weeklyMinutes` (`weekly_minutes`) | `540` |
| `one_time_at` | NULL |
| `updated_at` | `2026-08-20 23:37:23.296931+00` |
| `updated_by` | NULL |

---

## 6. Legacy import status

Filenames and modification times only. File contents were not read or reproduced.

### `data/legacy-export/`

Directory status: **does not exist**.

```
ls: cannot access 'data/legacy-export/': No such file or directory
```

Six required CSVs present: **0 of 6** (the directory itself is absent, so no CSV is present).

### `data/load/`

Directory status: **exists, empty** (no `transform.py` output present).

```
total 0
drwxr-xr-x 1 runner runner  0 Aug 17 18:55 .
drwxr-xr-x 1 runner runner 26 Aug 17 18:55 ..
```

`transform.py` output present in `data/load/`: **no**.

### `data/` (parent)

```
total 4
drwxr-xr-x 1 runner runner  26 Aug 17 18:55 .
drwxr-xr-x 1 runner runner 598 Aug 24 18:32 ..
drwxr-xr-x 1 runner runner   0 Aug 17 18:55 load
-rw-r--r-- 1 runner runner 890 Aug 17 03:34 README.md
```

`transform.py` anywhere in the repo (excluding `node_modules`, `.git`, `dist`):

```
./transform.py
```

`transform.py` file stat:

```
transform.py  2026-08-17 03:34:00.889742247 +0000  63898 bytes
```

Invocation documented in the `transform.py` module docstring:

```
python3 transform.py --source data/legacy-export --out data/load
psql "$DATABASE_URL" -f load.sql
```

`load.sql` at repo root: **does not exist**.

### Six required source CSVs

The six source filenames `transform.py` expects in `--source` (`data/legacy-export`), read from the
`FILES` table at `transform.py:51-57`:

| # | Required source CSV | Present in `data/legacy-export/` |
| --- | --- | --- |
| 1 | `Area_Needs_-_Organizations.csv` | no (directory absent) |
| 2 | `Area_Needs_-_Item_Requests.csv` | no (directory absent) |
| 3 | `Area_Needs_-_Items.csv` | no (directory absent) |
| 4 | `Area_Needs_-_Volunteer_Requests.csv` | no (directory absent) |
| 5 | `Area_Needs_-_Volunteer_Roles.csv` | no (directory absent) |
| 6 | `Area_Needs_-_Donors.csv` | no (directory absent) |

Present: **0 of 6**.

### Expected `transform.py` output files

The thirteen output filenames `transform.py` writes to `--out` (`data/load`), read from the `ORDER`
table at `transform.py:1260-1273`, plus two report files at `transform.py:1446,1449`:

| # | Expected output file | Present in `data/load/` |
| --- | --- | --- |
| 1 | `01_people.csv` | no |
| 2 | `02_populations.csv` | no |
| 3 | `03_organizations.csv` | no |
| 4 | `04_organization_populations.csv` | no |
| 5 | `05_item_requests.csv` | no |
| 6 | `06_items.csv` | no |
| 7 | `07_volunteer_requests.csv` | no |
| 8 | `08_volunteer_roles.csv` | no |
| 9 | `09_item_pledges.csv` | no |
| 10 | `10_item_pledge_lines.csv` | no |
| 11 | `11_volunteer_signups.csv` | no |
| 12 | `12_volunteer_signup_roles.csv` | no |
| 13 | `13_email_log.csv` | no |
| 14 | `migration-exceptions.csv` | no |
| 15 | `redirects.csv` | no |

Present: **0 of 15**.

### `docs/migration/` (filenames and mtimes only)

```
-rw-r--r-- 1 runner runner 18719 Aug 17 03:34 data-audit.md
-rw-r--r-- 1 runner runner  5167 Aug 17 03:34 dropped-fields.csv
-rw-r--r-- 1 runner runner  3227 Aug 17 03:34 exclusions.csv
-rw-r--r-- 1 runner runner 36636 Aug 17 03:34 field-map.md
-rw-r--r-- 1 runner runner 13878 Aug 17 03:34 validation.sql
```

---

## 7. Environment variables

Every `process.env.*` name referenced anywhere under `server/`. No values are shown.

"Set in Replit Secrets" is yes only for entries in the Secrets store. The `Configured as` column
records where else the name is defined (`.replit` `[userenv.shared]`, `.replit`
`[userenv.production]`, or platform-provided at runtime).

| # | Env var name (referenced in `server/`) | Set in Replit Secrets | Configured as |
| --- | --- | --- | --- |
| 1 | `APP_BASE_URL` | no | `[userenv.production]` |
| 2 | `DATABASE_URL` | no | platform-provided |
| 3 | `EMAIL_FROM_ADDRESS` | no | `[userenv.shared]` |
| 4 | `EMAIL_FROM_NAME` | no | `[userenv.shared]` |
| 5 | `NODE_ENV` | no | not configured; set per-command at runtime |
| 6 | `OPENAI_API_BASE_URL` | no | not configured |
| 7 | `OPENAI_API_KEY` | yes | Replit Secrets |
| 8 | `OPENAI_BASE_URL` | no | not configured |
| 9 | `OPENAI_IMAGE_MODEL` | no | not configured |
| 10 | `POSTMARK_SERVER_TOKEN` | yes | Replit Secrets |
| 11 | `QUICK_LOGIN_ENABLED` | no | `[userenv.production]` |
| 12 | `REPLIT_DEPLOYMENT` | no | platform-provided |
| 13 | `REPLIT_DEV_DOMAIN` | no | platform-provided |
| 14 | `REPLIT_DOMAINS` | no | platform-provided |
| 15 | `SESSION_SECRET` | yes | Replit Secrets |
| 16 | `STAFF_NOTIFY_PRIMARY` | no | `[userenv.shared]` |
| 17 | `STAFF_NOTIFY_SECONDARY` | no | `[userenv.shared]` |
| 18 | `TRUSTED_ORIGINS` | no | not configured |

Secrets present in the Replit Secrets store: `OPENAI_API_KEY`, `PEXELS_API_KEY`,
`POSTMARK_SERVER_TOKEN`, `SESSION_SECRET`.

`PEXELS_API_KEY` is present in Replit Secrets and is **not** referenced by any `process.env`
lookup under `server/`.

Presence in the development workspace shell at audit time:

```
APP_BASE_URL=NOT SET
DATABASE_URL=SET
EMAIL_FROM_ADDRESS=SET
EMAIL_FROM_NAME=SET
NODE_ENV=NOT SET
OPENAI_API_BASE_URL=NOT SET
OPENAI_API_KEY=SET
OPENAI_BASE_URL=NOT SET
OPENAI_IMAGE_MODEL=NOT SET
POSTMARK_SERVER_TOKEN=SET
QUICK_LOGIN_ENABLED=NOT SET
REPLIT_DEPLOYMENT=NOT SET
REPLIT_DEV_DOMAIN=SET
REPLIT_DOMAINS=SET
SESSION_SECRET=SET
STAFF_NOTIFY_PRIMARY=SET
STAFF_NOTIFY_SECONDARY=SET
TRUSTED_ORIGINS=NOT SET
```

---

## 8. Known issues

Search for `TODO`, `FIXME`, and comments containing "known issue" or "bug", across `server/`,
`client/`, `shared/`, `migrations/`, `scripts/`, `docs/`, all file types (excluding `node_modules`,
`.git`, `dist`).

### `TODO`

Matches: **0**.

### `FIXME`

Matches: **0**.

### "known issue" (literal phrase)

Matches: **0**.

### "bug" (word-boundary, case-insensitive, excluding `debug`)

Matches: **9**. Verbatim, with file:line.

Code and stylesheet comments (6):

```
server/db/rls-policies.sql:30:-- This protects against the bug class that matters most here — a missing or
server/dal/email-log.ts:76: * duplicate means a code bug, not a business outcome).
client/src/components/public/ShareButton.tsx:11: * tags and ignores custom text — expected, not a bug).
client/src/index.css:26:  /* Links are styled deliberately — never default blue (known Wix bug). */
client/src/index.css:772:  /* Known live bug NOT reproduced: the legacy submit was white-on-white.
scripts/test-item-request-expiry.ts:346:  // not just the DAL.  A caching or routing bug between the HTTP handlers and the
```

Documentation prose under `docs/` (3):

```
docs/migration/field-map.md:169:| Mission Statement | `mission` | Populated on all 49. **The org-mission bleed described in the pre-sprint brief is not in the data** — all 49 missions are distinct and correct. It was a Wix page-lookup bug and dies with the platform. Seven contain literal line breaks, which is valid CSV but makes the file look mangled in a plain text editor |
docs/specs/MP-01.md:124:- The login form is visible and legible. Specifically, it is not white text on a white background; see the known bug in `Design.md`.
docs/specs/MP-12.md:57:| 1 | Toggle status of this Volunteer Request | Select | Yes | `volunteer_requests.status` | **See the status conflict, section 6.** Build "Toggle status of this Volunteer Request," not the live site's "Toggle status of this Item Request" — that is a copy-paste leftover from the item side, same category as the org-mission bug, a defect the rebuild corrects rather than carries forward |
```

---

## 9. Route map

### 9a. Page routes

Defined in `shared/routes.ts` (`SURFACE_ROUTES`) and rendered by `client/src/App.tsx`.
Surfaces with no entry in `SURFACE_PAGES` / `ADMIN_PAGES` render `PlaceholderPage`.

| Surface ID | Path | Title | Area | Component file |
| --- | --- | --- | --- | --- |
| MP-01 | `/login` | Login | member | `client/src/pages/member/LoginPage.tsx` |
| MP-01C | `/login/verify` | Confirm sign-in | member | `client/src/pages/member/LoginVerifyPage.tsx` |
| MP-03 | `/signup` | Organization signup | member | `client/src/pages/member/SignupPage.tsx` |
| MP-04 | `/dashboard` | Member dashboard | member | `client/src/pages/member/DashboardPage.tsx` |
| MP-05 | `/dashboard/organization` | My organization | member | `client/src/pages/member/OrganizationSettingsPage.tsx` |
| MP-06 | `/dashboard/members/new` | Invite member | member | `client/src/pages/member/MembersNewPage.tsx` |
| MP-07 | `/dashboard/items/new` | New item request | member | `client/src/pages/member/ItemsNewPage.tsx` |
| MP-08 | `/dashboard/items/:id/add` | Add items | member | `client/src/pages/member/ItemsAddPage.tsx` |
| MP-09 | `/dashboard/items/:id/edit` | Edit item request | member | `client/src/pages/member/ItemsEditPage.tsx` |
| MP-10 | `/dashboard/volunteer/new` | New volunteer request | member | `client/src/pages/member/VolunteersNewPage.tsx` |
| MP-11 | `/dashboard/volunteer/:id/add` | Add volunteer roles | member | `client/src/pages/member/VolunteersAddPage.tsx` |
| MP-12 | `/dashboard/volunteer/:id/edit` | Edit volunteer request | member | `client/src/pages/member/VolunteersEditPage.tsx` |
| MP-13 | `/dashboard/supporters` | Supporters | member | `client/src/pages/member/SupportersPage.tsx` |
| SP-01 | `/profile` | My profile | member | `client/src/pages/supporter/ProfilePage.tsx` |
| PB-00 | `/` | Home | public | `client/src/pages/public/HomePage.tsx` |
| PB-01 | `/items` | Provide an item | public | `client/src/pages/public/ItemsBrowsePage.tsx` |
| PB-02 | `/items/:id` | Item request detail | public | `client/src/pages/public/ItemDetailPage.tsx` |
| PB-03 | `/volunteer` | Volunteer your time | public | `client/src/pages/public/VolunteerBrowsePage.tsx` |
| PB-04 | `/volunteer/:id` | Volunteer request detail | public | `client/src/pages/public/VolunteerDetailPage.tsx` |
| PB-05 | `/subscribe` | Subscribe to the digest | public | `client/src/pages/public/DigestPage.tsx` |
| PB-05 | `/unsubscribe/:token` | Unsubscribe | public | `client/src/pages/public/DigestPage.tsx` |
| PB-06 | `/about` | About | public | `client/src/pages/public/AboutPage.tsx` |
| PB-07 | `/volunteer-alerts/unsubscribe/:token` | Volunteer alert opt-out | public | `client/src/pages/public/VolunteerAlertOptOutPage.tsx` |
| PB-08 | `/o/:slug` | Organization profile | public | `client/src/pages/public/OrganizationProfilePage.tsx` |
| ADMIN-01 | `/admin/organizations` | Organizations | admin | `client/src/pages/admin/OrganizationsPage.tsx` |
| ADMIN-02 | `/admin/requests` | Requests | admin | `client/src/pages/admin/RequestsPage.tsx` |
| ADMIN-03 | `/admin/members` | Members | admin | `client/src/pages/admin/MembersPage.tsx` |
| ADMIN-04 | `/admin/people/review` | People review | admin | `client/src/pages/admin/PeopleReviewPage.tsx` |
| ADMIN-05 | `/admin/populations` | Populations | admin | `client/src/pages/admin/PopulationsPage.tsx` |
| ADMIN-06 | `/admin/email` | Email log | admin | `client/src/pages/admin/EmailLogPage.tsx` |
| ADMIN-07 | `/admin/activity` | Activity | admin | `client/src/pages/admin/ActivityPage.tsx` |
| ADMIN-08 | `/admin/subscribers` | Subscribers | admin | `client/src/pages/admin/SubscribersPage.tsx` |
| ADMIN-09 | `/admin/roles` | Roles | admin | `client/src/pages/admin/RolesPage.tsx` |
| ADMIN-10 | `/admin/emails` | Automated emails | admin | `client/src/pages/admin/EmailTemplatesPage.tsx` |
| ADMIN-11 | `/admin/volunteer-categories` | Volunteer categories | admin | `client/src/pages/admin/VolunteerCategoriesPage.tsx` |
| ADMIN-12 | `/admin/analytics` | Analytics | admin | `client/src/pages/admin/AnalyticsPage.tsx` |
| ADMIN-13 | `/admin/settings` | Settings | admin | `client/src/pages/admin/SettingsPage.tsx` |
| (catch-all) | any unmatched path | Not found | — | `client/src/pages/NotFound.tsx` |

Page files under `client/src/pages/` not bound to a surface route:
`client/src/pages/PlaceholderPage.tsx` (fallback renderer for surfaces with no component).

### 9b. API routes

Every HTTP route registered under `server/routes/`, one line each, with defining file:line.

```
GET     /api/admin/email-templates                                   server/routes/admin-email-templates.ts:148
PUT     /api/admin/email-templates/:key/schedule                     server/routes/admin-email-templates.ts:223
PUT     /api/admin/email-templates/:key                              server/routes/admin-email-templates.ts:316
POST    /api/admin/email-templates/:key/enabled                      server/routes/admin-email-templates.ts:384
POST    /api/admin/email-templates/:key/preview                      server/routes/admin-email-templates.ts:410
GET     /api/admin/email-brand                                       server/routes/admin-email-templates.ts:468
PUT     /api/admin/email-brand                                       server/routes/admin-email-templates.ts:478
POST    /api/admin/email-brand/reset                                 server/routes/admin-email-templates.ts:558
POST    /api/admin/email-brand/header-image                          server/routes/admin-email-templates.ts:585
GET     /api/site-settings                                           server/routes/admin-settings.ts:32
GET     /api/admin/site-settings                                     server/routes/admin-settings.ts:45
PUT     /api/admin/site-settings                                     server/routes/admin-settings.ts:55
POST    /api/admin/site-settings/reset                               server/routes/admin-settings.ts:88
GET     /api/admin/nav-counts                                        server/routes/admin.ts:332
GET     /api/admin/db-health                                         server/routes/admin.ts:343
GET     /api/admin/organizations                                     server/routes/admin.ts:348
GET     /api/admin/organizations/:id                                 server/routes/admin.ts:366
POST    /api/admin/organizations/:id/approve                         server/routes/admin.ts:398
POST    /api/admin/organizations/:id/disable                         server/routes/admin.ts:463
GET     /api/admin/requests                                          server/routes/admin.ts:497
GET     /api/admin/requests/:type/:id                                server/routes/admin.ts:515
POST    /api/admin/requests/:type/:id/edit                           server/routes/admin.ts:590
POST    /api/admin/requests/:type/:id/move-to-pending                server/routes/admin.ts:637
POST    /api/admin/requests/:type/:id/unapprove                      server/routes/admin.ts:668
POST    /api/admin/requests/:type/:id/approve                        server/routes/admin.ts:701
POST    /api/admin/requests/:type/:id/return-to-draft                server/routes/admin.ts:825
POST    /api/admin/requests/:type/:id/archive                        server/routes/admin.ts:862
POST    /api/admin/requests/:type/:id/reinstate                      server/routes/admin.ts:906
POST    /api/admin/requests/:type/:id/image                          server/routes/admin.ts:951
POST    /api/admin/requests/item/:id/generate-image                  server/routes/admin.ts:1018
POST    /api/admin/requests/item/:id/remove-generated-image          server/routes/admin.ts:1059
POST    /api/admin/requests/volunteer/:id/generate-image             server/routes/admin.ts:1106
GET     /api/admin/members                                           server/routes/admin.ts:1202
GET     /api/admin/members/:id                                       server/routes/admin.ts:1218
POST    /api/admin/members/:id/approve                               server/routes/admin.ts:1266
POST    /api/admin/members/:id/reject                                server/routes/admin.ts:1321
GET     /api/admin/people/review                                     server/routes/admin.ts:1365
GET     /api/admin/people/review/:id                                 server/routes/admin.ts:1376
POST    /api/admin/people/review/:id/names                           server/routes/admin.ts:1405
POST    /api/admin/people/review/:id/clear-flag                      server/routes/admin.ts:1435
POST    /api/admin/people/review/:id/merge                           server/routes/admin.ts:1462
GET     /api/admin/populations                                       server/routes/admin.ts:1525
POST    /api/admin/populations                                       server/routes/admin.ts:1540
POST    /api/admin/populations/reorder                               server/routes/admin.ts:1572
POST    /api/admin/populations/:id/rename                            server/routes/admin.ts:1596
POST    /api/admin/populations/:id/deactivate                        server/routes/admin.ts:1628
POST    /api/admin/populations/promote                               server/routes/admin.ts:1666
GET     /api/admin/volunteer-categories                              server/routes/admin.ts:1715
POST    /api/admin/volunteer-categories                              server/routes/admin.ts:1724
POST    /api/admin/volunteer-categories/:id/rename                   server/routes/admin.ts:1753
GET     /api/admin/email                                             server/routes/admin.ts:1834
GET     /api/admin/email/:id                                         server/routes/admin.ts:1894
GET     /api/admin/email/:id/preview                                 server/routes/admin.ts:1975
POST    /api/admin/email/:id/resend                                  server/routes/admin.ts:2088
GET     /api/admin/activity                                          server/routes/admin.ts:2119
GET     /api/admin/subscribers                                       server/routes/admin.ts:2220
GET     /api/admin/subscribers/export.csv                            server/routes/admin.ts:2249
POST    /api/admin/subscribers/:id/unsubscribe                       server/routes/admin.ts:2291
GET     /api/admin/digest/upcoming                                   server/routes/admin.ts:2324
POST    /api/admin/members/:id/reinstate                             server/routes/admin.ts:2385
GET     /api/admin/roles                                             server/routes/admin.ts:2425
POST    /api/admin/roles/:id                                         server/routes/admin.ts:2437
POST    /api/admin/staff/invite                                      server/routes/admin.ts:2517
GET     /api/admin/analytics                                         server/routes/engagement-reporting.ts:181
GET     /api/admin/analytics/audience                                server/routes/engagement-reporting.ts:199
POST    /api/admin/analytics/outreach/preview                        server/routes/engagement-reporting.ts:237
POST    /api/admin/analytics/outreach/send                           server/routes/engagement-reporting.ts:261
POST    /api/admin/analytics/outreach/export                         server/routes/engagement-reporting.ts:367
GET     /api/dashboard/…                                           server/routes/index.ts:6
GET     /api/admin/…                                               server/routes/index.ts:7
GET     /api/auth/magic-link/verify                                  server/routes/index.ts:287
POST    /api/login/magic-link                                        server/routes/index.ts:306
POST    /api/login/magic-link/verify                                 server/routes/index.ts:348
POST    /api/dev/reset-rate-limits                                   server/routes/index.ts:390
GET     /api/login/quick/status                                      server/routes/index.ts:405
POST    /api/login/quick                                             server/routes/index.ts:414
GET     /api/session                                                 server/routes/index.ts:487
POST    /api/session/active-org                                      server/routes/index.ts:498
GET     /api/supporter/profile                                       server/routes/index.ts:526
PUT     /api/supporter/profile/volunteer-interests                   server/routes/index.ts:560
GET     /api/admin/ping                                              server/routes/index.ts:612
GET     /storage/*                                                   server/routes/index.ts:617
GET     /api/dashboard/overview                                      server/routes/member.ts:52
GET     /api/dashboard/organization                                  server/routes/member.ts:80
PUT     /api/dashboard/organization                                  server/routes/member.ts:132
POST    /api/dashboard/items                                         server/routes/member.ts:240
GET     /api/dashboard/volunteer-categories                          server/routes/member.ts:320
GET     /api/dashboard/items/:id                                     server/routes/member.ts:987
POST    /api/dashboard/members                                       server/routes/member.ts:1506
POST    /api/public/engagement                                       server/routes/public.ts:303
GET     /api/public/item-requests                                    server/routes/public.ts:364
GET     /api/public/volunteer-requests                               server/routes/public.ts:384
GET     /api/public/organizations/:slug                              server/routes/public.ts:404
GET     /api/public/item-requests/:id                                server/routes/public.ts:443
POST    /api/public/item-requests/:id/pledges                        server/routes/public.ts:492
GET     /api/public/volunteer-requests/:id                           server/routes/public.ts:762
POST    /api/public/volunteer-requests/:id/signups                   server/routes/public.ts:811
GET     /api/public/populations                                      server/routes/public.ts:1084
POST    /api/public/organization-signups                             server/routes/public.ts:1094
POST    /api/public/digest-subscriptions                             server/routes/public.ts:1225
POST    /api/public/digest-subscriptions/unsubscribe                 server/routes/public.ts:1268
POST    /api/public/volunteer-alerts/unsubscribe                     server/routes/public.ts:1285
```

Route file count and totals:

```
server/routes/admin-email-templates.ts        9
server/routes/admin-settings.ts               4
server/routes/admin.ts                        50
server/routes/engagement-reporting.ts         5
server/routes/index.ts                        14
server/routes/member.ts                       7
server/routes/public.ts                       13
TOTAL                                         102
```

---

## 10. Deployment visibility

| Field | Value |
| --- | --- |
| Visibility | **public** |
| Is deployed | true |
| Has successful build | true |
| Deployment type | autoscale |
| Primary URL | `https://lia.defendingthecause.org` |
| Additional URLs | `https://alliance-lia.replit.app` |

`visibility` value as reported: `public` — reachable by anyone on the internet.

Deployment configuration from `.replit`:

```
[deployment]
deploymentTarget = "autoscale"
run = ["npm", "run", "start"]
build = ["bash", "-c", "npm run db:apply-migrations && npm run build"]

[[ports]]
localPort = 5000
externalPort = 80
```
