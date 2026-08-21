-- The ingestion path validates child ownership before every insert. Mirror the
-- invariant in the database so future trusted/system writers cannot associate
-- an item or role with the wrong parent request.
-- NOTE: unique indexes items_id_item_request_id_key and
-- volunteer_roles_id_volunteer_request_id_key were already published in
-- migration 0040 and are not recreated here.

alter table request_engagement_events
  add constraint request_engagement_item_ownership_fk
  foreign key (item_id, item_request_id)
  references items (id, item_request_id)
  on delete cascade;

alter table request_engagement_events
  add constraint request_engagement_role_ownership_fk
  foreign key (volunteer_role_id, volunteer_request_id)
  references volunteer_roles (id, volunteer_request_id)
  on delete cascade;
