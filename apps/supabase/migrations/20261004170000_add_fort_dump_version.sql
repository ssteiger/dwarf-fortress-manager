-- The dump_version the game script wrote, so the web app can tell a dump it
-- does not know how to read. Keep in sync with
-- `packages/db-drizzle/src/schema.ts`.
alter table public.fort_dump add column if not exists dump_version integer null;
