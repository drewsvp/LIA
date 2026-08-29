create or replace function revoke_admin_organization_contexts_for_ineligible_org()
returns trigger
language plpgsql
as $$
declare
  context_row record;
begin
  if old.kind = 'member_org'
     and old.status = 'approved'
     and (new.kind <> 'member_org' or new.status <> 'approved') then
    for context_row in
      update admin_organization_contexts
         set ended_at = now()
       where organization_id = new.id
         and ended_at is null
      returning id, admin_user_id, organization_id
    loop
      insert into organization_context_actions
        (organization_context_id, organization_id, actor_user_id, action)
      values
        (context_row.id, context_row.organization_id, context_row.admin_user_id, 'invalidated');

      insert into approval_events
        (entity_type, entity_id, from_status, to_status, actor_user_id,
         note, organization_context_id, context_organization_id)
      values
        ('organization_context', context_row.id, 'active', 'invalidated',
         context_row.admin_user_id, 'Organization became ineligible',
         context_row.id, context_row.organization_id);
    end loop;
  end if;
  return new;
end;
$$;

drop trigger if exists organizations_revoke_admin_contexts on organizations;
create trigger organizations_revoke_admin_contexts
  after update of kind, status on organizations
  for each row execute function revoke_admin_organization_contexts_for_ineligible_org();