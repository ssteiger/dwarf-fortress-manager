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
-- While it runs, <out_path>.progress holds the step it is on (world, units,
-- items, buildings, jobs, announcements, diplomacy, writing, map). Console text only
-- reaches the worker once the script has finished; the file can be read while
-- the game is still paused. Manager orders and squads are read in the jobs
-- step, artifacts and the figures items name in the items step.
--
-- Nothing in here writes to game state.

local DUMP_VERSION = 11

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
local progress_path = out_path .. '.progress'

local function progress(step)
    local f = io.open(progress_path, 'wb')
    if f then
        f:write(step)
        f:close()
    end
end

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
    'id', 'name', 'name_english', 'readable', 'nickname', 'race', 'caste', 'sex', 'age',
    'profession', 'x', 'y', 'z', 'stress', 'stress_category', 'job_id', 'job',
    'squad_id', 'squad', 'wounds', 'blood', 'blood_max', 'hunger', 'thirst',
    'sleepiness', 'mood', 'flags', 'skills', 'inventory', 'positions',
    'hist_figure_id', 'civ_id', 'race_id', 'caste_id', 'look',
    'traits', 'values', 'thoughts', 'sheet', 'strange_mood',
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

-- Facets the game would remark on (outside the unremarkable 41–60 band),
-- strongest first. Values are beliefs; thoughts are the current emotions.
local function unit_traits(pers)
    local traits = arr{}
    local list = {}
    local i = 0
    while i < 80 do
        local name = df.personality_facet_type[i]
        if type(name) ~= 'string' then break end
        local val = tonumber(pers.traits[i])
        if val and (val <= 40 or val >= 61) then
            list[#list + 1] = {name, val}
        end
        i = i + 1
    end
    table.sort(list, function(a, b) return math.abs(a[2] - 50) > math.abs(b[2] - 50) end)
    for n = 1, #list do traits[n] = arr(list[n]) end
    return traits
end

local function unit_values(pers)
    local values = arr{}
    local list = {}
    for _, v in ipairs(pers.values) do
        local name = enum_name(df.value_type, v.type)
        local strength = tonumber(v.strength) or 0
        if name and name ~= 'NONE' and strength ~= 0 then
            list[#list + 1] = {name, strength}
        end
    end
    table.sort(list, function(a, b) return math.abs(a[2]) > math.abs(b[2]) end)
    for n = 1, math.min(#list, 12) do values[n] = arr(list[n]) end
    return values
end

local function unit_thoughts(pers)
    local thoughts = arr{}
    local list = {}
    for _, e in ipairs(pers.emotions) do
        local thought = enum_name(df.unit_thought_type, e.thought)
        if thought and thought ~= 'None' then
            list[#list + 1] = {
                thought,
                enum_name(df.emotion_type, e.type) or '',
                tonumber(e.strength) or 0,
                tonumber(e.year) or 0,
                tonumber(e.year_tick) or 0,
            }
        end
    end
    table.sort(list, function(a, b)
        if a[4] ~= b[4] then return a[4] > b[4] end
        return a[5] > b[5]
    end)
    for n = 1, math.min(#list, 16) do thoughts[n] = arr(list[n]) end
    return thoughts
end

local function unit_mind(u)
    local empty = arr{}
    local soul = try(function() return u.status.current_soul end)
    local pers = soul and try(function() return soul.personality end)
    if not pers then return empty, empty, empty end
    local traits = try(unit_traits, pers) or empty
    local values = try(unit_values, pers) or empty
    local thoughts = try(unit_thoughts, pers) or empty
    return traits, values, thoughts
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

-- Syndromes such as inebriation register as painless wounds that damage
-- nothing. They are not injuries.
local function is_syndrome_effect(w)
    if w.syndrome_id < 0 or w.pain > 0 or w.flags.whole ~= 0 then return false end
    for _, p in ipairs(w.parts) do
        if p.flags1.whole ~= 0 or p.flags2.whole ~= 0 or #p.effect_type > 0
            or p.bleeding > 0 or p.pain > 0 then
            return false
        end
    end
    return true
end

local function injury_count(u)
    local n = 0
    for _, w in ipairs(u.body.wounds) do
        if not try(is_syndrome_effect, w) then n = n + 1 end
    end
    return n
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

-- ---------------------------------------------------------------------------
-- Unit look: everything the graphics raws' layer conditions read, so the web
-- app can composite a unit exactly like the game does (see
-- apps/worker/src/scripts/extract-assets.ts for the rule side).
-- ---------------------------------------------------------------------------

-- Descriptor colour index -> token such as DARK_BROWN.
local function color_token(idx)
    if idx == nil or idx < 0 then return nil end
    local c = try(function() return df.global.world.raws.descriptors.colors[idx] end)
    return c and c.id or nil
end

-- Colour pattern id -> the token the graphics raws compare against.
local function pattern_color_token(pattern_id)
    local pattern = try(function() return df.global.world.raws.descriptors.patterns[pattern_id] end)
    if not pattern then return nil end
    local ptype = tonumber(pattern.pattern) or 0
    -- Eye patterns list sclera, pupil, iris; the iris is the colour people mean.
    local slot = (ptype == 2 or ptype == 4) and 2 or 0
    local idx = try(function() return pattern.colors[slot] end)
    if idx == nil then idx = try(function() return pattern.colors[0] end) end
    return color_token(idx)
end

-- CONDITION_PROFESSION_CATEGORY compares against the top of the profession
-- tree (MINER, FARMER, STANDARD, CHILD, ...), reached through parent links.
local function profession_category(u)
    local pid = u.profession
    for _ = 1, 8 do
        local parent = try(function() return df.profession.attrs[pid].parent end)
        if parent == nil or parent < 0 then break end
        pid = parent
    end
    return enum_name(df.profession, pid)
end

local function syn_classes(u)
    local out, seen = arr{}, {}
    local active = try(function() return u.syndromes.active end)
    if not active then return out end
    for _, us in ipairs(active) do
        local syn = df.syndrome.find(us.type)
        if syn then
            for _, c in ipairs(syn.syn_class) do
                local v = tostring(c.value)
                if not seen[v] then
                    seen[v] = true
                    out[#out + 1] = v
                end
            end
        end
    end
    return out
end

local function body_part_ref(caste, idx)
    local bp = try(function() return caste.body_info.body_parts[idx] end)
    if not bp then return nil, nil end
    return tostring(bp.token), tostring(bp.category)
end

local function layer_name(caste, bp_idx, layer_idx)
    return try(function() return caste.body_info.body_parts[bp_idx].layers[layer_idx].layer_name end)
end

-- Body parts as [token, category, missing] so BP_PRESENT / BP_MISSING can be
-- answered for parts the creature has, and denied for parts it never had.
local function unit_parts(u, caste)
    local parts = arr{}
    local bps = try(function() return caste.body_info.body_parts end)
    if not bps then return parts end
    for i, bp in ipairs(bps) do
        local missing = try(function() return u.body.components.body_part_status[i].missing end) == true
        parts[#parts + 1] = arr{tostring(bp.token), tostring(bp.category), missing and 1 or 0}
    end
    return parts
end

-- Tissue layers with a colour and/or a style: skin, hair, beard, eyebrows,
-- eyes. Each entry: {bps = {tokens}, cat, layer, color, length, style, curly, dense}.
local function unit_tissues(u, caste)
    local entries = {}
    local order = {}
    local function entry_for(bp_idx, l_idx)
        local key = bp_idx .. ':' .. l_idx
        local e = entries[key]
        if not e then
            local token, cat = body_part_ref(caste, bp_idx)
            if not token then return nil end
            e = {bp = token, cat = cat, layer = tostring(layer_name(caste, bp_idx, l_idx) or '')}
            entries[key] = e
            order[#order + 1] = key
        end
        return e
    end

    -- Colours: caste.color_modifiers[k] paints (body_part_id[j], tissue_layer_id[j])
    -- with pattern_index[unit.appearance.colors[k]]. Several modifiers can
    -- cover the same layer with a start/end age in days (hair greys at 80,
    -- whitens at 130); the one whose window holds the unit's age wins, and
    -- a 0..0 window is the lifelong default.
    local age_days = math.floor((try(dfhack.units.getAge, u, true) or 0) * 336)
    local mods = try(function() return caste.color_modifiers end)
    if mods then
        local applied = {}
        for k, mod in ipairs(mods) do
            local start_day = tonumber(mod.start_date) or 0
            local end_day = tonumber(mod.end_date) or 0
            local timed = not (start_day == 0 and end_day == 0)
            local active = not timed or (age_days >= start_day and (end_day <= 0 or age_days < end_day))
            if active then
                local choice = try(function() return u.appearance.colors[k] end)
                local pattern_id = choice and try(function() return mod.pattern_index[choice] end)
                local color = pattern_id and pattern_color_token(pattern_id) or nil
                local n = try(function() return #mod.body_part_id end) or 0
                for j = 0, n - 1 do
                    local e = entry_for(mod.body_part_id[j], mod.tissue_layer_id[j])
                    if e then
                        local key = mod.body_part_id[j] .. ':' .. mod.tissue_layer_id[j]
                        -- A timed window beats the lifelong default.
                        if timed or not applied[key] then
                            e.color = color
                            applied[key] = timed
                        end
                    end
                end
            end
        end
    end

    -- Length and styling: unit.appearance.tissue_length/tissue_style[i] belong
    -- to the layer at bp_appearance.style_part_idx[i] / style_layer_idx[i].
    -- Style is the tissue_style_type enum (-1 when unstyled); a negative
    -- length means the layer is not grown.
    local bpa = try(function() return caste.bp_appearance end)
    if bpa then
        local n = try(function() return #bpa.style_part_idx end) or 0
        for i = 0, n - 1 do
            local e = entry_for(bpa.style_part_idx[i], bpa.style_layer_idx[i])
            if e then
                local length = try(function() return u.appearance.tissue_length[i] end)
                local style = try(function() return u.appearance.tissue_style[i] end)
                e.length = (length ~= nil and length >= 0) and length or nil
                e.style = (style ~= nil and style >= 0) and enum_name(df.tissue_style_type, style) or nil
                -- The graphics raws spell it the plural way.
                if e.style == 'PONY_TAIL' then e.style = 'PONY_TAILS' end
            end
        end
    end

    -- CURLY / DENSE are body-part appearance modifiers bound to a tissue layer.
    if bpa then
        local n = try(function() return #bpa.modifier_idx end) or 0
        for i = 0, n - 1 do
            local mod = try(function() return bpa.modifiers[bpa.modifier_idx[i]] end)
            local mtype = mod and enum_name(df.appearance_modifier_type, mod.modifier.type)
            if mtype == 'CURLY' or mtype == 'DENSE' then
                local l_idx = try(function() return bpa.layer_idx[i] end) or -1
                if l_idx >= 0 then
                    local e = entry_for(bpa.part_idx[i], l_idx)
                    if e then
                        e[mtype == 'CURLY' and 'curly' or 'dense'] = try(function() return u.appearance.bp_modifiers[i] end)
                    end
                end
            end
        end
    end

    -- Collapse identical parts (every skin patch shares one colour) into one
    -- entry that lists the body part tokens it covers.
    local merged, out = {}, arr{}
    for _, key in ipairs(order) do
        local e = entries[key]
        local sig = table.concat({e.cat, e.layer, tostring(e.color), tostring(e.length),
            tostring(e.style), tostring(e.curly), tostring(e.dense)}, '|')
        local m = merged[sig]
        if not m then
            m = {bps = arr{}, cat = e.cat, layer = e.layer, color = e.color, length = e.length,
                style = e.style, curly = e.curly, dense = e.dense}
            merged[sig] = m
            out[#out + 1] = m
        end
        m.bps[#m.bps + 1] = e.bp
    end
    return out
end

-- Body part appearance modifiers (ROUND_VS_NARROW on the nose, ...) as
-- [bp token, category, type, value]; body-wide ones as [type, value].
local function unit_modifiers(u, caste)
    local bp_mods, body_mods = arr{}, arr{}
    local bpa = try(function() return caste.bp_appearance end)
    if bpa then
        local n = try(function() return #bpa.modifier_idx end) or 0
        for i = 0, n - 1 do
            local mod = try(function() return bpa.modifiers[bpa.modifier_idx[i]] end)
            local mtype = mod and enum_name(df.appearance_modifier_type, mod.modifier.type)
            local token, cat = body_part_ref(caste, try(function() return bpa.part_idx[i] end) or -1)
            local value = try(function() return u.appearance.bp_modifiers[i] end)
            if mtype and token and value ~= nil then
                bp_mods[#bp_mods + 1] = arr{token, cat, mtype, value}
            end
        end
    end
    local body = try(function() return caste.body_appearance_modifiers end)
    if body then
        for i, mod in ipairs(body) do
            local value = try(function() return u.appearance.body_modifiers[i] end)
            local mtype = try(function() return mod.modifier.type end)
            if value ~= nil and mtype ~= nil then
                body_mods[#body_mods + 1] = arr{enum_name(df.appearance_modifier_type, mtype), value}
            end
        end
    end
    return bp_mods, body_mods
end

-- Material facts the graphics raws test with CONDITION_MATERIAL_FLAG / _TYPE
-- and the colour USE_STANDARD_PALETTE_FROM_ITEM paints with.
local MATERIAL_FLAG_NAMES = {
    {'WOOD', 'ANY_WOOD_MATERIAL'},
    {'LEATHER', 'ANY_LEATHER_MATERIAL'},
    {'BONE', 'ANY_BONE_MATERIAL'},
    {'SHELL', 'ANY_SHELL_MATERIAL'},
    {'IS_STONE', 'ANY_STONE_MATERIAL'},
    {'IS_METAL', 'ANY_METAL_MATERIAL'},
    {'IS_GEM', 'ANY_GEM_MATERIAL'},
    {'HORN', 'ANY_HORN_MATERIAL'},
    {'TOOTH', 'ANY_TOOTH_MATERIAL'},
    {'PEARL', 'ANY_PEARL_MATERIAL'},
    {'SILK', 'ANY_SILK_MATERIAL'},
    {'YARN', 'ANY_YARN_MATERIAL'},
    {'THREAD_PLANT', 'ANY_PLANT_CLOTH_MATERIAL'},
}

local function item_dye_color(item)
    local imps = try(function() return item.improvements end)
    if not imps then return nil end
    for _, imp in ipairs(imps) do
        -- Since dye mixing and tinting (51.x) the cloth, thread or
        -- coloration improvement records the colour the dyes came out as.
        local mixed = color_token(try(function() return imp.dye_profile.color_index end))
        if mixed then return mixed end
        local mat_type = try(function() return imp.dye.mat_type end)
        local mat_index = try(function() return imp.dye.mat_index end)
        if mat_type ~= nil and mat_type >= 0 then
            local mi = try(dfhack.matinfo.decode, mat_type, mat_index)
            local idx = mi and try(function() return mi.material.powder_dye end)
            local token = color_token(idx)
            if token then return token end
        end
    end
    return nil
end

local WORN_MODES = {Weapon = true, Worn = true, Piercing = true, Flask = true,
    WrappedAround = true, Strapped = true}

local function unit_worn(u, caste)
    local worn = arr{}
    local mode_enum = try(function() return df.unit_inventory_item.T_mode end)
    for _, entry in ipairs(u.inventory) do
        local item = entry.item
        local mode = tonumber(entry.mode) or -1
        local mode_name = (mode_enum and try(function() return mode_enum[mode] end))
            or INVENTORY_MODES[mode] or tostring(mode)
        if item and WORN_MODES[tostring(mode_name)] then
            local token, cat = body_part_ref(caste, entry.body_part_id)
            local flags = arr{}
            local mtype, color = nil, nil
            local mi = try(dfhack.matinfo.decode, item)
            if mi then
                mtype = mi.mode and tostring(mi.mode):upper() or nil
                local mat = mi.material
                if mat then
                    color = color_token(try(function() return mat.state_color.Solid end))
                    local woven = false
                    for _, pair in ipairs(MATERIAL_FLAG_NAMES) do
                        if try(function() return mat.flags[pair[1]] end) == true then
                            flags[#flags + 1] = pair[2]
                            if pair[1] == 'SILK' or pair[1] == 'YARN' or pair[1] == 'THREAD_PLANT' then
                                woven = true
                            end
                        end
                    end
                    -- Cloth of any fibre: what the raws call a woven item.
                    if woven then flags[#flags + 1] = 'WOVEN_ITEM' end
                end
            end
            if try(function() return item.flags.artifact end) == true then
                flags[#flags + 1] = 'IS_CRAFTED_ARTIFACT'
            else
                flags[#flags + 1] = 'NOT_ARTIFACT'
            end
            if try(function() return item.flags2.grown end) == true then
                flags[#flags + 1] = 'GROWN_NOT_CRAFTED'
            end
            local dye = item_dye_color(item)
            worn[#worn + 1] = {
                item_id = item.id,
                mode = tostring(mode_name),
                bp = token,
                cat = cat,
                type = enum_name(df.item_type, item:getType()),
                subtype = try(function() return item.subtype.id end),
                quality = try(function() return item:getQuality() end) or 0,
                material_type = mtype,
                color = dye or color,
                dyed = dye ~= nil,
                flags = flags,
            }
        end
    end
    return worn
end

-- Procedurally generated races (forgotten beasts, titans, demons, night
-- creatures) have no sprite in the raws; the game assembles one from a body
-- plan silhouette plus overlays. These are the facts that assembly reads:
-- what kind of thing it is, its body part categories, its tissues, the
-- colour of its outer material, and the generator's own description.
local GENERATED_KIND_FLAGS = {
    {'TITAN', 'TITAN'},
    {'UNIQUE_DEMON', 'DEMON'},
    {'DEMON', 'DEMON'},
    {'NIGHT_CREATURE_HUNTER', 'NIGHT_CREATURE'},
    {'NIGHT_CREATURE_BOGEYMAN', 'NIGHT_CREATURE'},
    {'NIGHT_CREATURE_EXPERIMENTER', 'NIGHT_CREATURE'},
    {'NIGHT_CREATURE', 'NIGHT_CREATURE'},
    {'FEATURE_BEAST', 'FEATURE_BEAST'},
    {'MEGABEAST', 'MEGABEAST'},
    {'SEMIMEGABEAST', 'MEGABEAST'},
}

-- Outer covering first: the tissue whose colour the beast shows.
local OUTER_TISSUES = {'UNIFORM_TIS', 'FEATHER', 'SCALE', 'CHITIN', 'SHELL', 'HAIR', 'SKIN', 'FAT', 'MUSCLE'}

local function generated_look(craw, caste)
    local kind = 'OTHER'
    for _, pair in ipairs(GENERATED_KIND_FLAGS) do
        if try(function() return caste.flags[pair[1]] end) == true then
            kind = pair[2]
            break
        end
    end
    local cats = {}
    local bps = try(function() return caste.body_info.body_parts end)
    if bps then
        for _, bp in ipairs(bps) do
            local c = tostring(bp.category)
            cats[c] = (cats[c] or 0) + 1
        end
    end
    local tissues = arr{}
    local by_id = {}
    local list = try(function() return craw.tissue end)
    if list then
        for _, t in ipairs(list) do
            local id = tostring(t.id)
            tissues[#tissues + 1] = id
            by_id[id] = t
        end
    end
    local color = nil
    for _, id in ipairs(OUTER_TISSUES) do
        local t = by_id[id]
        if t then
            local mi = try(dfhack.matinfo.decode, t.mat_type, t.mat_index)
            color = mi and color_token(try(function() return mi.material.state_color.Solid end)) or nil
            if color then break end
        end
    end
    return {
        kind = kind,
        description = tostring(try(function() return caste.description end) or ''),
        cats = cats,
        tissues = tissues,
        color = color,
        flier = try(function() return caste.flags.FLIER end) == true,
    }
end

-- The game colours clothing by profession only while the dye display
-- (DISPLAY_CLOTHING_WITH_DYES_IN_FORT_MODE) is off.
local PROFESSION_COLORS = try(function()
    return not df.global.d_init.display.flags.FORT_SHOW_CLOTHING_DYES
end)

local function unit_look_inner(u, craw)
    local caste = try(function() return craw.caste[u.caste] end)
    if not caste then return nil end
    local haul = 0
    for _, entry in ipairs(u.inventory) do
        if tonumber(entry.mode) == 0 then haul = haul + 1 end
    end
    local bp_mods, body_mods = unit_modifiers(u, caste)
    return {
        profession_category = profession_category(u),
        profession_colors = PROFESSION_COLORS,
        syn_classes = syn_classes(u),
        haul_count = haul,
        body_size = try(function() return u.body.size_info.size_cur end) or 0,
        tissues = unit_tissues(u, caste),
        bp_modifiers = bp_mods,
        body_modifiers = body_mods,
        parts = unit_parts(u, caste),
        worn = unit_worn(u, caste),
        generated = (try(function() return craw.flags.GENERATED end) == true)
            and generated_look(craw, caste) or nil,
    }
end

-- A failure here must not lose the unit; record why instead so the web app
-- can fall back and the problem is visible in the dump.
local function unit_look(u, craw)
    if not craw then return nil end
    local ok, res = pcall(unit_look_inner, u, craw)
    if ok then return res end
    return {error = tostring(res)}
end

-- ---------------------------------------------------------------------------
-- Unit sheet: what the game's unit screens show beyond the columns above
-- (attributes, needs, preferences, dreams, memories, people, gods, groups,
-- wounds, labors), for the web app's character pages. Each section is read
-- on its own, so a failure empties that section and keeps the rest.
-- ---------------------------------------------------------------------------

local function nonempty(s)
    if s == nil or s == '' then return nil end
    return s
end

local function hf_find(hfid)
    if hfid == nil or hfid < 0 then return nil end
    return df.historical_figure.find(hfid)
end

local function race_label(race)
    local craw = df.creature_raw.find(race)
    return craw and craw.name[0] or nil
end

-- [token, 'P' or 'M', effective value, potential, the caste's 7 range cutoffs].
local function sheet_attributes(u, caste)
    local out = arr{}
    local function add(kind, enum, value_of, attrs, ranges)
        for i = enum._first_item, enum._last_item do
            local r = ranges[i]
            out[#out + 1] = arr{
                enum[i], kind, value_of(u, i), attrs[i].max_value,
                arr{r[0], r[1], r[2], r[3], r[4], r[5], r[6]},
            }
        end
    end
    add('P', df.physical_attribute_type, dfhack.units.getPhysicalAttrValue,
        u.body.physical_attrs, caste.attributes.phys_att_range)
    local soul = u.status.current_soul
    if soul then
        add('M', df.mental_attribute_type, dfhack.units.getMentalAttrValue,
            soul.mental_attrs, caste.attributes.ment_att_range)
    end
    return out
end

-- Every skill with any rating or experience: [token, rating, experience
-- toward the next level, rust, skill class, whether its labor is enabled
-- (null for skills without one)].
local function sheet_skills(u)
    local out = arr{}
    local soul = u.status.current_soul
    if not soul then return out end
    local list = {}
    for _, sk in ipairs(soul.skills) do
        if sk.rating > 0 or sk.experience > 0 then
            local attrs = df.job_skill.attrs[sk.id]
            local enabled = nil
            if attrs.labor ~= nil and attrs.labor >= 0 then
                enabled = u.status.labors[attrs.labor] == true
            end
            list[#list + 1] = {
                enum_name(df.job_skill, sk.id),
                sk.rating,
                sk.experience,
                sk.rusty,
                enum_name(df.job_skill_class, attrs.type),
                enabled,
            }
        end
    end
    table.sort(list, function(a, b)
        if a[2] ~= b[2] then return a[2] > b[2] end
        return a[3] > b[3]
    end)
    for i = 1, math.min(#list, 60) do out[i] = row(table.unpack(list[i], 1, 6)) end
    return out
end

-- [need token, focus level, how fast it drains, deity name for prayer].
local function sheet_needs(pers)
    local out = arr{}
    for _, need in ipairs(pers.needs) do
        local deity = need.deity_id >= 0 and hf_find(need.deity_id) or nil
        out[#out + 1] = row(
            enum_name(df.need_type, need.id),
            need.focus_level,
            need.need_level,
            deity and nonempty(translate(deity.name, false)) or nil
        )
    end
    table.sort(out, function(a, b) return a[2] < b[2] end)
    return out
end

-- "beet plant plant" -> "beet plant".
local function mat_label(mattype, matindex)
    local info = try(dfhack.matinfo.decode, mattype, matindex)
    local name = info and try(function() return info:toString() end)
    return name and (name:gsub('(%a+) %1$', '%1')) or nil
end

local function pluralize(noun)
    if noun:match('s$') then return noun end
    if noun:match('[xz]$') or noun:match('[cs]h$') then return noun .. 'es' end
    if noun:match('[^aeiou]y$') then return noun:sub(1, -2) .. 'ies' end
    return noun .. 's'
end

local function item_type_label(item_type, subtype, plural)
    if subtype ~= nil and subtype >= 0 then
        local def = try(dfhack.items.getSubtypeDef, item_type, subtype)
        local name = def and try(function() return plural and def.name_plural or def.name end)
        if name and name ~= '' then return name end
    end
    local caption = try(function() return df.item_type.attrs[item_type].caption end)
        or (enum_name(df.item_type, item_type) or ''):lower():gsub('_', ' ')
    if caption == '' then return nil end
    return plural and pluralize(caption) or caption
end

local function art_form_label(list, id)
    local form = try(function() return list[id] end)
    return form and nonempty(translate(form.name, true)) or nil
end

-- [kind, what they like, in words].
local function sheet_preferences(soul)
    local out = arr{}
    local raws = df.global.world.raws
    for _, p in ipairs(soul.preferences) do
        local kind = enum_name(df.unitpref_type, p.type)
        local text
        if kind == 'LikeMaterial' then
            text = mat_label(p.mattype, p.matindex)
        elseif kind == 'LikeFood' then
            local mat = mat_label(p.mattype, p.matindex)
            local what = item_type_label(p.item_type, p.item_subtype, false)
            text = mat and ((what == 'meat' or what == 'fish') and (mat .. ' (' .. what .. ')') or mat) or what
        elseif kind == 'LikeCreature' or kind == 'HateCreature' then
            text = try(function() return raws.creatures.all[p.creature_id].name[1] end)
        elseif kind == 'LikeItem' then
            text = item_type_label(p.item_type, p.item_subtype, true)
        elseif kind == 'LikePlant' or kind == 'LikeTree' then
            text = try(function() return raws.plants.all[p.plant_id].name_plural end)
        elseif kind == 'LikeColor' then
            text = try(function() return raws.descriptors.colors[p.color_id].name end)
        elseif kind == 'LikeShape' then
            text = try(function() return raws.descriptors.shapes[p.shape_id].name_plural end)
        elseif kind == 'LikePoeticForm' then
            text = art_form_label(df.global.world.poetic_forms.all, p.poetic_form_id)
        elseif kind == 'LikeMusicalForm' then
            text = art_form_label(df.global.world.musical_forms.all, p.musical_form_id)
        elseif kind == 'LikeDanceForm' then
            text = art_form_label(df.global.world.dance_forms.all, p.dance_form_id)
        end
        if kind and text and text ~= '' then out[#out + 1] = arr{kind, text} end
    end
    return out
end

-- [goal token, realised, the game's short name].
local function sheet_dreams(pers)
    local out = arr{}
    for _, d in ipairs(pers.dreams) do
        out[#out + 1] = row(
            enum_name(df.goal_type, d.type),
            d.flags.accomplished == true,
            try(function() return df.goal_type.attrs[d.type].short_name end)
        )
    end
    return out
end

-- Short- and long-term memories: [thought, emotion, strength, year, tick,
-- 'short' | 'long'], plus core memories that changed who they are:
-- [thought, emotion, year, tick, facet, old, new, value, old, new].
local function sheet_memories(pers)
    local out, core = arr{}, arr{}
    local mem = pers.memories
    if not mem then return out, core end
    local function add(slot, kind)
        for i = 0, 7 do
            local m = try(function() return slot[i] end)
            local thought = m and enum_name(df.unit_thought_type, m.thought)
            if thought and thought ~= 'None' and thought ~= '-1' then
                out[#out + 1] = row(
                    thought, enum_name(df.emotion_type, m.type) or '',
                    m.strength, m.year, m.year_tick, kind
                )
            end
        end
    end
    add(mem.shortterm, 'short')
    add(mem.longterm, 'long')
    for _, c in ipairs(mem.core_memories) do
        local m = c.memory
        local facet = c.changed_facet >= 0 and enum_name(df.personality_facet_type, c.changed_facet) or nil
        local value = c.changed_value >= 0 and enum_name(df.value_type, c.changed_value) or nil
        core[#core + 1] = row(
            enum_name(df.unit_thought_type, m.thought), enum_name(df.emotion_type, m.type) or '',
            m.year, m.year_tick,
            facet, facet and c.facet_old or nil, facet and c.facet_new or nil,
            value, value and c.value_old or nil, value and c.value_new or nil
        )
    end
    return out, core
end

local function person(hfid, kind)
    local hf = hf_find(hfid)
    if not hf then return nil end
    return {
        hf = hfid,
        kind = kind,
        name = nonempty(translate(hf.name, false)),
        name_english = nonempty(translate(hf.name, true)),
        race = race_label(hf.race),
        sex = hf.sex,
        alive = hf.died_year == -1,
        unit = hf.unit_id >= 0 and hf.unit_id or nil,
    }
end

-- Family, lovers and masters from the historical figure's links, then
-- everyone they have formed an opinion of. `kind` is a histfig_hf_link_type
-- (MOTHER, SPOUSE, ...) or, for opinions, "known" with the game's feelings.
local function sheet_people(hf)
    local out = arr{}
    local seen = {}
    for _, link in ipairs(hf.histfig_links) do
        local kind = enum_name(df.histfig_hf_link_type, link:getType())
        if kind and kind ~= 'DEITY' then
            local p = person(link.target_hf, kind)
            if p then
                seen[link.target_hf] = true
                out[#out + 1] = p
            end
        end
    end
    local profiles = try(function() return hf.info.relationships.hf_visual end)
    if not profiles then return out end
    local known = {}
    for _, rel in ipairs(profiles) do
        local core = rel.core
        local rank = enum_name(df.vague_relationship_type, rel.rank)
        local attitude = arr{}
        for _, a in ipairs(rel.attitude) do attitude[#attitude + 1] = enum_name(df.reputation_type, a) end
        if core.love ~= 0 or core.trust ~= 0 or core.respect ~= 0 or (rank and rank ~= 'none')
            or #attitude > 0 or rel.meet_count >= 10 then
            known[#known + 1] = {rel = rel, rank = rank, attitude = attitude}
        end
    end
    table.sort(known, function(a, b)
        local la, lb = math.abs(a.rel.core.love), math.abs(b.rel.core.love)
        if la ~= lb then return la > lb end
        return a.rel.meet_count > b.rel.meet_count
    end)
    local shown = 0
    for _, k in ipairs(known) do
        if shown >= 40 then break end
        local p = person(k.rel.histfig_id, 'known')
        if p then
            local core = k.rel.core
            p.love, p.trust, p.respect, p.loyalty, p.fear = core.love, core.trust, core.respect, core.loyalty, core.fear
            p.met = k.rel.meet_count
            p.rank = k.rank ~= 'none' and k.rank or nil
            p.attitude = k.attitude
            p.family = seen[k.rel.histfig_id] or nil
            out[#out + 1] = p
            shown = shown + 1
        end
    end
    return out
end

-- [name, worship strength, spheres].
local function sheet_deities(hf)
    local out = arr{}
    for _, link in ipairs(hf.histfig_links) do
        if link:getType() == df.histfig_hf_link_type.DEITY then
            local god = hf_find(link.target_hf)
            if god then
                local spheres = arr{}
                local list = try(function() return god.info.metaphysical.spheres end)
                if list then
                    for _, s in ipairs(list) do spheres[#spheres + 1] = enum_name(df.sphere_type, s) end
                end
                out[#out + 1] = row(nonempty(translate(god.name, false)) or '?', link.link_strength, spheres)
            end
        end
    end
    table.sort(out, function(a, b) return a[2] > b[2] end)
    return out
end

-- Religions, guilds, troupes, companies and civilizations: [name, entity type, link type].
local function sheet_groups(hf)
    local out = arr{}
    for _, link in ipairs(hf.entity_links) do
        local ltype = enum_name(df.histfig_entity_link_type, link:getType())
        local ent = df.historical_entity.find(link.entity_id)
        if ent and ltype then
            local etype = enum_name(df.historical_entity_type, ent.type)
            local name = nonempty(translate(ent.name, true))
            if name and etype ~= 'MigratingGroup' and etype ~= 'NomadicGroup' and etype ~= 'VesselCrew' then
                out[#out + 1] = arr{name, etype, ltype}
            end
        end
    end
    return out
end

local WOUND_LAYER_WORDS = {
    {'cut', 'cut open'}, {'smashed', 'smashed open'}, {'broken', 'broken'},
    {'edged_shake1', 'torn'}, {'joint_bend1', 'bent out of shape'}, {'gouged', 'gouged'},
    {'tendon_bruised', 'tendon bruised'}, {'tendon_strained', 'tendon strained'},
    {'tendon_torn', 'tendon torn'}, {'ligament_bruised', 'ligament bruised'},
    {'ligament_sprained', 'ligament sprained'}, {'ligament_torn', 'ligament torn'},
    {'motor_nerve_severed', 'motor nerve severed'}, {'sensory_nerve_severed', 'sensory nerve severed'},
    {'major_artery', 'major artery opened'}, {'artery', 'artery opened'},
    {'guts_spilled', 'guts spilled'}, {'compound_fracture', 'compound fracture'},
    {'overlapping_fracture', 'overlapping fracture'},
}
local WOUND_SCAR_FLAGS = {
    'scar_cut', 'scar_smashed', 'scar_edged_shake1', 'scar_broken', 'scar_blunt_shake1', 'scar_joint_bend1',
}
local WOUND_FLAG_WORDS = {
    {'severed_part', 'severed'}, {'infection', 'infected'}, {'stuck_weapon', 'something stuck in it'},
    {'sutured', 'sutured'}, {'diagnosed', 'diagnosed'},
}

-- One entry per wound: {parts = body part names, damage = words, flags =
-- words, pain, bleeding, syndrome = its name, effect = true when the
-- syndrome is all there is to it}.
local function sheet_wounds(u)
    local out = arr{}
    local bps = try(function() return u.body.body_plan.body_parts end)
    for _, w in ipairs(u.body.wounds) do
        local parts, damage, flags = arr{}, arr{}, arr{}
        local seen = {}
        local function add(list, word)
            if word and not seen[word] then
                seen[word] = true
                list[#list + 1] = word
            end
        end
        local bleeding = 0
        for _, part in ipairs(w.parts) do
            add(parts, try(function() return bps[part.body_part_id].name_singular[0].value end))
            for _, pair in ipairs(WOUND_LAYER_WORDS) do
                if try(function() return part.flags1[pair[1]] end) then add(damage, pair[2]) end
            end
            for _, e in ipairs(part.effect_type) do
                local name = enum_name(df.wound_effect_type, e)
                if name and name ~= 'NONE' then add(damage, name:lower()) end
            end
            if try(function() return part.flags2.needs_setting end) then add(damage, 'needs setting') end
            for _, s in ipairs(WOUND_SCAR_FLAGS) do
                if try(function() return part.flags1[s] end) then add(damage, 'scarred') end
            end
            bleeding = bleeding + (part.bleeding or 0)
        end
        for _, pair in ipairs(WOUND_FLAG_WORDS) do
            if try(function() return w.flags[pair[1]] end) then add(flags, pair[2]) end
        end
        local syn = w.syndrome_id >= 0 and df.syndrome.find(w.syndrome_id) or nil
        out[#out + 1] = {
            parts = parts, damage = damage, flags = flags,
            pain = w.pain, bleeding = bleeding,
            syndrome = syn and nonempty(syn.syn_name) or nil,
            effect = is_syndrome_effect(w) or nil,
        }
        if #out >= 30 then break end
    end
    return out
end

local function sheet_syndromes(u)
    local out, seen = arr{}, {}
    for _, us in ipairs(u.syndromes.active) do
        local syn = df.syndrome.find(us.type)
        local name = syn and nonempty(syn.syn_name)
        if name and not seen[name] then
            seen[name] = true
            out[#out + 1] = name
        end
    end
    return out
end

local function sheet_work_details(u)
    local out = arr{}
    for _, wd in ipairs(df.global.plotinfo.labor_info.work_details) do
        for _, id in ipairs(wd.assigned_units) do
            if id == u.id then
                out[#out + 1] = wd.name
                break
            end
        end
    end
    return out
end

local function unit_sheet_inner(u, craw)
    local caste = try(function() return craw.caste[u.caste] end)
    local soul = u.status.current_soul
    local pers = soul and soul.personality
    local hf = hf_find(u.hist_figure_id)
    local sheet = {
        attributes = caste and try(sheet_attributes, u, caste) or arr{},
        skills = try(sheet_skills, u) or arr{},
        needs = pers and try(sheet_needs, pers) or arr{},
        preferences = soul and try(sheet_preferences, soul) or arr{},
        dreams = pers and try(sheet_dreams, pers) or arr{},
        people = hf and try(sheet_people, hf) or arr{},
        deities = hf and try(sheet_deities, hf) or arr{},
        groups = hf and try(sheet_groups, hf) or arr{},
        wounds = try(sheet_wounds, u) or arr{},
        syndromes = try(sheet_syndromes, u) or arr{},
        work_details = try(sheet_work_details, u) or arr{},
        birth = (u.birth_year >= 0) and arr{u.birth_year, math.max(u.birth_time, 0)} or nil,
        kills = try(dfhack.units.getKillCount, u),
        pregnant = (try(function() return u.pregnancy_timer end) or 0) > 0 or nil,
        custom_profession = nonempty(try(function() return u.custom_profession end)),
        squad_position = u.military.squad_id >= 0 and u.military.squad_position or nil,
    }
    if pers then
        local ok, memories, core = pcall(sheet_memories, pers)
        sheet.memories = ok and memories or arr{}
        sheet.core_memories = ok and core or arr{}
        sheet.focus = try(function()
            if pers.undistracted_focus <= 0 then return nil end
            return math.floor(pers.current_focus * 100 / pers.undistracted_focus + 0.5)
        end)
        sheet.longterm_stress = try(function() return pers.longterm_stress end)
        sheet.combat_hardened = try(function() return pers.combat_hardened end)
        sheet.likes_outdoors = try(function() return pers.likes_outdoors end)
    end
    return sheet
end

local function unit_sheet(u, craw)
    if not craw then return nil end
    local ok, res = pcall(unit_sheet_inner, u, craw)
    if ok then return res end
    return {error = tostring(res)}
end

-- ---------------------------------------------------------------------------
-- Job requirements: what a job asks for (job.job_items.elements) and what has
-- been brought for it (job.items, matched by job_item_idx), in the words the
-- game's own screens use. Manager order conditions share the same fields.
-- ---------------------------------------------------------------------------

local JOB_ITEM_NOUNS = {
    BOULDER = {'boulder', 'boulders'}, BLOCKS = {'block', 'blocks'}, WOOD = {'log', 'logs'},
    BAR = {'bar', 'bars'}, SMALLGEM = {'cut gem', 'cut gems'}, ROUGH = {'rough gem', 'rough gems'},
    SKIN_TANNED = {'leather', 'leather'}, CLOTH = {'cloth', 'cloth'}, THREAD = {'thread', 'thread'},
    REMAINS = {'remains', 'remains'}, CORPSE = {'corpse', 'corpses'},
    CORPSEPIECE = {'body part', 'body parts'}, PLANT = {'plant', 'plants'}, SEEDS = {'seed', 'seeds'},
    POWDER_MISC = {'powder', 'powder'}, GLOB = {'glob', 'globs'}, DRINK = {'drink', 'drinks'},
}

-- Requirements with no item type that ask for a body part, by their flag.
local BODY_PART_NOUNS = {
    {'bone', 'bone', 'bones'}, {'shell', 'shell', 'shells'}, {'horn', 'horn', 'horns'},
    {'pearl', 'pearl', 'pearls'}, {'ivory_tooth', 'tooth', 'teeth'}, {'hair_wool', 'hair', 'hair'},
}

-- The material family a flag names when no material is set.
local MATERIAL_FLAG_WORDS = {
    {'silk', 'silk'}, {'plant', 'plant fibre'}, {'yarn', 'yarn'}, {'metal', 'metal'},
    {'glass', 'glass'}, {'leather', 'leather'}, {'bone', 'bone'}, {'soap', 'soap'},
}

local ITEM_FLAG_WORDS = {
    {'empty', 'empty'}, {'millable', 'millable'}, {'processable', 'processable'},
    {'murdered', 'murdered'}, {'non_economic', 'non-economic'},
}

-- The set flags of a job item, which are spread over three bitfields.
local function job_flags(e)
    local set = {}
    for _, field in ipairs{'flags1', 'flags2', 'flags3'} do
        pcall(function()
            for name, on in pairs(e[field]) do
                if on == true then set[name] = true end
            end
        end)
    end
    return set
end

-- has_material_reaction_product: what the material must be able to become.
local PRODUCT_WORDS = {
    DRINK_MAT = 'brewable', PRESS_LIQUID_MAT = 'pressable', HONEYCOMB_PRESS_MAT = 'pressable',
    SOAP_MAT = 'soap-making', PRESS_PAPER_MAT = 'paper-making', BAG_ITEM = 'bag-making',
}

-- Coal (builtin material 7) as a reagent: the forges burn either kind.
local FUEL_MAT_TYPE = 7

-- "silk cloth", "rough gems", "empty bag", "hematite boulder", "bones".
local function job_item_label(e, n)
    local plural = n ~= 1
    if e.item_type == df.item_type.BAR and e.mat_type == FUEL_MAT_TYPE then
        return plural and 'charcoal or coke bars' or 'charcoal or coke bar'
    end
    local flags = job_flags(e)
    local words = {}
    for _, w in ipairs(ITEM_FLAG_WORDS) do
        if flags[w[1]] then words[#words + 1] = w[2] end
    end
    local product = try(function() return e.has_material_reaction_product end)
    if product and product ~= '' then
        words[#words + 1] = PRODUCT_WORDS[product] or product:lower():gsub('_mat$', ''):gsub('_', ' ')
    end
    local class = try(function() return e.reaction_class end)
    if class and class ~= '' then words[#words + 1] = (class:lower():gsub('_', ' ')) end
    local noun, body_part = nil, false
    local tool_use = try(function() return e.has_tool_use >= 0 and df.tool_uses[e.has_tool_use] end)
    if tool_use then
        noun = tostring(tool_use):lower():gsub('_', ' ')
        if plural then noun = pluralize(noun) end
    elseif e.item_type < 0 and flags.food_storage then
        noun = plural and 'barrels or pots' or 'barrel or pot'
    elseif e.item_type < 0 then
        for _, b in ipairs(BODY_PART_NOUNS) do
            if flags[b[1]] then
                noun = plural and b[3] or b[2]
                body_part = true
                break
            end
        end
        noun = noun or (plural and 'items' or 'item')
    elseif e.item_subtype >= 0 then
        noun = item_type_label(e.item_type, e.item_subtype, plural)
    else
        local nouns = JOB_ITEM_NOUNS[enum_name(df.item_type, e.item_type)]
        noun = nouns and nouns[plural and 2 or 1] or item_type_label(e.item_type, -1, plural)
    end
    local mat = nil
    if e.mat_type >= 0 and not (e.mat_type == 0 and e.mat_index < 0) then
        mat = mat_label(e.mat_type, e.mat_index)
    end
    if not mat and not body_part then
        for _, w in ipairs(MATERIAL_FLAG_WORDS) do
            if flags[w[1]] then
                mat = w[2]
                break
            end
        end
    end
    if mat then words[#words + 1] = mat end
    words[#words + 1] = noun or '?'
    return table.concat(words, ' ')
end

-- One entry per requirement: {e, idx, need, have, div}. Bars, cloth and
-- thread are asked for in units of size (150 a bar, 10000 a cloth), so both
-- counts are divided by the size of one.
local function job_needs(job)
    local out = {}
    local elements = try(function() return job.job_items.elements end)
    if not elements then return out end
    for i, e in ipairs(elements) do
        local div = (e.min_dimension and e.min_dimension > 0) and e.min_dimension or 1
        local got = 0
        for _, ref in ipairs(job.items) do
            if ref.job_item_idx == i and ref.item then
                got = got + (div > 1 and (try(function() return ref.item:getTotalDimension() end) or div) or 1)
            end
        end
        got = math.floor(got / div)
        local need = math.floor(e.quantity / div)
        if need <= 0 then need = math.max(got, 1) end
        out[#out + 1] = {e = e, idx = i, need = need, have = got, div = div}
    end
    return out
end

-- Free items in play by item type, built the first time a mood asks.
local free_index = nil

local function free_candidates(item_type)
    if not free_index then
        free_index = {all = {}}
        for _, it in ipairs(df.global.world.items.other.IN_PLAY) do
            local f = it.flags
            if not (f.forbid or f.in_job or f.trader or f.removed or f.construction or f.in_building
                or f.owned or f.garbage_collect or f.dump or f.artifact) then
                local t = it:getType()
                local list = free_index[t]
                if not list then
                    list = {}
                    free_index[t] = list
                end
                list[#list + 1] = it
                free_index.all[#free_index.all + 1] = it
            end
        end
    end
    if item_type >= 0 then return free_index[item_type] or {} end
    return free_index.all
end

-- How much of a requirement the fortress could still hand over: items nobody
-- holds, claims or has forbidden, in the same units as `need`.
local function free_count(e, div)
    local n = 0
    for _, it in ipairs(free_candidates(e.item_type)) do
        local itype, isub = it:getType(), it:getSubtype()
        if (e.item_subtype < 0 or isub == e.item_subtype)
            and dfhack.job.isSuitableItem(e, itype, isub)
            and dfhack.job.isSuitableMaterial(e, it:getMaterial(), it:getMaterialIndex(), itype)
            and not dfhack.items.getHolderUnit(it) then
            if div > 1 then
                n = n + math.floor((try(function() return it:getTotalDimension() end) or 0) / div)
            else
                n = n + (try(function() return it:getStackSize() end) or 1)
            end
        end
    end
    return n
end

-- [label, need, have, item type] for every requirement of a job.
local function job_need_rows(job)
    local out = arr{}
    for _, n in ipairs(job_needs(job)) do
        out[#out + 1] = row(job_item_label(n.e, n.need), n.need, n.have,
            enum_name(df.item_type, n.e.item_type))
    end
    return out
end

local function job_state(job)
    local f = job.flags
    if f.working then return 'working' end
    if f.bringing then return 'bringing' end
    if f.fetching then return 'fetching' end
    if f.item_lost then return 'item_lost' end
    return nil
end

local STRANGE_MOODS = {Fey = true, Secretive = true, Possessed = true, Macabre = true, Fell = true}

local function is_mood_job(job)
    return try(function()
        return df.job_type_class[df.job_type.attrs[job.job_type].type] == 'StrangeMood'
    end) == true
end

-- What a dwarf in a strange mood is making and still lacks. The demands only
-- exist once they have claimed a workshop; `free` is counted for the ones
-- still short.
local function unit_strange_mood_inner(u, mood)
    local job = u.job.current_job
    local mood_job = job and is_mood_job(job)
    local holder = mood_job and try(dfhack.job.getHolder, job) or nil
    local needs = arr{}
    if mood_job then
        for _, n in ipairs(job_needs(job)) do
            needs[#needs + 1] = {
                label = job_item_label(n.e, n.need),
                item_type = enum_name(df.item_type, n.e.item_type),
                need = n.need,
                have = n.have,
                free = n.have < n.need and try(free_count, n.e, n.div) or nil,
            }
        end
    end
    local skill = try(function() return u.job.mood_skill end)
    return {
        type = mood,
        skill = (skill and skill >= 0) and enum_name(df.job_skill, skill) or nil,
        timeout = try(function() return u.job.mood_timeout end),
        job_id = mood_job and job.id or nil,
        job = mood_job and enum_name(df.job_type, job.job_type) or nil,
        building_id = holder and holder.id or nil,
        working = mood_job and job.flags.working or nil,
        needs = needs,
    }
end

local function unit_strange_mood(u, mood)
    if not STRANGE_MOODS[mood] then return nil end
    local ok, res = pcall(unit_strange_mood_inner, u, mood)
    if ok then return res end
    return {type = mood, needs = arr{}, error = tostring(res)}
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
    local traits, values, thoughts = unit_mind(u)
    -- Babies carry the mood "Baby" while they are being carried around; it
    -- is not a mood anyone would remark on.
    local mood = u.mood >= 0 and enum_name(df.mood_type, u.mood) or nil
    if mood == 'Baby' then mood = nil end
    return row(
        u.id,
        translate(visible_name, false),
        translate(visible_name, true),
        dfhack.units.getReadableName(u),
        try(function() return visible_name.nickname end),
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
        injury_count(u),
        try(function() return u.body.blood_count end),
        try(function() return u.body.blood_max end),
        try(function() return u.counters2.hunger_timer end) or 0,
        try(function() return u.counters2.thirst_timer end) or 0,
        try(function() return u.counters2.sleepiness_timer end) or 0,
        mood,
        unit_flags(u),
        unit_skills(u),
        unit_inventory(u),
        unit_positions(u),
        u.hist_figure_id,
        u.civ_id,
        race_id,
        caste_id,
        unit_look(u, craw),
        traits, values, thoughts,
        unit_sheet(u, craw),
        unit_strange_mood(u, mood)
    )
end

-- ---------------------------------------------------------------------------
-- Items
-- ---------------------------------------------------------------------------

local ITEM_COLUMNS = arr{
    'id', 'type', 'subtype', 'description', 'material', 'stack', 'quality',
    'wear', 'x', 'y', 'z', 'flags', 'container_id', 'holder_unit_id',
    'holder_building_id', 'value', 'subtype_id', 'mat_class', 'color',
    'race_id', 'caste_id', 'plant_id', 'corpse_flags', 'maker_hf', 'owner_id',
    'artifact_id',
}

-- Filled before the items are read: item id -> artifact record id, and the
-- historical figures items and artifacts name, for the figures table.
local artifact_by_item = {}
local wanted_figures = {}

local function want_figure(hfid)
    if hfid ~= nil and hfid >= 0 then wanted_figures[hfid] = true end
end

-- Corpses, body parts, remains, fish, vermin, eggs and pets carry the
-- creature they came from; the graphics for them are the creature's.
local function item_creature(it)
    local race = try(function() return it.race end)
    if race == nil or race < 0 then return nil, nil end
    local craw = df.creature_raw.find(race)
    if not craw then return nil, nil end
    local caste = try(function() return it.caste end)
    local caste_id = (caste ~= nil and caste >= 0)
        and try(function() return craw.caste[caste].caste_id end) or nil
    return craw.creature_id, caste_id
end

-- Which part of a butchered creature a body part item is (bone, skull,
-- skin, horn, ...): the set corpse_flags, by name.
local function item_corpse_flags(it)
    local flags = try(function() return it.corpse_flags end)
    if not flags then return nil end
    local out = arr{}
    local ok = pcall(function()
        for name, set in pairs(flags) do
            if set == true then out[#out + 1] = tostring(name) end
        end
    end)
    if not ok then return nil end
    table.sort(out)
    return out
end

-- The material family the item graphics choose a variant by
-- (ITEM_DOOR_STONE, ITEM_BOOK_METAL, ITEM_FLASK_LEATHER).
local function material_class(mi)
    local mat = mi and mi.material
    if not mat then return nil end
    local function has(name) return try(function() return mat.flags[name] end) == true end
    if has('IS_METAL') then return 'METAL' end
    if has('IS_GLASS') then return 'GLASS' end
    if has('IS_GEM') then return 'GEM' end
    if has('IS_STONE') then return 'STONE' end
    if has('WOOD') then return 'WOOD' end
    if has('LEATHER') then return 'LEATHER' end
    if has('BONE') then return 'BONE' end
    if has('SHELL') then return 'SHELL' end
    if has('SOAP') then return 'SOAP' end
    if has('SILK') or has('YARN') or has('THREAD_PLANT') then return 'CLOTH' end
    if mi.mode == 'plant' then return 'PLANT' end
    return nil
end

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
    local subtype_id = nil
    local def = try(dfhack.items.getSubtypeDef, itype, it:getSubtype())
    if def then
        subtype = try(function() return def.name end)
        -- Raw token (ITEM_WEAPON_PICK): what the item graphics are keyed on.
        subtype_id = try(function() return def.id end)
    end
    local material = ''
    local mi = try(dfhack.matinfo.decode, it)
    if mi then material = try(function() return mi:toString() end) or '' end
    local color = try(item_dye_color, it)
        or (mi and color_token(try(function() return mi.material.state_color.Solid end)))
        or nil
    local plant_id = mi and try(function() return mi.plant.id end) or nil
    local race_id, caste_id = item_creature(it)
    local container = try(dfhack.items.getContainer, it)
    local holder_unit = try(dfhack.items.getHolderUnit, it)
    local holder_building = try(dfhack.items.getHolderBuilding, it)
    -- Only crafted items record who made them.
    local maker = try(function() return it.maker end)
    if maker ~= nil and maker < 0 then maker = nil end
    want_figure(maker)
    local owner = it.flags.owned and try(dfhack.items.getOwner, it) or nil
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
        try(dfhack.items.getValue, it) or 0,
        subtype_id,
        material_class(mi),
        color,
        race_id,
        caste_id,
        plant_id,
        item_corpse_flags(it),
        maker,
        owner and owner.id or nil,
        artifact_by_item[it.id]
    )
end

-- ---------------------------------------------------------------------------
-- Artifacts: the records behind artifact items, for those on the map and for
-- those made, held or owned by the fortress's own people.
-- ---------------------------------------------------------------------------

local ARTIFACT_COLUMNS = arr{
    'id', 'item_id', 'name', 'name_english', 'description', 'type', 'maker_hf',
    'holder_hf', 'owner_hf', 'year', 'tick', 'site_id', 'on_map', 'value',
}

local function nonneg(v)
    if v == nil or v < 0 then return nil end
    return v
end

local function collect_artifacts(fort_hfs)
    local rows = {}
    for _, a in ipairs(df.global.world.artifacts.all) do
        local it = a.item
        if it then
            artifact_by_item[it.id] = a.id
            local maker = nonneg(try(function() return it.maker end))
            local holder, owner = nonneg(a.holder_hf), nonneg(a.owner_hf)
            local on_map = try(dfhack.items.getPosition, it) ~= nil
            local ours = (maker and fort_hfs[maker]) or (holder and fort_hfs[holder])
                or (owner and fort_hfs[owner])
            if on_map or ours then
                want_figure(maker)
                want_figure(holder)
                want_figure(owner)
                rows[#rows + 1] = row(
                    a.id,
                    it.id,
                    nonempty(translate(a.name, false)),
                    nonempty(translate(a.name, true)),
                    try(dfhack.items.getReadableDescription, it) or '',
                    enum_name(df.item_type, it:getType()),
                    maker, holder, owner,
                    nonneg(a.year), nonneg(a.season_tick),
                    nonneg(a.site),
                    on_map,
                    try(dfhack.items.getValue, it) or 0
                )
            end
        end
    end
    return rows
end

-- ---------------------------------------------------------------------------
-- Figures: the historical figures items and artifacts name (makers, holders,
-- owners), so the app can name a maker who is not on the map.
-- ---------------------------------------------------------------------------

local FIGURE_COLUMNS = arr{'hf', 'name', 'name_english', 'race', 'unit_id', 'alive'}

local function collect_figures()
    local rows = {}
    for hfid in pairs(wanted_figures) do
        local hf = hf_find(hfid)
        if hf then
            rows[#rows + 1] = row(
                hfid,
                nonempty(translate(hf.name, false)),
                nonempty(translate(hf.name, true)),
                race_label(hf.race),
                nonneg(hf.unit_id),
                hf.died_year == -1
            )
        end
    end
    table.sort(rows, function(a, b) return a[1] < b[1] end)
    return rows
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
    'building_id', 'order_id', 'items', 'needs', 'state',
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
        #job.items,
        try(job_need_rows, job) or arr{},
        try(job_state, job)
    )
end

-- ---------------------------------------------------------------------------
-- Manager work orders
-- ---------------------------------------------------------------------------

local ORDER_COLUMNS = arr{
    'id', 'job', 'label', 'detail', 'amount_left', 'amount_total', 'frequency',
    'validated', 'active', 'workshop_id', 'max_workshops', 'conditions', 'finished',
}

local COMPARE_WORDS = {
    AtLeast = 'at least', AtMost = 'at most', GreaterThan = 'more than',
    LessThan = 'fewer than', Exactly = 'exactly', Not = 'not',
}

local reaction_names = nil

local function reaction_name(code)
    if not reaction_names then
        reaction_names = {}
        for _, r in ipairs(df.global.world.raws.reactions.reactions) do
            reaction_names[r.code] = r.name
        end
    end
    return nonempty(reaction_names[code])
end

local function bitfield_names(bits)
    local out = {}
    pcall(function()
        for name, set in pairs(bits) do
            if set == true and type(name) == 'string' and not name:match('^%d') then out[#out + 1] = name end
        end
    end)
    table.sort(out)
    return out
end

local function order_detail(o)
    local words = {}
    if o.mat_type >= 0 then
        words[#words + 1] = mat_label(o.mat_type, o.mat_index)
    else
        for _, name in ipairs(bitfield_names(o.material_category)) do words[#words + 1] = name end
    end
    if o.item_subtype >= 0 then
        -- Orders like Make Tool leave the item type to the job.
        local itype = o.item_type >= 0 and o.item_type
            or try(function() return df.job_type.attrs[o.job_type].item end)
        local name = itype and itype >= 0 and item_type_label(itype, o.item_subtype, false)
        if name then words[#words + 1] = name end
    end
    if #words == 0 then return nil end
    return table.concat(words, ' ')
end

-- "fewer than 10 barrels", "after order 12 is completed".
local function order_conditions(o)
    local out = arr{}
    for _, c in ipairs(o.item_conditions) do
        local cmp = COMPARE_WORDS[enum_name(df.logic_condition_type, c.compare_type)]
        local text = try(job_item_label, c, c.compare_val)
        if cmp and text then out[#out + 1] = cmp .. ' ' .. c.compare_val .. ' ' .. text end
    end
    for _, c in ipairs(o.order_conditions) do
        local state = try(function() return enum_name(df.manager_order_condition_order.T_condition, c.condition) end)
        out[#out + 1] = 'after order ' .. c.order_id .. ' is ' .. (state or 'done'):lower()
    end
    return out
end

local function order_row(o)
    local job = enum_name(df.job_type, o.job_type)
    local label = (o.reaction_name ~= '' and reaction_name(o.reaction_name))
        or try(function() return df.job_type.attrs[o.job_type].caption end)
        or job
    return row(
        o.id,
        job,
        label,
        try(order_detail, o),
        o.amount_left,
        o.amount_total,
        enum_name(df.workquota_frequency_type, o.frequency),
        o.status.validated == true,
        o.status.active == true,
        nonneg(o.workshop_id),
        o.max_workshops,
        try(order_conditions, o) or arr{},
        o.finished_year >= 0 and arr{o.finished_year, o.finished_year_tick} or nil
    )
end

-- ---------------------------------------------------------------------------
-- Squads: the fortress's own, with their members, orders and alert routine.
-- ---------------------------------------------------------------------------

local SQUAD_COLUMNS = arr{'id', 'name', 'alias', 'routine', 'orders', 'positions', 'members'}

local SQUAD_ORDER_WORDS = {
    MOVE = 'Station', KILL_LIST = 'Kill', DEFEND_BURROWS = 'Defend burrows',
    PATROL_ROUTE = 'Patrol', TRAIN = 'Train', DRIVE_ENTITY_OFF_SITE = 'Drive off a group',
    CAUSE_TROUBLE_FOR_ENTITY = 'Cause trouble', KILL_HF = 'Kill someone',
    DRIVE_ARMIES_FROM_SITE = 'Drive armies away', RETRIEVE_ARTIFACT = 'Retrieve an artifact',
    RAID_SITE = 'Raid', RESCUE_HF = 'Rescue someone',
}

local function squad_order_words(list)
    local out = arr{}
    for _, o in ipairs(list) do
        local kind = enum_name(df.squad_order_type, try(function() return o:getType() end))
        local text = try(function() return utils.call_with_string(o, 'getDescription') end)
        out[#out + 1] = nonempty(text) or SQUAD_ORDER_WORDS[kind] or kind
    end
    return out
end

local function routine_name(idx)
    if idx == nil or idx < 0 then return nil end
    local r = try(function() return df.global.plotinfo.alerts.routines[idx] end)
    return r and nonempty(r.name) or nil
end

local function squad_row(sq)
    local members = arr{}
    for i, p in ipairs(sq.positions) do
        if p.occupant >= 0 then
            local hf = hf_find(p.occupant)
            members[#members + 1] = {
                position = i,
                leader = i == sq.leader_position or nil,
                hf = p.occupant,
                unit = hf and nonneg(hf.unit_id) or nil,
                name = hf and nonempty(translate(hf.name, false)) or nil,
                uniform = nonempty(try(function() return p.equipment.nickname end)),
                assigned_items = try(function() return #p.equipment.assigned_items end) or 0,
                orders = try(squad_order_words, p.orders) or arr{},
            }
        end
    end
    local name = translate(sq.name, true)
    return row(
        sq.id,
        nonempty(name),
        nonempty(sq.alias),
        routine_name(sq.cur_routine_idx),
        try(squad_order_words, sq.orders) or arr{},
        #sq.positions,
        members
    )
end

local function collect_squads()
    local rows = {}
    local gid = df.global.plotinfo.group_id
    for _, sq in ipairs(df.global.world.squads.all) do
        if sq.entity_id == gid then rows[#rows + 1] = squad_row(sq) end
    end
    return rows
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

local function goods_label(item_type, subtype, mat_type, mat_index, n)
    local noun = item_type_label(item_type, subtype, n ~= 1) or '?'
    local mat = (mat_type ~= nil and mat_type >= 0) and mat_label(mat_type, mat_index) or nil
    return mat and (mat .. ' ' .. noun) or noun
end

-- Production mandates and export bans. The timeout counts up to its limit;
-- DFHack warns once fewer than 2500 remain, about a month.
local function collect_mandates()
    local out = arr{}
    for _, m in ipairs(df.global.world.mandates.all) do
        local u = m.unit
        out[#out + 1] = {
            kind = enum_name(df.mandate_type, m.mode),
            unit_id = u and u.id or nil,
            noble = u and dfhack.units.getReadableName(u) or nil,
            position = u and unit_positions(u)[1] or nil,
            item = goods_label(m.item_type, m.item_subtype, m.mat_type, m.mat_index, m.amount_total),
            amount_total = m.amount_total,
            amount_remaining = m.amount_remaining,
            timeout_counter = m.timeout_counter,
            timeout_limit = m.timeout_limit,
            hammerstrikes = try(function() return m.punishment.hammerstrikes end),
            prison_time = try(function() return m.punishment.prison_time end),
        }
    end
    return out
end

-- Rooms (and the furniture in them) nobles have demanded.
local function collect_demands()
    local out = arr{}
    local place_enum = try(function() return df.unit_demand._fields.place.type end)
    for _, u in ipairs(df.global.world.units.active) do
        local list = try(function() return u.status.demands end)
        if list and #list > 0 and dfhack.units.isCitizen(u, true) then
            for _, d in ipairs(list) do
                out[#out + 1] = {
                    unit_id = u.id,
                    name = dfhack.units.getReadableName(u),
                    position = unit_positions(u)[1],
                    place = place_enum and enum_name(place_enum, d.place) or tostring(d.place),
                    item = d.item_type >= 0
                        and goods_label(d.item_type, d.item_subtype, d.mat_type, d.mat_index, 1) or nil,
                    timeout_counter = d.timeout_counter,
                    timeout_limit = d.timeout_limit,
                }
            end
        end
    end
    return out
end

local CARAVAN_TROUBLE = {'casualty', 'hardship', 'seized', 'offended'}

-- Caravans on their way, at the depot or leaving. time_remaining / 120 is in
-- days, as DFHack's caravan command counts it.
local function collect_caravans()
    local out = arr{}
    for i, car in ipairs(df.global.plotinfo.caravans) do
        local ent = df.historical_entity.find(car.entity)
        local craw = ent and df.creature_raw.find(ent.race)
        local trouble = arr{}
        for _, flag in ipairs(CARAVAN_TROUBLE) do
            if try(function() return car.flags[flag] end) == true then trouble[#trouble + 1] = flag end
        end
        out[#out + 1] = {
            index = i,
            entity_id = car.entity,
            civ = ent and nonempty(translate(ent.name, true)) or nil,
            civ_native = ent and nonempty(translate(ent.name, false)) or nil,
            race = craw and try(function() return craw.name[2] end) or nil,
            own_civ = car.entity == df.global.plotinfo.civ_id,
            state = enum_name(df.caravan_state.T_trade_state, car.trade_state),
            time_remaining = car.time_remaining,
            trouble = trouble,
        }
    end
    return out
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
                if injury_count(u) > 0 then injured[#injured + 1] = dfhack.units.getReadableName(u) end
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

    s.mandates = try(collect_mandates) or arr{}
    s.demands = try(collect_demands) or arr{}
    s.caravans = try(collect_caravans) or arr{}

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
        if dfhack.units.isCitizen(u, true) and u.mood >= 0
            and STRANGE_MOODS[enum_name(df.mood_type, u.mood)] then
            moods = moods + 1
        end
    end
    if moods > 0 then
        alert('mood', 'Strange mood', moods .. ' dwarf(s) are in a strange mood.', moods, 'info')
    end
    return s
end

-- ---------------------------------------------------------------------------
-- Diplomacy and war
-- ---------------------------------------------------------------------------

-- Sites nobody lives in as a home: tombs, lairs, camps and the like.
local NOT_SETTLEMENTS = {Monument = true, LairShrine = true, Camp = true, ImportantLocation = true}

-- Entity raw tokens that say what a power does to a fortress.
local POWER_FLAGS = {
    'SIEGER', 'BABYSNATCHER', 'ITEM_THIEF', 'AMBUSHER', 'LOCAL_BANDITRY',
    'AT_PEACE_WITH_WILDLIFE', 'WILL_ACCEPT_TRIBUTE', 'MERCHANT_NOBILITY',
    'SIEGE_SKILLED_MINERS', 'INVADERS_IGNORE_NEUTRALS', 'ABUSE_BODIES',
}

local SITES_PER_POWER = 8
local EVENTS_PER_WAR = 12

local function parent_entity(ent)
    for _, l in ipairs(ent.entity_links) do
        if l.type == df.entity_entity_link_type.PARENT then
            local p = df.historical_entity.find(l.target)
            if p then return p end
        end
    end
    return nil
end

local power_cache = {}

-- The topmost group an entity answers to, its civilization when it has one:
-- kobold hamlets answer to the site government that founded them.
local function power_of(ent)
    if not ent then return nil end
    local cached = power_cache[ent.id]
    if cached then return cached end
    local top = ent
    for _ = 1, 4 do
        if top.type == df.historical_entity_type.Civilization then break end
        local p = parent_entity(top)
        if not p then break end
        top = p
    end
    power_cache[ent.id] = top
    return top
end

local function diplomacy_state(ent, ids)
    for _, s in ipairs(ent.relations.diplomacy.state) do
        if ids[s.group_id] then return s end
    end
    return nil
end

local function relation_name(state)
    return state and enum_name(df.diplomacy_state_type, state.relation) or nil
end

local function true_flags(flags)
    local out = arr{}
    for k, v in pairs(flags) do
        if v == true then out[#out + 1] = tostring(k) end
    end
    table.sort(out)
    return out
end

-- Office holders with a figure, highest precedence first.
local function power_leaders(ent)
    local positions = {}
    for _, p in ipairs(ent.positions.own) do positions[p.id] = p end
    local out = {}
    for _, a in ipairs(ent.positions.assignments) do
        local p = positions[a.position_id]
        local hf = p and hf_find(a.histfig)
        if hf then
            local title = (hf.sex == 0 and nonempty(p.name_female[0]))
                or (hf.sex == 1 and nonempty(p.name_male[0]))
                or nonempty(p.name[0]) or p.code:lower():gsub('_', ' ')
            out[#out + 1] = {
                position = title,
                precedence = p.precedence,
                hf = hf.id,
                name = nonempty(translate(hf.name, true)),
                name_native = nonempty(translate(hf.name, false)),
                alive = hf.died_year == -1,
            }
        end
    end
    table.sort(out, function(a, b)
        local pa = a.precedence >= 0 and a.precedence or math.huge
        local pb = b.precedence >= 0 and b.precedence or math.huge
        if pa ~= pb then return pa < pb end
        return a.hf < b.hf
    end)
    local top = arr{}
    for i = 1, math.min(#out, 5) do
        out[i].precedence = nil
        top[i] = out[i]
    end
    return top
end

local function power_behaviour(ent)
    local out = arr{}
    for _, k in ipairs(POWER_FLAGS) do
        if try(function() return ent.entity_raw.flags[k] end) == true then out[#out + 1] = k end
    end
    return out
end

-- Fortress progress levels at which the power takes notice and lays siege; 0 never.
local function power_triggers(ent)
    return try(function()
        local pt = ent.entity_raw.progress_trigger
        return {
            population = pt.population, production = pt.production, trade = pt.trade,
            pop_siege = pt.pop_siege, prod_siege = pt.prod_siege, trade_siege = pt.trade_siege,
        }
    end)
end

local function site_label(site_id)
    local site = site_id and site_id >= 0 and df.world_site.find(site_id)
    return site and nonempty(translate(site.name, true)) or nil
end

-- Battles, conquests and raids of one war, newest first.
local function war_events(col, note_entity)
    local events = {}
    local counts = {battles = 0, conquests = 0, raids = 0, deaths = 0}
    for _, cid in ipairs(col.collections) do
        local c = df.history_event_collection.find(cid)
        local kind = c and enum_name(df.history_event_collection_type, c:getType())
        if kind == 'BATTLE' or kind == 'SITE_CONQUERED' or kind == 'RAID'
            or kind == 'THEFT' or kind == 'ABDUCTION' then
            local site_id = nonneg(try(function() return c.site end))
            local attacker = try(function() return c.attacker_civ[0] end)
                or try(function() return c.attacking_entity end)
            local defender = try(function() return c.defender_civ[0] end)
            note_entity(attacker)
            note_entity(defender)
            local e = {
                kind = kind,
                year = c.start_year,
                name = nonempty(try(function() return translate(c.name, true) end)),
                site_id = site_id,
                site = site_label(site_id),
                attacker = nonneg(attacker),
                defender = nonneg(defender),
            }
            if kind == 'BATTLE' then
                counts.battles = counts.battles + 1
                local a, d = 0, 0
                for _, n in ipairs(c.attacker_squad_deaths) do a = a + math.max(0, n) end
                for _, n in ipairs(c.defender_squad_deaths) do d = d + math.max(0, n) end
                e.attacker_deaths, e.defender_deaths = a, d
                e.outcome = enum_name(df.battle_outcome_type, c.outcome)
                counts.deaths = counts.deaths + a + d
            elseif kind == 'SITE_CONQUERED' then
                counts.conquests = counts.conquests + 1
            else
                counts.raids = counts.raids + 1
            end
            events[#events + 1] = e
        end
    end
    table.sort(events, function(a, b) return a.year > b.year end)
    local top = arr{}
    for i = 1, math.min(#events, EVENTS_PER_WAR) do top[i] = events[i] end
    return top, counts, #events
end

local function collect_diplomacy()
    local pi = df.global.plotinfo
    local civ_id, group_id, site_id = pi.civ_id, pi.group_id, pi.site_id
    local ours = {[civ_id] = true, [group_id] = true}
    local mine = df.historical_entity.find(civ_id)
    local here = df.world_site.find(site_id)
    local hx, hy = here and here.pos.x or 0, here and here.pos.y or 0

    local entities = {}
    local function note_entity(id)
        if id == nil or id < 0 or entities[tostring(id)] then return end
        local ent = df.historical_entity.find(id)
        if not ent then return end
        local pw = power_of(ent)
        entities[tostring(id)] = {
            name = nonempty(translate(ent.name, true)),
            type = enum_name(df.historical_entity_type, ent.type),
            race = race_label(ent.race),
            power_id = pw and pw.id or id,
        }
    end

    -- Sites by the power that holds them. Settlements make a power a neighbour;
    -- tombs and lairs only place powers that are known for other reasons.
    local held = {}
    for _, s in ipairs(df.global.world.world_data.sites) do
        local owner = s.cur_owner_id >= 0 and s.cur_owner_id or s.civ_id
        local ent = s.id ~= site_id and owner >= 0 and df.historical_entity.find(owner)
        if ent then
            local pw = power_of(ent)
            local h = held[pw.id]
            if not h then
                h = {ent = pw, sites = {}, settled = false}
                held[pw.id] = h
            end
            local kind = enum_name(df.world_site_type, s.type)
            local settlement = not NOT_SETTLEMENTS[kind]
            if settlement then h.settled = true end
            local dx, dy = s.pos.x - hx, s.pos.y - hy
            h.sites[#h.sites + 1] = {
                site = s,
                id = s.id,
                type = kind,
                settlement = settlement,
                dx = dx, dy = dy,
                distance = math.max(math.abs(dx), math.abs(dy)),
                owner_id = ent.id,
            }
        end
    end

    local powers, order = {}, {}
    local function power_entry(ent)
        local p = powers[ent.id]
        if not p then
            p = {ent = ent, sites = held[ent.id] and held[ent.id].sites or {}, groups = arr{}}
            powers[ent.id] = p
            order[#order + 1] = ent.id
        end
        return p
    end
    for _, h in pairs(held) do
        if h.settled then power_entry(h.ent) end
    end

    -- Everyone the civilization has dealings with, even without a settlement.
    if mine then
        for _, s in ipairs(mine.relations.diplomacy.state) do
            local ent = df.historical_entity.find(s.group_id)
            local pw = power_of(ent)
            if pw and pw.id ~= civ_id then
                local p = power_entry(pw)
                if pw.id ~= ent.id then
                    p.groups[#p.groups + 1] = {
                        id = ent.id,
                        name = nonempty(translate(ent.name, true)),
                        type = enum_name(df.historical_entity_type, ent.type),
                        relation = relation_name(s),
                        war_id = nonneg(s.war_event_collection),
                    }
                end
            end
        end
    end

    -- Wars: every one the fortress's civilization fights, and those between listed powers.
    local wars = arr{}
    local war_list = try(function() return df.global.world.history.event_collections.other.WAR end) or {}
    local function add_war(col)
        local us, listed = false, false
        local sides = {attackers = arr{}, defenders = arr{}}
        for side, field in pairs{attackers = 'attacker_civ', defenders = 'defender_civ'} do
            for _, id in ipairs(col[field]) do
                sides[side][#sides[side] + 1] = id
                local pw = power_of(df.historical_entity.find(id))
                if ours[id] or (pw and pw.id == civ_id) then us = true end
                if pw and powers[pw.id] then listed = true end
            end
        end
        if us or listed then
            if us then
                for _, list in pairs(sides) do
                    for _, id in ipairs(list) do
                        local pw = power_of(df.historical_entity.find(id))
                        if pw and pw.id ~= civ_id then power_entry(pw) end
                    end
                end
            end
            for _, list in pairs(sides) do
                for _, id in ipairs(list) do note_entity(id) end
            end
            local events, counts, total = war_events(col, note_entity)
            wars[#wars + 1] = {
                id = col.id,
                name = nonempty(translate(col.name, true)),
                start_year = col.start_year,
                end_year = nonneg(col.end_year),
                attackers = sides.attackers,
                defenders = sides.defenders,
                ours = us,
                battles = counts.battles,
                conquests = counts.conquests,
                raids = counts.raids,
                deaths = counts.deaths,
                event_count = total,
                events = events,
            }
        end
    end
    for _, col in ipairs(war_list) do try(add_war, col) end
    table.sort(wars, function(a, b)
        if a.ours ~= b.ours then return a.ours end
        if (a.end_year == nil) ~= (b.end_year == nil) then return a.end_year == nil end
        return a.start_year > b.start_year
    end)

    for _, p in pairs(powers) do
        table.sort(p.sites, function(a, b)
            if a.settlement ~= b.settlement then return a.settlement end
            if a.distance ~= b.distance then return a.distance < b.distance end
            return a.id < b.id
        end)
        p.distance = p.sites[1] and p.sites[1].distance or math.huge
        p.settlements = 0
        for _, s in ipairs(p.sites) do
            if s.settlement then p.settlements = p.settlements + 1 end
        end
    end
    table.sort(order, function(a, b)
        if powers[a].distance ~= powers[b].distance then return powers[a].distance < powers[b].distance end
        return a < b
    end)

    -- How each listed power stands with the others it knows.
    local function relations_of(ent)
        local seen, out = {}, arr{}
        for _, s in ipairs(ent.relations.diplomacy.state) do
            local pw = power_of(df.historical_entity.find(s.group_id))
            if pw and pw.id ~= ent.id and (powers[pw.id] or pw.id == civ_id) then
                local prev = seen[pw.id]
                if not prev or (prev.relation == 0 and s.relation ~= 0) then
                    seen[pw.id] = s
                end
            end
        end
        for id, s in pairs(seen) do out[#out + 1] = row(id, relation_name(s)) end
        table.sort(out, function(a, b) return a[1] < b[1] end)
        return out
    end

    local out_powers = arr{}
    for _, id in ipairs(order) do
        local p = powers[id]
        local ent = p.ent
        local craw = df.creature_raw.find(ent.race)
        -- For the civilization itself this is how it stands with itself: war means civil war.
        local toward = mine and diplomacy_state(mine, {[ent.id] = true}) or nil
        local back = ent.id ~= civ_id and diplomacy_state(ent, ours) or nil
        local sites = arr{}
        for i = 1, math.min(#p.sites, SITES_PER_POWER) do
            local s = p.sites[i]
            s.name = nonempty(translate(s.site.name, true))
            s.name_native = nonempty(translate(s.site.name, false))
            s.site = nil
            sites[i] = s
        end
        out_powers[#out_powers + 1] = {
            id = ent.id,
            name = nonempty(translate(ent.name, true)),
            name_native = nonempty(translate(ent.name, false)),
            type = enum_name(df.historical_entity_type, ent.type),
            race = craw and craw.name[0] or nil,
            race_plural = craw and nonempty(craw.name[1]) or nil,
            race_adjective = craw and nonempty(craw.name[2]) or nil,
            raw = try(function() return ent.entity_raw.code end),
            own = ent.id == civ_id,
            relation = relation_name(toward),
            their_relation = relation_name(back),
            relation_flags = toward and true_flags(toward.flags) or arr{},
            war_id = toward and nonneg(toward.war_event_collection) or nil,
            tribute_season = toward and toward.tribute_season or nil,
            distance = p.sites[1] and p.sites[1].distance or nil,
            site_count = p.settlements,
            sites = sites,
            leaders = try(power_leaders, ent) or arr{},
            behaviour = power_behaviour(ent),
            triggers = power_triggers(ent),
            groups = p.groups,
            relations = try(relations_of, ent) or arr{},
        }
    end

    -- Petitions and other agreements the fortress or its civilization is party to.
    local agreements = arr{}
    for _, a in ipairs(try(df.agreement.get_vector) or {}) do
        local d = #a.details > 0 and a.details[0] or nil
        local loc_site = d and try(function() return d.data.Location.site end)
        local party_ours, others = false, arr{}
        for _, p in ipairs(a.parties) do
            for _, e in ipairs(p.entity_ids) do
                if ours[e] then party_ours = true
                else
                    others[#others + 1] = e
                    note_entity(e)
                end
            end
        end
        if d and (party_ours or (loc_site ~= nil and loc_site == site_id)) then
            local kind = enum_name(df.agreement_details_type, d.type)
            local entry = {
                id = a.id,
                kind = kind,
                year = d.year,
                tick = d.year_tick,
                parties = others,
            }
            if a.flags.convicted_accepted then entry.status = 'satisfied'
            elseif a.flags.petition_not_accepted then entry.status = 'denied'
            elseif df.global.cur_year - d.year > 1
                or (df.global.cur_year - d.year == 1 and df.global.cur_year_tick >= d.year_tick) then
                entry.status = 'expired'
            else entry.status = 'outstanding' end
            local loc = kind == 'Location' and try(function() return d.data.Location end)
            if loc then
                local temple = loc.type == df.abstract_building_type.TEMPLE
                local guild = loc.type == df.abstract_building_type.GUILDHALL
                entry.location = temple and (loc.tier == 2 and 'Temple complex' or 'Temple')
                    or guild and (loc.tier == 2 and 'Grand guildhall' or 'Guildhall')
                    or enum_name(df.abstract_building_type, loc.type)
                if guild then
                    entry.profession = try(function()
                        return (df.profession[loc.profession]:lower():gsub('_', ' '))
                    end)
                elseif temple then
                    entry.deity = try(function()
                        if loc.deity_type == df.religious_practice_type.WORSHIP_HFID then
                            return translate(df.historical_figure.find(loc.deity_data.practice_id).name, true)
                        end
                        local religion = df.historical_entity.find(loc.deity_data.practice_id)
                        return translate(df.historical_figure.find(religion.relations.deities[0]).name, true)
                    end)
                end
            end
            agreements[#agreements + 1] = entry
        end
    end
    table.sort(agreements, function(a, b)
        if a.year ~= b.year then return a.year > b.year end
        return a.tick > b.tick
    end)

    local invasions = arr{}
    for _, inv in ipairs(try(function() return pi.invasions.list end) or {}) do
        note_entity(inv.civ_id)
        invasions[#invasions + 1] = {
            id = inv.id,
            civ_id = inv.civ_id,
            flags = try(true_flags, inv.flags) or arr{},
            size = try(function() return inv.size end),
            year = try(function() return inv.created_year end),
        }
    end

    -- Armies the fortress's people lead abroad, and others whose goal is this site.
    local missions, incoming = arr{}, arr{}
    for _, ac in ipairs(try(function() return df.global.world.army_controllers.all end) or {}) do
        local target = try(function() return ac.site_id end) or -1
        local entry = try(function()
            return {
                id = ac.id,
                entity_id = ac.entity_id,
                goal = enum_name(df.army_controller_goal_type, ac.goal),
                site_id = nonneg(target),
                site = site_label(target),
                year = try(function() return ac.year end),
            }
        end)
        if entry and ours[ac.entity_id] then
            note_entity(ac.entity_id)
            missions[#missions + 1] = entry
        elseif entry and target == site_id then
            note_entity(ac.entity_id)
            incoming[#incoming + 1] = entry
        end
    end

    local cd = pi.main.custom_difficulty
    local function levels(list)
        local out = arr{}
        for i = 0, 4 do out[#out + 1] = list[i] end
        return out
    end
    return {
        civ_id = civ_id,
        group_id = group_id,
        site_id = site_id,
        year = df.global.cur_year,
        powers = out_powers,
        wars = wars,
        entities = entities,
        agreements = agreements,
        invasions = invasions,
        missions = missions,
        incoming = incoming,
        progress = {
            population = pi.progress_population,
            production = pi.progress_production,
            trade = pi.progress_trade,
            rank = pi.fortress_rank,
        },
        triggers = try(function()
            return {
                population = levels(cd.enemy_pop_trigger),
                production = levels(cd.enemy_prod_trigger),
                trade = levels(cd.enemy_trade_trigger),
            }
        end),
        invasion_rules = try(function()
            return {
                min_raids_before_siege = cd.min_raids_before_siege,
                min_raids_between_sieges = cd.min_raids_between_sieges,
                siege_frequency = cd.siege_frequency,
                invasion_unit_cap = cd.invasion_unit_cap,
            }
        end),
        invaders_repelled = try(function() return pi.tasks.invaders_repelled end),
    }
end

-- ---------------------------------------------------------------------------
-- Map
-- ---------------------------------------------------------------------------

-- Bits of tile_designation worth keeping: flow_size, pile, dig, smooth, hidden,
-- light, subterranean, outside, liquid_type, traffic.
local FLAG_MASK = 0x0321C3FF

local function vein_priority(ev)
    local fl = ev.flags
    if fl.cluster then return 1 end
    if fl.vein then return 2 end
    if fl.cluster_small then return 3 end
    if fl.cluster_one then return 4 end
    return 5
end

-- Which inorganic each tile of a block is a vein of, keyed x * 16 + y, by the
-- rule DFHack's tile-material.lua follows: the smaller kind of vein wins over
-- the larger, and of two alike the later one. Nil when the block has none.
local function block_veins(block)
    local mats, prio = nil, nil
    for _, ev in ipairs(block.block_events) do
        if getmetatable(ev) == 'block_square_event_mineralst' then
            mats = mats or {}
            prio = prio or {}
            local p = vein_priority(ev)
            local mat = ev.inorganic_mat
            local bits = ev.tile_bitmask.bits
            for y = 0, 15 do
                local r = bits[y]
                if r ~= 0 then
                    for x = 0, 15 do
                        if r & (1 << x) ~= 0 then
                            local k = x * 16 + y
                            if not prio[k] or p >= prio[k] then
                                mats[k] = mat
                                prio[k] = p
                            end
                        end
                    end
                end
            end
        end
    end
    return mats
end

local function color_hex(idx)
    local c = idx and idx >= 0 and try(function() return df.global.world.raws.descriptors.colors[idx] end)
    if not c then return nil end
    local function byte(v) return math.max(0, math.min(255, math.floor((tonumber(v) or 0) * 255 + 0.5))) end
    return string.format('#%02x%02x%02x', byte(c.red), byte(c.green), byte(c.blue))
end

-- id, name, ore / gem / mineral, the metals it smelts into, and its colour.
local function mineral_entry(idx)
    local raw = try(function() return df.global.world.raws.inorganics.all[idx] end)
    if not raw then return nil end
    local metals = arr{}
    local ores = try(function() return raw.metal_ore.mat_index end)
    if ores then
        for _, m in ipairs(ores) do
            local metal = try(function() return df.global.world.raws.inorganics.all[m].material.state_name.Solid end)
            if metal then metals[#metals + 1] = metal end
        end
    end
    local kind = 'mineral'
    if try(function() return raw.material.flags.IS_GEM end) == true then kind = 'gem'
    elseif #metals > 0 then kind = 'ore' end
    return {
        id = tostring(raw.id),
        name = clean_name(try(function() return raw.material.state_name.Solid end) or raw.id),
        kind = kind,
        metals = metals,
        color = color_hex(try(function() return raw.material.state_color.Solid end)),
    }
end

local function write_map(f)
    local map = df.global.world.map
    local seen = {}
    local minerals = {}
    local mineral_tt = {}
    local MINERAL = df.tiletype_material.MINERAL
    f:write(string.format('{"x_count":%d,"y_count":%d,"z_count":%d,"blocks":[', map.x_count, map.y_count, map.z_count))
    local first = true
    for _, block in ipairs(map.map_blocks) do
        local tt, des = block.tiletype, block.designation
        local tiles, flags = {}, {}
        local tv, tn, fv, fn = nil, 0, nil, 0
        local veins = block_veins(block)
        local vtiles, vv, vn, any_vein = {}, nil, 0, false
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
                if veins then
                    -- Only tiles still of the vein's stone: caverns and
                    -- digging leave mask bits over other ground.
                    local m = -1
                    local is_mineral = mineral_tt[t]
                    if is_mineral == nil then
                        is_mineral = df.tiletype.attrs[t].material == MINERAL
                        mineral_tt[t] = is_mineral
                    end
                    if is_mineral then
                        local vm = veins[x * 16 + y]
                        if vm then
                            m = vm
                            any_vein = true
                            minerals[vm] = true
                        end
                    end
                    if m == vv then vn = vn + 1
                    else
                        if vv ~= nil then vtiles[#vtiles + 1] = vv; vtiles[#vtiles + 1] = vn end
                        vv, vn = m, 1
                    end
                end
            end
        end
        tiles[#tiles + 1] = tv; tiles[#tiles + 1] = tn
        flags[#flags + 1] = fv; flags[#flags + 1] = fn
        local vein_part = ''
        if any_vein then
            vtiles[#vtiles + 1] = vv; vtiles[#vtiles + 1] = vn
            vein_part = ',[' .. table.concat(vtiles, ',') .. ']'
        end
        local pos = block.map_pos
        f:write(first and '' or ',')
        first = false
        f:write(string.format('[%d,%d,%d,[%s],[%s]%s]', pos.z, pos.x // 16, pos.y // 16,
            table.concat(tiles, ','), table.concat(flags, ','), vein_part))
    end
    f:write('],"minerals":{')
    local first_m = true
    for idx in pairs(minerals) do
        local entry = mineral_entry(idx)
        if entry then
            f:write(first_m and '' or ',')
            first_m = false
            f:write(jstr(tostring(idx)) .. ':' .. jval(entry))
        end
    end
    f:write('},"tiletypes":{')
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
    progress('world')
    local world = collect_world()

    progress('units')
    local unit_rows = {}
    -- The fortress's own people, living or dead, by historical figure.
    local fort_hfs = {}
    for _, u in ipairs(df.global.world.units.active) do
        unit_rows[#unit_rows + 1] = unit_row(u)
        if u.hist_figure_id >= 0 and (try(dfhack.units.isOwnCiv, u) or try(dfhack.units.isCitizen, u, true)) then
            fort_hfs[u.hist_figure_id] = true
        end
    end

    progress('items')
    local artifact_rows = try(collect_artifacts, fort_hfs) or {}
    local item_rows = {}
    for _, it in ipairs(df.global.world.items.all) do
        if not it.flags.garbage_collect then
            item_rows[#item_rows + 1] = item_row(it)
        end
    end
    local figure_rows = try(collect_figures) or {}

    progress('buildings')
    local building_rows = {}
    for _, b in ipairs(df.global.world.buildings.all) do
        building_rows[#building_rows + 1] = building_row(b)
    end

    progress('jobs')
    local job_rows = {}
    for _, job in utils.listpairs(df.global.world.jobs.list) do
        job_rows[#job_rows + 1] = job_row(job)
    end
    local order_rows = {}
    for _, o in ipairs(df.global.world.manager_orders.all) do
        local ok, r = pcall(order_row, o)
        if ok then order_rows[#order_rows + 1] = r end
    end
    local squad_rows = try(collect_squads) or {}

    progress('announcements')
    local announcement_rows = collect_announcements(400)
    local summary = collect_summary(unit_rows, #item_rows, #building_rows, announcement_rows)

    progress('diplomacy')
    local diplomacy = try(collect_diplomacy)

    progress('writing')
    local tmp_path = out_path .. '.tmp'
    local f = assert(io.open(tmp_path, 'wb'))
    f:write('{"status":"live","dump_version":' .. DUMP_VERSION)
    f:write(',"world":' .. jval(world))
    f:write(',"summary":' .. jval(summary))
    f:write(',"units":'); write_table(f, UNIT_COLUMNS, unit_rows)
    f:write(',"items":'); write_table(f, ITEM_COLUMNS, item_rows)
    f:write(',"buildings":'); write_table(f, BUILDING_COLUMNS, building_rows)
    f:write(',"jobs":'); write_table(f, JOB_COLUMNS, job_rows)
    f:write(',"orders":'); write_table(f, ORDER_COLUMNS, order_rows)
    f:write(',"squads":'); write_table(f, SQUAD_COLUMNS, squad_rows)
    f:write(',"artifacts":'); write_table(f, ARTIFACT_COLUMNS, artifact_rows)
    f:write(',"figures":'); write_table(f, FIGURE_COLUMNS, figure_rows)
    f:write(',"announcements":'); write_table(f, ANNOUNCEMENT_COLUMNS, announcement_rows)
    f:write(',"diplomacy":' .. jval(diplomacy))
    if with_map then
        progress('map')
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
