import type { GeneratedLook } from '@fortress/db-drizzle'

import type { DfAssetIndex, TileSprite } from './index'
import type { Recolor, ResolvedLayer } from './layers'

/**
 * Procedurally generated creatures (forgotten beasts, titans, demons) have no
 * sprite of their own. The game ships a parts kit instead - one silhouette
 * per body plan on BEASTS_SMALL (and BEASTS_SMALL_ORGANICS for fleshy ones)
 * with overlays for shell, plates, wings, tails, horns, antennae, mandibles,
 * beak, trunk and eye count - and assembles a beast from its generated body,
 * recolouring through the BEASTS palette. The assembly rules are the
 * engine's, so this reconstructs them from the facts the dump carries: body
 * part categories, tissues, the outer material's colour and the generator's
 * description. Close to the game in spirit, not pixel for pixel.
 */

export type BodyPlan =
  | 'AMORPHOUS'
  | 'SNAKE'
  | 'WORM_LONG'
  | 'WORM_SHORT'
  | 'INSECT'
  | 'SPIDER'
  | 'SCORPION'
  | 'BIPEDAL_DINOSAUR'
  | 'HUMANOID'
  | 'FRONT_GRASP'
  | 'QUADRUPED_BULKY'
  | 'QUADRUPED_SLINKY'
  | 'WALRUS'

const PLAN_LEGS: Record<BodyPlan, number> = {
  AMORPHOUS: 0,
  SNAKE: 0,
  WORM_LONG: 0,
  WORM_SHORT: 0,
  INSECT: 6,
  SPIDER: 8,
  SCORPION: 8,
  BIPEDAL_DINOSAUR: 2,
  HUMANOID: 2,
  FRONT_GRASP: 4,
  QUADRUPED_BULKY: 4,
  QUADRUPED_SLINKY: 4,
  WALRUS: 0,
}

/** Which silhouette the generated body maps to. */
export function bodyPlan(gen: GeneratedLook): BodyPlan {
  const c = (k: string) => gen.cats[k] ?? 0
  const d = gen.description.toLowerCase()
  const legs = c('LEG_FRONT') + c('LEG_REAR') + c('LEG_UPPER') + c('LEG')
  const arms = c('ARM_UPPER') + c('ARM')
  const flippers = c('FLIPPER')

  if (/\bscorpions?\b/.test(d)) return 'SCORPION'
  if (legs >= 8 || /\b(spiders?|tarantulas?)\b/.test(d)) return 'SPIDER'
  if (legs === 6 || legs === 7) return 'INSECT'
  if (flippers > 0 || /\b(walrus|seals?|sea lions?|manatees?)\b/.test(d)) return 'WALRUS'
  if (legs === 0 && arms === 0) {
    if (/(worm|caterpillar|leech|slug|larva|maggot|grub)/.test(d)) {
      return /\b(stubby|short|squat)\b/.test(d) ? 'WORM_SHORT' : 'WORM_LONG'
    }
    if (c('HEAD') > 0 || /\b(serpents?|snakes?|eels?)\b/.test(d)) return 'SNAKE'
    return 'AMORPHOUS'
  }
  if (legs <= 2 && arms > 0) return 'HUMANOID'
  if (legs <= 2) return 'BIPEDAL_DINOSAUR'
  if (c('HAND') >= 2 && c('FOOT_FRONT') === 0) return 'FRONT_GRASP'
  if (/\b(gaunt|emaciated|slender|lanky|lean|thin|skinny)\b/.test(d)) return 'QUADRUPED_SLINKY'
  return 'QUADRUPED_BULKY'
}

function firstTile(index: DfAssetIndex, names: string[]): TileSprite | null {
  for (const name of names) {
    const tile = index.tiles[name]
    if (tile) return tile
  }
  return null
}

/** The beast palette row is picked by nearest colour to the material's colour. */
function beastRecolor(index: DfAssetIndex, gen: GeneratedLook): Recolor | null {
  const beasts = index.palettes.BEASTS
  const standard = index.palettes.DEFAULT
  if (!beasts || !standard || !gen.color) return null
  const row = standard.colors[gen.color]
  if (row === undefined) return null
  return {
    file: beasts.file,
    fromRow: beasts.defaultRow,
    toRow: -1,
    match: { file: standard.file, row },
  }
}

/**
 * The layer stack for a generated creature, bottom to top: wings behind,
 * body, covering, tails, extra legs, head features, eyes, wings in front.
 */
export function beastLayers(index: DfAssetIndex, gen: GeneratedLook): ResolvedLayer[] {
  const plan = bodyPlan(gen)
  const organic = !gen.tissues.includes('UNIFORM_TIS')
  const c = (k: string) => gen.cats[k] ?? 0
  const d = gen.description.toLowerCase()
  const recolor = beastRecolor(index, gen)

  const prefixes = organic ? ['BEAST_SMALL_ORGANIC_', 'BEAST_SMALL_'] : ['BEAST_SMALL_']
  const part = (suffix: string): TileSprite | null =>
    firstTile(
      index,
      prefixes.map((p) => `${p}${plan}${suffix}`),
    )

  const layers: ResolvedLayer[] = []
  const push = (name: string, tile: TileSprite | null, paint = true) => {
    if (!tile) return
    layers.push({
      name,
      page: tile.page,
      x: tile.x,
      y: tile.y,
      w: tile.w ?? 1,
      h: tile.h ?? 1,
      offset: [0, 0],
      recolor: paint ? recolor : null,
    })
  }

  // Wings: feathered when it has feathers, membranous for fleshy beasts,
  // lacy (insect-like) for bugs and things made of stone or vapour.
  const winged = c('WING') > 0 || gen.flier
  const wingKind = gen.tissues.includes('FEATHER')
    ? 'FEATHERED'
    : organic && plan !== 'INSECT' && plan !== 'SPIDER' && plan !== 'SCORPION'
      ? 'BAT'
      : 'LACY'
  if (winged) push('wings back', part(`_WINGS_${wingKind}_BACK`))

  push('body', part(''))

  if (c('SHELL') > 0 || /\bshell\b/.test(d)) push('shell', part('_SHELL'))
  else if (gen.tissues.includes('SCALE') || /\b(plates?|plated|armou?red)\b/.test(d)) {
    push('plates', part('_PLATES'))
  }
  if (/\b(exposed|external)\s+ribs?\b|\bribs? (show|jut)/.test(d))
    push('ribs', part('_EXTERNAL_RIBS'))
  if (/\bquills?\b|\bspines?\b|\bspiky\b/.test(d)) push('quills', part('_QUILLS'))

  const tails = c('TAIL')
  if (tails === 1) push('tail', part('_TAIL_ONE'))
  else if (tails === 2) push('tails', part('_TAIL_TWO'))
  else if (tails >= 3) push('tails', part('_TAIL_THREE'))

  const legs = c('LEG_FRONT') + c('LEG_REAR') + c('LEG_UPPER') + c('LEG')
  const extra = legs - PLAN_LEGS[plan]
  if (extra >= 4) push('extra legs', part('_EXTRA_LEGS2'))
  else if (extra >= 2) push('extra legs', part('_EXTRA_LEGS1'))
  if (plan === 'HUMANOID' || plan === 'BIPEDAL_DINOSAUR') {
    if (c('ARM_UPPER') + c('ARM') > 2) push('extra arms', part('_ARMS'))
  }

  const horns = c('HORN')
  if (horns === 1) push('horn', part('_HORN'))
  else if (horns === 2) push('horns', part('_HORNS1'))
  else if (horns >= 3) push('horns', part('_HORNS2'))
  if (c('ANTENNA') > 0) push('antennae', part('_ANTENNAE'))
  const mandibles = c('MANDIBLE') > 0
  if (mandibles) push('mandibles back', part('_MANDIBLES_BACK'))
  if (c('BEAK') > 0 || /\bbeak\b/.test(d)) push('beak', part('_BEAK'))
  if (c('TRUNK') > 0 || /\btrunk\b/.test(d)) push('trunk', part('_TRUNK'))
  if (c('PROBOSCIS') > 0 || /\bproboscis\b/.test(d)) push('proboscis', part('_PROBOSCIS'))

  // Eyes are not recoloured: the kit paints them to stand out.
  const eyes = c('EYE')
  if (eyes === 1) push('eye', part('_EYE_ONE'), false)
  else if (eyes === 2) push('eyes', part('_EYE_TWO'), false)
  else if (eyes >= 3) push('eyes', part('_EYE_THREE'), false)

  if (mandibles) push('mandibles front', part('_MANDIBLES_FRONT'))
  if (winged) push('wings front', part(`_WINGS_${wingKind}_FRONT`))

  return layers
}

/** Race token prefix -> the list icon the game shows for that class of generated creature. */
const GENERATED_ICONS: [RegExp, string][] = [
  [/^FORGOTTEN_BEAST_/, 'FORGOTTEN_BEAST_ICON'],
  [/^TITAN_/, 'TITAN_ICON'],
  [/^DEMON_/, 'DEMON_ICON'],
  [/^NIGHT_CREATURE_/, 'NIGHT_CREATURE_ICON'],
  [/^HFEXP/, 'NIGHT_CREATURE_ICON'],
  [/^ANGEL_/, 'ANGEL_ICON'],
]

/** True for race tokens that only exist inside a generated world. */
export function isGeneratedRace(race: string | null | undefined): boolean {
  return !!race && GENERATED_ICONS.some(([re]) => re.test(race))
}

/** The generic icon for a generated race, used where its body is unknown (legends, corpses). */
export function generatedIcon(
  index: DfAssetIndex,
  race: string | null | undefined,
): TileSprite | null {
  if (!race) return null
  const hit = GENERATED_ICONS.find(([re]) => re.test(race))
  return hit ? (index.tiles[hit[1]] ?? null) : null
}
