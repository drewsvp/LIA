-- Date-specific item deadlines are public availability dates, not just form
-- metadata. Keep this rule in SQL so public reads, the nightly archive pass,
-- and the pledge write path agree even at the LA midnight boundary.

create or replace function item_request_expired_on(
  p_deadline_type text,
  p_deadline_date date,
  p_expires_on date,
  p_today date
) returns boolean
language sql
immutable
as $$
  select
    (p_expires_on is not null and p_expires_on < p_today)
    or (
      p_deadline_type = 'date_specific'
      and p_deadline_date is not null
      and p_deadline_date < p_today
    );
$$;

-- Unlike now()/current_timestamp, clock_timestamp() advances during a long
-- transaction. A pledge transaction that starts before LA midnight but writes
-- after midnight must see the new calendar date.
create or replace function item_request_current_la_date() returns date
language sql
volatile
as $$
  select (clock_timestamp() at time zone 'America/Los_Angeles')::date;
$$;

-- record_item_pledge() already locks the parent before inserting its pledge.
-- Recheck availability at the actual write, rather than relying on the route's
-- preflight check, so a request cannot receive a new pledge after midnight
-- while the nightly archive job is still waiting to run.
create or replace function reject_expired_item_pledge() returns trigger as $$
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
$$ language plpgsql;

drop trigger if exists item_pledges_reject_expired_request on item_pledges;
create trigger item_pledges_reject_expired_request
  before insert on item_pledges
  for each row execute function reject_expired_item_pledge();