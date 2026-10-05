-- The fortress's dead: the dump's own list (version 12 on), and the last sheet
-- the worker read of each citizen who has since died or left. Written by the
-- worker. Keep in sync with `packages/db-drizzle/src/schema.ts`.
alter table public.fort_dump add column if not exists dead jsonb null;

create table if not exists public.fort_unit_archive (
  fort_key text not null,
  unit_id integer not null,
  -- 'died' or 'left'.
  reason text not null,
  game_year integer not null,
  game_tick integer not null,
  unit jsonb not null,
  updated_at timestamp with time zone not null default now(),
  constraint fort_unit_archive_pkey primary key (fort_key, unit_id)
);
