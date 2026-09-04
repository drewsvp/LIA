-- Runtime feature flag for OpenAI-backed request image generation.
-- Existing environments are deliberately disabled until a staff admin opts in.
alter table site_settings
  add column if not exists image_generation_enabled boolean not null default false;