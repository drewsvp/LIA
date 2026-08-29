-- Missing transaction-local authorization settings must fail closed. PostgreSQL
-- boolean expressions involving NULL otherwise skip the trigger's IF branch.

create or replace function protect_account_email_identity()
returns trigger as $$
begin
  new.email := lower(btrim(new.email));
  if new.email = '' then
    raise exception 'people_email_empty';
  end if;

  if tg_op = 'UPDATE'
     and lower(btrim(old.email)) is distinct from new.email
     and exists (select 1 from users where person_id = old.id)
     and not (
       coalesce(current_setting('app.account_email_change_person_id', true), '') = old.id::text
       and coalesce(current_setting('app.account_email_change_email', true), '') = new.email
     ) then
    raise exception 'account_email_immutable'
      using hint = 'A linked login account must retain its email identity.';
  end if;

  return new;
end;
$$ language plpgsql;