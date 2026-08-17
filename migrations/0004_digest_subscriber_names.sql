-- 0004_digest_subscriber_names.sql
-- digest_subscribers.first_name / last_name — PB-05 stores what it collects.
--
-- PB-05 collects and validates both names but had nowhere to put them:
-- digest_subscribers was email-only, and creating a people row on subscribe
-- is out of scope (D27 stands). Two nullable text columns, stored exactly
-- as entered, never concatenated (Handbook §8: no code path joins or splits
-- name columns). Existing rows keep null — no invented backfill. A
-- resubscribe updates the stored names to the values just submitted,
-- matching how the email address behaves. Per the captain's work order of
-- Aug 17 2026.

alter table digest_subscribers
  add column first_name text,
  add column last_name text;

comment on column digest_subscribers.first_name is
  'PB-05 form value, stored exactly as entered. Null on rows created before 0004 or imported without a name.';
comment on column digest_subscribers.last_name is
  'PB-05 form value, stored exactly as entered. Null on rows created before 0004 or imported without a name.';
