-- ADMIN-10 body-block editor: add array CHECK constraint for body_blocks column
-- added in 0047. This is a separate migration so the constraint is installed on
-- existing upgraded databases that already received 0047 without the CHECK.
-- Idempotent: the DO block skips the ALTER if the constraint already exists.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'email_template_overrides_body_blocks_array'
      and conrelid = 'email_template_overrides'::regclass
  ) then
    alter table email_template_overrides
      add constraint email_template_overrides_body_blocks_array
        check (body_blocks is null or jsonb_typeof(body_blocks) = 'array');
  end if;
end;
$$;
