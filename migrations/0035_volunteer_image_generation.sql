-- Auto-sourced images for volunteer requests (D67).
-- Straight parity with item_requests (0008 + 0011): image_generated marks the
-- CURRENT image_url as auto-sourced so an uploaded photo always wins, and
-- image_gen_status/image_gen_error keep every failure admin-visible instead of
-- silently swallowed. image_gen_retries gives the sweep a durable, DB-enforced
-- retry cap per row.
alter table volunteer_requests
  add column image_generated boolean not null default false,
  add column image_gen_status text check (image_gen_status in ('pending', 'succeeded', 'failed')),
  add column image_gen_error text,
  add column image_gen_retries integer not null default 0;
