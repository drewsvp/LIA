-- The ingestion path validates child ownership before every insert. Mirror the
-- invariant in the database so future trusted/system writers cannot associate
-- an item or role with the wrong parent request.
create unique index items_id_request_ownership_idx
  on items (id, item_request_id);
create unique index volunteer_roles_id_request_ownership_idx
  on volunteer_roles (id, volunteer_request_id);

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