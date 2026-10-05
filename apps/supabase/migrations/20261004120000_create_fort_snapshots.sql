-- The fortress over time: one snapshot per fortress and in-game day, and the
-- life events two snapshots in a row differ by. Written by the worker. Keep
-- in sync with `packages/db-drizzle/src/schema.ts`.
create table if not exists public.fort_snapshots (
  -- The fortress as the chronicle keys it: "save_dir:site_id".
  fort_key text not null,
  -- Days since the world began: year * 336 + tick / 1200.
  day integer not null,
  game_year integer not null,
  game_tick integer not null,
  captured_at timestamp with time zone not null default now(),
  totals jsonb not null,
  units jsonb not null,
  constraint fort_snapshots_pkey primary key (fort_key, day)
);

create table if not exists public.fort_life_events (
  id serial not null,
  fort_key text not null,
  unit_id integer not null,
  hf integer null,
  kind text not null,
  game_year integer not null,
  game_tick integer not null,
  data jsonb not null,
  captured_at timestamp with time zone not null default now(),
  constraint fort_life_events_pkey primary key (id)
);

create index if not exists fort_life_events_time_idx
  on public.fort_life_events (fort_key, game_year, game_tick);
create index if not exists fort_life_events_unit_idx
  on public.fort_life_events (fort_key, unit_id);
