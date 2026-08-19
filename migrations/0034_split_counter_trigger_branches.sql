-- The original shared trigger used `table_name = ... AND NEW.table_column`.
-- PL/pgSQL resolves the whole expression against each trigger row type before
-- evaluating AND, so item updates tried to resolve volunteer-only columns (and
-- vice versa). Keep one function, but place each table-specific field reference
-- inside its own runtime branch.
create or replace function guard_counter_columns() returns trigger as $$
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
$$ language plpgsql;