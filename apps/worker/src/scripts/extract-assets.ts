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
 *          people) are composited from layers. Each explicit group draws the
 *          first layer whose conditions all hold; layers outside a group draw
 *          on their own. Conditions read caste, curses, skin/hair colour and
 *          length, worn items and their materials, profession, missing body
 *          parts, face shape, and so on. [USE_PALETTE:NAME:row] recolours a
 *          layer from row 0 of an LS_PALETTE image to another row, and
 *          [USE_STANDARD_PALETTE_FROM_ITEM] does the same with the global
 *          palette and the worn item's material colour. The index exports
 *          these rules verbatim (one JSON per creature under layers/) so the
 *          web app can evaluate them for a real unit exactly like the game.
 *     [LAYER_SET_TEMPLATE:NAME] ... [USE_LAYER_SET_TEMPLATE:NAME] + [ARG_X:...]
 *       -> animal people share one template; the ARG values are spliced in here.
 *     [PALETTE:DEFAULT] + [PALETTE_COLOR:NAME:row]
 *       -> the global palette: which row of palettes.png a colour token is.
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
// Index shape (mirrored in apps/web/src/lib/df-assets/types.ts)

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
  /** Size in tiles; present (>1) only for LARGE_IMAGE sprites. */
  w?: number
  h?: number
}

interface NamedPalette {
  /** Palette PNG relative to df-assets/; one colour per column, one variant per row. */
  file: string
  /** Row the sprite sheets are painted in. */
  defaultRow: number
  /** Colour token (DARK_BROWN) -> row; used by USE_STANDARD_PALETTE_FROM_ITEM. */
  colors: Record<string, number>
}

interface AssetIndex {
  gameDir: string
  extractedAt: string
  pages: Record<string, TilePage>
  /** TILE_GRAPHICS name -> sprite (last definition wins; frames get "NAME:frame" keys). */
  tiles: Record<string, TileSprite>
  /** "CREATURE" or "CREATURE:CASTE" -> state (DEFAULT, CHILD, CORPSE, ...) -> sprite. */
  creatures: Record<string, Record<string, TileSprite>>
  /** Creatures with a layers/<CREATURE>.json rule file. */
  layeredCreatures: string[]
  /** [PALETTE:NAME] blocks; "DEFAULT" is the one item colours refer to. */
  palettes: Record<string, NamedPalette>
  /**
   * Item subtype token (ITEM_WEAPON_PICK, ITEM_HELM_CAP) -> its sprite, from
   * [WEAPON_GRAPHICS:TOKEN] + [WEAPON_GRAPHICS_DEFAULT:PAGE:x:y] blocks and
   * [ARMOR_GRAPHICS:PAGE:x:y:TOKEN]-style tags. `artifact` is the variant
   * drawn for artifacts when the raws define one.
   */
  items: Record<string, { default: TileSprite; artifact?: TileSprite }>
}

// ---------------------------------------------------------------------------
// Layer rules (mirrored in apps/web/src/lib/df-assets/types.ts)

interface LayerRule {
  name: string
  page: string
  x: number
  y: number
  w: number
  h: number
  /**
   * The raw condition tags in order, tag first: e.g.
   * ["CONDITION_TISSUE_LAYER","BY_CATEGORY","HEAD","HAIR"] followed by its
   * nested ["TISSUE_MIN_LENGTH","50"]. Order matters: TISSUE_* and ITEM_*
   * tags refer to the tissue/item selected by the tag before them.
   */
  conditions: string[][]
  /** [USE_PALETTE:NAME:row]: recolour from the palette's default row to `row`. */
  palette?: { name: string; row: number }
  /** [USE_STANDARD_PALETTE_FROM_ITEM]: recolour with the worn item's material colour. */
  itemPalette?: boolean
}

interface LayerGroupRule {
  /** Opened by [LAYER_GROUP]; false for a layer that stands on its own. */
  explicit: boolean
  /** [LG_OFFSET:x:y] in pixels, from templates. */
  offset?: [number, number]
  /** Group-level conditions ([LG_CONDITION_BP:...] + [BP_PRESENT] ...). */
  conditions: string[][]
  layers: LayerRule[]
}

interface LayerSetRule {
  /** "DEFAULT", "CHILD:DEFAULT", "BABY:DEFAULT", "CORPSE", "ANIMATED", "PORTRAIT", "CHILD:PORTRAIT", ... */
  key: string
  /** Set when the set came from [CREATURE_CASTE_GRAPHICS:ID:CASTE]. */
  caste: string | null
  /** LS_PALETTE name -> palette image and the row the sheets are painted in. */
  palettes: Record<string, { file: string; defaultRow: number }>
  groups: LayerGroupRule[]
}

interface CreatureLayerRules {
  creature: string
  sets: LayerSetRule[]
}

// ---------------------------------------------------------------------------
// Raw parsing

/** Pull every [TAG:arg:arg] out of a raw file, in order. */
function* rawTags(text: string): Generator<string[]> {
  for (const match of text.matchAll(/\[([^\][]+)\]/g)) {
    yield match[1].split(':').map((part) => part.trim())
  }
}

/** Tags that start a new top-level block and therefore end a layer set. */
const BLOCK_OPENERS = new Set([
  'TILE_PAGE',
  'PAGE',
  'OBJECT',
  'CREATURE_GRAPHICS',
  'CREATURE_CASTE_GRAPHICS',
  'STATUE_CREATURE_GRAPHICS',
  'STATUE_CREATURE_CASTE_GRAPHICS',
  'LAYER_SET',
  'LAYER_SET_TEMPLATE',
  'PALETTE',
])

/** [X_GRAPHICS:PAGE:x:y:TOKEN(:material)] - one sprite per subtype, inline. */
const INLINE_ITEM_GRAPHICS = new Set([
  'ARMOR_GRAPHICS',
  'HELM_GRAPHICS',
  'SHOES_GRAPHICS',
  'GLOVES_GRAPHICS',
  'PANTS_GRAPHICS',
  'SHIELD_GRAPHICS',
  'TOOL_GRAPHICS',
  'TRAPCOMP_GRAPHICS',
  'TOY_GRAPHICS',
  'INSTRUMENT_GRAPHICS',
])

/** [X_GRAPHICS:TOKEN] opens a block of [X_GRAPHICS_VARIANT:PAGE:x:y] lines. */
const BLOCK_ITEM_GRAPHICS = new Set(['WEAPON_GRAPHICS', 'AMMO_GRAPHICS', 'SIEGEAMMO_GRAPHICS'])

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
  'BP_APPEARANCE_MODIFIER_RANGE',
])

/** Parse [STATE:PAGE:x:y...] or [STATE:PAGE:LARGE_IMAGE:x1:y1:x2:y2...] into a sprite. */
function spriteFromArgs(args: string[], from: number): TileSprite | null {
  const page = args[from]
  if (!page) return null
  if (args[from + 1] === 'LARGE_IMAGE') {
    const x = Number(args[from + 2])
    const y = Number(args[from + 3])
    const x2 = Number(args[from + 4])
    const y2 = Number(args[from + 5])
    if (![x, y, x2, y2].every(Number.isInteger)) return null
    return { page, x, y, w: x2 - x + 1, h: y2 - y + 1 }
  }
  const x = Number(args[from + 1])
  const y = Number(args[from + 2])
  if (!Number.isInteger(x) || !Number.isInteger(y)) return null
  return { page, x, y }
}

/** Collects one LAYER_SET's groups and layers from the raw tag stream. */
class LayerSetBuilder {
  readonly set: LayerSetRule
  private group: LayerGroupRule | null = null
  private layer: LayerRule | null = null
  private palette: string | null = null
  /** Set by LG_PERMITTED when a template arg says the group is off. */
  private groupDropped = false

  constructor(
    key: string,
    caste: string | null,
    private readonly packName: string,
  ) {
    this.set = { key, caste, palettes: {}, groups: [] }
  }

  private openGroup(explicit: boolean) {
    this.group = { explicit, conditions: [], layers: [] }
    this.layer = null
    this.groupDropped = false
    this.set.groups.push(this.group)
  }

  private closeGroup() {
    if (this.group && this.groupDropped) this.set.groups.pop()
    this.group = null
    this.layer = null
    this.groupDropped = false
  }

  handle(args: string[]) {
    const tag = args[0]
    switch (tag) {
      case 'LS_PALETTE':
        this.palette = args[1]
        this.set.palettes[args[1]] ??= { file: '', defaultRow: 0 }
        return
      case 'LS_PALETTE_FILE':
        if (this.palette)
          this.set.palettes[this.palette].file = path.posix.join(this.packName, args[1])
        return
      case 'LS_PALETTE_DEFAULT':
        if (this.palette) this.set.palettes[this.palette].defaultRow = Number(args[1])
        return
      case 'LAYER_GROUP':
        this.closeGroup()
        this.openGroup(true)
        return
      case 'END_LAYER_GROUP':
        this.closeGroup()
        return
      case 'LAYER': {
        // [LAYER:NAME:PAGE:x:y] or [LAYER:NAME:PAGE:LARGE_IMAGE:x1:y1:x2:y2]
        const sprite = spriteFromArgs(args, 2)
        if (!sprite) return
        if (!this.group?.explicit) {
          this.closeGroup()
          this.openGroup(false)
        }
        this.layer = {
          name: args[1],
          page: sprite.page,
          x: sprite.x,
          y: sprite.y,
          w: sprite.w ?? 1,
          h: sprite.h ?? 1,
          conditions: [],
        }
        this.group?.layers.push(this.layer)
        return
      }
      case 'LG_PERMITTED':
        // From templates: the arg has been substituted; anything but YES drops the group.
        if (this.group && args[1] !== 'YES') this.groupDropped = true
        return
      case 'LG_OFFSET':
        if (this.group) this.group.offset = [Number(args[1]) || 0, Number(args[2]) || 0]
        return
      case 'USE_PALETTE':
        if (this.layer) this.layer.palette = { name: args[1], row: Number(args[2]) }
        return
      case 'USE_STANDARD_PALETTE_FROM_ITEM':
        if (this.layer) this.layer.itemPalette = true
        return
      default:
        if (this.layer) this.layer.conditions.push(args)
        else if (this.group) this.group.conditions.push(args)
    }
  }

  finish(): LayerSetRule {
    this.closeGroup()
    return this.set
  }
}

interface ParseContext {
  index: AssetIndex
  /** LAYER_SET_TEMPLATE name -> its raw tags. */
  templates: Map<string, string[][]>
  /** Creature id -> rules, filled while parsing. */
  rules: Map<string, CreatureLayerRules>
}

/** First pass: collect [LAYER_SET_TEMPLATE] bodies so uses in other files resolve. */
function collectTemplates(text: string, templates: Map<string, string[][]>) {
  let current: string[][] | null = null
  for (const args of rawTags(text)) {
    if (args[0] === 'LAYER_SET_TEMPLATE') {
      current = []
      templates.set(args[1], current)
      continue
    }
    if (BLOCK_OPENERS.has(args[0])) {
      current = null
      continue
    }
    current?.push(args)
  }
}

/** Splice template ARG values into a template tag: [LAYER:X:ARG_HEAD_TEXTURE] -> [LAYER:X:PAGE:0:0]. */
function substituteArgs(tag: string[], values: Map<string, string[]>): string[] {
  return tag.flatMap((part) => {
    if (!part.startsWith('ARG_')) return [part]
    return values.get(part) ?? [part]
  })
}

function parseRawFile(text: string, packName: string, ctx: ParseContext) {
  const { index } = ctx
  let currentPage: TilePage | null = null
  let currentCreature: string | null = null
  let currentCaste: string | null = null
  let builder: LayerSetBuilder | null = null
  let stdPalette: NamedPalette | null = null
  let templateArgs: { name: string; values: Map<string, string[]> } | null = null
  let inTemplateDefinition = false
  /** Subtype token of the open [WEAPON_GRAPHICS:...] style block. */
  let currentItem: string | null = null

  const endLayerSet = () => {
    flushTemplate()
    if (builder && currentCreature) {
      const set = builder.finish()
      if (set.groups.length) {
        const rules = ctx.rules.get(currentCreature) ?? { creature: currentCreature, sets: [] }
        rules.sets.push(set)
        ctx.rules.set(currentCreature, rules)
      }
    }
    builder = null
  }

  const flushTemplate = () => {
    if (!templateArgs || !builder) {
      templateArgs = null
      return
    }
    const body = ctx.templates.get(templateArgs.name)
    if (body) for (const tag of body) builder.handle(substituteArgs(tag, templateArgs.values))
    templateArgs = null
  }

  for (const args of rawTags(text)) {
    const tag = args[0]

    // Template definitions were collected in the first pass; skip their body here.
    if (tag === 'LAYER_SET_TEMPLATE') {
      endLayerSet()
      inTemplateDefinition = true
      continue
    }
    if (inTemplateDefinition) {
      if (!BLOCK_OPENERS.has(tag)) continue
      inTemplateDefinition = false
    }

    if (tag === 'LAYER_SET') {
      endLayerSet()
      builder = new LayerSetBuilder(args.slice(1).join(':'), currentCaste, packName)
      continue
    }
    if (builder) {
      if (tag === 'USE_LAYER_SET_TEMPLATE') {
        flushTemplate()
        templateArgs = { name: args[1], values: new Map() }
        continue
      }
      if (templateArgs && tag.startsWith('ARG_')) {
        templateArgs.values.set(tag, args.slice(1))
        continue
      }
      if (templateArgs) flushTemplate()
      if (!BLOCK_OPENERS.has(tag)) {
        builder.handle(args)
        continue
      }
      endLayerSet()
    }

    // Item sprites: inline [ARMOR_GRAPHICS:PAGE:x:y:TOKEN] or a
    // [WEAPON_GRAPHICS:TOKEN] block with DEFAULT / ARTIFACT variants.
    if (INLINE_ITEM_GRAPHICS.has(tag)) {
      currentItem = null
      const sprite = spriteFromArgs(args, 1)
      const token = args[sprite?.w ? 7 : 4]
      if (sprite && token?.startsWith('ITEM_')) index.items[token] ??= { default: sprite }
      continue
    }
    if (BLOCK_ITEM_GRAPHICS.has(tag)) {
      currentItem = args[1] ?? null
      continue
    }
    if (currentItem) {
      const variant = /^(?:WEAPON|AMMO|SIEGEAMMO)_GRAPHICS_(.+)$/.exec(tag)?.[1]
      if (variant) {
        const sprite = spriteFromArgs(args, 1)
        if (sprite) {
          if (variant === 'DEFAULT' || variant === 'STRAIGHT_DEFAULT') {
            index.items[currentItem] = { ...index.items[currentItem], default: sprite }
          } else if (variant === 'ARTIFACT' || variant === 'STRAIGHT_ARTIFACT') {
            const entry = index.items[currentItem] ?? { default: sprite }
            entry.artifact = sprite
            index.items[currentItem] = entry
          }
        }
        continue
      }
      currentItem = null
    }

    if (tag === 'PALETTE') {
      stdPalette = { file: '', defaultRow: 0, colors: {} }
      index.palettes[args[1]] = stdPalette
      currentPage = null
      currentCreature = null
      continue
    }
    if (stdPalette && tag === 'FILE' && !currentPage) {
      stdPalette.file = path.posix.join(packName, args[1])
      continue
    }
    if (stdPalette && tag === 'PALETTE_DEFAULT') {
      stdPalette.defaultRow = Number(args[1])
      continue
    }
    if (stdPalette && tag === 'PALETTE_COLOR') {
      stdPalette.colors[args[1]] = Number(args[2])
      continue
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
      currentCaste = null
      currentPage = null
      index.creatures[currentCreature] ??= {}
      continue
    }
    if (tag === 'CREATURE_CASTE_GRAPHICS') {
      // Simple states stay keyed by "CREATURE:CASTE"; layer sets are stored
      // on the creature with the caste recorded on the set.
      currentCreature = args[1]
      currentCaste = args[2]
      currentPage = null
      index.creatures[`${args[1]}:${args[2]}`] ??= {}
      continue
    }
    // Statues are separate sprites; keep them from overwriting the creature's
    // real DEFAULT state by namespacing the key.
    if (tag === 'STATUE_CREATURE_GRAPHICS') {
      currentCreature = `STATUE:${args[1]}`
      currentCaste = null
      currentPage = null
      index.creatures[currentCreature] ??= {}
      continue
    }
    if (tag === 'STATUE_CREATURE_CASTE_GRAPHICS') {
      currentCreature = `STATUE:${args[1]}:${args[2]}`
      currentCaste = null
      currentPage = null
      index.creatures[currentCreature] ??= {}
      continue
    }
    if (tag === 'OBJECT') {
      currentCreature = null
      currentCaste = null
      currentPage = null
      stdPalette = null
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
      !tag.startsWith('LG_')
    ) {
      const sprite = spriteFromArgs(args, 1)
      if (sprite) {
        const key = currentCaste ? `${currentCreature}:${currentCaste}` : currentCreature
        index.creatures[key] ??= {}
        index.creatures[key][tag] = sprite
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
  fs.mkdirSync(path.join(OUT_DIR, 'layers'), { recursive: true })

  const ctx: ParseContext = {
    index: {
      gameDir,
      extractedAt: new Date().toISOString(),
      pages: {},
      tiles: {},
      creatures: {},
      layeredCreatures: [],
      palettes: {},
      items: {},
    },
    templates: new Map(),
    rules: new Map(),
  }

  let pngCount = 0

  // Every vanilla pack that ships a graphics/ folder: creatures (incl. the
  // dwarf sprites and portraits), items, buildings, plants, map tiles
  // (vanilla_environment), interface art, and the world map sheets.
  const packs = fs
    .readdirSync(vanillaDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(vanillaDir, e.name, 'graphics')))
    .map((e) => e.name)

  const raws: { pack: string; text: string }[] = []
  for (const pack of packs) {
    const graphicsDir = path.join(vanillaDir, pack, 'graphics')
    for (const file of listFiles(graphicsDir)) {
      const rel = path.relative(graphicsDir, file)
      const ext = path.extname(file).toLowerCase()
      if (ext === '.png') {
        copyInto(file, path.join(pack, rel))
        pngCount++
      } else if (ext === '.txt') {
        raws.push({ pack, text: fs.readFileSync(file, 'utf8') })
      }
    }
  }

  // Templates first, then everything else, so a template defined in a later
  // file still expands.
  for (const raw of raws) collectTemplates(raw.text, ctx.templates)
  for (const raw of raws) parseRawFile(raw.text, raw.pack, ctx)

  // Classic tilesets and UI art (curses_*.png, logos, cursors).
  if (fs.existsSync(artDir)) {
    for (const file of listFiles(artDir)) {
      if (path.extname(file).toLowerCase() !== '.png') continue
      copyInto(file, path.join('art', path.relative(artDir, file)))
      pngCount++
    }
  }

  let layerCount = 0
  for (const [creature, rules] of ctx.rules) {
    fs.writeFileSync(path.join(OUT_DIR, 'layers', `${creature}.json`), JSON.stringify(rules))
    ctx.index.layeredCreatures.push(creature)
    for (const set of rules.sets) for (const group of set.groups) layerCount += group.layers.length
  }
  ctx.index.layeredCreatures.sort()

  fs.writeFileSync(path.join(OUT_DIR, 'index.json'), JSON.stringify(ctx.index, null, 2))

  const { index } = ctx
  console.log(`Extracted DF assets from ${gameDir}`)
  console.log(
    `  ${pngCount} PNGs copied, ${raws.length} raws parsed from packs: ${packs.join(', ')}`,
  )
  console.log(
    `  ${Object.keys(index.pages).length} sprite sheets, ${Object.keys(index.tiles).length} named tiles, ${Object.keys(index.creatures).length} creature entries, ${Object.keys(index.items).length} item sprites`,
  )
  console.log(
    `  ${index.layeredCreatures.length} layered creatures with ${layerCount} layer rules (${ctx.templates.size} templates expanded), ${Object.keys(index.palettes.DEFAULT?.colors ?? {}).length} standard palette colours`,
  )
  console.log(`  -> ${OUT_DIR} (gitignored, local only)`)
}

main()
