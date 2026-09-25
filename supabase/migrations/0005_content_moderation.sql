-- Report queue for staff review and storage for post attachments.
create table if not exists public.user_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  target_type text not null check (target_type in ('user','post')),
  target_id text not null,
  reason text not null check (length(reason) between 1 and 1000),
  status text not null default 'pending' check (status in ('pending','dismissed','actioned')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id) on delete set null
);
create index if not exists user_reports_queue_idx on public.user_reports(status, created_at desc);
create index if not exists user_reports_target_idx on public.user_reports(target_type, target_id);

alter table public.user_reports enable row level security;
grant insert, select on public.user_reports to authenticated;
drop policy if exists "user_reports_submit_own" on public.user_reports;
create policy "user_reports_submit_own" on public.user_reports
  for insert with check (auth.uid() = reporter_id);
drop policy if exists "user_reports_read_own" on public.user_reports;
create policy "user_reports_read_own" on public.user_reports
  for select using (auth.uid() = reporter_id);
-- Staff review and mutations use the server-only service-role client after
-- checking MOTION_ADMIN_EMAILS. No client-side admin policy is granted.

insert into storage.buckets (id, name, public)
values ('post-media', 'post-media', true)
on conflict (id) do nothing;

drop policy if exists "post_media_public_read" on storage.objects;
create policy "post_media_public_read" on storage.objects
  for select using (bucket_id = 'post-media');
drop policy if exists "post_media_owner_insert" on storage.objects;
create policy "post_media_owner_insert" on storage.objects
  for insert with check (bucket_id = 'post-media' and auth.uid()::text = (storage.foldername(name))[1]);
drop policy if exists "post_media_owner_update" on storage.objects;
create policy "post_media_owner_update" on storage.objects
  for update using (bucket_id = 'post-media' and auth.uid()::text = (storage.foldername(name))[1]);
drop policy if exists "post_media_owner_delete" on storage.objects;
create policy "post_media_owner_delete" on storage.objects
  for delete using (bucket_id = 'post-media' and auth.uid()::text = (storage.foldername(name))[1]);
