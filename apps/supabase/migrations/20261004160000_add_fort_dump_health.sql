-- What citizens wait for from the doctors, who has a medical labor on, and
-- what the hospitals keep (dump version 12 on). Keep in sync with
-- `packages/db-drizzle/src/schema.ts`.
alter table public.fort_dump add column if not exists health jsonb null;
