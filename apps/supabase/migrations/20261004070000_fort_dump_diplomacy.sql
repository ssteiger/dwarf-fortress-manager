-- Neighbouring powers, wars, petitions and invasion triggers, dumped with the
-- rest of the fortress. Keep in sync with `packages/db-drizzle/src/schema.ts`.
alter table public.fort_dump
  add column if not exists diplomacy jsonb;
