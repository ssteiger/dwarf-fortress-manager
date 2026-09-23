/**
 * Client-safe vocabulary for the legends browser: how each record kind is
 * named, grouped, and coloured. No server imports here.
 */

export interface KindMeta {
  label: string
  plural: string
}

export const KIND_META: Record<string, KindMeta> = {
  historical_figure: { label: 'Figure', plural: 'Figures' },
  site: { label: 'Site', plural: 'Sites' },
  entity: { label: 'Group', plural: 'Civilizations & groups' },
  artifact: { label: 'Artifact', plural: 'Artifacts' },
  region: { label: 'Region', plural: 'Regions' },
  underground_region: { label: 'Cavern layer', plural: 'Cavern layers' },
  landmass: { label: 'Landmass', plural: 'Landmasses' },
  mountain_peak: { label: 'Mountain peak', plural: 'Mountain peaks' },
  river: { label: 'River', plural: 'Rivers' },
  world_construction: { label: 'Construction', plural: 'Constructions' },
  written_content: { label: 'Writing', plural: 'Writings' },
  poetic_form: { label: 'Poetic form', plural: 'Poetic forms' },
  musical_form: { label: 'Musical form', plural: 'Musical forms' },
  dance_form: { label: 'Dance form', plural: 'Dance forms' },
  historical_event: { label: 'Event', plural: 'Events' },
  historical_event_collection: { label: 'Chapter', plural: 'Wars & chapters' },
  historical_era: { label: 'Era', plural: 'Eras' },
  entity_population: { label: 'Population', plural: 'Populations' },
  creature: { label: 'Creature', plural: 'Creatures' },
  creature_raw: { label: 'Creature', plural: 'Creatures' },
  identity: { label: 'Identity', plural: 'Identities' },
  historical_event_relationship: { label: 'Relationship', plural: 'Relationships' },
  historical_event_relationship_supplement: { label: 'Relationship', plural: 'Relationships' },
}

export function kindLabel(kind: string): string {
  return KIND_META[kind]?.label ?? humanizeToken(kind)
}

export function kindPlural(kind: string): string {
  return KIND_META[kind]?.plural ?? `${humanizeToken(kind)}s`
}

/** Turn SNAKE_CASE or snake_case into "Snake case". */
export function humanizeToken(token: string | null | undefined): string {
  if (!token) return ''
  const spaced = token.replace(/_/g, ' ').replace(/:\d+$/, '').toLowerCase().trim()
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

/** Lowercase, spaces instead of underscores: for mid-sentence use. */
export function words(token: string | null | undefined): string {
  if (!token) return ''
  return token.replace(/_/g, ' ').replace(/:\d+$/, '').toLowerCase().trim()
}

/** Legends names arrive lowercase; capitalise like a proper noun. */
export function titleCase(s: string): string {
  return s.replace(
    /(^|\s|-)([a-z\u00C0-\u024F])/g,
    (_m, pre: string, c: string) => pre + c.toUpperCase(),
  )
}

/** Strip DF's colour control bytes from artifact names. */
export function cleanName(s: string | null | undefined): string {
  if (!s) return ''
  // biome-ignore lint/suspicious/noControlCharactersInRegex: DF embeds colour codes
  return s.replace(/[\u0000-\u001f]/g, '').trim()
}

/** Which archive tab a record kind belongs to. */
export interface BrowseTab {
  key: string
  label: string
  kinds: string[]
  /** Restrict to these `type` values (collections only). */
  types?: string[]
  /** Only rows with a name; hides the flood of unnamed beasts and rituals. */
  namedOnly?: boolean
}

export const BROWSE_TABS: BrowseTab[] = [
  { key: 'figures', label: 'Figures', kinds: ['historical_figure'] },
  { key: 'sites', label: 'Sites', kinds: ['site'] },
  { key: 'groups', label: 'Civilizations & groups', kinds: ['entity'] },
  { key: 'artifacts', label: 'Artifacts', kinds: ['artifact'] },
  {
    key: 'wars',
    label: 'Wars & chapters',
    kinds: ['historical_event_collection'],
    types: [
      'war',
      'battle',
      'site conquered',
      'duel',
      'abduction',
      'theft',
      'purge',
      'persecution',
      'journey',
      'insurrection',
      'raid',
    ],
  },
  {
    key: 'geography',
    label: 'Geography',
    kinds: [
      'region',
      'underground_region',
      'mountain_peak',
      'river',
      'landmass',
      'world_construction',
    ],
  },
  {
    key: 'culture',
    label: 'Writings & arts',
    kinds: ['written_content', 'poetic_form', 'musical_form', 'dance_form'],
  },
  { key: 'all', label: 'Everything', kinds: [], namedOnly: true },
]

export function browseTabForKind(kind: string): BrowseTab {
  return BROWSE_TABS.find((tab) => tab.kinds.includes(kind)) ?? BROWSE_TABS[BROWSE_TABS.length - 1]
}

/** Races that build civilizations, as they appear in `plus.race`. */
export const CIVILIZED_RACES = new Set(['dwarf', 'human', 'elf', 'goblin', 'kobold'])

/** Swatches for civilizations by race, used on the map and in lists. */
export const RACE_COLORS: Record<string, string> = {
  dwarf: '#d97706',
  human: '#2563eb',
  elf: '#16a34a',
  goblin: '#9333ea',
  kobold: '#78716c',
}

/**
 * "black bear" -> BLACK_BEAR: the best guess at a raw creature token from a
 * legends name. Exact for civilized races (dwarf, human, elf, goblin, kobold);
 * the raws order some animal names differently (BEAR_BLACK).
 */
export function raceToken(name: string | null | undefined): string | null {
  if (!name) return null
  const token = name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
  return token || null
}

export function raceColor(race: string | null | undefined): string {
  if (!race) return '#71717a'
  return RACE_COLORS[words(race)] ?? '#0891b2'
}

/** Terrain colours for the world map, keyed by region type. */
export const REGION_COLORS: Record<string, string> = {
  Grassland: '#8fb56a',
  Forest: '#3f7a3a',
  Mountains: '#8b8b8b',
  Hills: '#a9a860',
  Lake: '#4d8fd1',
  Wetland: '#4f8f78',
  Tundra: '#b9c3c9',
  Desert: '#dcc27a',
  Glacier: '#eef4f8',
  Ocean: '#2d5f9e',
}

export function regionColor(type: string | null | undefined): string {
  return (type && REGION_COLORS[type]) ?? '#6b7280'
}

/** How settled a site is, for icons and map markers. */
/** The imported legends world whose name matches the fortress, in either language. */
export function matchLegendsWorld<T extends { name: string | null; alt_name: string | null }>(
  worlds: T[],
  names: Array<string | null | undefined>,
): T | null {
  const needles = new Set(
    names.map((name) => name?.trim().toLowerCase()).filter((name): name is string => !!name),
  )
  if (!needles.size) return null
  return (
    worlds.find((world) =>
      [world.name, world.alt_name].some((name) => name && needles.has(name.trim().toLowerCase())),
    ) ?? null
  )
}

export function siteGroup(type: string | null | undefined): 'settlement' | 'ruin' | 'wild' {
  const t = words(type)
  if (['lair', 'cave', 'mysterious lair', 'shrine', 'camp', 'labyrinth'].includes(t)) return 'wild'
  if (t.includes('ruin')) return 'ruin'
  return 'settlement'
}
