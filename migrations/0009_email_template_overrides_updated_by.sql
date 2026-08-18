-- 0009_email_template_overrides_updated_by.sql
-- Track who last edited an email template override (ADMIN-10 audit trail).
-- updated_by is null for rows created before this migration (or by system
-- operations that have no acting user).

alter table email_template_overrides
  add column updated_by uuid references users(id);
