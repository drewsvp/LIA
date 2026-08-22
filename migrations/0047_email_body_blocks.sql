-- ADMIN-10 body-block editor: add body_blocks JSONB column to
-- email_template_overrides. Nullable; null = legacy paragraphs-only override.
-- No back-fill needed: null is treated as "use paragraphs array" in all read
-- paths, preserving full backward compatibility.
alter table email_template_overrides
  add column if not exists body_blocks jsonb;
