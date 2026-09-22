/**
 * Copy sprite sheets and art out of the local Dwarf Fortress install and build
 * an index the web app can use to address individual sprites.
 *
 * Run from apps/worker:  bun run assets:extract   (or: npx tsx src/scripts/extract-assets.ts)
 *
 * How the game stores its graphics (Steam DF v50, "premium" tileset):
 *
 * - Every sprite is a plain PNG sprite sheet under
 *   `<game>/data/vanilla/<pack>/graphics/` (often in an `images/` subfolder).
 *   Packs: vanilla_creatures_graphics (dwarves live here), vanilla_items_graphics,
 *   vanilla_environment (map tiles), vanilla_interface, vanilla_buildings_graphics,
 *   vanilla_plants_graphics, vanilla_world_map, and a few smaller ones.
 * - Text raws next to the images describe them:
 *     [TILE_PAGE:NAME] + [FILE:images/x.png] + [TILE_DIM:w:h] + [PAGE_DIM_PIXELS:w:h]
 *       -> one sprite sheet and its grid size
 *     [TILE_GRAPHICS:PAGE:col:row:TILE_NAME(:frame)]
 *       -> one named tile on a sheet (terrain, flows, liquids, ...)
 *     [CREATURE_GRAPHICS:ID] / [CREATURE_CASTE_GRAPHICS:ID:CASTE] followed by
 *     state lines like [DEFAULT:PAGE:col:row:AS_IS] or [CORPSE:PAGE:col:row:...]
 *       -> where a creature's sprites sit.
 *     [LAYER_SET:DEFAULT] ... [LAYER_GROUP] [LAYER:NAME:PAGE:col:row] [CONDITION_*...]
 *       -> civilized races (dwarves, humans, elves, goblins, kobolds, animal
 *          people) are composited from layers: one layer per group is drawn,
 *          the first whose conditions hold. Conditions cover caste, curses,
 *          skin and hair colour, worn items, profession, and so on. The index
 *          resolves each group for a plain creature of each caste (no curse,
 *          nothing worn, first listed skin/hair variant) so the web app can
 *          draw a creature's default look without knowing its wardrobe.
 * - `<game>/data/art/` holds the classic tilesets and UI art (curses_*.png etc.).
 *
 * Everything lands in apps/web/public/df-assets/, which is gitignored: the
 * sprites are Kitfox/Bay 12 property and must not be committed.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { config } from '../config'

const workerRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const OUT_DIR = process.env.DF_ASSETS_OUT_DIR || path.resolve(workerRoot, '../web/public/df-assets')

// ---------------------------------------------------------------------------
// Raw parsing

interface TilePage {
  /** TILE_PAGE name, e.g. CREATURES_DOMESTIC. */
  name: string
  /** Path of the copied PNG relative to df-assets/, e.g. "vanilla_creatures_graphics/images/creatures_domestic.png". */
  file: string
  tileWidth: number
  tileHeight: number
  pageWidth: number
  pageHeight: number
}

interface TileSprite {
  page: string
  x: number
  y: number
}

/** One fallback layer of a layered creature, in tiles of its page. */
interface LayerSprite extends TileSprite {
  name: string
  /** Size in tiles; >1 only for LARGE_IMAGE layers. */
  w: number
  h: number
}

interface AssetIndex {
  gameDir: string
  extractedAt: string
  pages: Record<string, TilePage>
  /** TILE_GRAPHICS name -> sprite (last definition wins; frames get "NAME:frame" keys). */
  tiles: Record<string, TileSprite>
  /** "CREATURE" or "CREATURE:CASTE" -> state (DEFAULT, CHILD, CORPSE, ...) -> sprite. */
  creatures: Record<string, Record<string, TileSprite>>
  /**
   * Layered creatures: "CREATURE" or "CREATURE:CASTE" -> layer set
   * ("DEFAULT", "CHILD:DEFAULT", "BABY:DEFAULT", "CORPSE", "ANIMATED",
   * "PORTRAIT", ...) -> one layer per layer group for a plain creature,
   * bottom to top. Groups that only draw worn items or curses are left out.
   */
  layered: Record<string, Record<string, LayerSprite[]>>
}

/** Pull every [TAG:arg:arg] out of a raw file, in order. */
function* rawTags(text: string): Generator<string[]> {
  for (const match of text.matchAll(/\[([^\][]+)\]/g)) {
    yield match[1].split(':').map((part) => part.trim())
  }
}

const CREATURE_STATE_SKIP = new Set([
  'LAYER_SET',
  'LAYER_GROUP',
  'LAYER',
  'END_LAYER_GROUP',
  'LS_PALETTE',
  'LS_PALETTE_FILE',
  'LS_PALETTE_DEFAULT',
  'USE_PALETTE',
  'BODY_UPPER',
  'CONDITION_GHOST',
  // Portrait layer plumbing, not a sprite state.
  'BP_APPEARANCE_MODIFIER_RANGE',
])

/** Tags inside a layer set that describe how to draw, not when to draw. */
const LAYER_NON_CONDITION = new Set([
  'LS_PALETTE',
  'LS_PALETTE_FILE',
  'LS_PALETTE_DEFAULT',
  'USE_PALETTE',
  'USE_STANDARD_PALETTE_FROM_ITEM',
])

/**
 * The "plain" creature the layers are resolved for: healthy, nothing worn,
 * average build, short unstyled hair, the first face variant, and one colour
 * per tissue. Every appearance condition is evaluated against this the way
 * the game evaluates it against a real unit, so exactly one variant of each
 * body part passes. Lengths: 1-49 stubble, 50-99 short, 100-199 mid, 200+ long.
 */
const PLAIN_TISSUE_LENGTH = 75
const PLAIN_MODIFIER_VALUE = 100
const PREFERRED_COLORS = ['DARK_BROWN', 'BROWN', 'CHESTNUT', 'TAN', 'PALE_BROWN', 'BLACK', 'GRAY']

interface RawLayer {
  sprite: LayerSprite
  conditions: string[][]
}

interface RawLayerGroup {
  /** Opened by [LAYER_GROUP]; layers outside any group each draw on their own. */
  explicit: boolean
  conditioned: boolean
  layers: RawLayer[]
}

/** Default colour per tissue key ("BY_CATEGORY:HEAD:HAIR"), chosen from the colours the raws offer. */
type TissueColors = Map<string, string>

function pickTissueColors(groups: RawLayerGroup[]): TissueColors {
  const offered = new Map<string, string[]>()
  for (const group of groups) {
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
  const chosen: TissueColors = new Map()
  for (const [tissue, colors] of offered) {
    chosen.set(tissue, PREFERRED_COLORS.find((c) => colors.includes(c)) ?? colors[0])
  }
  return chosen
}

function layerPasses(layer: RawLayer, caste: string | null, colors: TissueColors): boolean {
  let tissue: string | null = null
  for (const cond of layer.conditions) {
    const tag = cond[0]
    switch (tag) {
      case 'CONDITION_CASTE':
        if (caste === null || !cond.slice(1).includes(caste)) return false
        break
      case 'CONDITION_TISSUE_LAYER':
        tissue = cond.slice(1).join(':')
        break
      case 'TISSUE_MAY_HAVE_COLOR': {
        const want = tissue ? colors.get(tissue) : undefined
        if (!want || !cond.slice(1).includes(want)) return false
        break
      }
      case 'TISSUE_MIN_LENGTH':
        if (PLAIN_TISSUE_LENGTH < Number(cond[1])) return false
        break
      case 'TISSUE_MAX_LENGTH':
        if (PLAIN_TISSUE_LENGTH > Number(cond[1])) return false
        break
      case 'TISSUE_MAY_HAVE_SHAPING':
        // Plain hair is not styled.
        return false
      case 'CONDITION_RANDOM_PART_INDEX':
        // [..:PART:index:count] - always the first variant.
        if (Number(cond[2]) !== 1) return false
        break
      case 'BP_APPEARANCE_MODIFIER_RANGE':
      case 'CONDITION_BP_APPEARANCE_MODIFIER_RANGE': {
        // [..:MODIFIER:min:max] (portraits may prefix a body part).
        const max = Number(cond.at(-1))
        const min = Number(cond.at(-2))
        if (Number.isFinite(min) && Number.isFinite(max)) {
          if (PLAIN_MODIFIER_VALUE < min || PLAIN_MODIFIER_VALUE > max) return false
        }
        break
      }
      case 'TISSUE_NOT_SHAPED':
      case 'TISSUE_SWAP':
      case 'CONDITION_NOT_CHILD':
      // "Hide when a helmet/cloak is worn": nothing is worn, so it passes.
      case 'SHUT_OFF_IF_ITEM_PRESENT':
        break
      default:
        // Curses, ghosts, worn items, professions, dyes, materials: not plain.
        return false
    }
  }
  return true
}

class LayerSetParser {
  private readonly groups: RawLayerGroup[] = []
  private group: RawLayerGroup | null = null
  readonly castes = new Set<string>()

  private openGroup(explicit: boolean) {
    this.group = { explicit, conditioned: false, layers: [] }
    this.groups.push(this.group)
  }

  handle(args: string[]) {
    const tag = args[0]
    if (tag === 'LAYER_GROUP') {
      this.openGroup(true)
      return
    }
    if (tag === 'END_LAYER_GROUP') {
      this.group = null
      return
    }
    if (tag === 'LAYER') {
      if (!this.group?.explicit) this.openGroup(false)
      // [LAYER:NAME:PAGE:x:y] or [LAYER:NAME:PAGE:LARGE_IMAGE:x1:y1:x2:y2]
      const large = args[3] === 'LARGE_IMAGE'
      const x = Number(args[large ? 4 : 3])
      const y = Number(args[large ? 5 : 4])
      const w = large ? Number(args[6]) - x + 1 : 1
      const h = large ? Number(args[7]) - y + 1 : 1
      if (!Number.isInteger(x) || !Number.isInteger(y)) return
      this.group?.layers.push({
        sprite: { name: args[1], page: args[2], x, y, w, h },
        conditions: [],
      })
      return
    }
    if (tag.startsWith('LG_')) {
      if (this.group) this.group.conditioned = true
      return
    }
    if (LAYER_NON_CONDITION.has(tag)) return
    const layer = this.group?.layers.at(-1)
    if (!layer) return
    layer.conditions.push(args)
    if (tag === 'CONDITION_CASTE') for (const c of args.slice(1)) this.castes.add(c)
  }

  /**
   * The layers a plain creature of the given caste shows, bottom to top: the
   * first passing layer of each explicit group, and every passing ungrouped
   * layer (that is how the game treats layers outside a LAYER_GROUP).
   */
  resolve(caste: string | null): LayerSprite[] {
    const colors = pickTissueColors(this.groups)
    const out: LayerSprite[] = []
    for (const group of this.groups) {
      if (group.conditioned) continue
      if (group.explicit) {
        const layer = group.layers.find((l) => layerPasses(l, caste, colors))
        if (layer) out.push(layer.sprite)
      } else {
        for (const layer of group.layers) {
          if (layerPasses(layer, caste, colors)) out.push(layer.sprite)
        }
      }
    }
    return out
  }
}

function parseRawFile(text: string, packName: string, index: AssetIndex) {
  let currentPage: TilePage | null = null
  let currentCreature: string | null = null
  let layerSet: { key: string; parser: LayerSetParser } | null = null

  const endLayerSet = () => {
    if (!layerSet || !currentCreature) {
      layerSet = null
      return
    }
    const { key, parser } = layerSet
    const store = (creatureKey: string, layers: LayerSprite[]) => {
      if (!layers.length) return
      index.layered[creatureKey] ??= {}
      index.layered[creatureKey][key] = layers
    }
    const castes = [...parser.castes]
    if (castes.length === 0) {
      store(currentCreature, parser.resolve(null))
    } else {
      // Per-caste variants, plus the first caste as the fallback when the
      // unit's caste is unknown or has no graphics of its own.
      for (const caste of castes) store(`${currentCreature}:${caste}`, parser.resolve(caste))
      store(currentCreature, parser.resolve(castes[0]))
    }
    layerSet = null
  }

  for (const args of rawTags(text)) {
    const tag = args[0]

    if (tag === 'LAYER_SET') {
      endLayerSet()
      layerSet = { key: args.slice(1).join(':'), parser: new LayerSetParser() }
      continue
    }
    if (layerSet) {
      const opensBlock =
        tag === 'TILE_PAGE' ||
        tag === 'PAGE' ||
        tag === 'OBJECT' ||
        tag === 'CREATURE_GRAPHICS' ||
        tag === 'CREATURE_CASTE_GRAPHICS' ||
        tag === 'STATUE_CREATURE_GRAPHICS' ||
        tag === 'STATUE_CREATURE_CASTE_GRAPHICS'
      if (!opensBlock) {
        layerSet.parser.handle(args)
        continue
      }
      endLayerSet()
    }

    if (tag === 'TILE_PAGE' || tag === 'PAGE') {
      currentPage = {
        name: args[1],
        file: '',
        tileWidth: 0,
        tileHeight: 0,
        pageWidth: 0,
        pageHeight: 0,
      }
      currentCreature = null
      index.pages[args[1]] = currentPage
      continue
    }
    if (currentPage && tag === 'FILE') {
      currentPage.file = path.posix.join(packName, args[1])
      continue
    }
    if (currentPage && tag === 'TILE_DIM') {
      currentPage.tileWidth = Number(args[1])
      currentPage.tileHeight = Number(args[2])
      continue
    }
    if (currentPage && tag === 'PAGE_DIM_PIXELS') {
      currentPage.pageWidth = Number(args[1])
      currentPage.pageHeight = Number(args[2])
      continue
    }

    // [TILE_GRAPHICS:PAGE:col:row:NAME(:frame)]
    if (tag === 'TILE_GRAPHICS' && args.length >= 5) {
      const [, page, x, y, name, frame] = args
      const key = frame ? `${name}:${frame}` : name
      index.tiles[key] = { page, x: Number(x), y: Number(y) }
      continue
    }

    if (tag === 'CREATURE_GRAPHICS') {
      currentCreature = args[1]
      currentPage = null
      index.creatures[currentCreature] ??= {}
      continue
    }
    if (tag === 'CREATURE_CASTE_GRAPHICS') {
      currentCreature = `${args[1]}:${args[2]}`
      currentPage = null
      index.creatures[currentCreature] ??= {}
      continue
    }
    // Statues are separate sprites; keep them from overwriting the creature's
    // real DEFAULT state by namespacing the key.
    if (tag === 'STATUE_CREATURE_GRAPHICS') {
      currentCreature = `STATUE:${args[1]}`
      currentPage = null
      index.creatures[currentCreature] ??= {}
      continue
    }
    if (tag === 'STATUE_CREATURE_CASTE_GRAPHICS') {
      currentCreature = `STATUE:${args[1]}:${args[2]}`
      currentPage = null
      index.creatures[currentCreature] ??= {}
      continue
    }
    if (tag === 'OBJECT') {
      currentCreature = null
      currentPage = null
      continue
    }

    // Inside a creature block: [STATE:PAGE:col:row:...], e.g.
    // [DEFAULT:CREATURES_DOMESTIC:0:0:AS_IS] or [SKELETON:BONE_PILE:0:0].
    if (
      currentCreature &&
      args.length >= 4 &&
      !CREATURE_STATE_SKIP.has(tag) &&
      !tag.startsWith('CONDITION_') &&
      !tag.startsWith('TISSUE_') &&
      !tag.startsWith('LG_') &&
      Number.isInteger(Number(args[2])) &&
      Number.isInteger(Number(args[3]))
    ) {
      index.creatures[currentCreature][tag] = {
        page: args[1],
        x: Number(args[2]),
        y: Number(args[3]),
      }
    }
  }
  endLayerSet()
}

// ---------------------------------------------------------------------------
// Copying

function listFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true, recursive: true }).flatMap((entry) => {
    if (!entry.isFile()) return []
    return [path.join(entry.parentPath, entry.name)]
  })
}

function copyInto(src: string, destRel: string): void {
  const dest = path.join(OUT_DIR, destRel)
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.copyFileSync(src, dest)
}

function main() {
  const gameDir = config.gameDir
  const vanillaDir = path.join(gameDir, 'data', 'vanilla')
  const artDir = path.join(gameDir, 'data', 'art')

  if (!fs.existsSync(vanillaDir)) {
    console.error(
      `Game data not found at ${vanillaDir}.\nSet DF_GAME_DIR in apps/worker/.env to the folder that contains "Dwarf Fortress.exe".`,
    )
    process.exit(1)
  }

  fs.rmSync(OUT_DIR, { recursive: true, force: true })
  fs.mkdirSync(OUT_DIR, { recursive: true })

  const index: AssetIndex = {
    gameDir,
    extractedAt: new Date().toISOString(),
    pages: {},
    tiles: {},
    creatures: {},
    layered: {},
  }

  let pngCount = 0
  let rawCount = 0

  // Every vanilla pack that ships a graphics/ folder: creatures (incl. the
  // dwarf sprites and portraits), items, buildings, plants, map tiles
  // (vanilla_environment), interface art, and the world map sheets.
  const packs = fs
    .readdirSync(vanillaDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(vanillaDir, e.name, 'graphics')))
    .map((e) => e.name)

  for (const pack of packs) {
    const graphicsDir = path.join(vanillaDir, pack, 'graphics')
    for (const file of listFiles(graphicsDir)) {
      const rel = path.relative(graphicsDir, file)
      const ext = path.extname(file).toLowerCase()
      if (ext === '.png') {
        copyInto(file, path.join(pack, rel))
        pngCount++
      } else if (ext === '.txt') {
        parseRawFile(fs.readFileSync(file, 'utf8'), pack, index)
        rawCount++
      }
    }
  }

  // Classic tilesets and UI art (curses_*.png, logos, cursors).
  if (fs.existsSync(artDir)) {
    for (const file of listFiles(artDir)) {
      if (path.extname(file).toLowerCase() !== '.png') continue
      copyInto(file, path.join('art', path.relative(artDir, file)))
      pngCount++
    }
  }

  fs.writeFileSync(path.join(OUT_DIR, 'index.json'), JSON.stringify(index, null, 2))

  console.log(`Extracted DF assets from ${gameDir}`)
  console.log(`  ${pngCount} PNGs copied, ${rawCount} raws parsed from packs: ${packs.join(', ')}`)
  console.log(
    `  ${Object.keys(index.pages).length} sprite sheets, ${Object.keys(index.tiles).length} named tiles, ${Object.keys(index.creatures).length} creature entries, ${Object.keys(index.layered).length} layered creatures`,
  )
  console.log(`  -> ${OUT_DIR} (gitignored, local only)`)
}

main()
