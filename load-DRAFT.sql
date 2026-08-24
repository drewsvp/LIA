-- DRAFT. Generated from transform.py. Not reviewed, not executed. Do not run
-- against any database until a human has read it end to end.
--
-- One \copy per output file, in the exact order of the ORDER table at
-- transform.py:1260-1273. Column lists are taken verbatim from the COLUMNS
-- table at transform.py:1224-1258.
--
-- Load order is foreign-key order: parents before children.
--
-- NOT loaded here (per transform.py:1294-1296): users, org_memberships,
-- digest_subscribers -- all three come from the contacts export. Also not
-- loaded: image_url and logo_url, filled by the media pass after upload.

\set ON_ERROR_STOP on

begin;

-- people
\copy people (id, first_name, last_name, email, phone, needs_review, review_note, source_note, legacy_wix_contact_id) from 'data/load/01_people.csv' with (format csv, header true, null '\N')

-- populations
\copy populations (id, name, slug, sort_order, is_active) from 'data/load/02_populations.csv' with (format csv, header true, null '\N')

-- organizations
\copy organizations (id, legacy_wix_id, kind, name, slug, website_url, mission, phone, logo_url, populations_other, address_line1, address_line2, city, state, postal_code, address_formatted, primary_contact_person_id, status, approved_at, approved_by, created_at, updated_at) from 'data/load/03_organizations.csv' with (format csv, header true, null '\N')

-- organization_populations
\copy organization_populations (org_id, population_id) from 'data/load/04_organization_populations.csv' with (format csv, header true, null '\N')

-- item_requests
\copy item_requests (id, legacy_wix_id, org_id, title, description, image_url, dropoff_location, people_helped, deadline_type, deadline_date, expires_on, contact_person_id, status, submitted_at, approved_at, approved_by, archived_at, archived_reason, created_by, created_at, updated_at) from 'data/load/05_item_requests.csv' with (format csv, header true, null '\N')

-- items
\copy items (id, legacy_wix_id, item_request_id, name, description, condition, product_url, quantity_requested, quantity_claimed, quantity_received, sort_order, created_at, updated_at) from 'data/load/06_items.csv' with (format csv, header true, null '\N')

-- volunteer_requests
\copy volunteer_requests (id, legacy_wix_id, org_id, title, description, details, event_location, image_url, people_helped, deadline_type, deadline_date, expires_on, contact_person_id, status, submitted_at, approved_at, approved_by, archived_at, archived_reason, created_by, created_at, updated_at) from 'data/load/07_volunteer_requests.csv' with (format csv, header true, null '\N')

-- volunteer_roles
\copy volunteer_roles (id, legacy_wix_id, volunteer_request_id, name, description, quantity_needed, quantity_interested, quantity_confirmed, sort_order, created_at, updated_at) from 'data/load/08_volunteer_roles.csv' with (format csv, header true, null '\N')

-- item_pledges
\copy item_pledges (id, legacy_wix_id, person_id, item_request_id, notes, created_at, updated_at) from 'data/load/09_item_pledges.csv' with (format csv, header true, null '\N')

-- item_pledge_lines
\copy item_pledge_lines (id, item_pledge_id, item_id, quantity) from 'data/load/10_item_pledge_lines.csv' with (format csv, header true, null '\N')

-- volunteer_signups
\copy volunteer_signups (id, legacy_wix_id, person_id, volunteer_request_id, notes, created_at, updated_at) from 'data/load/11_volunteer_signups.csv' with (format csv, header true, null '\N')

-- volunteer_signup_roles
\copy volunteer_signup_roles (id, volunteer_signup_id, volunteer_role_id) from 'data/load/12_volunteer_signup_roles.csv' with (format csv, header true, null '\N')

-- email_log
\copy email_log (id, template_key, to_email, to_person_id, entity_type, entity_id, payload, status, provider_message_id, error, sent_at, created_at) from 'data/load/13_email_log.csv' with (format csv, header true, null '\N')

commit;

-- Then prove it worked:
--     psql "$DATABASE_URL" -f docs/migration/validation.sql
