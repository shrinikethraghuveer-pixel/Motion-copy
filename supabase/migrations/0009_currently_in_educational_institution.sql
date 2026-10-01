-- Records an explicit onboarding response without classifying existing users.
alter table public.profiles
  add column if not exists currently_in_educational_institution boolean;
