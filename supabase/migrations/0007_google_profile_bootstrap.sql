-- Ensure every new Supabase Auth user has a usable Motion profile, including
-- Google OAuth users whose metadata uses name / given_name rather than username.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  base_handle text;
  profile_name text;
begin
  profile_name := coalesce(
    nullif(btrim(new.raw_user_meta_data->>'full_name'), ''),
    nullif(btrim(new.raw_user_meta_data->>'name'), ''),
    nullif(btrim(new.raw_user_meta_data->>'given_name'), '')
  );
  base_handle := lower(regexp_replace(
    coalesce(
      nullif(btrim(new.raw_user_meta_data->>'username'), ''),
      nullif(btrim(new.raw_user_meta_data->>'preferred_username'), ''),
      nullif(btrim(new.raw_user_meta_data->>'user_name'), ''),
      profile_name,
      split_part(coalesce(new.email, ''), '@', 1),
      'user_' || left(new.id::text, 8)
    ),
    '[^a-zA-Z0-9_.-]+', '_', 'g'
  ));
  base_handle := trim(both '_.' from left(base_handle, 30));
  if base_handle = '' then
    base_handle := 'user_' || left(new.id::text, 8);
  end if;

  insert into public.profiles (id, username, full_name, avatar_url)
  values (
    new.id, base_handle, profile_name,
    coalesce(nullif(new.raw_user_meta_data->>'avatar_url', ''), nullif(new.raw_user_meta_data->>'picture', ''))
  )
  on conflict (id) do nothing;
  return new;
exception when unique_violation then
  insert into public.profiles (id, username, full_name, avatar_url)
  values (
    new.id,
    left(base_handle, 20) || '_' || left(new.id::text, 8),
    profile_name,
    coalesce(nullif(new.raw_user_meta_data->>'avatar_url', ''), nullif(new.raw_user_meta_data->>'picture', ''))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
