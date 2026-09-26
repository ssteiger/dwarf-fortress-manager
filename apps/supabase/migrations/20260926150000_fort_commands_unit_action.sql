-- Let the command queue carry actions on a single unit: showing them in the
-- game, a custom title, and a few whitelisted DFHack cheats. The web app
-- stores the action key; the worker maps it to what runs. `arg` holds the
-- title for the title action.
alter table public.fort_commands
  add column if not exists arg text null;

alter table public.fort_commands drop constraint if exists fort_commands_kind_check;
alter table public.fort_commands
  add constraint fort_commands_kind_check check (kind in ('set_nickname', 'dfhack', 'unit_action'));

alter table public.fort_commands drop constraint if exists fort_commands_payload_check;
alter table public.fort_commands
  add constraint fort_commands_payload_check check (
    (kind = 'set_nickname' and unit_id is not null and nickname is not null)
    or (kind = 'dfhack' and action is not null)
    or (kind = 'unit_action' and unit_id is not null and action is not null)
  );

create index if not exists fort_commands_unit_idx
  on public.fort_commands (unit_id, created_at desc);
