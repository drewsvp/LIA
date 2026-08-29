-- API timestamps round-trip through JavaScript Date values at millisecond
-- precision. Keep managed participation versions at the same precision so an
-- unchanged row never appears stale because of hidden PostgreSQL microseconds.

update item_pledges set updated_at = date_trunc('milliseconds', updated_at);
update volunteer_signups set updated_at = date_trunc('milliseconds', updated_at);

create or replace function round_participation_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := date_trunc('milliseconds', new.updated_at);
  return new;
end;
$$;

drop trigger if exists zz_round_item_pledge_updated_at on item_pledges;
create trigger zz_round_item_pledge_updated_at
  before insert or update on item_pledges
  for each row execute function round_participation_updated_at();

drop trigger if exists zz_round_volunteer_signup_updated_at on volunteer_signups;
create trigger zz_round_volunteer_signup_updated_at
  before insert or update on volunteer_signups
  for each row execute function round_participation_updated_at();