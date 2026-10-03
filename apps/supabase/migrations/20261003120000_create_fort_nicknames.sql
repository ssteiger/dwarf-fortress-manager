-- Every nickname given from the nickname page, with the reason behind it, so
-- a dwarf's page can say why they are called what they are called. A dwarf
-- renamed again gets a new row; the newest one is theirs.
create table if not exists public.fort_nicknames (
  id serial not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  -- The fortress as the chronicle keys it: "save_dir:site_id".
  fort_key text not null,
  unit_id integer not null,
  nickname text not null,
  -- One sentence on the fact behind the name; null when the player typed their own.
  why text,
  -- facts, model, list or typed.
  source text not null default 'typed',
  created_at timestamp with time zone not null default now(),
  constraint fort_nicknames_pkey primary key (id)
);

create index if not exists fort_nicknames_unit_idx
  on public.fort_nicknames (fort_key, unit_id, created_at desc);

alter table public.fort_nicknames enable row level security;

create policy "fort_nicknames_select_own" on public.fort_nicknames
  for select using ((select auth.uid()) = user_id);
create policy "fort_nicknames_insert_own" on public.fort_nicknames
  for insert with check ((select auth.uid()) = user_id);
create policy "fort_nicknames_delete_own" on public.fort_nicknames
  for delete using ((select auth.uid()) = user_id);

-- The player's own nicknames waiting for a dwarf to fit them, kept across
-- fortresses. One row per name, compared without case.
create table if not exists public.nickname_list (
  id serial not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  created_at timestamp with time zone not null default now(),
  constraint nickname_list_pkey primary key (id)
);

create unique index if not exists nickname_list_name_unique
  on public.nickname_list (user_id, lower(name));

alter table public.nickname_list enable row level security;

create policy "nickname_list_select_own" on public.nickname_list
  for select using ((select auth.uid()) = user_id);
create policy "nickname_list_insert_own" on public.nickname_list
  for insert with check ((select auth.uid()) = user_id);
create policy "nickname_list_delete_own" on public.nickname_list
  for delete using ((select auth.uid()) = user_id);
