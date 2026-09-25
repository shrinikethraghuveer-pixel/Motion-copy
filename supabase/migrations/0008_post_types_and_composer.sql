-- Typed composer payloads: text, event, and poll posts with optional media.
alter table public.posts
  add column if not exists post_type text not null default 'text'
    check (post_type in ('text', 'event', 'poll')),
  add column if not exists event_details jsonb,
  add column if not exists poll_details jsonb,
  add column if not exists media_urls text[] not null default '{}';

create index if not exists posts_type_created_at_idx
  on public.posts (post_type, created_at desc);
