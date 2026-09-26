-- unit-action.lua
--
-- One whitelisted action on one unit, queued by the web app (UNIT_ACTIONS in
-- packages/db-drizzle/src/fortress-types.ts). Invoked by the worker as:
--
--   lua --file dfhack-config/unit-action.lua <action> <unit_id> [text]
--
-- Prints exactly one status line:
--   OK <unit_id>     done
--   MENU             no fortress loaded
--   ERR <message>    refused or failed; nothing changed

local args = {...}
local action = args[1]
local unit_id = tonumber(args[2])
local text = args[3]

local MAX_TITLE = 40

local function fail(message)
    print('ERR ' .. tostring(message):gsub('[\r\n]+', ' '))
end

if not dfhack.isMapLoaded() or not dfhack.world.isFortressMode() then
    print('MENU')
    return
end

if not unit_id or unit_id < 0 then
    fail('expected a unit id')
    return
end

local unit = df.unit.find(unit_id)
if not unit then
    fail('unit not found')
    return
end

local function ours_and_alive()
    if dfhack.units.isDead(unit) then return false, 'they are dead' end
    if not dfhack.units.isFortControlled(unit) then return false, 'they do not belong to the fortress' end
    return true
end

local ACTIONS = {}

function ACTIONS.reveal()
    local x, y, z = dfhack.units.getPosition(unit)
    if not x then return false, 'they are not on the map' end
    dfhack.gui.revealInDwarfmodeMap(xyz2pos(x, y, z), true, true)
    return true
end

function ACTIONS.title()
    local ok, why = ours_and_alive()
    if not ok then return false, why end
    local title = text or ''
    if #title > MAX_TITLE * 4 or title:find('[%c]') then return false, 'the title is invalid' end
    unit.custom_profession = dfhack.utf2df(title)
    return true
end

function ACTIONS.calm()
    local ok, why = ours_and_alive()
    if not ok then return false, why end
    if not unit.status.current_soul then return false, 'they have no mind to calm' end
    reqscript('remove-stress').removeStress(unit, -1000000)
    return true
end

function ACTIONS.fillneeds()
    local ok, why = ours_and_alive()
    if not ok then return false, why end
    if not unit.status.current_soul then return false, 'they have no needs' end
    dfhack.run_script('fillneeds', '-unit', tostring(unit.id))
    return true
end

function ACTIONS.heal()
    local ok, why = ours_and_alive()
    if not ok then return false, why end
    dfhack.run_script('full-heal', '-unit', tostring(unit.id))
    return true
end

local run = ACTIONS[action or '']
if not run then
    fail('unknown action "' .. tostring(action) .. '"')
    return
end

local ok, done, why = pcall(run)
if not ok then
    fail(done)
elseif not done then
    fail(why)
else
    print('OK ' .. unit_id)
end
