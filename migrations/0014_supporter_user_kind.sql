-- Task: supporter profiles from the public claim/volunteer forms.
-- users.kind distinguishes supporter accounts (self-service donors/volunteers,
-- no org membership) from member/staff accounts. Existing rows stay 'member'.
alter table users
  add column if not exists kind text not null default 'member';

alter table users
  drop constraint if exists users_kind_check;
alter table users
  add constraint users_kind_check check (kind in ('member', 'supporter'));
