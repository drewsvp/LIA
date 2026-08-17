-- 0001_initial_schema.sql
-- Love in Action / Area Needs. Complete initial schema.
--
-- Seventeen tables, two counter functions, one view. Applying this file to an
-- empty Postgres database produces the correct architecture in full. Nothing
-- else is required.
--
-- Numbered migrations after this one are incremental changes made once the
-- database exists and holds data. Never edit this file after it has been applied
-- to a shared database.
--
-- schema.sql at the repo root is a generated pg_dump snapshot, produced after
-- this file is applied, and is never hand-edited.
--
-- Rationale for the design is in Handbook.md sections 7 and 8. This file does
-- not restate it.
--
-- Conventions:
--   snake_case, plural tables
--   uuid primary keys, gen_random_uuid()
--   timestamptz everywhere, store UTC, render America/Los_Angeles
--   status columns are text + CHECK, not enums (enums are painful to alter)
--   foreign keys always declared; no string joins anywhere
--   legacy_wix_id on every table receiving migrated rows, never a foreign key

begin;

create extension if not exists pgcrypto;

create function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;


-- ============================================================
-- 1. Identity
-- ============================================================

-- One human is one row, permanently. No role column: roles are relationships
-- and live in org_memberships. A person's roles are a query, not a field.
create table people (
  id                    uuid primary key default gen_random_uuid(),
  first_name            text not null,
  last_name             text not null,
  email                 text not null,
  phone                 text,
  needs_review          boolean not null default false,
  review_note           text,
  source_note           text,
  legacy_wix_contact_id text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create unique index people_email_key on people (lower(email));
create index people_needs_review_idx on people (needs_review) where needs_review;

create trigger people_set_updated_at
  before update on people
  for each row execute function set_updated_at();


-- Auth plumbing only, for the subset of people who log in. Carries no
-- permissions. auth_subject is the provider's stable subject id and nothing
-- else in the schema knows or cares who issues it.
create table users (
  id            uuid primary key default gen_random_uuid(),
  person_id     uuid not null unique references people(id),
  auth_subject  text unique,
  status        text not null default 'invited'
                  check (status in ('invited','active','disabled')),
  last_login_at timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create trigger users_set_updated_at
  before update on users
  for each row execute function set_updated_at();


-- ============================================================
-- 2. Organizations and membership
-- ============================================================

-- The Alliance is a row here, kind = 'platform_owner'. Staff are members of it.
-- Every public-facing query filters kind = 'member_org' through one shared
-- query helper, not per page.
create table organizations (
  id                        uuid primary key default gen_random_uuid(),
  legacy_wix_id             text unique,
  kind                      text not null default 'member_org'
                              check (kind in ('member_org','platform_owner')),
  name                      text not null unique,
  slug                      text not null unique,
  website_url               text,
  mission                   text,
  phone                     text,
  logo_url                  text,
  populations_other         text,
  address_line1             text,
  address_line2             text,
  city                      text,
  state                     text,
  postal_code               text,
  address_formatted         text,
  primary_contact_person_id uuid references people(id),
  status                    text not null default 'pending'
                              check (status in ('pending','approved','disabled')),
  approved_at               timestamptz,
  approved_by               uuid references users(id),
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

create index organizations_kind_status_idx on organizations (kind, status);

create trigger organizations_set_updated_at
  before update on organizations
  for each row execute function set_updated_at();


-- This table replaces the free-typed organization-name string field that was
-- the root cause of most faults in the prior system. There is no code path
-- anywhere that resolves a person to an organization by comparing text.
--
-- staff_admin and staff_approver are only meaningful on a membership whose org
-- is kind = 'platform_owner'. Enforce that in the permission helper.
create table org_memberships (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  user_id     uuid not null references users(id) on delete cascade,
  role        text not null default 'member'
                check (role in ('owner','member','staff_admin','staff_approver')),
  status      text not null default 'pending'
                check (status in ('pending','active','removed')),
  invited_by  uuid references users(id),
  approved_at timestamptz,
  approved_by uuid references users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (org_id, user_id)
);

create index org_memberships_user_idx on org_memberships (user_id) where status = 'active';
create index org_memberships_org_idx  on org_memberships (org_id)  where status = 'active';

create trigger org_memberships_set_updated_at
  before update on org_memberships
  for each row execute function set_updated_at();


-- ============================================================
-- 3. Populations served
-- ============================================================

-- Seeded from the distinct values present in the migrated data, not from an
-- invented taxonomy. 'Other' is a seeded row so it stays selectable and
-- countable; organizations.populations_other captures what was meant by it.
create table populations (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  slug       text not null unique,
  sort_order integer not null default 0,
  is_active  boolean not null default true
);

create table organization_populations (
  org_id        uuid not null references organizations(id) on delete cascade,
  population_id uuid not null references populations(id),
  primary key (org_id, population_id)
);


-- ============================================================
-- 4. Item requests
-- ============================================================

-- expires_on is the prior system's Archive On field, renamed.
-- status = 'draft' is new: a request mid-creation, invisible to everyone but
-- its own organization.
create table item_requests (
  id                uuid primary key default gen_random_uuid(),
  legacy_wix_id     text unique,
  org_id            uuid not null references organizations(id),
  title             text not null,
  description       text,
  image_url         text,
  dropoff_location  text,
  people_helped     integer,
  deadline_type     text not null default 'until_fulfilled'
                      check (deadline_type in ('date_specific','until_fulfilled','ongoing')),
  deadline_date     date,
  expires_on        date,
  contact_person_id uuid references people(id),
  status            text not null default 'draft'
                      check (status in ('draft','pending','active','archived')),
  submitted_at      timestamptz,
  approved_at       timestamptz,
  approved_by       uuid references users(id),
  archived_at       timestamptz,
  archived_reason   text check (archived_reason in ('manual','expired','fulfilled')),
  created_by        uuid references users(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint item_requests_deadline_date_required
    check (deadline_type <> 'date_specific' or deadline_date is not null)
);

create index item_requests_public_idx on item_requests (status, created_at desc)
  where status = 'active';
create index item_requests_org_idx on item_requests (org_id);

create trigger item_requests_set_updated_at
  before update on item_requests
  for each row execute function set_updated_at();


-- quantity_remaining is generated and is NEVER written.
-- quantity_claimed is written only by record_item_pledge(), defined below.
-- quantity_received is a manual field organizations maintain themselves; it
-- does not affect public availability.
create table items (
  id                 uuid primary key default gen_random_uuid(),
  legacy_wix_id      text unique,
  item_request_id    uuid not null references item_requests(id) on delete cascade,
  name               text not null,
  description        text,
  condition          text check (condition in ('new','gently_used','any')),
  product_url        text,
  quantity_requested integer not null check (quantity_requested > 0),
  quantity_claimed   integer not null default 0 check (quantity_claimed >= 0),
  quantity_received  integer not null default 0 check (quantity_received >= 0),
  quantity_remaining integer generated always as
                       (greatest(quantity_requested - quantity_claimed, 0)) stored,
  sort_order         integer not null default 0,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index items_request_idx on items (item_request_id, sort_order);

create trigger items_set_updated_at
  before update on items
  for each row execute function set_updated_at();


-- ============================================================
-- 5. Volunteer requests
-- ============================================================

-- deadline_date is live and exposed on the volunteer create form. This is the
-- one named additive deviation from the prior system's forms.
create table volunteer_requests (
  id                uuid primary key default gen_random_uuid(),
  legacy_wix_id     text unique,
  org_id            uuid not null references organizations(id),
  title             text not null,
  description       text,
  details           text,
  event_location    text,
  image_url         text,
  people_helped     integer,
  deadline_type     text not null default 'ongoing'
                      check (deadline_type in ('date_specific','until_fulfilled','ongoing')),
  deadline_date     date,
  expires_on        date,
  contact_person_id uuid references people(id),
  status            text not null default 'draft'
                      check (status in ('draft','pending','active','archived')),
  submitted_at      timestamptz,
  approved_at       timestamptz,
  approved_by       uuid references users(id),
  archived_at       timestamptz,
  archived_reason   text check (archived_reason in ('manual','expired','fulfilled')),
  created_by        uuid references users(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint volunteer_requests_deadline_date_required
    check (deadline_type <> 'date_specific' or deadline_date is not null)
);

create index volunteer_requests_public_idx on volunteer_requests (status, created_at desc)
  where status = 'active';
create index volunteer_requests_org_idx on volunteer_requests (org_id);

create trigger volunteer_requests_set_updated_at
  before update on volunteer_requests
  for each row execute function set_updated_at();


-- The volunteer side tracks INTEREST, not commitment.
-- quantity_interested gates the public checkbox and is written only by
-- record_volunteer_signup(). quantity_confirmed is the organization's own
-- record of who actually served. Do not conflate them.
create table volunteer_roles (
  id                   uuid primary key default gen_random_uuid(),
  legacy_wix_id        text unique,
  volunteer_request_id uuid not null references volunteer_requests(id) on delete cascade,
  name                 text not null,
  description          text,
  quantity_needed      integer not null check (quantity_needed > 0),
  quantity_interested  integer not null default 0 check (quantity_interested >= 0),
  quantity_confirmed   integer not null default 0 check (quantity_confirmed >= 0),
  quantity_remaining   integer generated always as
                         (greatest(quantity_needed - quantity_interested, 0)) stored,
  sort_order           integer not null default 0,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index volunteer_roles_request_idx on volunteer_roles (volunteer_request_id, sort_order);

create trigger volunteer_roles_set_updated_at
  before update on volunteer_roles
  for each row execute function set_updated_at();


-- ============================================================
-- 6. Pledges and signups
-- ============================================================

-- The single-supporter model. One person who both donates and volunteers is
-- one people row with rows in both branches. There is no donor entity.
create table item_pledges (
  id              uuid primary key default gen_random_uuid(),
  legacy_wix_id   text unique,
  person_id       uuid not null references people(id),
  item_request_id uuid not null references item_requests(id),
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index item_pledges_person_idx  on item_pledges (person_id);
create index item_pledges_request_idx on item_pledges (item_request_id);

create trigger item_pledges_set_updated_at
  before update on item_pledges
  for each row execute function set_updated_at();


create table item_pledge_lines (
  id             uuid primary key default gen_random_uuid(),
  item_pledge_id uuid not null references item_pledges(id) on delete cascade,
  item_id        uuid not null references items(id),
  quantity       integer not null check (quantity > 0),
  unique (item_pledge_id, item_id)
);

create index item_pledge_lines_item_idx on item_pledge_lines (item_id);


-- notes is the free-text availability / experience / accommodations field from
-- the public form. It is displayed to the organization in full and is never
-- truncated or summarized.
create table volunteer_signups (
  id                   uuid primary key default gen_random_uuid(),
  legacy_wix_id        text unique,
  person_id            uuid not null references people(id),
  volunteer_request_id uuid not null references volunteer_requests(id),
  notes                text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index volunteer_signups_person_idx  on volunteer_signups (person_id);
create index volunteer_signups_request_idx on volunteer_signups (volunteer_request_id);

create trigger volunteer_signups_set_updated_at
  before update on volunteer_signups
  for each row execute function set_updated_at();


create table volunteer_signup_roles (
  id                  uuid primary key default gen_random_uuid(),
  volunteer_signup_id uuid not null references volunteer_signups(id) on delete cascade,
  volunteer_role_id   uuid not null references volunteer_roles(id),
  unique (volunteer_signup_id, volunteer_role_id)
);

create index volunteer_signup_roles_role_idx on volunteer_signup_roles (volunteer_role_id);


-- ============================================================
-- 7. Governance
-- ============================================================

-- Every status transition writes a row, including automated ones. The nightly
-- expiry job writes events with a null actor.
--
-- 'person' is included so the merge action in ADMIN-04 is auditable. It is the
-- only irreversible operation in the system and it would otherwise leave no
-- trace. Merge writes from_status = 'duplicate', to_status = 'merged'.
create table approval_events (
  id            uuid primary key default gen_random_uuid(),
  entity_type   text not null
                  check (entity_type in ('organization','org_membership',
                                         'item_request','volunteer_request',
                                         'person')),
  entity_id     uuid not null,
  from_status   text,
  to_status     text not null,
  actor_user_id uuid references users(id),
  note          text,
  created_at    timestamptz not null default now()
);

create index approval_events_entity_idx
  on approval_events (entity_type, entity_id, created_at desc);
create index approval_events_created_idx on approval_events (created_at desc);


-- Replaces the prior system's Approved Email Sent boolean, which existed only
-- because there was no other way to avoid double-sending.
--
-- The dedup index includes to_email because several templates send to more
-- than one recipient for the same entity: all four staff notifications go to
-- two addresses, and org_request_approved goes to both the organization's
-- primary contact and the request's creator. Without to_email in the key, the
-- second recipient's row is rejected and that person silently receives nothing.
-- Semantics are once per recipient per entity; approving twice still sends
-- each person exactly one email.
create table email_log (
  id                  uuid primary key default gen_random_uuid(),
  template_key        text not null,
  to_email            text not null,
  to_person_id        uuid references people(id),
  entity_type         text,
  entity_id           uuid,
  payload             jsonb not null default '{}',
  status              text not null default 'queued'
                        check (status in ('queued','sent','failed')),
  provider_message_id text,
  error               text,
  sent_at             timestamptz,
  created_at          timestamptz not null default now()
);

create unique index email_log_once_idx
  on email_log (template_key, entity_type, entity_id, lower(to_email))
  where entity_id is not null and status <> 'failed';

create index email_log_status_idx on email_log (status, created_at desc);
create index email_log_entity_idx on email_log (entity_type, entity_id);


-- ============================================================
-- 8. Weekly digest
-- ============================================================

-- Scope is the table plus the subscriber import. The send job is phase two.
-- person_id is nullable: someone can subscribe without ever donating or
-- volunteering, and an email address alone is not a person record.
create table digest_subscribers (
  id                uuid primary key default gen_random_uuid(),
  person_id         uuid references people(id),
  email             text not null,
  status            text not null default 'subscribed'
                      check (status in ('subscribed','unsubscribed','bounced')),
  unsubscribe_token uuid not null default gen_random_uuid(),
  subscribed_at     timestamptz not null default now(),
  unsubscribed_at   timestamptz,
  legacy_source     text
);

create unique index digest_subscribers_email_key on digest_subscribers (lower(email));
create unique index digest_subscribers_token_key on digest_subscribers (unsubscribe_token);


-- ============================================================
-- 9. Counter drift check
-- ============================================================

-- Should return zero rows at every commit. The fastest way to catch a rogue
-- write path against a counter column. Used by the test suite and by
-- migration validation.
create view counter_drift as
  select 'item' as kind, i.id, i.quantity_claimed as stored,
         coalesce(sum(l.quantity), 0) as actual
    from items i
    left join item_pledge_lines l on l.item_id = i.id
   group by i.id, i.quantity_claimed
  having i.quantity_claimed <> coalesce(sum(l.quantity), 0)
  union all
  select 'role', r.id, r.quantity_interested,
         coalesce(count(sr.id), 0)
    from volunteer_roles r
    left join volunteer_signup_roles sr on sr.volunteer_role_id = r.id
   group by r.id, r.quantity_interested
  having r.quantity_interested <> coalesce(count(sr.id), 0);


-- ============================================================
-- 10. Counter functions
-- ============================================================

-- These two functions are the ONLY code in the system that writes
-- items.quantity_claimed or volunteer_roles.quantity_interested.
--
-- If you find yourself writing `update items set quantity_claimed`, stop and
-- call record_item_pledge() instead. Stored counters drift the moment two code
-- paths can write them, and the drift is invisible until a donor claims
-- something that was already gone.
--
-- Both do the whole operation in one transaction: find or create the person,
-- write the pledge or signup, write the lines, move the counters, and re-check
-- availability under a row lock so two simultaneous donors cannot oversubscribe
-- the same item or role.
--
-- These are the only code paths in the system that create a person on a public
-- flow. Name and phone handling implements the person identity and name policy
-- in Handbook.md section 8.

create function record_item_pledge(
  p_first_name  text,
  p_last_name   text,
  p_email       text,
  p_phone       text,
  p_request_id  uuid,
  p_notes       text,
  p_lines       jsonb          -- [{"item_id":"...","quantity":2}, ...]
) returns uuid as $$
declare
  v_person_id         uuid;
  v_pledge_id         uuid;
  v_line              jsonb;
  v_item_id           uuid;
  v_qty               integer;
  v_remaining         integer;
  v_status            text;
  v_phone_digits      text;
  v_phone_match_count integer;
  v_match_email       text;
  v_match_id          uuid;
  v_needs_review      boolean := false;
  v_review_note       text;
begin
  -- Lock the request first, so an archive racing a pledge resolves one way.
  select status into v_status from item_requests where id = p_request_id for update;
  if v_status is null then
    raise exception 'request_not_found';
  end if;
  if v_status is distinct from 'active' then
    raise exception 'request_not_active';
  end if;

  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'no_lines';
  end if;

  -- One human is one row, keyed by email. Names update in place on a match.
  select id into v_person_id from people where lower(email) = lower(p_email);
  if v_person_id is null then
    v_phone_digits := regexp_replace(coalesce(nullif(trim(p_phone), ''), ''), '[^0-9]', '', 'g');
    if v_phone_digits <> '' then
      select count(*), min(email), min(id)
        into v_phone_match_count, v_match_email, v_match_id
        from people
       where regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g') = v_phone_digits;

      if v_phone_match_count > 0 then
        v_needs_review := true;
        if v_phone_match_count = 1 then
          v_review_note := format(
            'Suspected duplicate: submitted phone matches existing person %s (%s).',
            v_match_email, v_match_id
          );
        else
          v_review_note := format(
            'Suspected duplicate: submitted phone matches %s existing people. Example: %s (%s).',
            v_phone_match_count, v_match_email, v_match_id
          );
        end if;
      end if;
    end if;

    insert into people (first_name, last_name, email, phone, needs_review, review_note)
    values (p_first_name, p_last_name, p_email, p_phone, v_needs_review, v_review_note)
    returning id into v_person_id;
  else
    update people
       set first_name = p_first_name,
           last_name  = p_last_name,
           phone      = coalesce(nullif(p_phone, ''), phone)
     where id = v_person_id;
  end if;

  insert into item_pledges (person_id, item_request_id, notes)
  values (v_person_id, p_request_id, p_notes)
  returning id into v_pledge_id;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_item_id := (v_line->>'item_id')::uuid;
    v_qty     := (v_line->>'quantity')::integer;

    if v_qty is null or v_qty <= 0 then
      raise exception 'invalid_quantity';
    end if;

    -- Row lock: this is what makes two simultaneous claims on the last unit
    -- resolve to one success and one insufficient_quantity.
    select quantity_remaining into v_remaining
      from items
     where id = v_item_id and item_request_id = p_request_id
     for update;

    if v_remaining is null then
      raise exception 'item_not_in_request';
    end if;
    if v_qty > v_remaining then
      raise exception 'insufficient_quantity';
    end if;

    insert into item_pledge_lines (item_pledge_id, item_id, quantity)
    values (v_pledge_id, v_item_id, v_qty);

    update items
       set quantity_claimed = quantity_claimed + v_qty
     where id = v_item_id;
  end loop;

  -- A fully claimed request archives itself, and the transition is audited
  -- like any other. Null actor: no human did this.
  if not exists (
    select 1 from items
     where item_request_id = p_request_id and quantity_remaining > 0
  ) then
    update item_requests
       set status = 'archived',
           archived_at = now(),
           archived_reason = 'fulfilled'
     where id = p_request_id;

    insert into approval_events (entity_type, entity_id, from_status, to_status, note)
    values ('item_request', p_request_id, 'active', 'archived', 'fulfilled');
  end if;

  return v_pledge_id;
end;
$$ language plpgsql;


create function record_volunteer_signup(
  p_first_name  text,
  p_last_name   text,
  p_email       text,
  p_phone       text,
  p_request_id  uuid,
  p_notes       text,
  p_role_ids    uuid[]
) returns uuid as $$
declare
  v_person_id         uuid;
  v_signup_id         uuid;
  v_role_id           uuid;
  v_remaining         integer;
  v_status            text;
  v_phone_digits      text;
  v_phone_match_count integer;
  v_match_email       text;
  v_match_id          uuid;
  v_needs_review      boolean := false;
  v_review_note       text;
begin
  select status into v_status from volunteer_requests where id = p_request_id for update;
  if v_status is null then
    raise exception 'request_not_found';
  end if;
  if v_status is distinct from 'active' then
    raise exception 'request_not_active';
  end if;

  if p_role_ids is null or array_length(p_role_ids, 1) is null then
    raise exception 'no_roles';
  end if;

  select id into v_person_id from people where lower(email) = lower(p_email);
  if v_person_id is null then
    v_phone_digits := regexp_replace(coalesce(nullif(trim(p_phone), ''), ''), '[^0-9]', '', 'g');
    if v_phone_digits <> '' then
      select count(*), min(email), min(id)
        into v_phone_match_count, v_match_email, v_match_id
        from people
       where regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g') = v_phone_digits;

      if v_phone_match_count > 0 then
        v_needs_review := true;
        if v_phone_match_count = 1 then
          v_review_note := format(
            'Suspected duplicate: submitted phone matches existing person %s (%s).',
            v_match_email, v_match_id
          );
        else
          v_review_note := format(
            'Suspected duplicate: submitted phone matches %s existing people. Example: %s (%s).',
            v_phone_match_count, v_match_email, v_match_id
          );
        end if;
      end if;
    end if;

    insert into people (first_name, last_name, email, phone, needs_review, review_note)
    values (p_first_name, p_last_name, p_email, p_phone, v_needs_review, v_review_note)
    returning id into v_person_id;
  else
    update people
       set first_name = p_first_name,
           last_name  = p_last_name,
           phone      = coalesce(nullif(p_phone, ''), phone)
     where id = v_person_id;
  end if;

  insert into volunteer_signups (person_id, volunteer_request_id, notes)
  values (v_person_id, p_request_id, p_notes)
  returning id into v_signup_id;

  foreach v_role_id in array p_role_ids loop
    select quantity_remaining into v_remaining
      from volunteer_roles
     where id = v_role_id and volunteer_request_id = p_request_id
     for update;

    if v_remaining is null then
      raise exception 'role_not_in_request';
    end if;
    if v_remaining < 1 then
      raise exception 'role_full';
    end if;

    insert into volunteer_signup_roles (volunteer_signup_id, volunteer_role_id)
    values (v_signup_id, v_role_id);

    update volunteer_roles
       set quantity_interested = quantity_interested + 1
     where id = v_role_id;
  end loop;

  -- Volunteer requests do NOT auto-archive when every role fills. Interest is
  -- not commitment: people who express interest do not always follow through,
  -- and an organization still wants to hear from someone after a role fills up.
  -- Archiving on the volunteer side is manual or by expiry only.

  return v_signup_id;
end;
$$ language plpgsql;

commit;
