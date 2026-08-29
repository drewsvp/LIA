-- ADMIN-14 scans newest participation first across all organizations.
-- Pair created_at with id because id is the stable tie-breaker used by paging.
create index item_pledges_admin_participation_idx
  on item_pledges (created_at desc, id desc);

create index volunteer_signups_admin_participation_idx
  on volunteer_signups (created_at desc, id desc);