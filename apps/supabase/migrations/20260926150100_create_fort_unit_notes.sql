-- The player's own notes on a dwarf, for role play: backstory, voice, what
-- happened to them. One note per user, fortress and unit.
create table if not exists public.fort_unit_notes (
  id serial not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  -- The fortress as the chronicle keys it: "save_dir:site_id".
  fort_key text not null,
  unit_id integer not null,
  note text not null default '',
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint fort_unit_notes_pkey primary key (id),
  constraint fort_unit_notes_target_unique unique (user_id, fort_key, unit_id)
);

-- Only the author sees or changes a note when going through the API roles.
alter table public.fort_unit_notes enable row level security;

create policy "fort_unit_notes_select_own" on public.fort_unit_notes
  for select using ((select auth.uid()) = user_id);
create policy "fort_unit_notes_insert_own" on public.fort_unit_notes
  for insert with check ((select auth.uid()) = user_id);
create policy "fort_unit_notes_update_own" on public.fort_unit_notes
  for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "fort_unit_notes_delete_own" on public.fort_unit_notes
  for delete using ((select auth.uid()) = user_id);
