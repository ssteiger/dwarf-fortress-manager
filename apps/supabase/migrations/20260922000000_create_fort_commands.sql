-- Small command queue between the web app and the only process allowed to
-- mutate the running game: the DFHack worker.
create table if not exists public.fort_commands (
  id serial not null,
  kind text not null,
  unit_id integer not null,
  nickname text not null,
  status text not null default 'pending',
  error text null,
  created_at timestamp with time zone not null default now(),
  started_at timestamp with time zone null,
  completed_at timestamp with time zone null,
  constraint fort_commands_pkey primary key (id),
  constraint fort_commands_kind_check check (kind in ('set_nickname')),
  constraint fort_commands_status_check check (status in ('pending', 'processing', 'done', 'failed'))
);

create index if not exists fort_commands_pending_idx
  on public.fort_commands (status, created_at);
