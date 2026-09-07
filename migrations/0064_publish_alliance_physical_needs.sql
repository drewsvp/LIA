-- Approved physical needs from the platform-owner organization use the same
-- public lifecycle as approved member-organization physical needs.

drop policy if exists item_requests_public_select on item_requests;
create policy item_requests_public_select on item_requests for select
  using (
    current_setting('app.context', true) = 'public'
    and status in ('active', 'archived')
    and org_id in (
      select o.id
        from organizations o
       where o.status = 'approved'
         and o.kind in ('member_org', 'platform_owner')
    )
  );

drop policy if exists items_public_select on items;
create policy items_public_select on items for select
  using (
    current_setting('app.context', true) = 'public'
    and exists (
      select 1
        from item_requests r
        join organizations o on o.id = r.org_id
       where r.id = items.item_request_id
         and r.status in ('active', 'archived')
         and o.status = 'approved'
         and o.kind in ('member_org', 'platform_owner')
    )
  );