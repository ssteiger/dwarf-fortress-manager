-- How often the worker reads the game, and requests from the web app to read
-- it now (single row, id = 1). The web app writes the schedule and the
-- requests; the worker answers requests and leaves a heartbeat, so the app
-- can tell it is running even when it has not read the game in a while.
-- Keep in sync with `packages/db-drizzle/src/schema.ts`.
create table if not exists public.fort_worker (
  id integer not null,
  auto_dump boolean not null default true,
  dump_interval_ms integer not null default 30000,
  dump_requested_at timestamp with time zone null,
  dump_answered_at timestamp with time zone null,
  seen_at timestamp with time zone null,
  constraint fort_worker_pkey primary key (id),
  constraint fort_worker_single_row check (id = 1),
  constraint fort_worker_interval_check check (dump_interval_ms > 0)
);
