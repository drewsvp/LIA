-- Restored databases can retain policy definitions while table-level RLS flags
-- are disabled. Physical-need publication must be enforced, not merely declared.

alter table item_requests enable row level security;
alter table item_requests force row level security;

alter table items enable row level security;
alter table items force row level security;