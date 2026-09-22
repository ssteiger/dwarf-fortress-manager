-- Live fortress state written by the DFHack worker in `apps/worker`, plus the
-- imported legends archive. Keep in sync with
-- `packages/db-drizzle/src/schema.ts`.

-- What the worker last saw when it talked to the game (single row, id = 1).
create table if not exists public.fort_state (
  id integer not null,
  status text not null,
  fort_name text null,
  world_name text null,
  game_date text null,
  captured_at timestamp with time zone not null default now(),
  world jsonb null,
  summary jsonb null,
  error text null,
  elapsed_ms integer null,
  constraint fort_state_pkey primary key (id)
);

-- The full dump of the loaded fortress, minus the map (single row, id = 1).
create table if not exists public.fort_dump (
  id integer not null,
  captured_at timestamp with time zone not null default now(),
  units jsonb null,
  items jsonb null,
  buildings jsonb null,
  jobs jsonb null,
  announcements jsonb null,
  constraint fort_dump_pkey primary key (id)
);

-- The map, dumped on its own slower cadence (single row, id = 1).
create table if not exists public.fort_map (
  id integer not null,
  captured_at timestamp with time zone not null default now(),
  x_count integer not null,
  y_count integer not null,
  z_count integer not null,
  tiletypes jsonb not null,
  blocks jsonb not null,
  constraint fort_map_pkey primary key (id)
);

-- Append-only chronicle of in-game announcements.
create table if not exists public.fort_events (
  id serial not null,
  dedupe_key text not null,
  report_id integer null,
  game_year integer null,
  game_tick integer null,
  type text null,
  text text not null,
  x integer null,
  y integer null,
  z integer null,
  captured_at timestamp with time zone not null default now(),
  constraint fort_events_pkey primary key (id)
);
create unique index if not exists fort_events_dedupe_key_idx on public.fort_events (dedupe_key);
create index if not exists fort_events_game_time_idx on public.fort_events (game_year, game_tick);

-- One row per exported legends world, grouped by the export file prefix.
create table if not exists public.legends_worlds (
  id serial not null,
  key text not null,
  name text null,
  alt_name text null,
  imported_at timestamp with time zone not null default now(),
  record_counts jsonb null,
  constraint legends_worlds_pkey primary key (id),
  constraint legends_worlds_key_unique unique (key)
);

-- Legends files already imported, so the worker can skip them on restart.
create table if not exists public.legends_imports (
  id serial not null,
  world_id integer not null references public.legends_worlds (id) on delete cascade,
  path text not null,
  size bigint not null,
  mtime_ms bigint not null,
  records integer not null default 0,
  imported_at timestamp with time zone not null default now(),
  constraint legends_imports_pkey primary key (id),
  constraint legends_imports_path_unique unique (path)
);

-- Every legends element. `payload` is the vanilla legends.xml element as JSON
-- with the legends_plus.xml element merged under `payload.plus`.
create table if not exists public.legends_records (
  world_id integer not null references public.legends_worlds (id) on delete cascade,
  kind text not null,
  id integer not null,
  name text null,
  type text null,
  year integer null,
  hfids integer[] null,
  entity_ids integer[] null,
  site_ids integer[] null,
  artifact_ids integer[] null,
  payload jsonb not null,
  constraint legends_records_pkey primary key (world_id, kind, id)
);
create index if not exists legends_records_kind_year_idx on public.legends_records (world_id, kind, year);
create index if not exists legends_records_name_idx on public.legends_records (world_id, name);
create index if not exists legends_records_hfids_idx on public.legends_records using gin (hfids);
create index if not exists legends_records_entity_ids_idx on public.legends_records using gin (entity_ids);
create index if not exists legends_records_site_ids_idx on public.legends_records using gin (site_ids);
create index if not exists legends_records_artifact_ids_idx on public.legends_records using gin (artifact_ids);
