-- Public RLS must match runtime publication: only active, unexpired needs from
-- eligible approved organizations are readable. Pledge eligibility is checked
-- again inside the write transaction while holding the organization row lock.

drop policy if exists item_requests_public_select on item_requests;
create policy item_requests_public_select on item_requests for select
  using (
    current_setting('app.context', true) = 'public'
    and status = 'active'
    and not item_request_expired_on(
      deadline_type,
      deadline_date,
      expires_on,
      item_request_current_la_date()
    )
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
         and r.status = 'active'
         and not item_request_expired_on(
           r.deadline_type,
           r.deadline_date,
           r.expires_on,
           item_request_current_la_date()
         )
         and o.status = 'approved'
         and o.kind in ('member_org', 'platform_owner')
    )
  );

create or replace function reject_ineligible_item_pledge() returns trigger as $$
begin
  perform 1
    from item_requests r
    join organizations o on o.id = r.org_id
   where r.id = new.item_request_id
     and o.status = 'approved'
     and o.kind in ('member_org', 'platform_owner')
   for share of o;

  if not found then
    raise exception 'request_not_found';
  end if;

  return new;
end;
$$ language plpgsql;

drop trigger if exists item_pledges_reject_ineligible_organization on item_pledges;
create trigger item_pledges_reject_ineligible_organization
  before insert on item_pledges
  for each row execute function reject_ineligible_item_pledge();