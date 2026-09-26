-- Where the latest game read is, or how it ended: the step, running / done /
-- menu / offline / error, whether the map came along, when it started and a
-- detail. The worker writes it as the read moves on, so the app can show it
-- while Dwarf Fortress is paused; a request from the app clears an ended one.
-- Keep in sync with `packages/db-drizzle/src/schema.ts`.
alter table public.fort_worker
  add column if not exists dump_progress jsonb;
