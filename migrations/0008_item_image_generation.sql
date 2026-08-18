-- Task: auto-sourced images for item requests (needs).
-- image_generated marks the CURRENT image_url as auto-sourced (stock/AI) so
-- an uploaded photo always wins: auto writes only fill a NULL image_url, and
-- regenerate/remove only touch rows where image_generated is true.
-- image_gen_status records the latest attempt (pending/succeeded/failed) so
-- failures are admin-visible, never silently swallowed.
alter table item_requests
  add column image_generated boolean not null default false,
  add column image_gen_status text check (image_gen_status in ('pending', 'succeeded', 'failed')),
  add column image_gen_error text;
