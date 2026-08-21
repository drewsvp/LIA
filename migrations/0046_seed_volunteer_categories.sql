-- Seed the shared volunteer-category vocabulary for production.
--
-- The development seed script populates these rows locally, but migrations
-- are the only supported path to production.  This migration inserts the
-- same 12 categories using ON CONFLICT DO NOTHING so it is safe to run
-- on development databases that already have them and on production databases
-- that currently have none.
--
-- Categories are never deleted (staff deactivate them instead), so omitting
-- a category here means staff would need to add it manually.  If the
-- production vocabulary ever diverges from this list intentionally, a
-- subsequent migration should document the difference.

insert into volunteer_categories (name)
values
  ('Administrative Support'),
  ('Child Care & Family Support'),
  ('Event & Outreach Support'),
  ('Foster Care & Respite'),
  ('Hands-On Projects & General Help'),
  ('Kids'' Camp Counselor / Help'),
  ('Mentoring & Relationship Building'),
  ('Ranch Help'),
  ('Skilled & Professional Services'),
  ('Sorting, Organizing & Distribution'),
  ('Technology & Digital Support'),
  ('Transportation & Delivery')
on conflict do nothing;
