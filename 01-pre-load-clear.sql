\set ON_ERROR_STOP on
begin;

drop table if exists _cutover_keep_email_schedules;
drop table if exists _cutover_keep_site_settings;
drop table if exists _cutover_keep_email_brand_settings;
drop table if exists _cutover_keep_email_template_overrides;

create table _cutover_keep_email_schedules          as select * from email_schedules;
create table _cutover_keep_site_settings            as select * from site_settings;
create table _cutover_keep_email_brand_settings     as select * from email_brand_settings;
create table _cutover_keep_email_template_overrides as select * from email_template_overrides;

truncate
  people, populations, organizations, organization_populations,
  item_requests, items, volunteer_requests, volunteer_roles,
  item_pledges, item_pledge_lines, volunteer_signups, volunteer_signup_roles,
  email_log, users, org_memberships, digest_subscribers,
  approval_events, request_revisions, organization_revisions,
  participation_history, person_volunteer_interests, request_engagement_events,
  volunteer_alert_preferences, volunteer_match_alert_claims,
  volunteer_request_categories, digest_exclusions,
  admin_organization_contexts, organization_context_actions,
  supporter_admin_audit, supporter_impersonation_contexts, contact_admin_audit,
  email_schedules, site_settings, email_brand_settings, email_template_overrides
  restart identity;

commit;
