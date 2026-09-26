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

local DUMP_VERSION = 8

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
    'id', 'name', 'name_english', 'readable', 'nickname', 'race', 'caste', 'sex', 'age',
    'profession', 'x', 'y', 'z', 'stress', 'stress_category', 'job_id', 'job',
    'squad_id', 'squad', 'wounds', 'blood', 'blood_max', 'hunger', 'thirst',
    'sleepiness', 'mood', 'flags', 'skills', 'inventory', 'positions',
    'hist_figure_id', 'civ_id', 'race_id', 'caste_id', 'look',
    'traits', 'values', 'thoughts', 'sheet',
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
        u.mood >= 0 and enum_name(df.mood_type, u.mood) or nil,
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
        unit_sheet(u, craw)
    )
end

-- ---------------------------------------------------------------------------
-- Items
-- ---------------------------------------------------------------------------

local ITEM_COLUMNS = arr{
    'id', 'type', 'subtype', 'description', 'material', 'stack', 'quality',
    'wear', 'x', 'y', 'z', 'flags', 'container_id', 'holder_unit_id',
    'holder_building_id', 'value', 'subtype_id', 'mat_class', 'color',
    'race_id', 'caste_id', 'plant_id', 'corpse_flags',
}

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
    local color = mi and color_token(try(function() return mi.material.state_color.Solid end)) or nil
    local plant_id = mi and try(function() return mi.plant.id end) or nil
    local race_id, caste_id = item_creature(it)
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
        try(dfhack.items.getValue, it) or 0,
        subtype_id,
        material_class(mi),
        color,
        race_id,
        caste_id,
        plant_id,
        item_corpse_flags(it)
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
