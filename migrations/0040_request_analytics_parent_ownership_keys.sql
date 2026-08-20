-- Prerequisite parent keys for a future analytics table's composite ownership
-- foreign keys. Keep this schema-only batch independent: the analytics table
-- and its child foreign keys are introduced in a later publish.
alter table items
  add constraint items_id_item_request_id_key unique (id, item_request_id);

alter table volunteer_roles
  add constraint volunteer_roles_id_volunteer_request_id_key unique (id, volunteer_request_id);