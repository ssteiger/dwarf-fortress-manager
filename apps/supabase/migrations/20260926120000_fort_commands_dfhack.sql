-- Let the command queue carry whitelisted DFHack commands besides nicknames.
-- The web app stores only an action key; the worker maps it to the command.
alter table public.fort_commands
  alter column unit_id drop not null,
  alter column nickname drop not null,
  add column if not exists action text null,
  add column if not exists output text null;

alter table public.fort_commands drop constraint if exists fort_commands_kind_check;
alter table public.fort_commands
  add constraint fort_commands_kind_check check (kind in ('set_nickname', 'dfhack'));

alter table public.fort_commands drop constraint if exists fort_commands_payload_check;
alter table public.fort_commands
  add constraint fort_commands_payload_check check (
    (kind = 'set_nickname' and unit_id is not null and nickname is not null)
    or (kind = 'dfhack' and action is not null)
  );
