-- Privacy-safe public engagement events. Anonymous rows deliberately contain
-- no visitor/session identifier; client_event_id exists only to make one
-- interaction retry-safe and is freshly generated for every interaction.
create table request_engagement_events (
  id                   uuid primary key default gen_random_uuid(),
  client_event_id      uuid not null unique,
  event_type           text not null check (
    event_type in (
      'card_click',
      'detail_view',
      'product_link_click',
      'form_start',
      'item_selected',
      'role_selected'
    )
  ),
  request_kind         text not null check (request_kind in ('item', 'volunteer')),
  item_request_id      uuid references item_requests(id) on delete cascade,
  volunteer_request_id uuid references volunteer_requests(id) on delete cascade,
  item_id              uuid references items(id) on delete cascade,
  volunteer_role_id    uuid references volunteer_roles(id) on delete cascade,
  user_id              uuid references users(id) on delete set null,
  created_at           timestamptz not null default now(),
  constraint request_engagement_request_target check (
    (request_kind = 'item' and item_request_id is not null and volunteer_request_id is null)
    or
    (request_kind = 'volunteer' and volunteer_request_id is not null and item_request_id is null)
  ),
  constraint request_engagement_child_target check (
    (event_type in ('product_link_click', 'item_selected')
      and request_kind = 'item' and item_id is not null and volunteer_role_id is null)
    or
    (event_type = 'role_selected'
      and request_kind = 'volunteer' and volunteer_role_id is not null and item_id is null)
    or
    (event_type in ('card_click', 'detail_view', 'form_start')
      and item_id is null and volunteer_role_id is null)
  )
);

create index request_engagement_item_reporting_idx
  on request_engagement_events (item_request_id, created_at desc)
  where item_request_id is not null;
create index request_engagement_volunteer_reporting_idx
  on request_engagement_events (volunteer_request_id, created_at desc)
  where volunteer_request_id is not null;
create index request_engagement_user_history_idx
  on request_engagement_events (user_id, created_at desc)
  where user_id is not null and event_type = 'detail_view';
create index request_engagement_type_created_idx
  on request_engagement_events (event_type, created_at desc);

comment on table request_engagement_events is
  'Allowlisted public request interactions. Anonymous rows have no persistent visitor identity; pledges/signups remain authoritative conversions.';
comment on column request_engagement_events.client_event_id is
  'Fresh UUID for one client interaction, used only to make duplicate delivery idempotent.';