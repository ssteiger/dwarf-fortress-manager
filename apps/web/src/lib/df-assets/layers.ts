import type { FortUnit, UnitLook, UnitTissue, UnitWornItem } from '@fortress/db-drizzle'
import { useQuery } from '@tanstack/react-query'

import { DF_ASSETS_BASE } from './index'
import type {
  CreatureLayerRules,
  DfAssetIndex,
  LayerGroupRule,
  LayerRule,
  LayerSetRule,
} from './types'

/**
 * The game's layered creature graphics, evaluated for one unit.
 *
 * A layer set is a list of groups. An explicit [LAYER_GROUP] draws the first
 * of its layers whose conditions all hold; a layer outside any group draws
 * whenever its own conditions hold. Conditions read the unit's caste,
 * curses, tissue colours and hair styling, worn items and their materials,
 * profession, body parts and face shape. Everything the conditions need is
 * carried on `unit.look`, dumped by fortress-snapshot.lua from the same
 * structures the game reads.
 */

export type LookUnit = Pick<FortUnit, 'id' | 'caste_id' | 'flags' | 'look'>

export interface Recolor {
  /** Palette PNG relative to /df-assets/. */
  file: string
  fromRow: number
  /** Target row; -1 when `match` picks it. */
  toRow: number
  /**
   * Pick the target row as the one whose colours are nearest to `row` of
   * another palette (how a beast's material colour lands on the 7-row beast
   * palette).
   */
  match?: { file: string; row: number }
}

export interface ResolvedLayer {
  name: string
  page: string
  x: number
  y: number
  w: number
  h: number
  /** Pixel offset from the group ([LG_OFFSET]). */
  offset: [number, number]
  recolor: Recolor | null
}

// ---------------------------------------------------------------------------
// Loading

async function fetchRules(creature: string): Promise<CreatureLayerRules | null> {
  try {
    const res = await fetch(`${DF_ASSETS_BASE}/layers/${encodeURIComponent(creature)}.json`)
    if (!res.ok) return null
    return (await res.json()) as CreatureLayerRules
  } catch {
    return null
  }
}

/** The layer rules for a creature, or null while loading / when it has none. */
export function useCreatureRules(
  index: DfAssetIndex | null,
  creature: string | null,
): CreatureLayerRules | null {
  const enabled =
    !!index &&
    !!creature &&
    typeof window !== 'undefined' &&
    index.layeredCreatures.includes(creature)
  const { data } = useQuery({
    queryKey: ['df-assets', 'layers', creature],
    queryFn: () => fetchRules(creature ?? ''),
    enabled,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
    retry: false,
  })
  return enabled ? (data ?? null) : null
}

// ---------------------------------------------------------------------------
// Which layer set to draw

export type LayerSetKind = 'sprite' | 'portrait'

function setKeysFor(kind: LayerSetKind, unit: LookUnit): string[] {
  const f = unit.flags
  const baby = f.includes('baby')
  const child = f.includes('child')
  if (kind === 'portrait') {
    if (baby) return ['BABY:PORTRAIT', 'CHILD:PORTRAIT', 'PORTRAIT']
    if (child) return ['CHILD:PORTRAIT', 'PORTRAIT']
    return ['PORTRAIT']
  }
  // Vermin states are simple sprites, never layer sets; a skeleton falls back
  // to the layered corpse when the creature has no SKELETON sprite.
  if (f.includes('remains') || f.includes('vermin')) return []
  if (f.includes('dead') || f.includes('skeleton')) return ['CORPSE']
  if (f.includes('undead')) return ['ANIMATED', 'DEFAULT']
  if (baby) return ['BABY:DEFAULT', 'CHILD:DEFAULT', 'DEFAULT']
  if (child) return ['CHILD:DEFAULT', 'DEFAULT']
  return ['DEFAULT']
}

/** The most specific layer set the unit should be drawn with, or null. */
export function selectLayerSet(
  rules: CreatureLayerRules,
  kind: LayerSetKind,
  unit: LookUnit,
): LayerSetRule | null {
  for (const key of setKeysFor(kind, unit)) {
    const candidates = rules.sets.filter(
      (set) => set.key === key && (set.caste === null || set.caste === unit.caste_id),
    )
    if (!candidates.length) continue
    return candidates.find((set) => set.caste !== null) ?? candidates[0]
  }
  return null
}

// ---------------------------------------------------------------------------
// Condition evaluation

const SHAPINGS = new Set(['NEATLY_COMBED', 'BRAIDED', 'DOUBLE_BRAIDS', 'PONY_TAILS'])

/**
 * Stand-in for units dumped before `look` existed: healthy, nothing worn,
 * average build, short unstyled hair, first face variant, and one colour per
 * tissue (chosen from what the set offers, see `plainColors`).
 */
interface PlainLook {
  colors: Map<string, string>
}

const PLAIN_LENGTH = 75
const PLAIN_MODIFIER = 100
const PREFERRED_COLORS = ['DARK_BROWN', 'BROWN', 'CHESTNUT', 'TAN', 'PALE_BROWN', 'BLACK', 'GRAY']

function plainColors(set: LayerSetRule): Map<string, string> {
  const offered = new Map<string, string[]>()
  for (const group of set.groups) {
    for (const layer of group.layers) {
      let tissue: string | null = null
      for (const cond of layer.conditions) {
        if (cond[0] === 'CONDITION_TISSUE_LAYER') tissue = cond.slice(1).join(':')
        else if (cond[0] === 'TISSUE_MAY_HAVE_COLOR' && tissue) {
          const list = offered.get(tissue) ?? []
          list.push(...cond.slice(1))
          offered.set(tissue, list)
        }
      }
    }
  }
  const chosen = new Map<string, string>()
  for (const [tissue, colors] of offered) {
    chosen.set(tissue, PREFERRED_COLORS.find((c) => colors.includes(c)) ?? colors[0])
  }
  return chosen
}

interface EvalContext {
  unit: LookUnit
  look: UnitLook | null
  plain: PlainLook | null
  /** Set by CONDITION_TISSUE_LAYER for the TISSUE_* tags after it. */
  tissues: UnitTissue[] | null
  tissueKey: string | null
  /** Set by CONDITION_ITEM_WORN for ITEM_QUALITY / material tags after it. */
  item: UnitWornItem | null
  /** Set by CONDITION_BP / LG_CONDITION_BP for BP_* tags after it. */
  parts: [string, string, 0 | 1][] | null
  /** Set by TISSUE_SWAP when the hair is curly enough. */
  swap: { page: string; x: number; y: number } | null
}

/** Stable per-unit, per-part pick for CONDITION_RANDOM_PART_INDEX (the game's seed is internal). */
function randomPartIndex(unitId: number, part: string, count: number): number {
  let h = (unitId * 2654435761) >>> 0
  for (let i = 0; i < part.length; i++) h = Math.imul(h ^ part.charCodeAt(i), 16777619) >>> 0
  return (h % Math.max(1, count)) + 1
}

function selectParts(
  look: UnitLook | null,
  mode: string,
  key: string,
): [string, string, 0 | 1][] | null {
  if (!look) return null
  return look.parts.filter((p) => (mode === 'BY_TOKEN' ? p[0] === key : p[1] === key))
}

function findWorn(
  look: UnitLook,
  mode: string,
  key: string,
  type: string | undefined,
  subtypes: string[],
): UnitWornItem | null {
  for (const item of look.worn) {
    const place = mode === 'BY_TOKEN' ? item.bp === key : item.cat === key
    if (!place) continue
    if (type && item.type !== type) continue
    if (subtypes.length && (!item.subtype || !subtypes.includes(item.subtype))) continue
    return item
  }
  return null
}

function maxOf(values: (number | null | undefined)[]): number | null {
  let out: number | null = null
  for (const v of values) if (typeof v === 'number' && (out === null || v > out)) out = v
  return out
}

/** Evaluate one condition tag against the unit; mutates the context for follow-up tags. */
function holds(cond: string[], ctx: EvalContext): boolean {
  const [tag, ...args] = cond
  const { unit, look, plain } = ctx
  switch (tag) {
    case 'CONDITION_CASTE':
      return unit.caste_id !== null && args.includes(unit.caste_id)
    case 'CONDITION_SYN_CLASS':
      return !!look && look.syn_classes.some((c) => args.includes(c))
    case 'CONDITION_GHOST':
      return unit.flags.includes('ghost')
    case 'CONDITION_CHILD':
      return unit.flags.includes('child') || unit.flags.includes('baby')
    case 'CONDITION_NOT_CHILD':
      return !(unit.flags.includes('child') || unit.flags.includes('baby'))
    case 'CONDITION_BODY_SIZE_MIN':
      return look ? look.body_size >= Number(args[0]) : true
    case 'CONDITION_HAUL_COUNT_MIN':
      return (look?.haul_count ?? 0) >= Number(args[0])
    case 'CONDITION_HAUL_COUNT_MAX':
      return (look?.haul_count ?? 0) <= Number(args[0])
    case 'CONDITION_PROFESSION_CATEGORY': {
      const category = look ? look.profession_category : 'STANDARD'
      return category !== null && args.includes(category)
    }

    // --- tissues -----------------------------------------------------------
    case 'CONDITION_TISSUE_LAYER': {
      // [BY_CATEGORY:CAT:LAYER] or [BY_TOKEN:TOKEN:LAYER]
      const [mode, key, layer] = args
      ctx.tissueKey = args.join(':')
      if (!look) {
        ctx.tissues = plain ? [] : null
        return !!plain
      }
      ctx.tissues = look.tissues.filter(
        (t) =>
          t.layer === layer &&
          (mode === 'BY_TOKEN' ? t.bps.includes(key) : key === 'ALL' || t.cat === key),
      )
      return ctx.tissues.length > 0
    }
    case 'TISSUE_MAY_HAVE_COLOR': {
      if (plain) {
        const want = ctx.tissueKey ? plain.colors.get(ctx.tissueKey) : undefined
        return !!want && args.includes(want)
      }
      return !!ctx.tissues?.some((t) => !!t.color && args.includes(t.color))
    }
    case 'TISSUE_MIN_LENGTH': {
      const length = plain ? PLAIN_LENGTH : maxOf(ctx.tissues?.map((t) => t.length) ?? [])
      return length !== null && length >= Number(args[0])
    }
    case 'TISSUE_MAX_LENGTH': {
      const length = plain ? PLAIN_LENGTH : maxOf(ctx.tissues?.map((t) => t.length) ?? [])
      return length !== null && length <= Number(args[0])
    }
    case 'TISSUE_MAY_HAVE_SHAPING':
      if (plain) return false
      return !!ctx.tissues?.some((t) => !!t.style && args.includes(t.style))
    case 'TISSUE_NOT_SHAPED':
      if (plain) return true
      return !!ctx.tissues?.some((t) => !t.style || !SHAPINGS.has(t.style))
    case 'TISSUE_MIN_DENSITY': {
      const dense = plain ? PLAIN_MODIFIER : maxOf(ctx.tissues?.map((t) => t.dense) ?? [])
      return dense !== null && dense >= Number(args[0])
    }
    case 'TISSUE_MAX_DENSITY': {
      const dense = plain ? PLAIN_MODIFIER : maxOf(ctx.tissues?.map((t) => t.dense) ?? [])
      return dense !== null && dense <= Number(args[0])
    }
    case 'TISSUE_SWAP': {
      // [IF_MIN_CURLY:n:PAGE:x:y]: not a condition, a sprite substitution.
      if (args[0] === 'IF_MIN_CURLY' && !plain) {
        const curly = maxOf(ctx.tissues?.map((t) => t.curly) ?? [])
        if (curly !== null && curly >= Number(args[1])) {
          ctx.swap = { page: args[2], x: Number(args[3]), y: Number(args[4]) }
        }
      }
      return true
    }

    // --- items -------------------------------------------------------------
    case 'CONDITION_ITEM_WORN': {
      // [BY_CATEGORY:CAT:TYPE:SUBTYPE...] or [BY_TOKEN:TOKEN:TYPE:SUBTYPE...]
      if (!look) return false
      const [mode, key, type, ...subtypes] = args
      const item = findWorn(look, mode, key, type, subtypes)
      if (!item) return false
      ctx.item = item
      return true
    }
    case 'SHUT_OFF_IF_ITEM_PRESENT': {
      if (!look) return true
      const [mode, key, type, ...subtypes] = args
      return findWorn(look, mode, key, type, subtypes) === null
    }
    case 'ITEM_QUALITY':
      return ctx.item !== null && ctx.item.quality === Number(args[0])
    case 'CONDITION_MATERIAL_FLAG':
      return ctx.item !== null && args.every((flag) => ctx.item?.flags.includes(flag))
    case 'CONDITION_MATERIAL_TYPE':
      return ctx.item !== null && ctx.item.material_type === args[0]
    case 'CONDITION_DYE':
      return !!ctx.item?.dyed && args.includes(ctx.item.color ?? '')
    case 'CONDITION_NOT_DYED':
      return ctx.item !== null && !ctx.item.dyed

    // --- body parts --------------------------------------------------------
    case 'CONDITION_BP':
    case 'LG_CONDITION_BP': {
      ctx.parts = selectParts(look, args[0], args[1])
      return true
    }
    case 'BP_PRESENT':
      if (!look) return true
      return !!ctx.parts?.some((p) => p[2] === 0)
    case 'BP_MISSING':
      if (!look) return false
      return !!ctx.parts?.some((p) => p[2] === 1)
    case 'BP_SCARRED':
      // Not exposed by the dump; the game would check the wound record.
      return false
    case 'BP_APPEARANCE_MODIFIER_RANGE':
    case 'CONDITION_BP_APPEARANCE_MODIFIER_RANGE': {
      // [MODIFIER:min:max], scoped to the parts picked by CONDITION_BP when present.
      const max = Number(args.at(-1))
      const min = Number(args.at(-2))
      const type = args[args.length - 3]
      if (!look) return PLAIN_MODIFIER >= min && PLAIN_MODIFIER <= max
      const tokens = ctx.parts ? new Set(ctx.parts.map((p) => p[0])) : null
      const mod = look.bp_modifiers.find((m) => m[2] === type && (!tokens || tokens.has(m[0])))
      return mod !== undefined && mod[3] >= min && mod[3] <= max
    }
    case 'CONDITION_RANDOM_PART_INDEX': {
      // [PART:index:count]
      const index = plain ? 1 : randomPartIndex(unit.id, args[0], Number(args[2]))
      return index === Number(args[1])
    }
    default:
      // A condition this port does not know: the game would decide; be conservative.
      return false
  }
}

function evaluate(conditions: string[][], ctx: EvalContext): boolean {
  for (const cond of conditions) if (!holds(cond, ctx)) return false
  return true
}

// ---------------------------------------------------------------------------
// Resolution

function recolorFor(
  layer: LayerRule,
  set: LayerSetRule,
  item: UnitWornItem | null,
  index: DfAssetIndex,
): Recolor | null {
  if (layer.palette) {
    const palette = set.palettes[layer.palette.name]
    if (!palette?.file) return null
    return { file: palette.file, fromRow: palette.defaultRow, toRow: layer.palette.row }
  }
  if (layer.itemPalette) {
    const standard = index.palettes.DEFAULT
    const color = item?.color
    if (!standard || !color) return null
    const row = standard.colors[color]
    if (row === undefined) return null
    return { file: standard.file, fromRow: standard.defaultRow, toRow: row }
  }
  return null
}

function resolveLayer(
  layer: LayerRule,
  group: LayerGroupRule,
  set: LayerSetRule,
  base: EvalContext,
  index: DfAssetIndex,
): ResolvedLayer | null {
  const ctx: EvalContext = { ...base, tissues: null, tissueKey: null, item: null, swap: null }
  if (!evaluate(layer.conditions, ctx)) return null
  const sprite = ctx.swap ?? layer
  return {
    name: layer.name,
    page: sprite.page,
    x: sprite.x,
    y: sprite.y,
    w: layer.w,
    h: layer.h,
    offset: group.offset ?? [0, 0],
    recolor: recolorFor(layer, set, ctx.item, index),
  }
}

/**
 * The layers to draw for this unit, bottom to top, exactly as the game
 * would pick them. Units from dumps without `look` get a plain default look.
 */
export function resolveLayers(
  set: LayerSetRule,
  unit: LookUnit,
  index: DfAssetIndex,
): ResolvedLayer[] {
  // The dump records `{error}` in place of a look it could not build; treat
  // that like a missing look.
  const look = unit.look && Array.isArray(unit.look.tissues) ? unit.look : null
  const base: EvalContext = {
    unit,
    look,
    plain: look ? null : { colors: plainColors(set) },
    tissues: null,
    tissueKey: null,
    item: null,
    parts: null,
    swap: null,
  }
  const out: ResolvedLayer[] = []
  for (const group of set.groups) {
    const groupCtx: EvalContext = { ...base, parts: null }
    if (!evaluate(group.conditions, groupCtx)) continue
    if (group.explicit) {
      for (const layer of group.layers) {
        const resolved = resolveLayer(layer, group, set, groupCtx, index)
        if (resolved) {
          out.push(resolved)
          break
        }
      }
    } else {
      for (const layer of group.layers) {
        const resolved = resolveLayer(layer, group, set, groupCtx, index)
        if (resolved) out.push(resolved)
      }
    }
  }
  return out
}
