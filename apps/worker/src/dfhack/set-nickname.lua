-- set-nickname.lua
--
-- Mutates one current citizen through DFHack's supported nickname API.
-- Invoked by the worker as:
--
--   lua --file dfhack-config/set-nickname.lua <unit_id> <nickname>

local args = {...}
local unit_id = tonumber(args[1])
local nickname = args[2]

local function fail(message)
    print('ERR ' .. tostring(message):gsub('[\r\n]+', ' '))
end

if not dfhack.isMapLoaded() or not dfhack.world.isFortressMode() then
    print('MENU')
    return
end

if not unit_id or unit_id < 0 or nickname == nil then
    fail('expected a unit id and nickname')
    return
end

if #nickname > 80 or nickname:find('[%c]') then
    fail('nickname is invalid')
    return
end

local unit = df.unit.find(unit_id)
if not unit then
    fail('unit not found')
    return
end

if not dfhack.units.isCitizen(unit, true) or dfhack.units.isDead(unit) then
    fail('unit is not a living citizen')
    return
end

local ok, err = pcall(dfhack.units.setNickname, unit, dfhack.utf2df(nickname))
if not ok then
    fail(err)
    return
end

print('OK ' .. unit_id)
