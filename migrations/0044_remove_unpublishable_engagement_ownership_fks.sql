-- Publish validates this schema against production by adding the composite
-- ownership foreign keys before it adds their required parent UNIQUE
-- constraints. PostgreSQL correctly rejects that order. Keep the ordinary
-- child and request foreign keys from 0040, and rely on the ingestion path's
-- explicit child/request lookup for the cross-table ownership check.
--
-- This removes constraints only from the development schema; no rows are
-- deleted and production remains untouched until the next Publish succeeds.

alter table request_engagement_events
  drop constraint request_engagement_item_ownership_fk;
alter table request_engagement_events
  drop constraint request_engagement_role_ownership_fk;

alter table items
  drop constraint items_id_request_ownership_key;
alter table volunteer_roles
  drop constraint volunteer_roles_id_request_ownership_key;