-- Approved volunteer opportunities from the platform-owner organization use
-- the same public lifecycle as approved member-organization opportunities.
-- Item-request policies intentionally remain member-organization-only.

-- The organization profile is already runtime-public for every approved
-- organization. Mirror that rule in RLS so volunteer joins can resolve The
-- Alliance instead of being filtered by the parent table's old kind gate.
drop policy if exists organizations_public_select on organizations;
create policy organizations_public_select on organizations for select
  using (
    current_setting('app.context', true) = 'public'
    and status = 'approved'
  );

drop policy if exists organization_populations_public_member_select on organization_populations;
create policy organization_populations_public_member_select on organization_populations for select
  using (
    current_setting('app.context', true) in ('public', 'member')
    and exists (
      select 1
        from organizations o
       where o.id = organization_populations.org_id
         and o.status = 'approved'
    )
  );

drop policy if exists volunteer_requests_public_select on volunteer_requests;
create policy volunteer_requests_public_select on volunteer_requests for select
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

drop policy if exists volunteer_roles_public_select on volunteer_roles;
create policy volunteer_roles_public_select on volunteer_roles for select
  using (
    current_setting('app.context', true) = 'public'
    and exists (
      select 1
        from volunteer_requests r
        join organizations o on o.id = r.org_id
       where r.id = volunteer_roles.volunteer_request_id
         and r.status in ('active', 'archived')
         and o.status = 'approved'
         and o.kind in ('member_org', 'platform_owner')
    )
  );