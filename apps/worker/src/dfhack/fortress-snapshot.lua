-- fortress-snapshot.lua
--
-- Read-only full dump of the loaded fortress, written as one JSON document.
-- Installed into <DF>/dfhack-config/ by apps/worker and invoked over the
-- DFHack remote console:
--
--   lua --file dfhack-config/fortress-snapshot.lua <out_path> <with_map:0|1>
--
-- Prints exactly one status line:
--   OK <bytes> <elapsed_ms>     dump written to <out_path>
--   MENU                        no fortress loaded (nothing written)
--   ERR <message>               something failed (nothing written)
--
-- Nothing in here writes to game state.

local DUMP_VERSION = 2

local args = {...}
local out_path = args[1] or 'dfhack-config/fortress-dump.json'
local with_map = args[2] == '1' or args[2] == 'true'

local utils = require('utils')

-- ---------------------------------------------------------------------------
-- JSON writer (streaming, no intermediate giant table)
-- ---------------------------------------------------------------------------

local ESCAPES = {
    ['"'] = '\\"', ['\\'] = '\\\\', ['\b'] = '\\b', ['\f'] = '\\f',
    ['\n'] = '\\n', ['\r'] = '\\r', ['\t'] = '\\t',
}

local function jstr(s)
    if s == nil then return 'null' end
    s = tostring(s)
    local ok, converted = pcall(dfhack.df2utf, s)
    if ok and converted then s = converted end
    s = s:gsub('[%c"\\]', function(c)
        return ESCAPES[c] or string.format('\\u%04x', c:byte())
    end)
    return '"' .. s .. '"'
end

local jval

-- Explicit null so rows can carry missing values without creating holes.
local NULL = setmetatable({}, {__tostring = function() return 'null' end})

local function jarray(t)
    local parts = {}
    local n = rawget(t, 'n') or #t
    for i = 1, n do parts[i] = jval(t[i]) end
    return '[' .. table.concat(parts, ',') .. ']'
end

local function jobject(t)
    local keys = {}
    for k in pairs(t) do keys[#keys + 1] = tostring(k) end
    table.sort(keys)
    local parts = {}
    for i, k in ipairs(keys) do
        parts[i] = jstr(k) .. ':' .. jval(t[k])
    end
    return '{' .. table.concat(parts, ',') .. '}'
end

-- Marker so empty tables can still be told apart.
local ARRAY = {}
local function arr(t) t = t or {}; setmetatable(t, ARRAY); return t end

-- Build a row from varargs, keeping nil positions (as NULL) and the true length.
local function row(...)
    local n = select('#', ...)
    local t = {...}
    for i = 1, n do
        if t[i] == nil then t[i] = NULL end
    end
    t.n = n
    return setmetatable(t, ARRAY)
end

jval = function(v)
    local t = type(v)
    if v == nil or v == NULL then return 'null'
    elseif t == 'boolean' then return v and 'true' or 'false'
    elseif t == 'number' then
        if v ~= v or v == math.huge or v == -math.huge then return 'null' end
        if math.type(v) == 'integer' then return tostring(v) end
        -- The game process may run under a locale with a comma decimal separator.
        return (string.format('%.3f', v):gsub(',', '.'))
    elseif t == 'string' then return jstr(v)
    elseif t == 'table' then
        if getmetatable(v) == ARRAY or #v > 0 then return jarray(v) end
        if next(v) == nil then return '{}' end
        return jobject(v)
    end
    return 'null'
end

-- ---------------------------------------------------------------------------
-- Small helpers
-- ---------------------------------------------------------------------------

local function try(fn, ...)
    local ok, res = pcall(fn, ...)
    if ok then return res end
    return nil
end

local function enum_name(enum, value)
    if value == nil then return nil end
    local ok, name = pcall(function() return enum[value] end)
    if ok and name ~= nil then return tostring(name) end
    return tostring(value)
end

local function clean_name(s)
    if s == nil then return '' end
    return tostring(s)
end

local function translate(name, english)
    local ok, res = pcall(dfhack.translation.translateName, name, english)
    if ok and res then return res end
    return ''
end

local MONTHS = {
    'Granite', 'Slate', 'Felsite', 'Hematite', 'Malachite', 'Galena',
    'Limestone', 'Sandstone', 'Timber', 'Moonstone', 'Opal', 'Obsidian',
}
local SEASONS = {
    'early spring', 'mid spring', 'late spring',
    'early summer', 'mid summer', 'late summer',
    'early autumn', 'mid autumn', 'late autumn',
    'early winter', 'mid winter', 'late winter',
}

-- ---------------------------------------------------------------------------
-- Gate: only dump a loaded fortress
-- ---------------------------------------------------------------------------

if not dfhack.isMapLoaded() or not dfhack.world.isFortressMode() then
    print('MENU')
    return
end

local t_start = dfhack.getTickCount()

-- ---------------------------------------------------------------------------
-- World / calendar
-- ---------------------------------------------------------------------------

local function collect_world()
    local site = dfhack.world.getCurrentSite()
    local year = dfhack.world.ReadCurrentYear()
    local month = dfhack.world.ReadCurrentMonth() + 1
    local day = dfhack.world.ReadCurrentDay()
    local map = df.global.world.map
    local world_name = df.global.world.world_data.name
    return {
        name = translate(world_name, true),
        name_native = translate(world_name, false),
        save_dir = clean_name(try(function() return df.global.world.cur_savegame.save_dir end)),
        site_id = site and site.id or -1,
        site_name = site and translate(site.name, true) or '',
        site_name_native = site and translate(site.name, false) or '',
        civ_id = try(function() return df.global.plotinfo.civ_id end) or -1,
        group_id = try(function() return df.global.plotinfo.group_id end) or -1,
        year = year,
        tick = df.global.cur_year_tick,
        month = month,
        day = day,
        month_name = MONTHS[month] or tostring(month),
        season = SEASONS[month] or '',
        map_x = map.x_count,
        map_y = map.y_count,
        map_z = map.z_count,
        df_version = clean_name(try(dfhack.getDFVersion)),
        dfhack_version = clean_name(try(dfhack.getDFHackVersion)),
    }
end

-- ---------------------------------------------------------------------------
-- Units
-- ---------------------------------------------------------------------------

local UNIT_COLUMNS = arr{
    'id', 'name', 'name_english', 'readable', 'race', 'caste', 'sex', 'age',
    'profession', 'x', 'y', 'z', 'stress', 'stress_category', 'job_id', 'job',
    'squad_id', 'squad', 'wounds', 'blood', 'blood_max', 'hunger', 'thirst',
    'sleepiness', 'mood', 'flags', 'skills', 'inventory', 'positions',
    'hist_figure_id', 'civ_id', 'race_id', 'caste_id',
}

local UNIT_FLAG_CHECKS = {
    {'citizen', function(u) return dfhack.units.isCitizen(u, true) end},
    {'resident', function(u) return dfhack.units.isResident(u, true) end},
    {'fort_controlled', dfhack.units.isFortControlled},
    {'own_civ', dfhack.units.isOwnCiv},
    {'visitor', dfhack.units.isVisitor},
    {'merchant', dfhack.units.isMerchant},
    {'diplomat', dfhack.units.isDiplomat},
    {'invader', dfhack.units.isInvader},
    {'animal', dfhack.units.isAnimal},
    {'tame', dfhack.units.isTame},
    {'war', dfhack.units.isWar},
    {'hunter', dfhack.units.isHunter},
    {'pet', dfhack.units.isPet},
    {'child', dfhack.units.isChild},
    {'baby', dfhack.units.isBaby},
    {'dead', dfhack.units.isDead},
    {'ghost', dfhack.units.isGhost},
    {'undead', dfhack.units.isUndead},
    {'insane', function(u) return not dfhack.units.isSane(u) end},
    {'crazed', dfhack.units.isCrazed},
    {'opposed_to_life', dfhack.units.isOpposedToLife},
    {'danger', dfhack.units.isDanger},
    {'agitated', dfhack.units.isAgitated},
    {'caged', function(u) return u.flags1.caged end},
    {'chained', function(u) return u.flags1.chained end},
    {'hidden', dfhack.units.isHidden},
}

local function unit_flags(u)
    local flags = arr{}
    for _, check in ipairs(UNIT_FLAG_CHECKS) do
        local ok, res = pcall(check[2], u)
        if ok and res then flags[#flags + 1] = check[1] end
    end
    return flags
end

local function unit_skills(u)
    local skills = arr{}
    local soul = u.status.current_soul
    if not soul then return skills end
    local list = {}
    for _, sk in ipairs(soul.skills) do
        if sk.rating > 0 then
            list[#list + 1] = {enum_name(df.job_skill, sk.id), sk.rating}
        end
    end
    table.sort(list, function(a, b) return a[2] > b[2] end)
    for i = 1, math.min(#list, 12) do skills[i] = arr(list[i]) end
    return skills
end

local INVENTORY_MODES = {
    [0] = 'Hauled', [1] = 'Weapon', [2] = 'Worn', [3] = 'Piercing', [4] = 'Flask',
    [5] = 'WrappedAround', [6] = 'StuckIn', [7] = 'InMouth', [8] = 'Pet',
    [9] = 'SewnInto', [10] = 'Strapped',
}

local function unit_inventory(u)
    local inv = arr{}
    local mode_enum = try(function() return df.unit_inventory_item.T_mode end)
    for _, entry in ipairs(u.inventory) do
        if entry.item then
            local mode = tonumber(entry.mode) or -1
            local mode_name = (mode_enum and try(function() return mode_enum[mode] end))
                or INVENTORY_MODES[mode] or tostring(mode)
            inv[#inv + 1] = arr{entry.item.id, tostring(mode_name)}
        end
    end
    return inv
end

local function unit_positions(u)
    local names = arr{}
    local positions = try(dfhack.units.getNoblePositions, u)
    if not positions then return names end
    for _, p in ipairs(positions) do
        local n = try(function() return p.position.name[0] end)
        if n and n ~= '' then names[#names + 1] = n end
    end
    return names
end

local function unit_row(u)
    local x, y, z = dfhack.units.getPosition(u)
    local soul = u.status.current_soul
    local stress = soul and soul.personality.stress or 0
    local job = u.job.current_job
    local squad_name = nil
    if u.military.squad_id >= 0 then
        local squad = df.squad.find(u.military.squad_id)
        if squad then
            squad_name = squad.alias
            if not squad_name or squad_name == '' then squad_name = translate(squad.name, true) end
        end
    end
    local craw = df.creature_raw.find(u.race)
    local race = craw and craw.name[0] or tostring(u.race)
    local caste = try(function() return craw.caste[u.caste].caste_name[0] end) or ''
    -- Raw tokens (DWARF, FEMALE): what the graphics raws key sprites on.
    local race_id = craw and craw.creature_id or nil
    local caste_id = try(function() return craw.caste[u.caste].caste_id end)
    local visible_name = dfhack.units.getVisibleName(u)
    return row(
        u.id,
        translate(visible_name, false),
        translate(visible_name, true),
        dfhack.units.getReadableName(u),
        race,
        caste,
        u.sex,
        try(dfhack.units.getAge, u, true) or 0,
        dfhack.units.getProfessionName(u),
        x, y, z,
        stress,
        dfhack.units.getStressCategory(u),
        job and job.id or nil,
        job and try(dfhack.job.getName, job) or nil,
        u.military.squad_id,
        squad_name,
        #u.body.wounds,
        try(function() return u.body.blood_count end),
        try(function() return u.body.blood_max end),
        try(function() return u.counters2.hunger_timer end) or 0,
        try(function() return u.counters2.thirst_timer end) or 0,
        try(function() return u.counters2.sleepiness_timer end) or 0,
        u.mood >= 0 and enum_name(df.mood_type, u.mood) or nil,
        unit_flags(u),
        unit_skills(u),
        unit_inventory(u),
        unit_positions(u),
        u.hist_figure_id,
        u.civ_id,
        race_id,
        caste_id
    )
end

-- ---------------------------------------------------------------------------
-- Items
-- ---------------------------------------------------------------------------

local ITEM_COLUMNS = arr{
    'id', 'type', 'subtype', 'description', 'material', 'stack', 'quality',
    'wear', 'x', 'y', 'z', 'flags', 'container_id', 'holder_unit_id',
    'holder_building_id', 'value',
}

local ITEM_FLAG_NAMES = {
    'forbid', 'dump', 'melt', 'rotten', 'owned', 'in_inventory', 'in_building',
    'in_job', 'on_ground', 'trader', 'foreign', 'artifact', 'container',
    'in_chest', 'encased', 'hidden', 'spider_web', 'construction', 'removed',
    'garbage_collect',
}

local function item_flags(it)
    local flags = arr{}
    local f = it.flags
    for _, name in ipairs(ITEM_FLAG_NAMES) do
        local ok, v = pcall(function() return f[name] end)
        if ok and v then flags[#flags + 1] = name end
    end
    return flags
end

local function item_row(it)
    local x, y, z = dfhack.items.getPosition(it)
    local itype = it:getType()
    local subtype = nil
    local def = try(dfhack.items.getSubtypeDef, itype, it:getSubtype())
    if def then subtype = try(function() return def.name end) end
    local material = ''
    local mi = try(dfhack.matinfo.decode, it)
    if mi then material = try(function() return mi:toString() end) or '' end
    local container = try(dfhack.items.getContainer, it)
    local holder_unit = try(dfhack.items.getHolderUnit, it)
    local holder_building = try(dfhack.items.getHolderBuilding, it)
    return row(
        it.id,
        enum_name(df.item_type, itype),
        subtype,
        try(dfhack.items.getReadableDescription, it) or '',
        material,
        try(function() return it.stack_size end) or 1,
        enum_name(df.item_quality, try(function() return it:getQuality() end) or 0),
        try(function() return it:getWear() end) or 0,
        x, y, z,
        item_flags(it),
        container and container.id or nil,
        holder_unit and holder_unit.id or nil,
        holder_building and holder_building.id or nil,
        try(dfhack.items.getValue, it) or 0
    )
end

-- ---------------------------------------------------------------------------
-- Buildings
-- ---------------------------------------------------------------------------

local BUILDING_COLUMNS = arr{
    'id', 'type', 'subtype', 'custom', 'name', 'x1', 'y1', 'x2', 'y2', 'z',
    'cx', 'cy', 'stage', 'max_stage', 'stockpile_items', 'jobs',
    'assigned_units', 'room',
}

local SUBTYPE_ENUMS = {
    Workshop = df.workshop_type,
    Furnace = df.furnace_type,
    Trap = df.trap_type,
    SiegeEngine = df.siegeengine_type,
    Construction = df.construction_type,
}

local function building_row(b)
    local btype = b:getType()
    local type_name = enum_name(df.building_type, btype)
    local subtype = nil
    if type_name == 'Civzone' then
        subtype = enum_name(df.civzone_type, try(function() return b.type end))
    else
        local st = try(function() return b:getSubtype() end)
        local enum = SUBTYPE_ENUMS[type_name]
        if enum and st and st >= 0 then subtype = enum_name(enum, st) end
    end
    local custom = nil
    local ct = try(function() return b:getCustomType() end)
    if ct and ct >= 0 then
        custom = try(function() return df.global.world.raws.buildings.all[ct].name end)
    end
    local stockpile_items = nil
    if df.building_stockpilest:is_instance(b) then
        local contents = try(dfhack.buildings.getStockpileContents, b)
        stockpile_items = contents and #contents or 0
    end
    local jobs = arr{}
    local job_list = try(function() return b.jobs end)
    if job_list then
        for _, job in ipairs(job_list) do jobs[#jobs + 1] = job.id end
    end
    local assigned = arr{}
    local assigned_units = try(function() return b.assigned_units end)
    if assigned_units then
        for _, id in ipairs(assigned_units) do assigned[#assigned + 1] = id end
    end
    local owner = try(function() return b.owner end)
    if owner and owner.id then assigned[#assigned + 1] = owner.id end
    local room = try(dfhack.buildings.getRoomDescription, b)
    if room == '' then room = nil end
    return row(
        b.id,
        type_name,
        subtype,
        custom,
        clean_name(try(function() return b.name end)),
        b.x1, b.y1, b.x2, b.y2, b.z,
        b.centerx, b.centery,
        try(function() return b:getBuildStage() end) or 0,
        try(function() return b:getMaxBuildStage() end) or 0,
        stockpile_items,
        jobs,
        assigned,
        room
    )
end

-- ---------------------------------------------------------------------------
-- Jobs
-- ---------------------------------------------------------------------------

local JOB_COLUMNS = arr{
    'id', 'type', 'name', 'x', 'y', 'z', 'suspended', 'repeat', 'worker_id',
    'building_id', 'order_id', 'items',
}

local function job_row(job)
    local worker = try(dfhack.job.getWorker, job)
    local holder = try(dfhack.job.getHolder, job)
    return row(
        job.id,
        enum_name(df.job_type, job.job_type),
        try(dfhack.job.getName, job) or '',
        job.pos.x, job.pos.y, job.pos.z,
        job.flags.suspend and true or false,
        job.flags['repeat'] and true or false,
        worker and worker.id or nil,
        holder and holder.id or nil,
        try(function() return job.order_id end) or -1,
        #job.items
    )
end

-- ---------------------------------------------------------------------------
-- Announcements
-- ---------------------------------------------------------------------------

local ANNOUNCEMENT_COLUMNS = arr{'id', 'year', 'time', 'type', 'text', 'repeat', 'x', 'y', 'z'}

local function collect_announcements(limit)
    local anns = df.global.world.status.announcements
    local rows = {}
    local n = #anns
    local first = math.max(0, n - limit)
    local current = nil
    for i = first, n - 1 do
        local a = anns[i]
        if current and a.flags.continuation then
            current[5] = current[5] .. ' ' .. a.text
        else
            current = row(
                a.id, a.year, a.time,
                enum_name(df.announcement_type, try(function() return a.type end)),
                a.text,
                try(function() return a.repeat_count end) or 0,
                try(function() return a.pos.x end) or -1,
                try(function() return a.pos.y end) or -1,
                try(function() return a.pos.z end) or -1
            )
            rows[#rows + 1] = current
        end
    end
    return rows
end

-- ---------------------------------------------------------------------------
-- Summary (computed here so the overview never rescans the dump)
-- ---------------------------------------------------------------------------

local STOCK_KEYS = {
    {'meals', 'Prepared meals', 'FOOD'},
    {'drink', 'Drink', 'DRINK'},
    {'meat', 'Meat', 'MEAT'},
    {'fish', 'Prepared fish', 'FISH'},
    {'fish_raw', 'Raw fish', 'FISH_RAW'},
    {'plants', 'Plants', 'PLANT'},
    {'plant_growths', 'Plant growths', 'PLANT_GROWTH'},
    {'cheese', 'Cheese', 'CHEESE'},
    {'eggs', 'Eggs', 'EGG'},
    {'seeds', 'Seeds', 'SEEDS'},
    {'powder', 'Flour and powder', 'POWDER_MISC'},
    {'globs', 'Fat and globs', 'GLOB'},
    {'bars', 'Bars', 'BAR'},
    {'logs', 'Logs', 'WOOD'},
    {'stone', 'Stone', 'BOULDER'},
    {'blocks', 'Blocks', 'BLOCKS'},
    {'cloth', 'Cloth', 'CLOTH'},
    {'thread', 'Thread', 'THREAD'},
    {'leather', 'Leather', 'SKIN_TANNED'},
    {'gems_rough', 'Rough gems', 'ROUGH'},
    {'gems_cut', 'Cut gems', 'SMALLGEM'},
    {'weapons', 'Weapons', 'WEAPON'},
    {'armor', 'Armor', 'ARMOR'},
    {'ammo', 'Ammo', 'AMMO'},
    {'coins', 'Coins', 'COIN'},
    {'barrels', 'Barrels', 'BARREL'},
    {'bins', 'Bins', 'BIN'},
    {'bags', 'Bags', 'BOX'},
    {'cages', 'Cages', 'CAGE'},
    {'beds', 'Beds', 'BED'},
    {'coffins', 'Coffins', 'COFFIN'},
    {'anvils', 'Anvils', 'ANVIL'},
    {'crafts', 'Crafts', 'CRAFTS'},
}

local function count_stock(key)
    local vec = try(function() return df.global.world.items.other[key] end)
    if not vec then return 0 end
    local n = 0
    for _, item in ipairs(vec) do
        local f = item.flags
        if not (f.garbage_collect or f.rotten or f.trader or f.removed or f.forbid) then
            n = n + (try(function() return item.stack_size end) or 1)
        end
    end
    return n
end

local function parse_cancellation(text)
    -- "Urist McDwarf, Mason cancels Construct rock Door: Needs 1 rock." -> task, reason
    local task, reason = text:match('cancels ([^:]+): (.+)$')
    if not task then return nil end
    reason = reason:gsub('%.$', '')
    return task, reason
end

local function collect_summary(units_rows, item_count, building_count, announcement_rows)
    local s = {
        adults = 0, children = 0, babies = 0, working = 0, idle = 0, military = 0,
        visitors = 0, merchants = 0, hostiles = 0, tame_animals = 0, war_animals = 0,
        mood = arr{0, 0, 0, 0, 0, 0, 0},
        jobs_total = 0, jobs_suspended = 0,
        stocks = arr{}, alerts = arr{}, wealth = nil,
        items_total = item_count, buildings_total = building_count,
    }
    local stressed = {}
    local injured = {}
    for _, u in ipairs(df.global.world.units.active) do
        if dfhack.units.isAlive(u) then
            if dfhack.units.isCitizen(u, true) then
                if dfhack.units.isBaby(u) then s.babies = s.babies + 1
                elseif dfhack.units.isChild(u) then s.children = s.children + 1
                else s.adults = s.adults + 1 end
                if u.military.squad_id >= 0 then s.military = s.military + 1 end
                if u.job.current_job then s.working = s.working + 1 else s.idle = s.idle + 1 end
                local cat = dfhack.units.getStressCategory(u)
                s.mood[cat + 1] = (s.mood[cat + 1] or 0) + 1
                if cat <= 1 then stressed[#stressed + 1] = dfhack.units.getReadableName(u) end
                if #u.body.wounds > 0 then injured[#injured + 1] = dfhack.units.getReadableName(u) end
            elseif dfhack.units.isInvader(u) or (try(dfhack.units.isDanger, u) and not dfhack.units.isFortControlled(u)) then
                s.hostiles = s.hostiles + 1
            elseif dfhack.units.isMerchant(u) then
                s.merchants = s.merchants + 1
            elseif dfhack.units.isVisitor(u) then
                s.visitors = s.visitors + 1
            elseif dfhack.units.isAnimal(u) and dfhack.units.isTame(u) then
                s.tame_animals = s.tame_animals + 1
                if dfhack.units.isWar(u) then s.war_animals = s.war_animals + 1 end
            end
        end
    end

    for _, job in utils.listpairs(df.global.world.jobs.list) do
        s.jobs_total = s.jobs_total + 1
        if job.flags.suspend then s.jobs_suspended = s.jobs_suspended + 1 end
    end

    for _, entry in ipairs(STOCK_KEYS) do
        local n = count_stock(entry[3])
        s.stocks[#s.stocks + 1] = {key = entry[1], label = entry[2], count = n}
    end

    s.wealth = try(function()
        local w = df.global.plotinfo.tasks.wealth
        return {
            total = w.total, weapons = w.weapons, armor = w.armor, furniture = w.furniture,
            other = w.other, architecture = w.architecture, displayed = w.displayed,
            held = w.held, imported = w.imported, exported = w.exported,
        }
    end)

    -- Alerts -----------------------------------------------------------------
    local alerts = s.alerts
    local function alert(kind, title, detail, count, severity)
        alerts[#alerts + 1] = {kind = kind, title = title, detail = detail, count = count, severity = severity}
    end

    if s.hostiles > 0 then
        alert('hostile', 'Dangerous creatures on the map',
            s.hostiles .. ' hostile or dangerous creature(s) are on your map.', s.hostiles, 'danger')
    end
    if #stressed > 0 then
        alert('stress', 'Dwarves in a bad way', table.concat(stressed, '; '), #stressed, 'warning')
    end
    if #injured > 0 then
        alert('injury', 'Injured citizens', table.concat(injured, '; '), #injured, 'info')
    end
    local drink = count_stock('DRINK')
    local meals = count_stock('FOOD')
    local pop = s.adults + s.children + s.babies
    if pop > 0 then
        if drink < pop * 5 then
            alert('supply', 'Drink is running low', drink .. ' drinks for ' .. pop .. ' citizens.', drink, drink < pop * 2 and 'danger' or 'warning')
        end
        if meals + count_stock('MEAT') + count_stock('FISH') + count_stock('PLANT') < pop * 3 then
            alert('supply', 'Food is running low', 'Fewer than three portions per citizen in stock.', meals, 'warning')
        end
    end
    -- Repeating cancellations from the recent announcements.
    local groups, order = {}, {}
    for _, row in ipairs(announcement_rows) do
        local task, reason = parse_cancellation(row[5])
        if task then
            local key = task .. '|' .. reason
            if not groups[key] then
                groups[key] = {task = task, reason = reason, count = 0}
                order[#order + 1] = key
            end
            groups[key].count = groups[key].count + 1
        end
    end
    table.sort(order, function(a, b) return groups[a].count > groups[b].count end)
    for i = 1, math.min(#order, 8) do
        local g = groups[order[i]]
        if g.count >= 2 then
            alert('cancellation', g.task .. ' keeps failing', g.reason, g.count, 'warning')
        end
    end
    local moods = 0
    for _, u in ipairs(df.global.world.units.active) do
        if dfhack.units.isCitizen(u, true) and u.mood >= 0 then moods = moods + 1 end
    end
    if moods > 0 then
        alert('mood', 'Strange mood', moods .. ' dwarf(s) are in a strange mood.', moods, 'info')
    end
    return s
end

-- ---------------------------------------------------------------------------
-- Map
-- ---------------------------------------------------------------------------

-- Bits of tile_designation worth keeping: flow_size, pile, dig, smooth, hidden,
-- light, subterranean, outside, liquid_type, traffic.
local FLAG_MASK = 0x0321C3FF

local function write_map(f)
    local map = df.global.world.map
    local seen = {}
    f:write(string.format('{"x_count":%d,"y_count":%d,"z_count":%d,"blocks":[', map.x_count, map.y_count, map.z_count))
    local first = true
    for _, block in ipairs(map.map_blocks) do
        local tt, des = block.tiletype, block.designation
        local tiles, flags = {}, {}
        local tv, tn, fv, fn = nil, 0, nil, 0
        for x = 0, 15 do
            local col, dcol = tt[x], des[x]
            for y = 0, 15 do
                local t = col[y]
                if t == tv then tn = tn + 1
                else
                    if tv ~= nil then tiles[#tiles + 1] = tv; tiles[#tiles + 1] = tn end
                    tv, tn = t, 1
                    seen[t] = true
                end
                local w = dcol[y].whole & FLAG_MASK
                if w == fv then fn = fn + 1
                else
                    if fv ~= nil then flags[#flags + 1] = fv; flags[#flags + 1] = fn end
                    fv, fn = w, 1
                end
            end
        end
        tiles[#tiles + 1] = tv; tiles[#tiles + 1] = tn
        flags[#flags + 1] = fv; flags[#flags + 1] = fn
        local pos = block.map_pos
        f:write(first and '' or ',')
        first = false
        f:write(string.format('[%d,%d,%d,[%s],[%s]]', pos.z, pos.x // 16, pos.y // 16,
            table.concat(tiles, ','), table.concat(flags, ',')))
    end
    f:write('],"tiletypes":{')
    local first_tt = true
    for id in pairs(seen) do
        local attrs = df.tiletype.attrs[id]
        f:write(first_tt and '' or ',')
        first_tt = false
        f:write(string.format('"%d":{"name":%s,"shape":%s,"material":%s}', id,
            jstr(enum_name(df.tiletype, id)),
            jstr(enum_name(df.tiletype_shape, attrs.shape)),
            jstr(enum_name(df.tiletype_material, attrs.material))))
    end
    f:write('}}')
end

-- ---------------------------------------------------------------------------
-- Write everything
-- ---------------------------------------------------------------------------

local function write_table(f, columns, rows)
    f:write('{"columns":' .. jval(columns) .. ',"rows":[')
    for i, row in ipairs(rows) do
        if i > 1 then f:write(',') end
        f:write(jval(row))
    end
    f:write(']}')
end

local function run()
    local world = collect_world()

    local unit_rows = {}
    for _, u in ipairs(df.global.world.units.active) do
        unit_rows[#unit_rows + 1] = unit_row(u)
    end

    local item_rows = {}
    for _, it in ipairs(df.global.world.items.all) do
        if not it.flags.garbage_collect then
            item_rows[#item_rows + 1] = item_row(it)
        end
    end

    local building_rows = {}
    for _, b in ipairs(df.global.world.buildings.all) do
        building_rows[#building_rows + 1] = building_row(b)
    end

    local job_rows = {}
    for _, job in utils.listpairs(df.global.world.jobs.list) do
        job_rows[#job_rows + 1] = job_row(job)
    end

    local announcement_rows = collect_announcements(400)
    local summary = collect_summary(unit_rows, #item_rows, #building_rows, announcement_rows)

    local tmp_path = out_path .. '.tmp'
    local f = assert(io.open(tmp_path, 'wb'))
    f:write('{"status":"live","dump_version":' .. DUMP_VERSION)
    f:write(',"world":' .. jval(world))
    f:write(',"summary":' .. jval(summary))
    f:write(',"units":'); write_table(f, UNIT_COLUMNS, unit_rows)
    f:write(',"items":'); write_table(f, ITEM_COLUMNS, item_rows)
    f:write(',"buildings":'); write_table(f, BUILDING_COLUMNS, building_rows)
    f:write(',"jobs":'); write_table(f, JOB_COLUMNS, job_rows)
    f:write(',"announcements":'); write_table(f, ANNOUNCEMENT_COLUMNS, announcement_rows)
    if with_map then
        f:write(',"map":'); write_map(f)
    else
        f:write(',"map":null')
    end
    local elapsed = dfhack.getTickCount() - t_start
    f:write(',"elapsed_ms":' .. elapsed .. '}')
    local bytes = f:seek('end')
    f:close()
    os.remove(out_path)
    local ok, err = os.rename(tmp_path, out_path)
    if not ok then error('rename failed: ' .. tostring(err)) end
    return bytes, elapsed
end

local ok, bytes_or_err, elapsed = pcall(run)
if ok then
    print(string.format('OK %d %d', bytes_or_err, elapsed))
else
    pcall(os.remove, out_path .. '.tmp')
    print('ERR ' .. tostring(bytes_or_err))
end
