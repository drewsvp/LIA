-- 0007_scope_public_child_policies.sql
--
-- No behavior change. Apply after acceptance testing, not before.
--
-- Three public policies test only that a parent row exists. They are safe
-- today because the parent's own RLS applies inside the subquery, so a public
-- reader cannot reach items belonging to a draft request. But the protection
-- is inherited rather than stated: one future edit to item_requests_public_select
-- silently widens items_public_select along with it, and nothing in the child
-- policy would show it.
--
-- Each child policy now restates the parent's predicates. The duplication is
-- deliberate. Policies are cheap to read and expensive to get wrong.

begin;


drop policy if exists items_public_select on items;

create policy items_public_select on items
  for select
  using (
    current_setting('app.context', true) = 'public'
    and exists (
      select 1
        from item_requests r
        join organizations o on o.id = r.org_id
       where r.id = items.item_request_id
         and r.status in ('active', 'archived')
         and o.kind = 'member_org'
         and o.status = 'approved'
    )
  );


drop policy if exists volunteer_roles_public_select on volunteer_roles;

create policy volunteer_roles_public_select on volunteer_roles
  for select
  using (
    current_setting('app.context', true) = 'public'
    and exists (
      select 1
        from volunteer_requests r
        join organizations o on o.id = r.org_id
       where r.id = volunteer_roles.volunteer_request_id
         and r.status in ('active', 'archived')
         and o.kind = 'member_org'
         and o.status = 'approved'
    )
  );


-- Member context keeps its own broader reach here: a member org reads
-- populations for any approved member org, matching organizations_member_select.
drop policy if exists organization_populations_public_member_select on organization_populations;

create policy organization_populations_public_member_select on organization_populations
  for select
  using (
    current_setting('app.context', true) in ('public', 'member')
    and exists (
      select 1
        from organizations o
       where o.id = organization_populations.org_id
         and o.kind = 'member_org'
         and o.status = 'approved'
    )
  );

commit;