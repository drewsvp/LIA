-- Replit's publish schema diff does not carry database trigger functions to
-- production. Replace the development-only trigger guard from 0042 with
-- declarative constraints the publisher understands and can dependency-order.
--
-- A UNIQUE constraint is intentionally used instead of a standalone unique
-- index: the publish planner creates table constraints before foreign keys,
-- while it attempted the 0041 foreign keys before their standalone indexes.

drop trigger if exists request_engagement_child_ownership_guard
  on request_engagement_events;
drop trigger if exists items_engagement_ownership_guard on items;
drop trigger if exists volunteer_roles_engagement_ownership_guard
  on volunteer_roles;

drop function if exists enforce_request_engagement_child_ownership();
drop function if exists prevent_engaged_item_reparent();
drop function if exists prevent_engaged_role_reparent();

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.items'::regclass
       and conname = 'items_id_request_ownership_key'
  ) then
    alter table items
      add constraint items_id_request_ownership_key
      unique (id, item_request_id);
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.volunteer_roles'::regclass
       and conname = 'volunteer_roles_id_request_ownership_key'
  ) then
    alter table volunteer_roles
      add constraint volunteer_roles_id_request_ownership_key
      unique (id, volunteer_request_id);
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.request_engagement_events'::regclass
       and conname = 'request_engagement_item_ownership_fk'
  ) then
    alter table request_engagement_events
      add constraint request_engagement_item_ownership_fk
      foreign key (item_id, item_request_id)
      references items (id, item_request_id)
      on delete cascade;
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.request_engagement_events'::regclass
       and conname = 'request_engagement_role_ownership_fk'
  ) then
    alter table request_engagement_events
      add constraint request_engagement_role_ownership_fk
      foreign key (volunteer_role_id, volunteer_request_id)
      references volunteer_roles (id, volunteer_request_id)
      on delete cascade;
  end if;
end;
$$;