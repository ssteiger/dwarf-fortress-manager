-- Manager work orders, squads, artifacts and the historical figures items
-- name, dumped with the rest of the fortress; and the minerals the map's
-- veins are made of. Keep in sync with `packages/db-drizzle/src/schema.ts`.
alter table public.fort_dump
  add column if not exists orders jsonb,
  add column if not exists squads jsonb,
  add column if not exists artifacts jsonb,
  add column if not exists figures jsonb;

alter table public.fort_map
  add column if not exists minerals jsonb;
