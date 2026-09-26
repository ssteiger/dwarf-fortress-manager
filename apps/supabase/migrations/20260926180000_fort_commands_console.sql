-- Let the command queue carry a DFHack console command as typed, for the
-- assistant in the header: the model suggests it, the player reads it in
-- full and confirms, and only then does it land here. `command` holds the
-- exact text the worker runs.
alter table public.fort_commands
  add column if not exists command text null;

alter table public.fort_commands drop constraint if exists fort_commands_kind_check;
alter table public.fort_commands
  add constraint fort_commands_kind_check
  check (kind in ('set_nickname', 'dfhack', 'unit_action', 'console'));

alter table public.fort_commands drop constraint if exists fort_commands_payload_check;
alter table public.fort_commands
  add constraint fort_commands_payload_check check (
    (kind = 'set_nickname' and unit_id is not null and nickname is not null)
    or (kind = 'dfhack' and action is not null)
    or (kind = 'unit_action' and unit_id is not null and action is not null)
    or (kind = 'console' and command is not null)
  );
