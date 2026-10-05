-- The world's history events at the fortress or naming its people, read live
-- from the game by the worker, and how far it has read them. Keep in sync with
-- `packages/db-drizzle/src/schema.ts`.
create table if not exists public.fort_history_events (
  fort_key text not null,
  -- The game's own event id.
  event_id integer not null,
  type text not null,
  game_year integer not null,
  game_tick integer not null,
  here boolean not null,
  hfids integer[] not null,
  fields jsonb not null,
  extra jsonb not null,
  captured_at timestamp with time zone not null default now(),
  constraint fort_history_events_pkey primary key (fort_key, event_id)
);

create index if not exists fort_history_events_time_idx
  on public.fort_history_events (fort_key, game_year, game_tick);
create index if not exists fort_history_events_hfids_idx
  on public.fort_history_events using gin (hfids);

create table if not exists public.fort_history_cursors (
  fort_key text not null,
  last_event_id integer not null,
  updated_at timestamp with time zone not null default now(),
  constraint fort_history_cursors_pkey primary key (fort_key)
);
