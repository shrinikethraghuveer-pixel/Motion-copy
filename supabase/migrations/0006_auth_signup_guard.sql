-- Optional Supabase Auth Before User Created hook. Populate this table with a
-- maintained, reviewed list of disposable email domains before enabling it.
create table if not exists public.signup_email_domain_blocklist (
  domain text primary key check (domain = lower(btrim(domain)) and position('@' in domain) = 0),
  reason text,
  created_at timestamptz not null default now()
);

alter table public.signup_email_domain_blocklist enable row level security;
revoke all on public.signup_email_domain_blocklist from public, anon, authenticated;

create or replace function public.before_user_created_block_disposable_domains(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  email_address text;
  email_domain text;
begin
  email_address := lower(btrim(event -> 'user' ->> 'email'));
  if email_address is null or email_address = '' or position('@' in email_address) = 0 then
    return '{}'::jsonb;
  end if;

  email_domain := split_part(email_address, '@', 2);
  if exists (
    select 1 from public.signup_email_domain_blocklist b
    where b.domain = email_domain
  ) then
    return jsonb_build_object(
      'error', jsonb_build_object(
        'http_code', 403,
        'message', 'Signups from this email domain are not allowed.'
      )
    );
  end if;

  return '{}'::jsonb;
end;
$$;

revoke all on function public.before_user_created_block_disposable_domains(jsonb) from public, anon, authenticated;
grant usage on schema public to supabase_auth_admin;
grant execute on function public.before_user_created_block_disposable_domains(jsonb) to supabase_auth_admin;
