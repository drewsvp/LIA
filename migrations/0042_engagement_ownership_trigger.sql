-- Replit's publish-time schema diff validates foreign keys before creating the
-- supporting standalone unique indexes. That makes the composite ownership
-- foreign keys from 0041 impossible to publish even though they are valid in
-- the development schema.
--
-- Keep the ordinary single-column foreign keys from 0040 for existence and
-- cascade behavior, and enforce the cross-column ownership invariant with
-- triggers instead. The trigger errors retain the old constraint names so
-- callers and diagnostics continue to identify the violated rule precisely.

alter table request_engagement_events
  drop constraint request_engagement_item_ownership_fk;
alter table request_engagement_events
  drop constraint request_engagement_role_ownership_fk;

drop index items_id_request_ownership_idx;
drop index volunteer_roles_id_request_ownership_idx;

create function enforce_request_engagement_child_ownership() returns trigger as $$
begin
  if new.item_id is not null and not exists (
    select 1
      from items i
     where i.id = new.item_id
       and i.item_request_id = new.item_request_id
  ) then
    raise exception using
      errcode = '23503',
      message = 'item does not belong to the engagement event request',
      schema = 'public',
      table = 'request_engagement_events',
      constraint = 'request_engagement_item_ownership_fk';
  end if;

  if new.volunteer_role_id is not null and not exists (
    select 1
      from volunteer_roles r
     where r.id = new.volunteer_role_id
       and r.volunteer_request_id = new.volunteer_request_id
  ) then
    raise exception using
      errcode = '23503',
      message = 'volunteer role does not belong to the engagement event request',
      schema = 'public',
      table = 'request_engagement_events',
      constraint = 'request_engagement_role_ownership_fk';
  end if;

  return new;
end;
$$ language plpgsql;

create trigger request_engagement_child_ownership_guard
  before insert or update of
    item_id, item_request_id, volunteer_role_id, volunteer_request_id
  on request_engagement_events
  for each row execute function enforce_request_engagement_child_ownership();

-- A composite foreign key also prevented a referenced child from being moved
-- to another request. Preserve that reverse-side protection for existing
-- engagement rows rather than guarding only new event writes.
create function prevent_engaged_item_reparent() returns trigger as $$
begin
  if new.item_request_id is distinct from old.item_request_id and exists (
    select 1
      from request_engagement_events e
     where e.item_id = new.id
       and e.item_request_id is distinct from new.item_request_id
  ) then
    raise exception using
      errcode = '23503',
      message = 'item has engagement events for its current request',
      schema = 'public',
      table = 'items',
      constraint = 'request_engagement_item_ownership_fk';
  end if;

  return new;
end;
$$ language plpgsql;

create trigger items_engagement_ownership_guard
  before update of item_request_id on items
  for each row execute function prevent_engaged_item_reparent();

create function prevent_engaged_role_reparent() returns trigger as $$
begin
  if new.volunteer_request_id is distinct from old.volunteer_request_id and exists (
    select 1
      from request_engagement_events e
     where e.volunteer_role_id = new.id
       and e.volunteer_request_id is distinct from new.volunteer_request_id
  ) then
    raise exception using
      errcode = '23503',
      message = 'volunteer role has engagement events for its current request',
      schema = 'public',
      table = 'volunteer_roles',
      constraint = 'request_engagement_role_ownership_fk';
  end if;

  return new;
end;
$$ language plpgsql;

create trigger volunteer_roles_engagement_ownership_guard
  before update of volunteer_request_id on volunteer_roles
  for each row execute function prevent_engaged_role_reparent();