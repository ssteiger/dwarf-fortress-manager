import {
  type JsonObject,
  type LegendsPayload,
  type LegendsRecord,
  postgres_db,
  schema,
} from '@fortress/db-drizzle'
import { type SQL, and, asc, eq, ilike, inArray, isNotNull, sql } from 'drizzle-orm'

import { num, numList, objList, plusOf, str } from './events'
import { entityTypeLabel, racePlural, raceToken, words } from './model'
import type { LegendsHit, NameIndex } from './server'

/*
 * Server-only helpers shared by the legends server functions: resolving the
 * ids a payload points at into names, and describing rows in one line.
 * Nothing here may be imported by client code, or the database client
 * follows it into the browser bundle.
 */

export const R = schema.legends_records

/** Kinds whose id arrays on events point back at them. */
export const REF_COLUMN: Record<string, 'hfids' | 'entity_ids' | 'site_ids' | 'artifact_ids'> = {
  historical_figure: 'hfids',
  entity: 'entity_ids',
  site: 'site_ids',
  artifact: 'artifact_ids',
}

export type RefSet = Record<string, Set<number>>

const HF_KEY_RE =
  /hfid|hist_?fig|histfig|(^|_)hf$|^hf_|^(woundee|wounder|doer|target|eater|victim|snatcher|changee|changer|trickster|corruptor|seeker|lure|plotter|partner|group|attacker|defender|builder|creator|actor|appointer|promise_to|leader|ruler|hunter|convicted|convicter|contact|prisoner|rescuer|abductor|joined|inhabitant|author|student|teacher|speaker|gambler|acquirer|framer|fooled|competitor|winner|bodies|source_hf|target_hf)$/i
const ENTITY_KEY_RE = /civ|entity|enid|owner|religion|(^|_)en$|_ent_id$|^(source|destination)$/i
const SITE_KEY_RE = /site/i
const ARTIFACT_KEY_RE = /artifact/i
const REGION_KEY_RE = /subregion|region_id|^region$/i
const WC_KEY_RE = /wc_id|written_content|^writing$/i

export function addRef(target: RefSet, kind: string, id: unknown) {
  if (typeof id !== 'number' || !Number.isInteger(id) || id < 0) return
  const set = target[kind] ?? new Set<number>()
  set.add(id)
  target[kind] = set
}

function kindForKey(key: string): string | null {
  if (ENTITY_KEY_RE.test(key)) return 'entity'
  if (SITE_KEY_RE.test(key)) return 'site'
  if (ARTIFACT_KEY_RE.test(key)) return 'artifact'
  if (WC_KEY_RE.test(key)) return 'written_content'
  if (REGION_KEY_RE.test(key)) return 'region'
  if (HF_KEY_RE.test(key)) return 'historical_figure'
  return null
}

export function addRefs(target: RefSet, obj: unknown, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 2) return
  if (Array.isArray(obj)) {
    for (const v of obj) addRefs(target, v, depth + 1)
    return
  }
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (key === 'plus') {
      addRefs(target, value, depth)
      continue
    }
    const kind = kindForKey(key)
    if (Array.isArray(value)) {
      if (kind) for (const v of value) addRef(target, kind, v)
      addRefs(target, value, depth + 1)
      continue
    }
    if (typeof value === 'object' && value !== null) {
      addRefs(target, value, depth + 1)
      continue
    }
    if (kind) addRef(target, kind, value)
  }
}

/** Entity records link to other entities under `entity_link[].target`; fix the kind. */
export function addEntityRefs(target: RefSet, payload: LegendsPayload) {
  const plus = plusOf(payload)
  for (const link of objList(plus.entity_link)) addRef(target, 'entity', link.target)
  for (const id of numList(plus.child)) addRef(target, 'entity', id)
  for (const id of numList(plus.worship_id)) addRef(target, 'historical_figure', id)
}

export async function lookupNames(worldId: number, refs: RefSet): Promise<NameIndex> {
  const names: NameIndex = {}
  const chunks: Promise<void>[] = []
  for (const [kind, ids] of Object.entries(refs)) {
    const list = [...ids].slice(0, 5000)
    if (list.length === 0) continue
    chunks.push(
      postgres_db
        .select({ id: R.id, name: R.name, type: R.type })
        .from(R)
        .where(and(eq(R.world_id, worldId), eq(R.kind, kind), inArray(R.id, list)))
        .then((rows) => {
          const map: Record<number, string> = {}
          for (const row of rows) {
            map[row.id] =
              row.name ??
              (kind === 'historical_figure' && row.type
                ? `an unnamed ${words(row.type)}`
                : `${words(kind)} #${row.id}`)
          }
          names[kind] = map
        }),
    )
  }
  await Promise.all(chunks)
  return names
}

function lifespan(p: LegendsPayload): string {
  const birth = num(p.birth_year)
  const death = num(p.death_year)
  if (p.deity === true || p.force === true) return ''
  if (birth === null) return ''
  if (birth < 0 && death !== null && death < 0) return 'older than history, still alive'
  if (birth < 0 && death !== null) return `older than history, died ${death}`
  if (death !== null && death >= 0) return `${birth}–${death} (aged ${death - birth})`
  return `born ${birth}, still alive`
}

function figureRace(p: LegendsPayload, type: string | null): string {
  const plus = plusOf(p)
  const race = str(plus.race) ?? words(type)
  const sex = num(plus.sex)
  const caste = str(p.caste)
  const prefix = sex === 0 ? 'female ' : sex === 1 ? 'male ' : ''
  const casteNote =
    caste && !['MALE', 'FEMALE', 'DEFAULT'].includes(caste) ? ` (${words(caste)})` : ''
  return `${prefix}${words(race)}${casteNote}`.trim()
}

/** Ids that should be named to describe this record in one line. */
function rowRefs(kind: string, p: LegendsPayload, refs: RefSet) {
  const plus = plusOf(p)
  switch (kind) {
    case 'historical_figure': {
      const member = objList(p.entity_link).find((l) => str(l.link_type) === 'member')
      addRef(refs, 'entity', member?.entity_id)
      return
    }
    case 'site':
      addRef(refs, 'entity', plus.civ_id)
      addRef(refs, 'entity', plus.cur_owner_id)
      return
    case 'entity':
      for (const link of objList(plus.entity_link))
        if (str(link.type) === 'PARENT') addRef(refs, 'entity', link.target)
      return
    case 'artifact':
      addRef(refs, 'historical_figure', p.holder_hfid)
      addRef(refs, 'site', p.site_id)
      return
    case 'written_content':
      addRef(refs, 'historical_figure', p.author_hfid ?? plus.author)
      return
    case 'historical_event_collection':
      addRef(refs, 'entity', p.aggressor_ent_id)
      addRef(refs, 'entity', p.defender_ent_id)
      addRef(refs, 'entity', p.attacking_enid)
      addRef(refs, 'entity', p.defending_enid)
      addRef(refs, 'site', p.site_id)
      return
    case 'identity':
      for (const id of numList(plus.histfig_id)) addRef(refs, 'historical_figure', id)
      return
  }
}

export function nameOf(names: NameIndex, kind: string, id: unknown): string | null {
  return typeof id === 'number' && id >= 0 ? (names[kind]?.[id] ?? null) : null
}

function coordCount(coords: unknown): number {
  const s = str(coords)
  if (!s) return 0
  return s.split('|').filter(Boolean).length
}

function rowDetail(kind: string, type: string | null, p: LegendsPayload, names: NameIndex): string {
  const plus = plusOf(p)
  const parts: string[] = []
  switch (kind) {
    case 'historical_figure': {
      if (p.deity === true)
        parts.push(
          `deity${Array.isArray(p.sphere) ? ` of ${p.sphere.map(String).join(', ')}` : ''}`,
        )
      else if (p.force === true)
        parts.push(
          `force of nature${Array.isArray(p.sphere) ? `: ${p.sphere.map(String).join(', ')}` : ''}`,
        )
      else parts.push(figureRace(p, type))
      const life = lifespan(p)
      if (life) parts.push(life)
      const member = objList(p.entity_link).find((l) => str(l.link_type) === 'member')
      const civ = nameOf(names, 'entity', member?.entity_id)
      if (civ) parts.push(`of ${civ}`)
      if (p.animated === true) parts.push('undead')
      if (p.ghost === true) parts.push('ghost')
      break
    }
    case 'site': {
      const owner = nameOf(names, 'entity', plus.civ_id)
      parts.push(owner ? `held by ${owner}` : 'unclaimed')
      const structures = objList((p.structures as JsonObject | undefined)?.structure).length
      if (structures) parts.push(`${structures} structure${structures === 1 ? '' : 's'}`)
      break
    }
    case 'entity': {
      const race = str(plus.race)
      const etype = str(plus.type) ?? type
      parts.push(
        [entityTypeLabel(etype) || 'group', race ? `of ${racePlural(race)}` : '']
          .filter(Boolean)
          .join(' '),
      )
      const parent = objList(plus.entity_link).find((l) => str(l.type) === 'PARENT')
      const parentName = nameOf(names, 'entity', parent?.target)
      if (parentName) parts.push(`part of ${parentName}`)
      const sites = numList(plus.child).length
      if (sites && str(plus.type) === 'civilization')
        parts.push(`${sites} site government${sites === 1 ? '' : 's'}`)
      break
    }
    case 'artifact': {
      const mat = str(plus.mat)
      const item = str(plus.item_type)
      const sub = str(plus.item_subtype)
      parts.push([mat, sub ?? item].filter(Boolean).join(' ') || 'artifact')
      const holder = nameOf(names, 'historical_figure', p.holder_hfid)
      const site = nameOf(names, 'site', p.site_id)
      if (holder) parts.push(`held by ${holder}`)
      else if (site) parts.push(`kept in ${site}`)
      if (plus.writing !== undefined) parts.push('bears a written work')
      break
    }
    case 'written_content': {
      const form = str(p.form) ?? str(plus.type)
      if (form) parts.push(words(form))
      const author = nameOf(names, 'historical_figure', p.author_hfid ?? plus.author)
      if (author) parts.push(`by ${author}`)
      const start = num(plus.page_start)
      const end = num(plus.page_end)
      if (start !== null && end !== null) parts.push(`${end - start + 1} pages`)
      break
    }
    case 'historical_event_collection': {
      const ctype = str(p.type) ?? type
      if (ctype === 'war') {
        const a = nameOf(names, 'entity', p.aggressor_ent_id)
        const d = nameOf(names, 'entity', p.defender_ent_id)
        if (a || d) parts.push(`${a ?? 'unknown'} against ${d ?? 'unknown'}`)
      } else {
        const a = nameOf(names, 'entity', p.attacking_enid)
        const d = nameOf(names, 'entity', p.defending_enid)
        if (a && d) parts.push(`${a} against ${d}`)
        const outcome = str(p.outcome)
        if (outcome) parts.push(outcome)
        const site = nameOf(names, 'site', p.site_id)
        if (site) parts.push(`at ${site}`)
      }
      const events = numList(p.event).length
      if (events) parts.push(`${events} event${events === 1 ? '' : 's'}`)
      break
    }
    case 'region': {
      const evil = str(plus.evilness)
      if (evil && evil !== 'neutral') parts.push(evil)
      const tiles = coordCount(plus.coords)
      if (tiles) parts.push(`${tiles} tile${tiles === 1 ? '' : 's'}`)
      break
    }
    case 'underground_region': {
      const depth = num(p.depth)
      if (depth !== null) parts.push(`layer ${depth}`)
      const tiles = coordCount(plus.coords)
      if (tiles) parts.push(`${tiles} tiles`)
      break
    }
    case 'mountain_peak': {
      const height = num(plus.height)
      if (height !== null) parts.push(`height ${height}`)
      if (plus.is_volcano === true) parts.push('volcano')
      break
    }
    case 'river': {
      const tiles = coordCount(plus.path)
      if (tiles) parts.push(`${tiles} tiles long`)
      break
    }
    case 'entity_population': {
      const race = str(plus.race)
      if (race) {
        const [name, count] = race.split(':')
        parts.push(`${count ?? '?'} ${words(name)}`)
      }
      break
    }
    case 'identity': {
      const who = nameOf(names, 'historical_figure', numList(plus.histfig_id)[0])
      if (who) parts.push(`used by ${who}`)
      break
    }
    case 'poetic_form':
    case 'musical_form':
    case 'dance_form': {
      const description = str(p.description)
      if (description) parts.push(description.split('.  ')[0])
      break
    }
    case 'historical_era': {
      const start = num(p.start_year)
      if (start !== null) parts.push(start < 0 ? 'from the beginning' : `from year ${start}`)
      break
    }
  }
  return parts.join(' · ')
}

export function endYearOf(p: LegendsPayload): number | null {
  const end = num(p.end_year) ?? num(p.death_year)
  return end !== null && end >= 0 ? end : null
}

export type RecordRow = Pick<LegendsRecord, 'kind' | 'id' | 'name' | 'type' | 'year' | 'payload'>

/** Extra context for a row, prepended to its detail line. */
export type Decorate = (row: RecordRow) => string | null

export async function describeRows(
  worldId: number,
  rows: RecordRow[],
  decorate?: Decorate,
): Promise<LegendsHit[]> {
  const refs: RefSet = {}
  for (const row of rows) rowRefs(row.kind, row.payload as LegendsPayload, refs)
  const names = await lookupNames(worldId, refs)
  return rows.map((row) => {
    const payload = row.payload as LegendsPayload
    const plus = plusOf(payload)
    const detail = rowDetail(row.kind, row.type, payload, names)
    const extra = decorate?.(row)
    const hit: LegendsHit = {
      kind: row.kind,
      id: row.id,
      name: row.name,
      type: row.type,
      year: row.year,
      endYear: endYearOf(payload),
      detail: [extra, detail].filter(Boolean).join(' · '),
    }
    // What the game would draw for the row.
    if (row.kind === 'historical_figure') {
      hit.race = row.type ?? str(payload.race)
      hit.caste = str(payload.caste)
    } else if (row.kind === 'entity' || row.kind === 'entity_population') {
      hit.race = raceToken(str(plus.race) ?? str(payload.race))
    } else if (row.kind === 'creature') {
      hit.race = str(plus.creature_id)
    } else if (row.kind === 'artifact') {
      hit.item = { type: str(plus.item_type), subtype: str(plus.item_subtype) }
    }
    return hit
  })
}

/** Kinds worth showing first when someone searches by name. */
const NAME_KIND_ORDER = [
  'historical_figure',
  'site',
  'entity',
  'artifact',
  'historical_event_collection',
  'region',
  'written_content',
]

/**
 * Named records matching `q`, best match first: an exact name, then one that
 * starts with it, then the rest, each within the kind order above. Events are
 * left out; they are found by their text, not by a name.
 */
export async function searchRecordsByName(
  worldId: number,
  query: string,
  kinds: string[] | undefined,
  limit: number,
): Promise<LegendsHit[]> {
  const q = query.trim()
  if (q.length < 2) return []
  const like = `%${q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`
  const conditions: SQL[] = [
    eq(R.world_id, worldId),
    sql`${R.kind} <> 'historical_event'`,
    isNotNull(R.name),
    ilike(R.name, like),
  ]
  if (kinds?.length) conditions.push(inArray(R.kind, kinds))
  const kindOrder = sql`case ${R.kind} ${sql.join(
    NAME_KIND_ORDER.map((k, i) => sql`when ${k} then ${i}`),
    sql` `,
  )} else 9 end`
  const rows = await postgres_db
    .select({
      kind: R.kind,
      id: R.id,
      name: R.name,
      type: R.type,
      year: R.year,
      payload: R.payload,
    })
    .from(R)
    .where(and(...conditions))
    .orderBy(
      sql`case when lower(${R.name}) = lower(${q}) then 0 when lower(${R.name}) like lower(${`${q}%`}) then 1 else 2 end`,
      kindOrder,
      asc(R.name),
    )
    .limit(Math.min(limit, 50))
  return describeRows(worldId, rows)
}

export function eventsWhere(
  worldId: number,
  kind: string,
  id: number,
  payload: LegendsPayload | null,
): SQL | null {
  const base = and(eq(R.world_id, worldId), eq(R.kind, 'historical_event')) as SQL
  const refColumn = REF_COLUMN[kind]
  if (refColumn) return and(base, sql`${R[refColumn]} @> ARRAY[${id}]::int[]`) as SQL
  if (kind === 'historical_event_collection') {
    const ids = payload ? numList(payload.event).slice(0, 5000) : []
    return ids.length ? (and(base, inArray(R.id, ids)) as SQL) : null
  }
  if (kind === 'region') return and(base, sql`(${R.payload}->>'subregion_id')::int = ${id}`) as SQL
  if (kind === 'written_content')
    return and(base, sql`(${R.payload}->>'wc_id')::int = ${id}`) as SQL
  if (kind === 'poetic_form' || kind === 'musical_form' || kind === 'dance_form')
    return and(
      base,
      sql`(${R.payload}->>'form_id')::int = ${id}`,
      eq(R.type, `${kind.replace('_', ' ')} created`),
    ) as SQL
  return null
}
