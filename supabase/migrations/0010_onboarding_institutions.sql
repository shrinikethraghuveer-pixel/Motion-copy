-- Columns written by the existing education step in onboarding.
alter table public.profiles
  add column if not exists school text,
  add column if not exists currently_in_educational_institution boolean,
  add column if not exists institution_id text,
  add column if not exists institution_not_listed boolean not null default false,
  add column if not exists institution_custom_name text;
