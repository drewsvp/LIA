-- Make the database use the same normalized email identity as application code.
--
-- Existing collisions are never auto-merged or guessed. The migration stops
-- before changing any row and tells operators to use the read-only account
-- email integrity report for explicit review.

do $$
declare
  collision_groups integer;
begin
  select count(*)::int
    into collision_groups
    from (
      select lower(btrim(email))
        from people
       group by lower(btrim(email))
      having count(*) > 1
    ) collisions;

  if collision_groups > 0 then
    raise exception
      'normalized people email collisions require explicit review before migration: % group(s)',
      collision_groups
      using hint = 'Review GET /api/admin/account-email-integrity; do not auto-merge or choose an address.';
  end if;
end;
$$;

-- With collisions ruled out, canonicalization changes formatting only, never
-- which address identifies the person.
update people
   set email = lower(btrim(email))
 where email is distinct from lower(btrim(email));

drop index people_email_key;
create unique index people_email_key on people (lower(btrim(email)));

create or replace function protect_account_email_identity()
returns trigger as $$
begin
  new.email := lower(btrim(new.email));
  if new.email = '' then
    raise exception 'people_email_empty';
  end if;

  if tg_op = 'UPDATE'
     and lower(btrim(old.email)) is distinct from new.email
     and exists (select 1 from users where person_id = old.id) then
    raise exception 'account_email_immutable'
      using hint = 'A linked login account must retain its email identity.';
  end if;

  return new;
end;
$$ language plpgsql;

drop trigger if exists people_protect_account_email_identity on people;
create trigger people_protect_account_email_identity
  before insert or update on people
  for each row execute function protect_account_email_identity();