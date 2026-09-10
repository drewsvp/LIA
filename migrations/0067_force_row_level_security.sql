-- Replit's schema publish currently carries RLS policies and ENABLE flags but
-- does not include FORCE flags in its generated diff. Reassert FORCE at
-- candidate startup so table-owner application connections cannot bypass the
-- published policies.

alter table people force row level security;
alter table users force row level security;
alter table organizations force row level security;
alter table org_memberships force row level security;
alter table populations force row level security;
alter table organization_populations force row level security;
alter table volunteer_categories force row level security;
alter table person_volunteer_interests force row level security;
alter table volunteer_alert_preferences force row level security;
alter table volunteer_match_alert_claims force row level security;
alter table volunteer_request_categories force row level security;
alter table item_requests force row level security;
alter table items force row level security;
alter table volunteer_requests force row level security;
alter table volunteer_roles force row level security;
alter table item_pledges force row level security;
alter table item_pledge_lines force row level security;
alter table volunteer_signups force row level security;
alter table volunteer_signup_roles force row level security;
alter table request_engagement_events force row level security;
alter table approval_events force row level security;
alter table admin_organization_contexts force row level security;
alter table organization_context_actions force row level security;
alter table supporter_impersonation_contexts force row level security;
alter table supporter_admin_audit force row level security;
alter table contact_admin_audit force row level security;
alter table participation_history force row level security;
alter table request_revisions force row level security;
alter table organization_revisions force row level security;
alter table storage_cleanup_queue force row level security;
alter table email_log force row level security;
alter table email_template_overrides force row level security;
alter table email_schedules force row level security;
alter table digest_subscribers force row level security;
alter table digest_runs force row level security;
alter table digest_exclusions force row level security;