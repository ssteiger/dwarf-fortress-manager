-- Which DFHack plugins run in the game (dump version 12 on). Keep in sync with
-- `packages/db-drizzle/src/schema.ts`.
alter table public.fort_dump add column if not exists automation jsonb null;
