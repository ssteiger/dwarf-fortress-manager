-- A reader's journal for legends mode: pins and notes on records, events,
-- spans of years and stories, kept per user and per world.
create table if not exists public.legends_notes (
  id serial not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  world_id integer not null references public.legends_worlds (id) on delete cascade,
  -- A record kind (historical_figure, site, ...), or event, span, story, narration.
  target_kind text not null,
  -- Record or event id, "from-to" for spans, the story key for stories.
  target_id text not null,
  -- What was pinned, in words, so the journal reads without a lookup.
  title text not null default '',
  note text not null default '',
  tags text[] not null default '{}',
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint legends_notes_pkey primary key (id),
  constraint legends_notes_target_unique unique (user_id, world_id, target_kind, target_id)
);

create index if not exists legends_notes_user_world_idx
  on public.legends_notes (user_id, world_id, updated_at desc);

-- Only the author sees or changes a note when going through the API roles.
alter table public.legends_notes enable row level security;

create policy "legends_notes_select_own" on public.legends_notes
  for select using ((select auth.uid()) = user_id);
create policy "legends_notes_insert_own" on public.legends_notes
  for insert with check ((select auth.uid()) = user_id);
create policy "legends_notes_update_own" on public.legends_notes
  for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "legends_notes_delete_own" on public.legends_notes
  for delete using ((select auth.uid()) = user_id);
