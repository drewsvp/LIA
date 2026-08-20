-- Classify volunteer opportunities with the shared staff-managed vocabulary.
-- Categories are never deleted, so an assignment remains historically
-- identifiable after staff deactivate its category. Request deletion is the
-- only lifecycle that removes assignment rows.

create table volunteer_request_categories (
  volunteer_request_id uuid not null references volunteer_requests(id) on delete cascade,
  category_id          uuid not null references volunteer_categories(id),
  created_at           timestamptz not null default now(),
  primary key (volunteer_request_id, category_id)
);

create index volunteer_request_categories_category_idx
  on volunteer_request_categories (category_id);