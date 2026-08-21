--
-- PostgreSQL database dump
--

\restrict J29AItAUEIV9Mz8OUWsWRKKbb8BLbqZ7qsFdXn3WSEY4LsFMQYy0PqIyA72cmrm

-- Dumped from database version 16.10
-- Dumped by pg_dump version 16.10

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;


--
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';


--
-- Name: guard_counter_columns(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.guard_counter_columns() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  if current_setting('app.counter_write', true) = 'on' then
    return new;
  end if;

  if tg_table_name = 'items' then
    if new.quantity_claimed is distinct from old.quantity_claimed then
      raise exception
        'items.quantity_claimed is written only by record_item_pledge()';
    end if;
  elsif tg_table_name = 'volunteer_roles' then
    if new.quantity_interested is distinct from old.quantity_interested then
      raise exception
        'volunteer_roles.quantity_interested is written only by record_volunteer_signup()';
    end if;
  end if;

  return new;
end;
$$;


--
-- Name: guard_member_request_transitions(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.guard_member_request_transitions() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  if current_setting('app.context', true) is distinct from 'member' then
    return new;
  end if;

  if new.org_id is distinct from old.org_id then
    raise exception 'member_cannot_move_request_between_orgs';
  end if;

  if new.approved_at is distinct from old.approved_at
     or new.approved_by is distinct from old.approved_by then
    raise exception 'member_cannot_set_approval_fields';
  end if;

  if new.status is distinct from old.status then
    if (old.status, new.status) not in
         (('draft','pending'), ('pending','draft'), ('active','archived')) then
      raise exception 'member_status_transition_not_allowed: % -> %',
        old.status, new.status;
    end if;

    if old.status = 'draft' then
      new.submitted_at := coalesce(new.submitted_at, now());
    end if;

    if new.status = 'archived' then
      new.archived_at     := coalesce(new.archived_at, now());
      new.archived_reason := 'manual';
    end if;

    -- Every status transition writes an event, including this one.
    insert into approval_events
      (entity_type, entity_id, from_status, to_status, actor_user_id)
    values
      (tg_argv[0], new.id, old.status, new.status,
       nullif(current_setting('app.user_id', true), '')::uuid);
  end if;

  return new;
end;
$$;


--
-- Name: item_request_current_la_date(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.item_request_current_la_date() RETURNS date
    LANGUAGE sql
    AS $$
  select (clock_timestamp() at time zone 'America/Los_Angeles')::date;
$$;


--
-- Name: item_request_expired_on(text, date, date, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.item_request_expired_on(p_deadline_type text, p_deadline_date date, p_expires_on date, p_today date) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    AS $$
  select
    (p_expires_on is not null and p_expires_on < p_today)
    or (
      p_deadline_type = 'date_specific'
      and p_deadline_date is not null
      and p_deadline_date < p_today
    );
$$;


--
-- Name: merge_people(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.merge_people(p_duplicate uuid, p_survivor uuid) RETURNS jsonb
    LANGUAGE plpgsql
    AS $$
declare
  n_pledges int;
  n_signups int;
  n_users int;
  n_digest int;
  n_org_contacts int;
  n_email int;
  n_item_req_contacts int;
  n_vol_req_contacts int;
  n_volunteer_interests int;
  v_actor uuid;
  v_note text;
begin
  if p_duplicate is null or p_survivor is null then
    raise exception 'merge_people: both ids are required';
  end if;
  if p_duplicate = p_survivor then
    raise exception 'merge_people: duplicate and survivor are the same row';
  end if;

  perform 1 from people where id = least(p_duplicate, p_survivor) for update;
  if not found then
    raise exception 'merge_people: person % not found', least(p_duplicate, p_survivor);
  end if;
  perform 1 from people where id = greatest(p_duplicate, p_survivor) for update;
  if not found then
    raise exception 'merge_people: person % not found', greatest(p_duplicate, p_survivor);
  end if;

  if exists (select 1 from users where person_id = p_duplicate)
     and exists (select 1 from users where person_id = p_survivor) then
    raise exception 'merge_people: both records have login accounts';
  end if;

  select format('Merged %s %s <%s> (%s) into %s.',
                first_name, last_name, email, id, p_survivor)
    into v_note
    from people where id = p_duplicate;

  v_actor := nullif(current_setting('app.user_id', true), '')::uuid;

  update item_pledges set person_id = p_survivor where person_id = p_duplicate;
  get diagnostics n_pledges = row_count;

  update volunteer_signups set person_id = p_survivor where person_id = p_duplicate;
  get diagnostics n_signups = row_count;

  update users set person_id = p_survivor where person_id = p_duplicate;
  get diagnostics n_users = row_count;

  update digest_subscribers set person_id = p_survivor where person_id = p_duplicate;
  get diagnostics n_digest = row_count;

  update organizations set primary_contact_person_id = p_survivor
   where primary_contact_person_id = p_duplicate;
  get diagnostics n_org_contacts = row_count;

  update email_log set to_person_id = p_survivor where to_person_id = p_duplicate;
  get diagnostics n_email = row_count;

  update item_requests set contact_person_id = p_survivor where contact_person_id = p_duplicate;
  get diagnostics n_item_req_contacts = row_count;

  update volunteer_requests set contact_person_id = p_survivor where contact_person_id = p_duplicate;
  get diagnostics n_vol_req_contacts = row_count;

  select count(*)::int into n_volunteer_interests
    from person_volunteer_interests
   where person_id = p_duplicate;

  insert into person_volunteer_interests (person_id, category_id)
  select p_survivor, category_id
    from person_volunteer_interests
   where person_id = p_duplicate
  on conflict do nothing;

  delete from person_volunteer_interests where person_id = p_duplicate;

  insert into approval_events
    (entity_type, entity_id, from_status, to_status, actor_user_id, note)
  values
    ('person', p_duplicate, 'duplicate', 'merged', v_actor, v_note);

  delete from people where id = p_duplicate;

  return jsonb_build_object(
    'pledges', n_pledges,
    'signups', n_signups,
    'users', n_users,
    'digestSubscribers', n_digest,
    'orgPrimaryContacts', n_org_contacts,
    'emailLogEntries', n_email,
    'itemRequestContacts', n_item_req_contacts,
    'volunteerRequestContacts', n_vol_req_contacts,
    'volunteerInterests', n_volunteer_interests);
end;
$$;


--
-- Name: record_item_pledge(text, text, text, text, uuid, text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.record_item_pledge(p_first_name text, p_last_name text, p_email text, p_phone text, p_request_id uuid, p_notes text, p_lines jsonb) RETURNS uuid
    LANGUAGE plpgsql
    AS $$
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
  v_match_list        text;
  v_needs_review      boolean := false;
  v_review_note       text;
  v_prior_context     text;
begin
  -- This function is called from the public pledge flow, where app.context is
  -- 'public' and people has no public policy. Run the body as system and put
  -- the caller's context back before returning, so the escalation is bounded
  -- by this function rather than by the surrounding transaction.
  v_prior_context := coalesce(current_setting('app.context', true), '');
  perform set_config('app.context', 'system', true);

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

  select id into v_person_id from people where lower(email) = lower(p_email);
  if v_person_id is null then
    v_phone_digits := regexp_replace(coalesce(nullif(trim(p_phone), ''), ''), '[^0-9]', '', 'g');
    if v_phone_digits <> '' then
      select count(*),
             string_agg(
               format('%s %s <%s> (%s)', first_name, last_name, email, id),
               '; ' order by created_at asc, id asc
             )
        into v_phone_match_count, v_match_list
        from people
       where regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g') = v_phone_digits;

      if v_phone_match_count > 0 then
        v_needs_review := true;
        if v_phone_match_count = 1 then
          v_review_note := format(
            'Suspected duplicate: submitted phone matches existing person %s.',
            v_match_list
          );
        else
          v_review_note := format(
            'Suspected duplicate: submitted phone matches %s existing people: %s.',
            v_phone_match_count, v_match_list
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

    perform set_config('app.counter_write', 'on', true);
    update items
       set quantity_claimed = quantity_claimed + v_qty
     where id = v_item_id;
    perform set_config('app.counter_write', 'off', true);
  end loop;

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

  perform set_config('app.context', v_prior_context, true);
  return v_pledge_id;
end;
$$;


--
-- Name: record_volunteer_signup(text, text, text, text, uuid, text, uuid[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.record_volunteer_signup(p_first_name text, p_last_name text, p_email text, p_phone text, p_request_id uuid, p_notes text, p_role_ids uuid[]) RETURNS uuid
    LANGUAGE plpgsql
    AS $$
declare
  v_person_id         uuid;
  v_signup_id         uuid;
  v_role_id           uuid;
  v_remaining         integer;
  v_status            text;
  v_phone_digits      text;
  v_phone_match_count integer;
  v_match_list        text;
  v_needs_review      boolean := false;
  v_review_note       text;
  v_prior_context     text;
begin
  -- See the note in record_item_pledge(). Same reason, same bounded escalation.
  v_prior_context := coalesce(current_setting('app.context', true), '');
  perform set_config('app.context', 'system', true);

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
      select count(*),
             string_agg(
               format('%s %s <%s> (%s)', first_name, last_name, email, id),
               '; ' order by created_at asc, id asc
             )
        into v_phone_match_count, v_match_list
        from people
       where regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g') = v_phone_digits;

      if v_phone_match_count > 0 then
        v_needs_review := true;
        if v_phone_match_count = 1 then
          v_review_note := format(
            'Suspected duplicate: submitted phone matches existing person %s.',
            v_match_list
          );
        else
          v_review_note := format(
            'Suspected duplicate: submitted phone matches %s existing people: %s.',
            v_phone_match_count, v_match_list
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

    perform set_config('app.counter_write', 'on', true);
    update volunteer_roles
       set quantity_interested = quantity_interested + 1
     where id = v_role_id;
    perform set_config('app.counter_write', 'off', true);
  end loop;

  perform set_config('app.context', v_prior_context, true);
  return v_signup_id;
end;
$$;


--
-- Name: reject_expired_item_pledge(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reject_expired_item_pledge() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  if exists (
    select 1
      from item_requests r
     where r.id = new.item_request_id
       and item_request_expired_on(
         r.deadline_type,
         r.deadline_date,
         r.expires_on,
         item_request_current_la_date()
       )
  ) then
    raise exception 'request_not_active';
  end if;
  return new;
end;
$$;


--
-- Name: set_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: account; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.account (
    id text NOT NULL,
    "accountId" text NOT NULL,
    "providerId" text NOT NULL,
    "userId" text NOT NULL,
    "accessToken" text,
    "refreshToken" text,
    "idToken" text,
    "accessTokenExpiresAt" timestamp without time zone,
    "refreshTokenExpiresAt" timestamp without time zone,
    scope text,
    password text,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: approval_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.approval_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    entity_type text NOT NULL,
    entity_id uuid NOT NULL,
    from_status text,
    to_status text NOT NULL,
    actor_user_id uuid,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT approval_events_entity_type_check CHECK ((entity_type = ANY (ARRAY['organization'::text, 'org_membership'::text, 'item_request'::text, 'volunteer_request'::text, 'person'::text])))
);

ALTER TABLE ONLY public.approval_events FORCE ROW LEVEL SECURITY;


--
-- Name: item_pledge_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.item_pledge_lines (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    item_pledge_id uuid NOT NULL,
    item_id uuid NOT NULL,
    quantity integer NOT NULL,
    CONSTRAINT item_pledge_lines_quantity_check CHECK ((quantity > 0))
);

ALTER TABLE ONLY public.item_pledge_lines FORCE ROW LEVEL SECURITY;


--
-- Name: items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    legacy_wix_id text,
    item_request_id uuid NOT NULL,
    name text NOT NULL,
    description text,
    condition text,
    product_url text,
    quantity_requested integer NOT NULL,
    quantity_claimed integer DEFAULT 0 NOT NULL,
    quantity_received integer DEFAULT 0 NOT NULL,
    quantity_remaining integer GENERATED ALWAYS AS (GREATEST((quantity_requested - quantity_claimed), 0)) STORED,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT items_condition_check CHECK ((condition = ANY (ARRAY['new'::text, 'gently_used'::text, 'any'::text]))),
    CONSTRAINT items_quantity_claimed_check CHECK ((quantity_claimed >= 0)),
    CONSTRAINT items_quantity_received_check CHECK ((quantity_received >= 0)),
    CONSTRAINT items_quantity_requested_check CHECK ((quantity_requested > 0))
);

ALTER TABLE ONLY public.items FORCE ROW LEVEL SECURITY;


--
-- Name: volunteer_roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.volunteer_roles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    legacy_wix_id text,
    volunteer_request_id uuid NOT NULL,
    name text NOT NULL,
    description text,
    quantity_needed integer NOT NULL,
    quantity_interested integer DEFAULT 0 NOT NULL,
    quantity_confirmed integer DEFAULT 0 NOT NULL,
    quantity_remaining integer GENERATED ALWAYS AS (GREATEST((quantity_needed - quantity_interested), 0)) STORED,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT volunteer_roles_quantity_confirmed_check CHECK ((quantity_confirmed >= 0)),
    CONSTRAINT volunteer_roles_quantity_interested_check CHECK ((quantity_interested >= 0)),
    CONSTRAINT volunteer_roles_quantity_needed_check CHECK ((quantity_needed > 0))
);

ALTER TABLE ONLY public.volunteer_roles FORCE ROW LEVEL SECURITY;


--
-- Name: volunteer_signup_roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.volunteer_signup_roles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    volunteer_signup_id uuid NOT NULL,
    volunteer_role_id uuid NOT NULL
);

ALTER TABLE ONLY public.volunteer_signup_roles FORCE ROW LEVEL SECURITY;


--
-- Name: counter_drift; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.counter_drift AS
 SELECT 'item'::text AS kind,
    i.id,
    i.quantity_claimed AS stored,
    COALESCE(sum(l.quantity), (0)::bigint) AS actual
   FROM (public.items i
     LEFT JOIN public.item_pledge_lines l ON ((l.item_id = i.id)))
  GROUP BY i.id, i.quantity_claimed
 HAVING (i.quantity_claimed <> COALESCE(sum(l.quantity), (0)::bigint))
UNION ALL
 SELECT 'role'::text AS kind,
    r.id,
    r.quantity_interested AS stored,
    COALESCE(count(sr.id), (0)::bigint) AS actual
   FROM (public.volunteer_roles r
     LEFT JOIN public.volunteer_signup_roles sr ON ((sr.volunteer_role_id = r.id)))
  GROUP BY r.id, r.quantity_interested
 HAVING (r.quantity_interested <> COALESCE(count(sr.id), (0)::bigint));


--
-- Name: digest_exclusions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.digest_exclusions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    need_type text NOT NULL,
    need_id uuid NOT NULL,
    window_start timestamp with time zone NOT NULL,
    excluded_by uuid,
    excluded_at timestamp with time zone DEFAULT now() NOT NULL,
    note text,
    CONSTRAINT digest_exclusions_need_type_check CHECK ((need_type = ANY (ARRAY['item'::text, 'volunteer'::text])))
);

ALTER TABLE ONLY public.digest_exclusions FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE digest_exclusions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.digest_exclusions IS 'Per-need exclusions for a digest run window; scoped to window_start so they expire naturally once the run completes and the watermark advances.';


--
-- Name: digest_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.digest_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    run_date date NOT NULL,
    window_start timestamp with time zone NOT NULL,
    window_end timestamp with time zone NOT NULL,
    status text DEFAULT 'running'::text NOT NULL,
    needs_count integer,
    recipients_count integer,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    needs_payload jsonb,
    occurrence_key text NOT NULL,
    CONSTRAINT digest_runs_status_check CHECK ((status = ANY (ARRAY['running'::text, 'sent'::text, 'skipped_empty'::text])))
);

ALTER TABLE ONLY public.digest_runs FORCE ROW LEVEL SECURITY;


--
-- Name: COLUMN digest_runs.needs_payload; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.digest_runs.needs_payload IS 'Canonical DigestNeed[] snapshot for this run; set once after selection, reused verbatim on resume.';


--
-- Name: COLUMN digest_runs.occurrence_key; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.digest_runs.occurrence_key IS 'Durable schedule occurrence claim: weekly:YYYY-MM-DD, once:<ISO instant>, or date:<YYYY-MM-DD> for direct verification passes.';


--
-- Name: digest_subscribers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.digest_subscribers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    person_id uuid,
    email text NOT NULL,
    status text DEFAULT 'subscribed'::text NOT NULL,
    unsubscribe_token uuid DEFAULT gen_random_uuid() NOT NULL,
    subscribed_at timestamp with time zone DEFAULT now() NOT NULL,
    unsubscribed_at timestamp with time zone,
    legacy_source text,
    first_name text,
    last_name text,
    CONSTRAINT digest_subscribers_status_check CHECK ((status = ANY (ARRAY['subscribed'::text, 'unsubscribed'::text, 'bounced'::text])))
);

ALTER TABLE ONLY public.digest_subscribers FORCE ROW LEVEL SECURITY;


--
-- Name: COLUMN digest_subscribers.first_name; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.digest_subscribers.first_name IS 'PB-05 form value, stored exactly as entered. Null on rows created before 0004 or imported without a name.';


--
-- Name: COLUMN digest_subscribers.last_name; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.digest_subscribers.last_name IS 'PB-05 form value, stored exactly as entered. Null on rows created before 0004 or imported without a name.';


--
-- Name: email_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    template_key text NOT NULL,
    to_email text NOT NULL,
    to_person_id uuid,
    entity_type text,
    entity_id uuid,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text DEFAULT 'queued'::text NOT NULL,
    provider_message_id text,
    error text,
    sent_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    failure_category text,
    resend_of_id uuid,
    CONSTRAINT email_log_failure_category_check CHECK ((failure_category = ANY (ARRAY['config'::text, 'render'::text, 'provider_timeout'::text, 'provider'::text, 'sweep'::text]))),
    CONSTRAINT email_log_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'sending'::text, 'sent'::text, 'failed'::text, 'skipped'::text])))
);

ALTER TABLE ONLY public.email_log FORCE ROW LEVEL SECURITY;


--
-- Name: COLUMN email_log.status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.email_log.status IS 'queued -> sending (dispatch claim) -> sent | failed. skipped = template disabled by staff; never dispatched.';


--
-- Name: email_schedules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_schedules (
    template_key text NOT NULL,
    active boolean DEFAULT true NOT NULL,
    weekly_weekday smallint NOT NULL,
    weekly_minutes smallint NOT NULL,
    one_time_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by uuid,
    CONSTRAINT email_schedules_weekly_minutes_check CHECK (((weekly_minutes >= 0) AND (weekly_minutes <= 1439))),
    CONSTRAINT email_schedules_weekly_weekday_check CHECK (((weekly_weekday >= 0) AND (weekly_weekday <= 6)))
);

ALTER TABLE ONLY public.email_schedules FORCE ROW LEVEL SECURITY;


--
-- Name: email_template_overrides; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_template_overrides (
    template_key text NOT NULL,
    subject text,
    heading text,
    paragraphs jsonb,
    recipients text,
    enabled boolean DEFAULT true NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by uuid,
    CONSTRAINT email_template_overrides_copy_all_or_nothing CHECK ((((subject IS NULL) AND (heading IS NULL) AND (paragraphs IS NULL)) OR ((subject IS NOT NULL) AND (heading IS NOT NULL) AND (paragraphs IS NOT NULL)))),
    CONSTRAINT email_template_overrides_paragraphs_array CHECK (((paragraphs IS NULL) OR (jsonb_typeof(paragraphs) = 'array'::text)))
);

ALTER TABLE ONLY public.email_template_overrides FORCE ROW LEVEL SECURITY;


--
-- Name: item_pledges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.item_pledges (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    legacy_wix_id text,
    person_id uuid NOT NULL,
    item_request_id uuid NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.item_pledges FORCE ROW LEVEL SECURITY;


--
-- Name: item_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.item_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    legacy_wix_id text,
    org_id uuid NOT NULL,
    title text NOT NULL,
    description text,
    image_url text,
    dropoff_location text,
    people_helped integer,
    deadline_type text DEFAULT 'until_fulfilled'::text NOT NULL,
    deadline_date date,
    expires_on date,
    contact_person_id uuid,
    status text DEFAULT 'draft'::text NOT NULL,
    submitted_at timestamp with time zone,
    approved_at timestamp with time zone,
    approved_by uuid,
    archived_at timestamp with time zone,
    archived_reason text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    image_generated boolean DEFAULT false NOT NULL,
    image_gen_status text,
    image_gen_error text,
    image_gen_retries integer DEFAULT 0 NOT NULL,
    CONSTRAINT item_requests_archived_reason_check CHECK ((archived_reason = ANY (ARRAY['manual'::text, 'expired'::text, 'fulfilled'::text]))),
    CONSTRAINT item_requests_deadline_date_required CHECK (((deadline_type <> 'date_specific'::text) OR (deadline_date IS NOT NULL))),
    CONSTRAINT item_requests_deadline_type_check CHECK ((deadline_type = ANY (ARRAY['date_specific'::text, 'until_fulfilled'::text, 'ongoing'::text]))),
    CONSTRAINT item_requests_image_gen_status_check CHECK ((image_gen_status = ANY (ARRAY['pending'::text, 'succeeded'::text, 'failed'::text]))),
    CONSTRAINT item_requests_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'pending'::text, 'active'::text, 'archived'::text])))
);

ALTER TABLE ONLY public.item_requests FORCE ROW LEVEL SECURITY;


--
-- Name: org_memberships; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.org_memberships (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role text DEFAULT 'member'::text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    invited_by uuid,
    approved_at timestamp with time zone,
    approved_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT org_memberships_role_check CHECK ((role = ANY (ARRAY['owner'::text, 'member'::text, 'staff_admin'::text, 'staff_approver'::text]))),
    CONSTRAINT org_memberships_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'active'::text, 'removed'::text])))
);

ALTER TABLE ONLY public.org_memberships FORCE ROW LEVEL SECURITY;


--
-- Name: organization_populations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organization_populations (
    org_id uuid NOT NULL,
    population_id uuid NOT NULL
);

ALTER TABLE ONLY public.organization_populations FORCE ROW LEVEL SECURITY;


--
-- Name: organizations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organizations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    legacy_wix_id text,
    kind text DEFAULT 'member_org'::text NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    website_url text,
    mission text,
    phone text,
    logo_url text,
    populations_other text,
    address_line1 text,
    address_line2 text,
    city text,
    state text,
    postal_code text,
    address_formatted text,
    primary_contact_person_id uuid,
    status text DEFAULT 'pending'::text NOT NULL,
    approved_at timestamp with time zone,
    approved_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT organizations_kind_check CHECK ((kind = ANY (ARRAY['member_org'::text, 'platform_owner'::text]))),
    CONSTRAINT organizations_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'disabled'::text])))
);

ALTER TABLE ONLY public.organizations FORCE ROW LEVEL SECURITY;


--
-- Name: people; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.people (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    first_name text NOT NULL,
    last_name text NOT NULL,
    email text NOT NULL,
    phone text,
    needs_review boolean DEFAULT false NOT NULL,
    review_note text,
    source_note text,
    legacy_wix_contact_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.people FORCE ROW LEVEL SECURITY;


--
-- Name: person_volunteer_interests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.person_volunteer_interests (
    person_id uuid NOT NULL,
    category_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.person_volunteer_interests FORCE ROW LEVEL SECURITY;


--
-- Name: populations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.populations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL
);

ALTER TABLE ONLY public.populations FORCE ROW LEVEL SECURITY;


--
-- Name: request_engagement_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.request_engagement_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    client_event_id uuid NOT NULL,
    event_type text NOT NULL,
    request_kind text NOT NULL,
    item_request_id uuid,
    volunteer_request_id uuid,
    item_id uuid,
    volunteer_role_id uuid,
    user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT request_engagement_child_target CHECK ((((event_type = ANY (ARRAY['product_link_click'::text, 'item_selected'::text])) AND (request_kind = 'item'::text) AND (item_id IS NOT NULL) AND (volunteer_role_id IS NULL)) OR ((event_type = 'role_selected'::text) AND (request_kind = 'volunteer'::text) AND (volunteer_role_id IS NOT NULL) AND (item_id IS NULL)) OR ((event_type = ANY (ARRAY['card_click'::text, 'detail_view'::text, 'form_start'::text])) AND (item_id IS NULL) AND (volunteer_role_id IS NULL)))),
    CONSTRAINT request_engagement_events_event_type_check CHECK ((event_type = ANY (ARRAY['card_click'::text, 'detail_view'::text, 'product_link_click'::text, 'form_start'::text, 'item_selected'::text, 'role_selected'::text]))),
    CONSTRAINT request_engagement_events_request_kind_check CHECK ((request_kind = ANY (ARRAY['item'::text, 'volunteer'::text]))),
    CONSTRAINT request_engagement_request_target CHECK ((((request_kind = 'item'::text) AND (item_request_id IS NOT NULL) AND (volunteer_request_id IS NULL)) OR ((request_kind = 'volunteer'::text) AND (volunteer_request_id IS NOT NULL) AND (item_request_id IS NULL))))
);

ALTER TABLE ONLY public.request_engagement_events FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE request_engagement_events; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.request_engagement_events IS 'Allowlisted public request interactions. Anonymous rows have no persistent visitor identity; pledges/signups remain authoritative conversions.';


--
-- Name: COLUMN request_engagement_events.client_event_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.request_engagement_events.client_event_id IS 'Fresh UUID for one client interaction, used only to make duplicate delivery idempotent.';


--
-- Name: schema_migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schema_migrations (
    filename text NOT NULL,
    sha256 text NOT NULL,
    applied_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: session; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.session (
    id text NOT NULL,
    "expiresAt" timestamp without time zone NOT NULL,
    token text NOT NULL,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp without time zone DEFAULT now() NOT NULL,
    "ipAddress" text,
    "userAgent" text,
    "userId" text NOT NULL
);


--
-- Name: user; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."user" (
    id text NOT NULL,
    name text NOT NULL,
    email text NOT NULL,
    "emailVerified" boolean DEFAULT false NOT NULL,
    image text,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    person_id uuid NOT NULL,
    auth_subject text,
    status text DEFAULT 'invited'::text NOT NULL,
    last_login_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    kind text DEFAULT 'member'::text NOT NULL,
    CONSTRAINT users_kind_check CHECK ((kind = ANY (ARRAY['member'::text, 'supporter'::text]))),
    CONSTRAINT users_status_check CHECK ((status = ANY (ARRAY['invited'::text, 'active'::text, 'disabled'::text])))
);

ALTER TABLE ONLY public.users FORCE ROW LEVEL SECURITY;


--
-- Name: verification; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.verification (
    id text NOT NULL,
    identifier text NOT NULL,
    value text NOT NULL,
    "expiresAt" timestamp without time zone NOT NULL,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: volunteer_alert_preferences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.volunteer_alert_preferences (
    user_id uuid NOT NULL,
    enabled boolean DEFAULT false NOT NULL,
    unsubscribe_token uuid DEFAULT gen_random_uuid() NOT NULL,
    enabled_at timestamp with time zone,
    disabled_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.volunteer_alert_preferences FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE volunteer_alert_preferences; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.volunteer_alert_preferences IS 'Explicit per-supporter consent for immediate matching-volunteer email alerts. No row is equivalent to enabled=false.';


--
-- Name: COLUMN volunteer_alert_preferences.unsubscribe_token; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.volunteer_alert_preferences.unsubscribe_token IS 'Opaque one-way capability used only to disable future matching alerts.';


--
-- Name: volunteer_categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.volunteer_categories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    CONSTRAINT volunteer_categories_name_check CHECK ((btrim(name) <> ''::text))
);

ALTER TABLE ONLY public.volunteer_categories FORCE ROW LEVEL SECURITY;


--
-- Name: volunteer_match_alert_claims; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.volunteer_match_alert_claims (
    volunteer_request_id uuid NOT NULL,
    user_id uuid NOT NULL,
    to_email text NOT NULL,
    claimed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT volunteer_match_alert_claims_to_email_check CHECK ((btrim(to_email) <> ''::text))
);

ALTER TABLE ONLY public.volunteer_match_alert_claims FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE volunteer_match_alert_claims; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.volunteer_match_alert_claims IS 'Durable once-only claim for approval-triggered matching alerts, independent of retryable email_log status.';


--
-- Name: volunteer_request_categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.volunteer_request_categories (
    volunteer_request_id uuid NOT NULL,
    category_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.volunteer_request_categories FORCE ROW LEVEL SECURITY;


--
-- Name: volunteer_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.volunteer_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    legacy_wix_id text,
    org_id uuid NOT NULL,
    title text NOT NULL,
    description text,
    details text,
    event_location text,
    image_url text,
    people_helped integer,
    deadline_type text DEFAULT 'ongoing'::text NOT NULL,
    deadline_date date,
    expires_on date,
    contact_person_id uuid,
    status text DEFAULT 'draft'::text NOT NULL,
    submitted_at timestamp with time zone,
    approved_at timestamp with time zone,
    approved_by uuid,
    archived_at timestamp with time zone,
    archived_reason text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    image_generated boolean DEFAULT false NOT NULL,
    image_gen_status text,
    image_gen_error text,
    image_gen_retries integer DEFAULT 0 NOT NULL,
    CONSTRAINT volunteer_requests_archived_reason_check CHECK ((archived_reason = ANY (ARRAY['manual'::text, 'expired'::text, 'fulfilled'::text]))),
    CONSTRAINT volunteer_requests_deadline_date_required CHECK (((deadline_type <> 'date_specific'::text) OR (deadline_date IS NOT NULL))),
    CONSTRAINT volunteer_requests_deadline_type_check CHECK ((deadline_type = ANY (ARRAY['date_specific'::text, 'until_fulfilled'::text, 'ongoing'::text]))),
    CONSTRAINT volunteer_requests_image_gen_status_check CHECK ((image_gen_status = ANY (ARRAY['pending'::text, 'succeeded'::text, 'failed'::text]))),
    CONSTRAINT volunteer_requests_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'pending'::text, 'active'::text, 'archived'::text])))
);

ALTER TABLE ONLY public.volunteer_requests FORCE ROW LEVEL SECURITY;


--
-- Name: volunteer_signups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.volunteer_signups (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    legacy_wix_id text,
    person_id uuid NOT NULL,
    volunteer_request_id uuid NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.volunteer_signups FORCE ROW LEVEL SECURITY;


--
-- Name: account account_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account
    ADD CONSTRAINT account_pkey PRIMARY KEY (id);


--
-- Name: approval_events approval_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approval_events
    ADD CONSTRAINT approval_events_pkey PRIMARY KEY (id);


--
-- Name: digest_exclusions digest_exclusions_need_type_need_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.digest_exclusions
    ADD CONSTRAINT digest_exclusions_need_type_need_id_key UNIQUE (need_type, need_id);


--
-- Name: digest_exclusions digest_exclusions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.digest_exclusions
    ADD CONSTRAINT digest_exclusions_pkey PRIMARY KEY (id);


--
-- Name: digest_runs digest_runs_occurrence_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.digest_runs
    ADD CONSTRAINT digest_runs_occurrence_key_key UNIQUE (occurrence_key);


--
-- Name: digest_runs digest_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.digest_runs
    ADD CONSTRAINT digest_runs_pkey PRIMARY KEY (id);


--
-- Name: digest_subscribers digest_subscribers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.digest_subscribers
    ADD CONSTRAINT digest_subscribers_pkey PRIMARY KEY (id);


--
-- Name: email_log email_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_log
    ADD CONSTRAINT email_log_pkey PRIMARY KEY (id);


--
-- Name: email_schedules email_schedules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_schedules
    ADD CONSTRAINT email_schedules_pkey PRIMARY KEY (template_key);


--
-- Name: email_template_overrides email_template_overrides_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_template_overrides
    ADD CONSTRAINT email_template_overrides_pkey PRIMARY KEY (template_key);


--
-- Name: item_pledge_lines item_pledge_lines_item_pledge_id_item_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_pledge_lines
    ADD CONSTRAINT item_pledge_lines_item_pledge_id_item_id_key UNIQUE (item_pledge_id, item_id);


--
-- Name: item_pledge_lines item_pledge_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_pledge_lines
    ADD CONSTRAINT item_pledge_lines_pkey PRIMARY KEY (id);


--
-- Name: item_pledges item_pledges_legacy_wix_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_pledges
    ADD CONSTRAINT item_pledges_legacy_wix_id_key UNIQUE (legacy_wix_id);


--
-- Name: item_pledges item_pledges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_pledges
    ADD CONSTRAINT item_pledges_pkey PRIMARY KEY (id);


--
-- Name: item_requests item_requests_legacy_wix_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_requests
    ADD CONSTRAINT item_requests_legacy_wix_id_key UNIQUE (legacy_wix_id);


--
-- Name: item_requests item_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_requests
    ADD CONSTRAINT item_requests_pkey PRIMARY KEY (id);


--
-- Name: items items_id_item_request_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.items
    ADD CONSTRAINT items_id_item_request_id_key UNIQUE (id, item_request_id);


--
-- Name: items items_legacy_wix_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.items
    ADD CONSTRAINT items_legacy_wix_id_key UNIQUE (legacy_wix_id);


--
-- Name: items items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.items
    ADD CONSTRAINT items_pkey PRIMARY KEY (id);


--
-- Name: org_memberships org_memberships_org_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_memberships
    ADD CONSTRAINT org_memberships_org_id_user_id_key UNIQUE (org_id, user_id);


--
-- Name: org_memberships org_memberships_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_memberships
    ADD CONSTRAINT org_memberships_pkey PRIMARY KEY (id);


--
-- Name: organization_populations organization_populations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_populations
    ADD CONSTRAINT organization_populations_pkey PRIMARY KEY (org_id, population_id);


--
-- Name: organizations organizations_legacy_wix_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_legacy_wix_id_key UNIQUE (legacy_wix_id);


--
-- Name: organizations organizations_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_name_key UNIQUE (name);


--
-- Name: organizations organizations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_pkey PRIMARY KEY (id);


--
-- Name: organizations organizations_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_slug_key UNIQUE (slug);


--
-- Name: people people_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.people
    ADD CONSTRAINT people_pkey PRIMARY KEY (id);


--
-- Name: person_volunteer_interests person_volunteer_interests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.person_volunteer_interests
    ADD CONSTRAINT person_volunteer_interests_pkey PRIMARY KEY (person_id, category_id);


--
-- Name: populations populations_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.populations
    ADD CONSTRAINT populations_name_key UNIQUE (name);


--
-- Name: populations populations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.populations
    ADD CONSTRAINT populations_pkey PRIMARY KEY (id);


--
-- Name: populations populations_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.populations
    ADD CONSTRAINT populations_slug_key UNIQUE (slug);


--
-- Name: request_engagement_events request_engagement_events_client_event_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.request_engagement_events
    ADD CONSTRAINT request_engagement_events_client_event_id_key UNIQUE (client_event_id);


--
-- Name: request_engagement_events request_engagement_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.request_engagement_events
    ADD CONSTRAINT request_engagement_events_pkey PRIMARY KEY (id);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (filename);


--
-- Name: session session_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session
    ADD CONSTRAINT session_pkey PRIMARY KEY (id);


--
-- Name: session session_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session
    ADD CONSTRAINT session_token_key UNIQUE (token);


--
-- Name: user user_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."user"
    ADD CONSTRAINT user_email_key UNIQUE (email);


--
-- Name: user user_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."user"
    ADD CONSTRAINT user_pkey PRIMARY KEY (id);


--
-- Name: users users_auth_subject_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_auth_subject_key UNIQUE (auth_subject);


--
-- Name: users users_person_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_person_id_key UNIQUE (person_id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: verification verification_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.verification
    ADD CONSTRAINT verification_pkey PRIMARY KEY (id);


--
-- Name: volunteer_alert_preferences volunteer_alert_preferences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.volunteer_alert_preferences
    ADD CONSTRAINT volunteer_alert_preferences_pkey PRIMARY KEY (user_id);


--
-- Name: volunteer_alert_preferences volunteer_alert_preferences_unsubscribe_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.volunteer_alert_preferences
    ADD CONSTRAINT volunteer_alert_preferences_unsubscribe_token_key UNIQUE (unsubscribe_token);


--
-- Name: volunteer_categories volunteer_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.volunteer_categories
    ADD CONSTRAINT volunteer_categories_pkey PRIMARY KEY (id);


--
-- Name: volunteer_match_alert_claims volunteer_match_alert_claims_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.volunteer_match_alert_claims
    ADD CONSTRAINT volunteer_match_alert_claims_pkey PRIMARY KEY (volunteer_request_id, user_id);


--
-- Name: volunteer_request_categories volunteer_request_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.volunteer_request_categories
    ADD CONSTRAINT volunteer_request_categories_pkey PRIMARY KEY (volunteer_request_id, category_id);


--
-- Name: volunteer_requests volunteer_requests_legacy_wix_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.volunteer_requests
    ADD CONSTRAINT volunteer_requests_legacy_wix_id_key UNIQUE (legacy_wix_id);


--
-- Name: volunteer_requests volunteer_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.volunteer_requests
    ADD CONSTRAINT volunteer_requests_pkey PRIMARY KEY (id);


--
-- Name: volunteer_roles volunteer_roles_id_volunteer_request_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.volunteer_roles
    ADD CONSTRAINT volunteer_roles_id_volunteer_request_id_key UNIQUE (id, volunteer_request_id);


--
-- Name: volunteer_roles volunteer_roles_legacy_wix_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.volunteer_roles
    ADD CONSTRAINT volunteer_roles_legacy_wix_id_key UNIQUE (legacy_wix_id);


--
-- Name: volunteer_roles volunteer_roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.volunteer_roles
    ADD CONSTRAINT volunteer_roles_pkey PRIMARY KEY (id);


--
-- Name: volunteer_signup_roles volunteer_signup_roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.volunteer_signup_roles
    ADD CONSTRAINT volunteer_signup_roles_pkey PRIMARY KEY (id);


--
-- Name: volunteer_signup_roles volunteer_signup_roles_volunteer_signup_id_volunteer_role_i_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.volunteer_signup_roles
    ADD CONSTRAINT volunteer_signup_roles_volunteer_signup_id_volunteer_role_i_key UNIQUE (volunteer_signup_id, volunteer_role_id);


--
-- Name: volunteer_signups volunteer_signups_legacy_wix_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.volunteer_signups
    ADD CONSTRAINT volunteer_signups_legacy_wix_id_key UNIQUE (legacy_wix_id);


--
-- Name: volunteer_signups volunteer_signups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.volunteer_signups
    ADD CONSTRAINT volunteer_signups_pkey PRIMARY KEY (id);


--
-- Name: account_userId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "account_userId_idx" ON public.account USING btree ("userId");


--
-- Name: approval_events_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX approval_events_created_idx ON public.approval_events USING btree (created_at DESC);


--
-- Name: approval_events_entity_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX approval_events_entity_idx ON public.approval_events USING btree (entity_type, entity_id, created_at DESC);


--
-- Name: digest_subscribers_email_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX digest_subscribers_email_key ON public.digest_subscribers USING btree (lower(email));


--
-- Name: digest_subscribers_token_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX digest_subscribers_token_key ON public.digest_subscribers USING btree (unsubscribe_token);


--
-- Name: email_log_entity_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX email_log_entity_idx ON public.email_log USING btree (entity_type, entity_id);


--
-- Name: email_log_once_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX email_log_once_idx ON public.email_log USING btree (template_key, entity_type, entity_id, lower(to_email)) WHERE ((entity_id IS NOT NULL) AND (status <> ALL (ARRAY['failed'::text, 'skipped'::text])));


--
-- Name: email_log_resend_of_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX email_log_resend_of_idx ON public.email_log USING btree (resend_of_id) WHERE (resend_of_id IS NOT NULL);


--
-- Name: email_log_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX email_log_status_idx ON public.email_log USING btree (status, created_at DESC);


--
-- Name: item_pledge_lines_item_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX item_pledge_lines_item_idx ON public.item_pledge_lines USING btree (item_id);


--
-- Name: item_pledges_person_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX item_pledges_person_idx ON public.item_pledges USING btree (person_id);


--
-- Name: item_pledges_request_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX item_pledges_request_idx ON public.item_pledges USING btree (item_request_id);


--
-- Name: item_requests_org_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX item_requests_org_idx ON public.item_requests USING btree (org_id);


--
-- Name: item_requests_public_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX item_requests_public_idx ON public.item_requests USING btree (status, created_at DESC) WHERE (status = 'active'::text);


--
-- Name: items_request_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX items_request_idx ON public.items USING btree (item_request_id, sort_order);


--
-- Name: org_memberships_org_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX org_memberships_org_idx ON public.org_memberships USING btree (org_id) WHERE (status = 'active'::text);


--
-- Name: org_memberships_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX org_memberships_user_idx ON public.org_memberships USING btree (user_id) WHERE (status = 'active'::text);


--
-- Name: organizations_kind_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX organizations_kind_status_idx ON public.organizations USING btree (kind, status);


--
-- Name: people_email_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX people_email_key ON public.people USING btree (lower(email));


--
-- Name: people_needs_review_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX people_needs_review_idx ON public.people USING btree (needs_review) WHERE needs_review;


--
-- Name: person_volunteer_interests_category_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX person_volunteer_interests_category_idx ON public.person_volunteer_interests USING btree (category_id);


--
-- Name: request_engagement_item_reporting_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX request_engagement_item_reporting_idx ON public.request_engagement_events USING btree (item_request_id, created_at DESC) WHERE (item_request_id IS NOT NULL);


--
-- Name: request_engagement_type_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX request_engagement_type_created_idx ON public.request_engagement_events USING btree (event_type, created_at DESC);


--
-- Name: request_engagement_user_history_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX request_engagement_user_history_idx ON public.request_engagement_events USING btree (user_id, created_at DESC) WHERE ((user_id IS NOT NULL) AND (event_type = 'detail_view'::text));


--
-- Name: request_engagement_volunteer_reporting_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX request_engagement_volunteer_reporting_idx ON public.request_engagement_events USING btree (volunteer_request_id, created_at DESC) WHERE (volunteer_request_id IS NOT NULL);


--
-- Name: session_userId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "session_userId_idx" ON public.session USING btree ("userId");


--
-- Name: verification_identifier_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX verification_identifier_idx ON public.verification USING btree (identifier);


--
-- Name: volunteer_categories_name_ci_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX volunteer_categories_name_ci_key ON public.volunteer_categories USING btree (lower(btrim(name)));


--
-- Name: volunteer_match_alert_claims_email_once_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX volunteer_match_alert_claims_email_once_idx ON public.volunteer_match_alert_claims USING btree (volunteer_request_id, lower(btrim(to_email)));


--
-- Name: volunteer_request_categories_category_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX volunteer_request_categories_category_idx ON public.volunteer_request_categories USING btree (category_id);


--
-- Name: volunteer_requests_org_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX volunteer_requests_org_idx ON public.volunteer_requests USING btree (org_id);


--
-- Name: volunteer_requests_public_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX volunteer_requests_public_idx ON public.volunteer_requests USING btree (status, created_at DESC) WHERE (status = 'active'::text);


--
-- Name: volunteer_roles_request_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX volunteer_roles_request_idx ON public.volunteer_roles USING btree (volunteer_request_id, sort_order);


--
-- Name: volunteer_signup_roles_role_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX volunteer_signup_roles_role_idx ON public.volunteer_signup_roles USING btree (volunteer_role_id);


--
-- Name: volunteer_signups_person_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX volunteer_signups_person_idx ON public.volunteer_signups USING btree (person_id);


--
-- Name: volunteer_signups_request_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX volunteer_signups_request_idx ON public.volunteer_signups USING btree (volunteer_request_id);


--
-- Name: item_pledges item_pledges_reject_expired_request; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER item_pledges_reject_expired_request BEFORE INSERT ON public.item_pledges FOR EACH ROW EXECUTE FUNCTION public.reject_expired_item_pledge();


--
-- Name: item_pledges item_pledges_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER item_pledges_set_updated_at BEFORE UPDATE ON public.item_pledges FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: item_requests item_requests_guard_member_transitions; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER item_requests_guard_member_transitions BEFORE UPDATE ON public.item_requests FOR EACH ROW EXECUTE FUNCTION public.guard_member_request_transitions('item_request');


--
-- Name: item_requests item_requests_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER item_requests_set_updated_at BEFORE UPDATE ON public.item_requests FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: items items_guard_counters; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER items_guard_counters BEFORE UPDATE ON public.items FOR EACH ROW EXECUTE FUNCTION public.guard_counter_columns();


--
-- Name: items items_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER items_set_updated_at BEFORE UPDATE ON public.items FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: org_memberships org_memberships_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER org_memberships_set_updated_at BEFORE UPDATE ON public.org_memberships FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: organizations organizations_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER organizations_set_updated_at BEFORE UPDATE ON public.organizations FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: people people_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER people_set_updated_at BEFORE UPDATE ON public.people FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: users users_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER users_set_updated_at BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: volunteer_alert_preferences volunteer_alert_preferences_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER volunteer_alert_preferences_set_updated_at BEFORE UPDATE ON public.volunteer_alert_preferences FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: volunteer_requests volunteer_requests_guard_member_transitions; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER volunteer_requests_guard_member_transitions BEFORE UPDATE ON public.volunteer_requests FOR EACH ROW EXECUTE FUNCTION public.guard_member_request_transitions('volunteer_request');


--
-- Name: volunteer_requests volunteer_requests_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER volunteer_requests_set_updated_at BEFORE UPDATE ON public.volunteer_requests FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: volunteer_roles volunteer_roles_guard_counters; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER volunteer_roles_guard_counters BEFORE UPDATE ON public.volunteer_roles FOR EACH ROW EXECUTE FUNCTION public.guard_counter_columns();


--
-- Name: volunteer_roles volunteer_roles_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER volunteer_roles_set_updated_at BEFORE UPDATE ON public.volunteer_roles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: volunteer_signups volunteer_signups_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER volunteer_signups_set_updated_at BEFORE UPDATE ON public.volunteer_signups FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: account account_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account
    ADD CONSTRAINT "account_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."user"(id) ON DELETE CASCADE;


--
-- Name: approval_events approval_events_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approval_events
    ADD CONSTRAINT approval_events_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES public.users(id);


--
-- Name: digest_exclusions digest_exclusions_excluded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.digest_exclusions
    ADD CONSTRAINT digest_exclusions_excluded_by_fkey FOREIGN KEY (excluded_by) REFERENCES public.users(id);


--
-- Name: digest_subscribers digest_subscribers_person_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.digest_subscribers
    ADD CONSTRAINT digest_subscribers_person_id_fkey FOREIGN KEY (person_id) REFERENCES public.people(id);


--
-- Name: email_log email_log_resend_of_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_log
    ADD CONSTRAINT email_log_resend_of_id_fkey FOREIGN KEY (resend_of_id) REFERENCES public.email_log(id);


--
-- Name: email_log email_log_to_person_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_log
    ADD CONSTRAINT email_log_to_person_id_fkey FOREIGN KEY (to_person_id) REFERENCES public.people(id);


--
-- Name: email_schedules email_schedules_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_schedules
    ADD CONSTRAINT email_schedules_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id);


--
-- Name: email_template_overrides email_template_overrides_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_template_overrides
    ADD CONSTRAINT email_template_overrides_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id);


--
-- Name: item_pledge_lines item_pledge_lines_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_pledge_lines
    ADD CONSTRAINT item_pledge_lines_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.items(id);


--
-- Name: item_pledge_lines item_pledge_lines_item_pledge_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_pledge_lines
    ADD CONSTRAINT item_pledge_lines_item_pledge_id_fkey FOREIGN KEY (item_pledge_id) REFERENCES public.item_pledges(id) ON DELETE CASCADE;


--
-- Name: item_pledges item_pledges_item_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_pledges
    ADD CONSTRAINT item_pledges_item_request_id_fkey FOREIGN KEY (item_request_id) REFERENCES public.item_requests(id);


--
-- Name: item_pledges item_pledges_person_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_pledges
    ADD CONSTRAINT item_pledges_person_id_fkey FOREIGN KEY (person_id) REFERENCES public.people(id);


--
-- Name: item_requests item_requests_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_requests
    ADD CONSTRAINT item_requests_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.users(id);


--
-- Name: item_requests item_requests_contact_person_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_requests
    ADD CONSTRAINT item_requests_contact_person_id_fkey FOREIGN KEY (contact_person_id) REFERENCES public.people(id);


--
-- Name: item_requests item_requests_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_requests
    ADD CONSTRAINT item_requests_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: item_requests item_requests_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_requests
    ADD CONSTRAINT item_requests_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id);


--
-- Name: items items_item_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.items
    ADD CONSTRAINT items_item_request_id_fkey FOREIGN KEY (item_request_id) REFERENCES public.item_requests(id) ON DELETE CASCADE;


--
-- Name: org_memberships org_memberships_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_memberships
    ADD CONSTRAINT org_memberships_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.users(id);


--
-- Name: org_memberships org_memberships_invited_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_memberships
    ADD CONSTRAINT org_memberships_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES public.users(id);


--
-- Name: org_memberships org_memberships_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_memberships
    ADD CONSTRAINT org_memberships_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: org_memberships org_memberships_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_memberships
    ADD CONSTRAINT org_memberships_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: organization_populations organization_populations_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_populations
    ADD CONSTRAINT organization_populations_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: organization_populations organization_populations_population_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_populations
    ADD CONSTRAINT organization_populations_population_id_fkey FOREIGN KEY (population_id) REFERENCES public.populations(id);


--
-- Name: organizations organizations_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.users(id);


--
-- Name: organizations organizations_primary_contact_person_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_primary_contact_person_id_fkey FOREIGN KEY (primary_contact_person_id) REFERENCES public.people(id);


--
-- Name: person_volunteer_interests person_volunteer_interests_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.person_volunteer_interests
    ADD CONSTRAINT person_volunteer_interests_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.volunteer_categories(id);


--
-- Name: person_volunteer_interests person_volunteer_interests_person_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.person_volunteer_interests
    ADD CONSTRAINT person_volunteer_interests_person_id_fkey FOREIGN KEY (person_id) REFERENCES public.people(id) ON DELETE CASCADE;


--
-- Name: request_engagement_events request_engagement_events_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.request_engagement_events
    ADD CONSTRAINT request_engagement_events_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.items(id) ON DELETE CASCADE;


--
-- Name: request_engagement_events request_engagement_events_item_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.request_engagement_events
    ADD CONSTRAINT request_engagement_events_item_request_id_fkey FOREIGN KEY (item_request_id) REFERENCES public.item_requests(id) ON DELETE CASCADE;


--
-- Name: request_engagement_events request_engagement_events_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.request_engagement_events
    ADD CONSTRAINT request_engagement_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: request_engagement_events request_engagement_events_volunteer_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.request_engagement_events
    ADD CONSTRAINT request_engagement_events_volunteer_request_id_fkey FOREIGN KEY (volunteer_request_id) REFERENCES public.volunteer_requests(id) ON DELETE CASCADE;


--
-- Name: request_engagement_events request_engagement_events_volunteer_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.request_engagement_events
    ADD CONSTRAINT request_engagement_events_volunteer_role_id_fkey FOREIGN KEY (volunteer_role_id) REFERENCES public.volunteer_roles(id) ON DELETE CASCADE;


--
-- Name: request_engagement_events request_engagement_item_ownership_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.request_engagement_events
    ADD CONSTRAINT request_engagement_item_ownership_fk FOREIGN KEY (item_id, item_request_id) REFERENCES public.items(id, item_request_id) ON DELETE CASCADE;


--
-- Name: request_engagement_events request_engagement_role_ownership_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.request_engagement_events
    ADD CONSTRAINT request_engagement_role_ownership_fk FOREIGN KEY (volunteer_role_id, volunteer_request_id) REFERENCES public.volunteer_roles(id, volunteer_request_id) ON DELETE CASCADE;


--
-- Name: session session_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session
    ADD CONSTRAINT "session_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."user"(id) ON DELETE CASCADE;


--
-- Name: users users_person_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_person_id_fkey FOREIGN KEY (person_id) REFERENCES public.people(id);


--
-- Name: volunteer_alert_preferences volunteer_alert_preferences_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.volunteer_alert_preferences
    ADD CONSTRAINT volunteer_alert_preferences_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: volunteer_match_alert_claims volunteer_match_alert_claims_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.volunteer_match_alert_claims
    ADD CONSTRAINT volunteer_match_alert_claims_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: volunteer_match_alert_claims volunteer_match_alert_claims_volunteer_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.volunteer_match_alert_claims
    ADD CONSTRAINT volunteer_match_alert_claims_volunteer_request_id_fkey FOREIGN KEY (volunteer_request_id) REFERENCES public.volunteer_requests(id) ON DELETE CASCADE;


--
-- Name: volunteer_request_categories volunteer_request_categories_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.volunteer_request_categories
    ADD CONSTRAINT volunteer_request_categories_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.volunteer_categories(id);


--
-- Name: volunteer_request_categories volunteer_request_categories_volunteer_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.volunteer_request_categories
    ADD CONSTRAINT volunteer_request_categories_volunteer_request_id_fkey FOREIGN KEY (volunteer_request_id) REFERENCES public.volunteer_requests(id) ON DELETE CASCADE;


--
-- Name: volunteer_requests volunteer_requests_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.volunteer_requests
    ADD CONSTRAINT volunteer_requests_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.users(id);


--
-- Name: volunteer_requests volunteer_requests_contact_person_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.volunteer_requests
    ADD CONSTRAINT volunteer_requests_contact_person_id_fkey FOREIGN KEY (contact_person_id) REFERENCES public.people(id);


--
-- Name: volunteer_requests volunteer_requests_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.volunteer_requests
    ADD CONSTRAINT volunteer_requests_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: volunteer_requests volunteer_requests_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.volunteer_requests
    ADD CONSTRAINT volunteer_requests_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id);


--
-- Name: volunteer_roles volunteer_roles_volunteer_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.volunteer_roles
    ADD CONSTRAINT volunteer_roles_volunteer_request_id_fkey FOREIGN KEY (volunteer_request_id) REFERENCES public.volunteer_requests(id) ON DELETE CASCADE;


--
-- Name: volunteer_signup_roles volunteer_signup_roles_volunteer_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.volunteer_signup_roles
    ADD CONSTRAINT volunteer_signup_roles_volunteer_role_id_fkey FOREIGN KEY (volunteer_role_id) REFERENCES public.volunteer_roles(id);


--
-- Name: volunteer_signup_roles volunteer_signup_roles_volunteer_signup_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.volunteer_signup_roles
    ADD CONSTRAINT volunteer_signup_roles_volunteer_signup_id_fkey FOREIGN KEY (volunteer_signup_id) REFERENCES public.volunteer_signups(id) ON DELETE CASCADE;


--
-- Name: volunteer_signups volunteer_signups_person_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.volunteer_signups
    ADD CONSTRAINT volunteer_signups_person_id_fkey FOREIGN KEY (person_id) REFERENCES public.people(id);


--
-- Name: volunteer_signups volunteer_signups_volunteer_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.volunteer_signups
    ADD CONSTRAINT volunteer_signups_volunteer_request_id_fkey FOREIGN KEY (volunteer_request_id) REFERENCES public.volunteer_requests(id);


--
-- Name: approval_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.approval_events ENABLE ROW LEVEL SECURITY;

--
-- Name: approval_events approval_events_member_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY approval_events_member_insert ON public.approval_events FOR INSERT WITH CHECK (((current_setting('app.context'::text, true) = 'member'::text) AND (entity_type = ANY (ARRAY['item_request'::text, 'volunteer_request'::text]))));


--
-- Name: approval_events approval_events_system_staff_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY approval_events_system_staff_all ON public.approval_events USING ((current_setting('app.context'::text, true) = ANY (ARRAY['system'::text, 'staff'::text]))) WITH CHECK ((current_setting('app.context'::text, true) = ANY (ARRAY['system'::text, 'staff'::text])));


--
-- Name: digest_exclusions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.digest_exclusions ENABLE ROW LEVEL SECURITY;

--
-- Name: digest_exclusions digest_exclusions_system_staff_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY digest_exclusions_system_staff_all ON public.digest_exclusions USING ((current_setting('app.context'::text, true) = ANY (ARRAY['system'::text, 'staff'::text]))) WITH CHECK ((current_setting('app.context'::text, true) = ANY (ARRAY['system'::text, 'staff'::text])));


--
-- Name: digest_runs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.digest_runs ENABLE ROW LEVEL SECURITY;

--
-- Name: digest_runs digest_runs_system_staff_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY digest_runs_system_staff_all ON public.digest_runs USING ((current_setting('app.context'::text, true) = ANY (ARRAY['system'::text, 'staff'::text]))) WITH CHECK ((current_setting('app.context'::text, true) = ANY (ARRAY['system'::text, 'staff'::text])));


--
-- Name: digest_subscribers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.digest_subscribers ENABLE ROW LEVEL SECURITY;

--
-- Name: digest_subscribers digest_subscribers_system_staff_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY digest_subscribers_system_staff_all ON public.digest_subscribers USING ((current_setting('app.context'::text, true) = ANY (ARRAY['system'::text, 'staff'::text]))) WITH CHECK ((current_setting('app.context'::text, true) = ANY (ARRAY['system'::text, 'staff'::text])));


--
-- Name: email_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.email_log ENABLE ROW LEVEL SECURITY;

--
-- Name: email_log email_log_system_staff_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY email_log_system_staff_all ON public.email_log USING ((current_setting('app.context'::text, true) = ANY (ARRAY['system'::text, 'staff'::text]))) WITH CHECK ((current_setting('app.context'::text, true) = ANY (ARRAY['system'::text, 'staff'::text])));


--
-- Name: email_schedules; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.email_schedules ENABLE ROW LEVEL SECURITY;

--
-- Name: email_schedules email_schedules_system_staff_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY email_schedules_system_staff_all ON public.email_schedules USING ((current_setting('app.context'::text, true) = ANY (ARRAY['system'::text, 'staff'::text]))) WITH CHECK ((current_setting('app.context'::text, true) = ANY (ARRAY['system'::text, 'staff'::text])));


--
-- Name: email_template_overrides; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.email_template_overrides ENABLE ROW LEVEL SECURITY;

--
-- Name: email_template_overrides email_template_overrides_system_staff_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY email_template_overrides_system_staff_all ON public.email_template_overrides USING ((current_setting('app.context'::text, true) = ANY (ARRAY['system'::text, 'staff'::text]))) WITH CHECK ((current_setting('app.context'::text, true) = ANY (ARRAY['system'::text, 'staff'::text])));


--
-- Name: item_pledge_lines; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.item_pledge_lines ENABLE ROW LEVEL SECURITY;

--
-- Name: item_pledge_lines item_pledge_lines_member_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY item_pledge_lines_member_select ON public.item_pledge_lines FOR SELECT USING (((current_setting('app.context'::text, true) = 'member'::text) AND (item_pledge_id IN ( SELECT ip.id
   FROM (public.item_pledges ip
     JOIN public.item_requests r ON ((r.id = ip.item_request_id)))
  WHERE (r.org_id IN ( SELECT om.org_id
           FROM public.org_memberships om
          WHERE ((om.user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) AND (om.status = 'active'::text))))))));


--
-- Name: item_pledge_lines item_pledge_lines_system_staff_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY item_pledge_lines_system_staff_all ON public.item_pledge_lines USING ((current_setting('app.context'::text, true) = ANY (ARRAY['system'::text, 'staff'::text]))) WITH CHECK ((current_setting('app.context'::text, true) = ANY (ARRAY['system'::text, 'staff'::text])));


--
-- Name: item_pledges; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.item_pledges ENABLE ROW LEVEL SECURITY;

--
-- Name: item_pledges item_pledges_member_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY item_pledges_member_select ON public.item_pledges FOR SELECT USING (((current_setting('app.context'::text, true) = 'member'::text) AND (item_request_id IN ( SELECT r.id
   FROM public.item_requests r
  WHERE (r.org_id IN ( SELECT om.org_id
           FROM public.org_memberships om
          WHERE ((om.user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) AND (om.status = 'active'::text))))))));


--
-- Name: item_pledges item_pledges_system_staff_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY item_pledges_system_staff_all ON public.item_pledges USING ((current_setting('app.context'::text, true) = ANY (ARRAY['system'::text, 'staff'::text]))) WITH CHECK ((current_setting('app.context'::text, true) = ANY (ARRAY['system'::text, 'staff'::text])));


--
-- Name: item_requests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.item_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: item_requests item_requests_member_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY item_requests_member_insert ON public.item_requests FOR INSERT WITH CHECK (((current_setting('app.context'::text, true) = 'member'::text) AND (status = 'draft'::text) AND (org_id IN ( SELECT om.org_id
   FROM public.org_memberships om
  WHERE ((om.user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) AND (om.status = 'active'::text))))));


--
-- Name: item_requests item_requests_member_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY item_requests_member_select ON public.item_requests FOR SELECT USING (((current_setting('app.context'::text, true) = 'member'::text) AND (org_id IN ( SELECT om.org_id
   FROM public.org_memberships om
  WHERE ((om.user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) AND (om.status = 'active'::text))))));


--
-- Name: item_requests item_requests_member_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY item_requests_member_update ON public.item_requests FOR UPDATE USING (((current_setting('app.context'::text, true) = 'member'::text) AND (org_id IN ( SELECT om.org_id
   FROM public.org_memberships om
  WHERE ((om.user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) AND (om.status = 'active'::text)))))) WITH CHECK (((current_setting('app.context'::text, true) = 'member'::text) AND (org_id IN ( SELECT om.org_id
   FROM public.org_memberships om
  WHERE ((om.user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) AND (om.status = 'active'::text))))));


--
-- Name: item_requests item_requests_public_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY item_requests_public_select ON public.item_requests FOR SELECT USING (((current_setting('app.context'::text, true) = 'public'::text) AND (status = ANY (ARRAY['active'::text, 'archived'::text])) AND (org_id IN ( SELECT o.id
   FROM public.organizations o
  WHERE ((o.kind = 'member_org'::text) AND (o.status = 'approved'::text))))));


--
-- Name: item_requests item_requests_system_staff_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY item_requests_system_staff_all ON public.item_requests USING ((current_setting('app.context'::text, true) = ANY (ARRAY['system'::text, 'staff'::text]))) WITH CHECK ((current_setting('app.context'::text, true) = ANY (ARRAY['system'::text, 'staff'::text])));


--
-- Name: items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.items ENABLE ROW LEVEL SECURITY;

--
-- Name: items items_member_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY items_member_all ON public.items USING (((current_setting('app.context'::text, true) = 'member'::text) AND (item_request_id IN ( SELECT r.id
   FROM public.item_requests r
  WHERE (r.org_id IN ( SELECT om.org_id
           FROM public.org_memberships om
          WHERE ((om.user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) AND (om.status = 'active'::text)))))))) WITH CHECK (((current_setting('app.context'::text, true) = 'member'::text) AND (item_request_id IN ( SELECT r.id
   FROM public.item_requests r
  WHERE (r.org_id IN ( SELECT om.org_id
           FROM public.org_memberships om
          WHERE ((om.user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) AND (om.status = 'active'::text))))))));


--
-- Name: items items_public_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY items_public_select ON public.items FOR SELECT USING (((current_setting('app.context'::text, true) = 'public'::text) AND (EXISTS ( SELECT 1
   FROM (public.item_requests r
     JOIN public.organizations o ON ((o.id = r.org_id)))
  WHERE ((r.id = items.item_request_id) AND (r.status = ANY (ARRAY['active'::text, 'archived'::text])) AND (o.kind = 'member_org'::text) AND (o.status = 'approved'::text))))));


--
-- Name: items items_system_staff_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY items_system_staff_all ON public.items USING ((current_setting('app.context'::text, true) = ANY (ARRAY['system'::text, 'staff'::text]))) WITH CHECK ((current_setting('app.context'::text, true) = ANY (ARRAY['system'::text, 'staff'::text])));


--
-- Name: org_memberships; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.org_memberships ENABLE ROW LEVEL SECURITY;

--
-- Name: org_memberships org_memberships_member_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY org_memberships_member_select_own ON public.org_memberships FOR SELECT USING (((current_setting('app.context'::text, true) = 'member'::text) AND (user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid)));


--
-- Name: org_memberships org_memberships_system_staff_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY org_memberships_system_staff_all ON public.org_memberships USING ((current_setting('app.context'::text, true) = ANY (ARRAY['system'::text, 'staff'::text]))) WITH CHECK ((current_setting('app.context'::text, true) = ANY (ARRAY['system'::text, 'staff'::text])));


--
-- Name: organization_populations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.organization_populations ENABLE ROW LEVEL SECURITY;

--
-- Name: organization_populations organization_populations_public_member_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY organization_populations_public_member_select ON public.organization_populations FOR SELECT USING (((current_setting('app.context'::text, true) = ANY (ARRAY['public'::text, 'member'::text])) AND (EXISTS ( SELECT 1
   FROM public.organizations o
  WHERE ((o.id = organization_populations.org_id) AND (o.kind = 'member_org'::text) AND (o.status = 'approved'::text))))));


--
-- Name: organization_populations organization_populations_system_staff_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY organization_populations_system_staff_all ON public.organization_populations USING ((current_setting('app.context'::text, true) = ANY (ARRAY['system'::text, 'staff'::text]))) WITH CHECK ((current_setting('app.context'::text, true) = ANY (ARRAY['system'::text, 'staff'::text])));


--
-- Name: organizations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

--
-- Name: organizations organizations_member_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY organizations_member_select ON public.organizations FOR SELECT USING (((current_setting('app.context'::text, true) = 'member'::text) AND ((id IN ( SELECT om.org_id
   FROM public.org_memberships om
  WHERE ((om.user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) AND (om.status = 'active'::text)))) OR ((kind = 'member_org'::text) AND (status = 'approved'::text)))));


--
-- Name: organizations organizations_member_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY organizations_member_update ON public.organizations FOR UPDATE USING (((current_setting('app.context'::text, true) = 'member'::text) AND (id IN ( SELECT om.org_id
   FROM public.org_memberships om
  WHERE ((om.user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) AND (om.status = 'active'::text)))))) WITH CHECK (((current_setting('app.context'::text, true) = 'member'::text) AND (id IN ( SELECT om.org_id
   FROM public.org_memberships om
  WHERE ((om.user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) AND (om.status = 'active'::text))))));


--
-- Name: organizations organizations_public_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY organizations_public_select ON public.organizations FOR SELECT USING (((current_setting('app.context'::text, true) = 'public'::text) AND (kind = 'member_org'::text) AND (status = 'approved'::text)));


--
-- Name: organizations organizations_system_staff_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY organizations_system_staff_all ON public.organizations USING ((current_setting('app.context'::text, true) = ANY (ARRAY['system'::text, 'staff'::text]))) WITH CHECK ((current_setting('app.context'::text, true) = ANY (ARRAY['system'::text, 'staff'::text])));


--
-- Name: people; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.people ENABLE ROW LEVEL SECURITY;

--
-- Name: people people_member_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY people_member_select ON public.people FOR SELECT USING (((current_setting('app.context'::text, true) = 'member'::text) AND ((EXISTS ( SELECT 1
   FROM (public.item_pledges ip
     JOIN public.item_requests ir ON ((ir.id = ip.item_request_id)))
  WHERE ((ip.person_id = people.id) AND (ir.org_id IN ( SELECT om.org_id
           FROM public.org_memberships om
          WHERE ((om.user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) AND (om.status = 'active'::text))))))) OR (EXISTS ( SELECT 1
   FROM (public.volunteer_signups vs
     JOIN public.volunteer_requests vr ON ((vr.id = vs.volunteer_request_id)))
  WHERE ((vs.person_id = people.id) AND (vr.org_id IN ( SELECT om.org_id
           FROM public.org_memberships om
          WHERE ((om.user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) AND (om.status = 'active'::text))))))) OR (EXISTS ( SELECT 1
   FROM public.organizations o
  WHERE ((o.primary_contact_person_id = people.id) AND (o.id IN ( SELECT om.org_id
           FROM public.org_memberships om
          WHERE ((om.user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) AND (om.status = 'active'::text))))))) OR (EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.person_id = people.id) AND (u.id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid)))))));


--
-- Name: people people_system_staff_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY people_system_staff_all ON public.people USING ((current_setting('app.context'::text, true) = ANY (ARRAY['system'::text, 'staff'::text]))) WITH CHECK ((current_setting('app.context'::text, true) = ANY (ARRAY['system'::text, 'staff'::text])));


--
-- Name: person_volunteer_interests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.person_volunteer_interests ENABLE ROW LEVEL SECURITY;

--
-- Name: person_volunteer_interests person_volunteer_interests_member_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY person_volunteer_interests_member_delete ON public.person_volunteer_interests FOR DELETE USING (((current_setting('app.context'::text, true) = 'member'::text) AND (EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.person_id = person_volunteer_interests.person_id) AND (u.id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid))))));


--
-- Name: person_volunteer_interests person_volunteer_interests_member_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY person_volunteer_interests_member_insert ON public.person_volunteer_interests FOR INSERT WITH CHECK (((current_setting('app.context'::text, true) = 'member'::text) AND (EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.person_id = person_volunteer_interests.person_id) AND (u.id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid)))) AND (EXISTS ( SELECT 1
   FROM public.volunteer_categories vc
  WHERE ((vc.id = person_volunteer_interests.category_id) AND vc.is_active)))));


--
-- Name: person_volunteer_interests person_volunteer_interests_member_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY person_volunteer_interests_member_select ON public.person_volunteer_interests FOR SELECT USING (((current_setting('app.context'::text, true) = 'member'::text) AND (EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.person_id = person_volunteer_interests.person_id) AND (u.id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid))))));


--
-- Name: person_volunteer_interests person_volunteer_interests_system_staff_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY person_volunteer_interests_system_staff_all ON public.person_volunteer_interests USING ((current_setting('app.context'::text, true) = ANY (ARRAY['system'::text, 'staff'::text]))) WITH CHECK ((current_setting('app.context'::text, true) = ANY (ARRAY['system'::text, 'staff'::text])));


--
-- Name: populations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.populations ENABLE ROW LEVEL SECURITY;

--
-- Name: populations populations_public_member_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY populations_public_member_select ON public.populations FOR SELECT USING (((current_setting('app.context'::text, true) = ANY (ARRAY['public'::text, 'member'::text])) AND is_active));


--
-- Name: populations populations_system_staff_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY populations_system_staff_all ON public.populations USING ((current_setting('app.context'::text, true) = ANY (ARRAY['system'::text, 'staff'::text]))) WITH CHECK ((current_setting('app.context'::text, true) = ANY (ARRAY['system'::text, 'staff'::text])));


--
-- Name: request_engagement_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.request_engagement_events ENABLE ROW LEVEL SECURITY;

--
-- Name: request_engagement_events request_engagement_events_system_staff_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY request_engagement_events_system_staff_all ON public.request_engagement_events USING ((current_setting('app.context'::text, true) = ANY (ARRAY['system'::text, 'staff'::text]))) WITH CHECK ((current_setting('app.context'::text, true) = ANY (ARRAY['system'::text, 'staff'::text])));


--
-- Name: users; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

--
-- Name: users users_member_select_self; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY users_member_select_self ON public.users FOR SELECT USING (((current_setting('app.context'::text, true) = 'member'::text) AND (id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid)));


--
-- Name: users users_system_staff_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY users_system_staff_all ON public.users USING ((current_setting('app.context'::text, true) = ANY (ARRAY['system'::text, 'staff'::text]))) WITH CHECK ((current_setting('app.context'::text, true) = ANY (ARRAY['system'::text, 'staff'::text])));


--
-- Name: volunteer_alert_preferences; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.volunteer_alert_preferences ENABLE ROW LEVEL SECURITY;

--
-- Name: volunteer_alert_preferences volunteer_alert_preferences_member_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY volunteer_alert_preferences_member_insert ON public.volunteer_alert_preferences FOR INSERT WITH CHECK (((current_setting('app.context'::text, true) = 'member'::text) AND (user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) AND (EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = volunteer_alert_preferences.user_id) AND (u.kind = 'supporter'::text) AND (u.status = 'active'::text))))));


--
-- Name: volunteer_alert_preferences volunteer_alert_preferences_member_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY volunteer_alert_preferences_member_select ON public.volunteer_alert_preferences FOR SELECT USING (((current_setting('app.context'::text, true) = 'member'::text) AND (user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid)));


--
-- Name: volunteer_alert_preferences volunteer_alert_preferences_member_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY volunteer_alert_preferences_member_update ON public.volunteer_alert_preferences FOR UPDATE USING (((current_setting('app.context'::text, true) = 'member'::text) AND (user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid))) WITH CHECK (((current_setting('app.context'::text, true) = 'member'::text) AND (user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) AND (EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = volunteer_alert_preferences.user_id) AND (u.kind = 'supporter'::text) AND (u.status = 'active'::text))))));


--
-- Name: volunteer_alert_preferences volunteer_alert_preferences_system_staff_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY volunteer_alert_preferences_system_staff_all ON public.volunteer_alert_preferences USING ((current_setting('app.context'::text, true) = ANY (ARRAY['system'::text, 'staff'::text]))) WITH CHECK ((current_setting('app.context'::text, true) = ANY (ARRAY['system'::text, 'staff'::text])));


--
-- Name: volunteer_categories; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.volunteer_categories ENABLE ROW LEVEL SECURITY;

--
-- Name: volunteer_categories volunteer_categories_member_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY volunteer_categories_member_select ON public.volunteer_categories FOR SELECT USING ((current_setting('app.context'::text, true) = 'member'::text));


--
-- Name: volunteer_categories volunteer_categories_system_staff_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY volunteer_categories_system_staff_all ON public.volunteer_categories USING ((current_setting('app.context'::text, true) = ANY (ARRAY['system'::text, 'staff'::text]))) WITH CHECK ((current_setting('app.context'::text, true) = ANY (ARRAY['system'::text, 'staff'::text])));


--
-- Name: volunteer_match_alert_claims; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.volunteer_match_alert_claims ENABLE ROW LEVEL SECURITY;

--
-- Name: volunteer_match_alert_claims volunteer_match_alert_claims_system_staff_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY volunteer_match_alert_claims_system_staff_all ON public.volunteer_match_alert_claims USING ((current_setting('app.context'::text, true) = ANY (ARRAY['system'::text, 'staff'::text]))) WITH CHECK ((current_setting('app.context'::text, true) = ANY (ARRAY['system'::text, 'staff'::text])));


--
-- Name: volunteer_request_categories; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.volunteer_request_categories ENABLE ROW LEVEL SECURITY;

--
-- Name: volunteer_request_categories volunteer_request_categories_member_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY volunteer_request_categories_member_all ON public.volunteer_request_categories USING (((current_setting('app.context'::text, true) = 'member'::text) AND (EXISTS ( SELECT 1
   FROM public.volunteer_requests r
  WHERE ((r.id = volunteer_request_categories.volunteer_request_id) AND (r.org_id IN ( SELECT om.org_id
           FROM public.org_memberships om
          WHERE ((om.user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) AND (om.status = 'active'::text))))))))) WITH CHECK (((current_setting('app.context'::text, true) = 'member'::text) AND (EXISTS ( SELECT 1
   FROM public.volunteer_requests r
  WHERE ((r.id = volunteer_request_categories.volunteer_request_id) AND (r.org_id IN ( SELECT om.org_id
           FROM public.org_memberships om
          WHERE ((om.user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) AND (om.status = 'active'::text))))))) AND (EXISTS ( SELECT 1
   FROM public.volunteer_categories vc
  WHERE ((vc.id = volunteer_request_categories.category_id) AND vc.is_active)))));


--
-- Name: volunteer_request_categories volunteer_request_categories_system_staff_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY volunteer_request_categories_system_staff_all ON public.volunteer_request_categories USING ((current_setting('app.context'::text, true) = ANY (ARRAY['system'::text, 'staff'::text]))) WITH CHECK ((current_setting('app.context'::text, true) = ANY (ARRAY['system'::text, 'staff'::text])));


--
-- Name: volunteer_requests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.volunteer_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: volunteer_requests volunteer_requests_member_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY volunteer_requests_member_insert ON public.volunteer_requests FOR INSERT WITH CHECK (((current_setting('app.context'::text, true) = 'member'::text) AND (status = 'draft'::text) AND (org_id IN ( SELECT om.org_id
   FROM public.org_memberships om
  WHERE ((om.user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) AND (om.status = 'active'::text))))));


--
-- Name: volunteer_requests volunteer_requests_member_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY volunteer_requests_member_select ON public.volunteer_requests FOR SELECT USING (((current_setting('app.context'::text, true) = 'member'::text) AND (org_id IN ( SELECT om.org_id
   FROM public.org_memberships om
  WHERE ((om.user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) AND (om.status = 'active'::text))))));


--
-- Name: volunteer_requests volunteer_requests_member_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY volunteer_requests_member_update ON public.volunteer_requests FOR UPDATE USING (((current_setting('app.context'::text, true) = 'member'::text) AND (org_id IN ( SELECT om.org_id
   FROM public.org_memberships om
  WHERE ((om.user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) AND (om.status = 'active'::text)))))) WITH CHECK (((current_setting('app.context'::text, true) = 'member'::text) AND (org_id IN ( SELECT om.org_id
   FROM public.org_memberships om
  WHERE ((om.user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) AND (om.status = 'active'::text))))));


--
-- Name: volunteer_requests volunteer_requests_public_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY volunteer_requests_public_select ON public.volunteer_requests FOR SELECT USING (((current_setting('app.context'::text, true) = 'public'::text) AND (status = ANY (ARRAY['active'::text, 'archived'::text])) AND (org_id IN ( SELECT o.id
   FROM public.organizations o
  WHERE ((o.kind = 'member_org'::text) AND (o.status = 'approved'::text))))));


--
-- Name: volunteer_requests volunteer_requests_system_staff_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY volunteer_requests_system_staff_all ON public.volunteer_requests USING ((current_setting('app.context'::text, true) = ANY (ARRAY['system'::text, 'staff'::text]))) WITH CHECK ((current_setting('app.context'::text, true) = ANY (ARRAY['system'::text, 'staff'::text])));


--
-- Name: volunteer_roles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.volunteer_roles ENABLE ROW LEVEL SECURITY;

--
-- Name: volunteer_roles volunteer_roles_member_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY volunteer_roles_member_all ON public.volunteer_roles USING (((current_setting('app.context'::text, true) = 'member'::text) AND (volunteer_request_id IN ( SELECT r.id
   FROM public.volunteer_requests r
  WHERE (r.org_id IN ( SELECT om.org_id
           FROM public.org_memberships om
          WHERE ((om.user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) AND (om.status = 'active'::text)))))))) WITH CHECK (((current_setting('app.context'::text, true) = 'member'::text) AND (volunteer_request_id IN ( SELECT r.id
   FROM public.volunteer_requests r
  WHERE (r.org_id IN ( SELECT om.org_id
           FROM public.org_memberships om
          WHERE ((om.user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) AND (om.status = 'active'::text))))))));


--
-- Name: volunteer_roles volunteer_roles_public_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY volunteer_roles_public_select ON public.volunteer_roles FOR SELECT USING (((current_setting('app.context'::text, true) = 'public'::text) AND (EXISTS ( SELECT 1
   FROM (public.volunteer_requests r
     JOIN public.organizations o ON ((o.id = r.org_id)))
  WHERE ((r.id = volunteer_roles.volunteer_request_id) AND (r.status = ANY (ARRAY['active'::text, 'archived'::text])) AND (o.kind = 'member_org'::text) AND (o.status = 'approved'::text))))));


--
-- Name: volunteer_roles volunteer_roles_system_staff_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY volunteer_roles_system_staff_all ON public.volunteer_roles USING ((current_setting('app.context'::text, true) = ANY (ARRAY['system'::text, 'staff'::text]))) WITH CHECK ((current_setting('app.context'::text, true) = ANY (ARRAY['system'::text, 'staff'::text])));


--
-- Name: volunteer_signup_roles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.volunteer_signup_roles ENABLE ROW LEVEL SECURITY;

--
-- Name: volunteer_signup_roles volunteer_signup_roles_member_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY volunteer_signup_roles_member_select ON public.volunteer_signup_roles FOR SELECT USING (((current_setting('app.context'::text, true) = 'member'::text) AND (volunteer_signup_id IN ( SELECT vs.id
   FROM (public.volunteer_signups vs
     JOIN public.volunteer_requests r ON ((r.id = vs.volunteer_request_id)))
  WHERE (r.org_id IN ( SELECT om.org_id
           FROM public.org_memberships om
          WHERE ((om.user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) AND (om.status = 'active'::text))))))));


--
-- Name: volunteer_signup_roles volunteer_signup_roles_system_staff_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY volunteer_signup_roles_system_staff_all ON public.volunteer_signup_roles USING ((current_setting('app.context'::text, true) = ANY (ARRAY['system'::text, 'staff'::text]))) WITH CHECK ((current_setting('app.context'::text, true) = ANY (ARRAY['system'::text, 'staff'::text])));


--
-- Name: volunteer_signups; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.volunteer_signups ENABLE ROW LEVEL SECURITY;

--
-- Name: volunteer_signups volunteer_signups_member_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY volunteer_signups_member_select ON public.volunteer_signups FOR SELECT USING (((current_setting('app.context'::text, true) = 'member'::text) AND (volunteer_request_id IN ( SELECT r.id
   FROM public.volunteer_requests r
  WHERE (r.org_id IN ( SELECT om.org_id
           FROM public.org_memberships om
          WHERE ((om.user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) AND (om.status = 'active'::text))))))));


--
-- Name: volunteer_signups volunteer_signups_system_staff_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY volunteer_signups_system_staff_all ON public.volunteer_signups USING ((current_setting('app.context'::text, true) = ANY (ARRAY['system'::text, 'staff'::text]))) WITH CHECK ((current_setting('app.context'::text, true) = ANY (ARRAY['system'::text, 'staff'::text])));


--
-- PostgreSQL database dump complete
--

\unrestrict J29AItAUEIV9Mz8OUWsWRKKbb8BLbqZ7qsFdXn3WSEY4LsFMQYy0PqIyA72cmrm

