alter table organization_revisions enable row level security;
alter table organization_revisions force row level security;

drop policy if exists organization_revisions_system_staff_all on organization_revisions;
create policy organization_revisions_system_staff_all on organization_revisions
  using (current_setting('app.context', true) in ('system','staff'))
  with check (current_setting('app.context', true) in ('system','staff'));