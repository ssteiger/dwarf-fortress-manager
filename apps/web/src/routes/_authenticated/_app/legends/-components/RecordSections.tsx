import type { JsonObject, LegendsPayload, LegendsRecord } from '@fortress/db-drizzle'
import { Badge, Button, cn } from '@fortress/ui'
import * as React from 'react'

import {
  legendsDate,
  num,
  numList,
  objList,
  plusOf,
  skillLevel,
  str,
  yearSpan,
} from '~/lib/legends/events'
import {
  cleanName,
  humanizeToken,
  kindLabel,
  raceColor,
  titleCase,
  words,
} from '~/lib/legends/model'
import type {
  HeldPosition,
  LegendsHit,
  LegendsMapData,
  NameIndex,
  RelatedRecords,
} from '~/lib/legends/server'
import { EventLine, Facts, HitRows, NamedRef, RecordLink, Section } from './LegendsChrome'
import { WorldMap } from './WorldMap'

export interface SectionProps {
  record: LegendsRecord
  payload: LegendsPayload
  plus: JsonObject
  names: NameIndex
  related: RelatedRecords
  positions: HeldPosition[]
  worldId: number
  map: LegendsMapData | undefined
  /** Chronicle for this record. Map kinds render it under the map; others render it first. */
  timeline?: React.ReactNode
}

// ---------------------------------------------------------------------------
// Summary line under the title

export function describeRecord(kind: string, p: LegendsPayload, names: NameIndex): string {
  const plus = plusOf(p)
  const parts: string[] = []
  const nameOf = (k: string, id: unknown) =>
    typeof id === 'number' && id >= 0 ? (names[k]?.[id] ? titleCase(names[k][id]) : null) : null
  switch (kind) {
    case 'historical_figure': {
      const race = str(plus.race) ?? words(str(p.race))
      const sex = num(plus.sex)
      if (p.deity === true) parts.push(`${race ? `${words(race)} ` : ''}deity`)
      else if (p.force === true) parts.push('force of nature')
      else
        parts.push(
          `${sex === 0 ? 'female ' : sex === 1 ? 'male ' : ''}${words(race) || 'creature'}`,
        )
      const birth = num(p.birth_year)
      const death = num(p.death_year)
      if (p.deity !== true && p.force !== true && birth !== null) {
        if (birth < 0)
          parts.push(
            death !== null && death >= 0
              ? `older than history, died ${death}`
              : 'older than history, still alive',
          )
        else if (death !== null && death >= 0)
          parts.push(`${birth}–${death}, aged ${death - birth}`)
        else parts.push(`born ${birth}, still alive`)
      }
      const member = objList(p.entity_link).find((l) => str(l.link_type) === 'member')
      const civ = nameOf('entity', member?.entity_id)
      if (civ) parts.push(`of ${civ}`)
      if (p.animated === true) parts.push('undead')
      break
    }
    case 'site': {
      parts.push(words(str(p.type)) || 'site')
      const owner = nameOf('entity', plus.civ_id)
      parts.push(owner ? `held by ${owner}` : 'unclaimed')
      const coords = str(p.coords)
      if (coords) parts.push(`at ${coords}`)
      break
    }
    case 'entity': {
      const race = str(plus.race)
      parts.push(
        [words(str(plus.type)) || 'group', race ? `of ${words(race)}s` : '']
          .filter(Boolean)
          .join(' '),
      )
      const parent = objList(plus.entity_link).find((l) => str(l.type) === 'PARENT')
      const parentName = nameOf('entity', parent?.target)
      if (parentName) parts.push(`part of ${parentName}`)
      break
    }
    case 'artifact': {
      parts.push(
        [str(plus.mat), str(plus.item_subtype) ?? str(plus.item_type)].filter(Boolean).join(' ') ||
          'artifact',
      )
      const holder = nameOf('historical_figure', p.holder_hfid)
      const site = nameOf('site', p.site_id)
      if (holder) parts.push(`held by ${holder}`)
      else if (site) parts.push(`kept in ${site}`)
      break
    }
    case 'written_content': {
      const form = str(p.form) ?? str(plus.type)
      if (form) parts.push(words(form))
      const author = nameOf('historical_figure', p.author_hfid ?? plus.author)
      if (author) parts.push(`by ${author}`)
      break
    }
    case 'historical_event_collection': {
      parts.push(words(str(p.type)) || 'chapter')
      const span = yearSpan(num(p.start_year), num(p.end_year))
      if (span) parts.push(span)
      const site = nameOf('site', p.site_id)
      if (site) parts.push(`at ${site}`)
      break
    }
    case 'region': {
      parts.push(words(str(p.type)) || 'region')
      const evil = str(plus.evilness)
      if (evil && evil !== 'neutral') parts.push(`${evil} land`)
      break
    }
    default: {
      if (str(p.type)) parts.push(words(str(p.type)))
      const start = num(p.start_year)
      if (start !== null) parts.push(start < 0 ? 'from the beginning' : `from year ${start}`)
    }
  }
  return parts.join(' · ')
}

// ---------------------------------------------------------------------------
// Shared bits

function Chips({ items }: { items: (string | null | undefined | false)[] }) {
  const shown = items.filter((i): i is string => typeof i === 'string' && i !== '')
  if (!shown.length) return null
  return (
    <div className="flex flex-wrap gap-1.5">
      {shown.map((item) => (
        <Badge key={item} variant="secondary">
          {item}
        </Badge>
      ))}
    </div>
  )
}

function RefList({
  kind,
  ids,
  names,
  worldId,
  max = 30,
}: {
  kind: string
  ids: number[]
  names: NameIndex
  worldId: number
  max?: number
}) {
  const [all, setAll] = React.useState(false)
  const unique = [...new Set(ids)]
  const shown = all ? unique : unique.slice(0, max)
  if (!unique.length) return <span className="text-muted-foreground">none</span>
  return (
    <span className="leading-relaxed">
      {shown.map((id, i) => (
        <span key={id}>
          {i > 0 ? ', ' : ''}
          <NamedRef kind={kind} id={id} names={names} worldId={worldId} />
        </span>
      ))}
      {ids.length > shown.length ? (
        <>
          {' '}
          <button
            type="button"
            className="text-sm text-primary hover:underline"
            onClick={() => setAll(true)}
          >
            and {ids.length - shown.length} more
          </button>
        </>
      ) : null}
    </span>
  )
}

function LinkGroup({
  label,
  entries,
  kind,
  names,
  worldId,
  max = 30,
}: {
  label: string
  entries: { id: number; note?: string }[]
  kind: string
  names: NameIndex
  worldId: number
  max?: number
}) {
  const [all, setAll] = React.useState(false)
  const shown = all ? entries : entries.slice(0, max)
  return (
    <div>
      <div className="mb-1.5 text-sm capitalize text-muted-foreground">{label}</div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 leading-relaxed">
        {shown.map((entry, i) => (
          <span key={`${entry.id}-${i}`}>
            <NamedRef kind={kind} id={entry.id} names={names} worldId={worldId} />
            {entry.note ? (
              <span className="text-sm text-muted-foreground"> {entry.note}</span>
            ) : null}
          </span>
        ))}
        {entries.length > shown.length ? (
          <button
            type="button"
            className="text-sm text-primary hover:underline"
            onClick={() => setAll(true)}
          >
            and {entries.length - shown.length} more
          </button>
        ) : null}
      </div>
    </div>
  )
}

function LinkGroups({
  groups,
  kind,
  names,
  worldId,
}: {
  groups: Map<string, { id: number; note?: string }[]>
  kind: string
  names: NameIndex
  worldId: number
}) {
  return (
    <div className="flex flex-col gap-4">
      {[...groups.entries()].map(([label, entries]) => (
        <LinkGroup
          key={label}
          label={label}
          entries={entries}
          kind={kind}
          names={names}
          worldId={worldId}
        />
      ))}
    </div>
  )
}

function TimelineRow({ timeline }: { timeline?: React.ReactNode }) {
  if (!timeline) return null
  return <div className="lg:col-span-3">{timeline}</div>
}

function MapAndFacts({ map, facts }: { map?: React.ReactNode; facts: React.ReactNode }) {
  if (!map) return facts
  return (
    <div className="grid items-start gap-6 lg:grid-cols-2">
      <div className="min-w-0">{map}</div>
      <div className="min-w-0">{facts}</div>
    </div>
  )
}

function MiniMap({
  map,
  focus,
  highlightRegion,
  highlightSites,
}: {
  map: LegendsMapData | undefined
  focus?: { x: number; y: number } | null
  highlightRegion?: number | null
  highlightSites?: ReadonlySet<number> | null
}) {
  if (!map) return <div className="aspect-square w-full animate-pulse rounded-lg bg-muted" />
  return (
    <WorldMap
      data={map}
      focus={focus}
      highlightRegion={highlightRegion}
      highlightSites={highlightSites}
      showLegend={false}
    />
  )
}

function parseCoord(s: unknown): { x: number; y: number } | null {
  if (typeof s !== 'string') return null
  const [x, y] = s.split(',').map((v) => Number.parseInt(v, 10))
  return Number.isFinite(x) && Number.isFinite(y) && x >= 0 && y >= 0 ? { x, y } : null
}

function regionAt(map: LegendsMapData | undefined, at: { x: number; y: number } | null) {
  if (!map || !at) return null
  const index = map.tiles[at.y * map.width + at.x]
  return index >= 0 ? map.regions[index] : null
}

// ---------------------------------------------------------------------------
// Historical figure

const FAMILY_LINKS = [
  'mother',
  'father',
  'spouse',
  'child',
  'lover',
  'former spouse',
  'deceased spouse',
  'former lover',
]
const LINK_ORDER = [
  'mother',
  'father',
  'spouse',
  'former spouse',
  'deceased spouse',
  'lover',
  'former lover',
  'child',
]

function groupLinks(links: JsonObject[], idKey: string, typeKey: string, order: string[] = []) {
  const groups = new Map<string, { id: number; note?: string }[]>()
  const sorted = [...links].sort((a, b) => {
    const ia = order.indexOf(str(a[typeKey]) ?? '')
    const ib = order.indexOf(str(b[typeKey]) ?? '')
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib)
  })
  for (const link of sorted) {
    const id = num(link[idKey])
    if (id === null || id < 0) continue
    const type = words(str(link[typeKey])) || 'linked'
    const label = type === 'child' ? 'children' : type
    const list = groups.get(label) ?? []
    const strength = num(link.link_strength)
    list.push({
      id,
      note: strength !== null && type === 'deity' ? `(devotion ${strength})` : undefined,
    })
    groups.set(label, list)
  }
  return groups
}

export function FigureSections({
  payload: p,
  plus,
  names,
  related,
  positions,
  worldId,
  timeline,
}: SectionProps) {
  const [allSkills, setAllSkills] = React.useState(false)
  const birth = num(p.birth_year)
  const death = num(p.death_year)
  const hfLinks = objList(p.hf_link)
  const family = groupLinks(
    hfLinks.filter((l) => FAMILY_LINKS.includes(str(l.link_type) ?? '')),
    'hfid',
    'link_type',
    LINK_ORDER,
  )
  const worship = groupLinks(
    hfLinks.filter((l) => str(l.link_type) === 'deity'),
    'hfid',
    'link_type',
  )
  const otherLinks = groupLinks(
    hfLinks.filter(
      (l) => !FAMILY_LINKS.includes(str(l.link_type) ?? '') && str(l.link_type) !== 'deity',
    ),
    'hfid',
    'link_type',
  )
  const affiliations = groupLinks(objList(p.entity_link), 'entity_id', 'link_type', [
    'member',
    'former member',
    'position',
    'enemy',
  ])
  const siteLinks = groupLinks(objList(p.site_link), 'site_id', 'link_type')
  const skills = objList(p.hf_skill)
    .map((s) => ({ skill: str(s.skill) ?? '?', ip: num(s.total_ip) ?? 0 }))
    .sort((a, b) => b.ip - a.ip)
  const spheres = Array.isArray(p.sphere) ? p.sphere.map(String) : []
  const goals = Array.isArray(p.goal) ? p.goal.map(String) : []
  const pets = Array.isArray(p.journey_pet) ? p.journey_pet.map((x) => words(String(x))) : []
  const knowledge = Array.isArray(p.interaction_knowledge)
    ? p.interaction_knowledge.map((x) => humanizeToken(String(x)))
    : []
  const plots = objList(p.intrigue_plot)
  const reputations = objList(p.entity_reputation)
  const profiles = objList(p.relationship_profile_hf_historical)
  const race = str(plus.race) ?? words(str(p.race))

  return (
    <>
      <TimelineRow timeline={timeline} />
      <div className="flex flex-col gap-4">
        <Section title="Who they are">
          <Facts
            items={[
              {
                label: 'Race',
                value: race ? (
                  <span className="inline-flex items-center gap-2">
                    <span
                      className="inline-block size-2.5 rounded-full"
                      style={{ backgroundColor: raceColor(race) }}
                    />
                    {titleCase(words(race))}
                  </span>
                ) : null,
              },
              {
                label: 'Caste',
                value:
                  str(p.caste) && !['MALE', 'FEMALE', 'DEFAULT'].includes(str(p.caste) ?? '')
                    ? words(str(p.caste))
                    : null,
              },
              {
                label: 'Sex',
                value: num(plus.sex) === 0 ? 'female' : num(plus.sex) === 1 ? 'male' : null,
              },
              {
                label: 'Born',
                value:
                  birth !== null && p.deity !== true && p.force !== true
                    ? birth < 0
                      ? 'before recorded history'
                      : legendsDate(birth, num(p.birth_seconds72))
                    : null,
              },
              {
                label: 'Died',
                value:
                  death !== null && death >= 0
                    ? `${legendsDate(death, num(p.death_seconds72))}${birth !== null && birth >= 0 ? `, aged ${death - birth}` : ''}`
                    : null,
              },
              {
                label: 'First appeared',
                value:
                  num(p.appeared) !== null &&
                  (num(p.appeared) ?? -1) >= 0 &&
                  num(p.appeared) !== birth
                    ? `year ${num(p.appeared)}`
                    : null,
              },
              { label: 'Spheres', value: spheres.length ? spheres.join(', ') : null },
              { label: 'Goals', value: goals.length ? goals.join(', ') : null },
              { label: 'Secrets known', value: knowledge.length ? knowledge.join(', ') : null },
              { label: 'Undead form', value: str(p.animated_string) },
            ]}
          />
        </Section>

        {positions.length ? (
          <Section title="Offices held" count={positions.length}>
            <ul className="flex flex-col gap-2">
              {positions.map((pos, i) => (
                <li key={`${pos.entity.id}-${pos.title}-${i}`} className="leading-relaxed">
                  <span className="font-medium capitalize">{pos.title}</span> of{' '}
                  <RecordLink
                    kind="entity"
                    id={pos.entity.id}
                    name={pos.entity.name}
                    worldId={worldId}
                  />
                  <span className="text-sm text-muted-foreground">
                    {' '}
                    {pos.endYear === null
                      ? `since ${pos.startYear ?? '?'}`
                      : yearSpan(pos.startYear, pos.endYear)}
                    {pos.endYear === null ? ', still in office' : ''}
                  </span>
                </li>
              ))}
            </ul>
          </Section>
        ) : null}

        {affiliations.size ? (
          <Section title="Allegiances">
            <LinkGroups groups={affiliations} kind="entity" names={names} worldId={worldId} />
          </Section>
        ) : null}

        {family.size || otherLinks.size ? (
          <Section title="Family & companions">
            <div className="flex flex-col gap-3">
              {family.size ? (
                <LinkGroups
                  groups={family}
                  kind="historical_figure"
                  names={names}
                  worldId={worldId}
                />
              ) : null}
              {otherLinks.size ? (
                <LinkGroups
                  groups={otherLinks}
                  kind="historical_figure"
                  names={names}
                  worldId={worldId}
                />
              ) : null}
            </div>
          </Section>
        ) : null}

        {worship.size ? (
          <Section title="Worship">
            <LinkGroups groups={worship} kind="historical_figure" names={names} worldId={worldId} />
          </Section>
        ) : null}

        {siteLinks.size ? (
          <Section title="Places">
            <LinkGroups groups={siteLinks} kind="site" names={names} worldId={worldId} />
          </Section>
        ) : null}
      </div>

      <div className="flex flex-col gap-4 lg:col-span-2">
        {skills.length ? (
          <Section title="Skills" count={skills.length}>
            <ul className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
              {(allSkills ? skills : skills.slice(0, 12)).map((s) => {
                const level = skillLevel(s.ip)
                return (
                  <li key={s.skill} className="flex items-center gap-3 text-sm">
                    <span className="flex-1 truncate">{humanizeToken(s.skill)}</span>
                    <span className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
                      <span
                        className="block h-full bg-primary"
                        style={{ width: `${Math.min(100, (level.level / 15) * 100)}%` }}
                      />
                    </span>
                    <span className="w-28 text-right text-muted-foreground">{level.label}</span>
                  </li>
                )
              })}
            </ul>
            {skills.length > 12 ? (
              <Button
                variant="link"
                size="sm"
                className="mt-2 px-0"
                onClick={() => setAllSkills((v) => !v)}
              >
                {allSkills ? 'Show fewer' : `Show all ${skills.length}`}
              </Button>
            ) : null}
          </Section>
        ) : null}

        {related.kills?.rows.length ? (
          <Section
            title="Slain by their hand"
            count={related.kills.total}
            description="Those whose deaths are laid at this figure's feet."
          >
            <HitRows
              hits={related.kills.rows}
              worldId={worldId}
              total={related.kills.total}
              years
            />
          </Section>
        ) : null}

        {related.artifacts?.length ? (
          <Section
            title="Artifacts"
            count={related.artifacts.length}
            description="Held now, or claimed."
          >
            <HitRows hits={related.artifacts} worldId={worldId} />
          </Section>
        ) : null}

        {related.writings?.length ? (
          <Section title="Works" count={related.writings.length}>
            <HitRows hits={related.writings} worldId={worldId} years />
          </Section>
        ) : null}

        {plots.length || related.identities?.length ? (
          <Section title="Schemes & disguises">
            <Facts
              items={[
                {
                  label: 'Plots',
                  value: plots.length
                    ? plots
                        .map(
                          (plot) =>
                            `${words(str(plot.type))}${plot.on_hold === true ? ' (on hold)' : ''}`,
                        )
                        .join(', ')
                    : null,
                },
                {
                  label: 'False identities',
                  value: related.identities?.length ? (
                    <span>
                      {related.identities.map((identity, i) => (
                        <span key={identity.id}>
                          {i > 0 ? ', ' : ''}
                          <RecordLink
                            kind="identity"
                            id={identity.id}
                            name={identity.name}
                            worldId={worldId}
                          />
                        </span>
                      ))}
                    </span>
                  ) : null,
                },
              ]}
            />
          </Section>
        ) : null}

        {profiles.length || reputations.length || pets.length ? (
          <Section title="Feelings & reputation">
            <div className="flex flex-col gap-4">
              {profiles.length ? (
                <ul className="flex flex-col gap-2">
                  {profiles.slice(0, 20).map((profile, i) => {
                    const id = num(profile.hf_id)
                    if (id === null) return null
                    const feelings = (['love', 'trust', 'loyalty', 'respect', 'fear'] as const)
                      .map((k) => [k, num(profile[k]) ?? 0] as const)
                      .filter(([, v]) => v !== 0)
                    return (
                      <li key={id} className="flex flex-wrap items-baseline gap-x-3 text-sm">
                        <NamedRef
                          kind="historical_figure"
                          id={id}
                          names={names}
                          worldId={worldId}
                        />
                        <span className="text-muted-foreground">
                          {feelings.length
                            ? feelings
                                .map(([k, v]) => `${v > 0 ? '' : 'no '}${k}${v > 0 ? ` ${v}` : ''}`)
                                .join(', ')
                            : 'indifferent'}
                        </span>
                      </li>
                    )
                  })}
                </ul>
              ) : null}
              {reputations.length ? (
                <ul className="flex flex-col gap-1 text-sm">
                  {reputations.slice(0, 12).map((rep, i) => {
                    const id = num(rep.entity_id)
                    const notes = Object.entries(rep)
                      .filter(
                        ([k, v]) =>
                          k !== 'entity_id' &&
                          k !== 'first_ageless_year' &&
                          k !== 'first_ageless_season_count' &&
                          typeof v === 'number' &&
                          v !== 0,
                      )
                      .map(([k, v]) => `${words(k)} ${v}`)
                    return (
                      // biome-ignore lint/suspicious/noArrayIndexKey: reputations have no id of their own
                      <li key={`${id}-${i}`}>
                        Known to <NamedRef kind="entity" id={id} names={names} worldId={worldId} />
                        {notes.length ? (
                          <span className="text-muted-foreground"> as {notes.join(', ')}</span>
                        ) : null}
                      </li>
                    )
                  })}
                </ul>
              ) : null}
              {pets.length ? (
                <Facts items={[{ label: 'Travelling companions', value: pets.join(', ') }]} />
              ) : null}
            </div>
          </Section>
        ) : null}
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// Site

interface Structure {
  id: number
  name: string | null
  nativeName: string | null
  type: string
  subtype: string | null
  inhabitant: number | null
  religion: number | null
  deity: number | null
}

function mergeStructures(p: LegendsPayload, plus: JsonObject): Structure[] {
  const vanilla = objList((p.structures as JsonObject | undefined)?.structure)
  const detailed = objList((plus.structures as JsonObject | undefined)?.structure)
  const byId = new Map<number, JsonObject>()
  for (const s of detailed) {
    const id = num(s.id)
    if (id !== null) byId.set(id, s)
  }
  const seen = new Set<number>()
  const out: Structure[] = []
  for (const s of vanilla) {
    const id = num(s.local_id) ?? out.length
    const extra = byId.get(id)
    seen.add(id)
    out.push({
      id,
      name: str(extra?.name) ?? str(s.name),
      nativeName: str(extra?.name2),
      type: words(str(extra?.type) ?? str(s.type)) || 'structure',
      subtype: str(s.subtype),
      inhabitant: num(extra?.inhabitant),
      religion: num(extra?.religion) ?? num(s.entity_id),
      deity: num(extra?.worship_hfid),
    })
  }
  for (const [id, extra] of byId) {
    if (seen.has(id)) continue
    out.push({
      id,
      name: str(extra.name),
      nativeName: str(extra.name2),
      type: words(str(extra.type)) || 'structure',
      subtype: null,
      inhabitant: num(extra.inhabitant),
      religion: num(extra.religion),
      deity: num(extra.worship_hfid),
    })
  }
  return out
}

export function SiteSections({
  payload: p,
  plus,
  names,
  related,
  worldId,
  map,
  timeline,
}: SectionProps) {
  const at = parseCoord(p.coords)
  const region = regionAt(map, at)
  const structures = mergeStructures(p, plus)
  const byType = new Map<string, Structure[]>()
  for (const s of structures) {
    const list = byType.get(s.type) ?? []
    list.push(s)
    byType.set(s.type, list)
  }
  const first = related.firstEvent
  const firstYear = first ? num((first.payload as LegendsPayload).year) : null
  const collectionTypes = Object.entries(related.collections?.byType ?? {}).sort(
    (a, b) => b[1] - a[1],
  )

  const chapterChips = collectionTypes.map(
    ([type, n]) => `${n} ${words(type)}${n === 1 ? '' : type.endsWith('s') ? '' : 's'}`,
  )

  return (
    <>
      <div className="lg:col-span-3">
        <Section title="Where it stands">
          <MapAndFacts
            map={<MiniMap map={map} focus={at} />}
            facts={
              <Facts
                items={[
                  { label: 'Kind of place', value: words(str(p.type)) },
                  {
                    label: 'Held by',
                    value:
                      num(plus.civ_id) !== null && (num(plus.civ_id) ?? -1) >= 0 ? (
                        <NamedRef
                          kind="entity"
                          id={num(plus.civ_id)}
                          names={names}
                          worldId={worldId}
                        />
                      ) : (
                        'no one'
                      ),
                  },
                  {
                    label: 'Governed by',
                    value:
                      num(plus.cur_owner_id) !== null &&
                      (num(plus.cur_owner_id) ?? -1) >= 0 &&
                      num(plus.cur_owner_id) !== num(plus.civ_id) ? (
                        <NamedRef
                          kind="entity"
                          id={num(plus.cur_owner_id)}
                          names={names}
                          worldId={worldId}
                        />
                      ) : null,
                  },
                  {
                    label: 'Region',
                    value: region ? (
                      <RecordLink
                        kind="region"
                        id={region.id}
                        name={region.name}
                        worldId={worldId}
                      >{`${region.name ? titleCase(region.name) : 'Unnamed region'} (${words(region.type)})`}</RecordLink>
                    ) : null,
                  },
                  { label: 'Coordinates', value: at ? `${at.x}, ${at.y}` : null },
                  {
                    label: 'First recorded',
                    value: firstYear !== null && firstYear >= 0 ? `year ${firstYear}` : null,
                  },
                  {
                    label: 'Events on record',
                    value: related.eventsTotal ? related.eventsTotal.toLocaleString() : null,
                  },
                ]}
              />
            }
          />
        </Section>
      </div>

      <TimelineRow timeline={timeline} />

      <div className="flex flex-col gap-4 lg:col-span-3">
        {structures.length ? (
          <Section title="Structures" count={structures.length}>
            <div className="flex flex-col gap-4">
              {[...byType.entries()]
                .sort((a, b) => b[1].length - a[1].length)
                .map(([type, list]) => (
                  <div key={type}>
                    <div className="mb-1 text-sm font-medium capitalize text-muted-foreground">
                      {type}
                      {list.length > 1 ? ` (${list.length})` : ''}
                    </div>
                    <ul className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
                      {list.map((s) => (
                        <li key={s.id} className="text-sm leading-relaxed">
                          <span className="font-medium">
                            {s.name ? titleCase(cleanName(s.name)) : `Unnamed ${type}`}
                          </span>
                          {s.nativeName ? (
                            <span className="text-muted-foreground"> · {s.nativeName}</span>
                          ) : null}
                          {s.subtype ? (
                            <span className="text-muted-foreground"> · {words(s.subtype)}</span>
                          ) : null}
                          {s.religion !== null && s.religion >= 0 ? (
                            <span className="text-muted-foreground">
                              {' '}
                              · of{' '}
                              <NamedRef
                                kind="entity"
                                id={s.religion}
                                names={names}
                                worldId={worldId}
                              />
                            </span>
                          ) : null}
                          {s.deity !== null && s.deity >= 0 ? (
                            <span className="text-muted-foreground">
                              {' '}
                              · to{' '}
                              <NamedRef
                                kind="historical_figure"
                                id={s.deity}
                                names={names}
                                worldId={worldId}
                              />
                            </span>
                          ) : null}
                          {s.inhabitant !== null && s.inhabitant >= 0 ? (
                            <span className="text-muted-foreground">
                              {' '}
                              · kept by{' '}
                              <NamedRef
                                kind="historical_figure"
                                id={s.inhabitant}
                                names={names}
                                worldId={worldId}
                              />
                            </span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
            </div>
          </Section>
        ) : null}

        {related.residents ? (
          <Section
            title="People of note"
            count={related.residents.total}
            description="Figures who lived, ruled, or lurked here. The living come first."
          >
            <HitRows
              hits={related.residents.rows}
              worldId={worldId}
              total={related.residents.total}
              emptyText="No one of note is recorded here."
            />
          </Section>
        ) : null}

        {related.collections?.rows.length || chapterChips.length ? (
          <Section
            title="Chapters"
            count={related.collections?.total || null}
            description="Battles, attacks, festivals, and other episodes set here."
          >
            {chapterChips.length ? (
              <div className={related.collections?.rows.length ? 'mb-4' : undefined}>
                <Chips items={chapterChips} />
              </div>
            ) : null}
            {related.collections?.rows.length ? (
              <HitRows
                hits={related.collections.rows}
                worldId={worldId}
                total={related.collections.total}
                years
              />
            ) : null}
          </Section>
        ) : null}

        {related.artifacts?.length ? (
          <Section title="Artifacts kept here" count={related.artifacts.length}>
            <HitRows hits={related.artifacts} worldId={worldId} />
          </Section>
        ) : null}
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// Entity

export function EntitySections({
  record,
  payload: p,
  plus,
  names,
  related,
  worldId,
  map,
  timeline,
}: SectionProps) {
  const positions = objList(plus.entity_position)
  const assignments = objList(plus.entity_position_assignment)
  const holders = new Map<number, number[]>()
  for (const a of assignments) {
    const pos = num(a.position_id)
    const hf = num(a.histfig)
    if (pos === null || hf === null || hf < 0) continue
    const list = holders.get(pos) ?? []
    list.push(hf)
    holders.set(pos, list)
  }
  const parent = objList(plus.entity_link).find((l) => str(l.type) === 'PARENT')
  const parentId = num(parent?.target)
  const worship = numList(plus.worship_id)
  const memberIds = numList(plus.histfig_id)
  const occasions = objList(plus.occasion)
  const weapons = Array.isArray(plus.weapon) ? plus.weapon.map((w) => words(String(w))) : []
  const professions = Array.isArray(plus.profession)
    ? plus.profession.map((w) => words(String(w)))
    : []
  const race = str(plus.race)
  const type = str(plus.type) ?? record.type
  const siteIds = React.useMemo(
    () =>
      map
        ? new Set(
            map.sites.filter((s) => s.civ === record.id || s.owner === record.id).map((s) => s.id),
          )
        : null,
    [map, record.id],
  )
  const collectionTypes = Object.entries(related.collections?.byType ?? {}).sort(
    (a, b) => b[1] - a[1],
  )

  const involvedChips = collectionTypes.map(([t, n]) => `${n} ${words(t)}${n === 1 ? '' : 's'}`)

  return (
    <>
      <div className="lg:col-span-3">
        <Section title="What it is">
          <MapAndFacts
            map={siteIds?.size ? <MiniMap map={map} highlightSites={siteIds} /> : null}
            facts={
              <Facts
                items={[
                  { label: 'Kind', value: words(type) || 'group' },
                  {
                    label: 'People',
                    value: race ? (
                      <span className="inline-flex items-center gap-2">
                        <span
                          className="inline-block size-2.5 rounded-full"
                          style={{ backgroundColor: raceColor(race) }}
                        />
                        {titleCase(words(race))}s
                      </span>
                    ) : null,
                  },
                  {
                    label: 'Part of',
                    value:
                      parentId !== null && parentId >= 0 ? (
                        <NamedRef kind="entity" id={parentId} names={names} worldId={worldId} />
                      ) : null,
                  },
                  {
                    label: 'Sites',
                    value: related.sites ? related.sites.total.toLocaleString() : null,
                  },
                  {
                    label: 'Members of note',
                    value: related.members
                      ? related.members.total.toLocaleString()
                      : memberIds.length
                        ? memberIds.length.toLocaleString()
                        : null,
                  },
                  {
                    label: 'Events on record',
                    value: related.eventsTotal ? related.eventsTotal.toLocaleString() : null,
                  },
                  { label: 'Weapons', value: weapons.length ? weapons.join(', ') : null },
                  {
                    label: 'Professions',
                    value: professions.length ? professions.join(', ') : null,
                  },
                ]}
              />
            }
          />
        </Section>
      </div>

      <TimelineRow timeline={timeline} />

      {worship.length ? (
        <div>
          <Section title="Gods" count={worship.length}>
            <RefList kind="historical_figure" ids={worship} names={names} worldId={worldId} />
          </Section>
        </div>
      ) : null}

      <div
        className={cn('flex flex-col gap-4', worship.length ? 'lg:col-span-2' : 'lg:col-span-3')}
      >
        {positions.length ? (
          <Section
            title="Offices"
            count={positions.length}
            description="Positions in this group and who holds them."
          >
            <ul className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
              {positions.map((pos) => {
                const id = num(pos.id)
                const held = id !== null ? (holders.get(id) ?? []) : []
                return (
                  <li key={id ?? str(pos.name)} className="text-sm leading-relaxed">
                    <span className="font-medium capitalize">{str(pos.name) ?? 'office'}</span>
                    {str(pos.name_male) &&
                    str(pos.name_female) &&
                    str(pos.name_male) !== str(pos.name_female) ? (
                      <span className="text-muted-foreground">
                        {' '}
                        ({str(pos.name_male)} / {str(pos.name_female)})
                      </span>
                    ) : null}
                    {held.length ? (
                      <span>
                        {': '}
                        <RefList
                          kind="historical_figure"
                          ids={held}
                          names={names}
                          worldId={worldId}
                        />
                      </span>
                    ) : (
                      <span className="text-muted-foreground"> · vacant</span>
                    )}
                  </li>
                )
              })}
            </ul>
          </Section>
        ) : null}

        {related.sites ? (
          <Section
            title="Sites"
            count={related.sites.total}
            description="Places founded or currently governed by this group."
          >
            <HitRows
              hits={related.sites.rows}
              worldId={worldId}
              total={related.sites.total}
              emptyText="Holds no sites."
            />
          </Section>
        ) : null}

        {related.collections?.rows.length || involvedChips.length ? (
          <Section title="Wars & conflicts" count={related.collections?.rows.length || null}>
            {involvedChips.length ? (
              <div className={related.collections?.rows.length ? 'mb-4' : undefined}>
                <Chips items={involvedChips} />
              </div>
            ) : null}
            {related.collections?.rows.length ? (
              <HitRows hits={related.collections.rows} worldId={worldId} years />
            ) : null}
          </Section>
        ) : null}

        {related.children?.length ? (
          <Section
            title="Groups within"
            count={related.children.length}
            description="Site governments, guilds, and orders under this banner."
          >
            <HitRows hits={related.children} worldId={worldId} />
          </Section>
        ) : null}

        {related.members ? (
          <Section
            title="Members of note"
            count={related.members.total}
            description="Figures recorded as members. The living come first."
          >
            <HitRows
              hits={related.members.rows}
              worldId={worldId}
              total={related.members.total}
              emptyText="No members are recorded."
            />
          </Section>
        ) : null}

        {occasions.length ? (
          <Section title="Festivals" count={occasions.length}>
            <ul className="flex flex-col gap-2">
              {occasions.map((occasion) => {
                const schedule = objList(occasion.schedule)
                const parts = schedule.map((s) => {
                  const features = objList(s.feature).map((f) => words(str(f.type)))
                  return `${words(str(s.type))}${features.length ? ` with ${features.join(', ')}` : ''}`
                })
                return (
                  <li
                    key={num(occasion.id) ?? str(occasion.name)}
                    className="text-sm leading-relaxed"
                  >
                    <span className="font-medium">{str(occasion.name) ?? 'A festival'}</span>
                    {parts.length ? (
                      <span className="text-muted-foreground"> · {parts.join('; ')}</span>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          </Section>
        ) : null}
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// Artifact

export function ArtifactSections({
  payload: p,
  plus,
  names,
  related,
  worldId,
  timeline,
}: SectionProps) {
  const item = (p.item as JsonObject | undefined) ?? {}
  const writing = num(plus.writing) ?? num(item.writing_written_content_id)
  const first = related.firstEvent
  const firstPayload = (first?.payload ?? {}) as LegendsPayload
  const creator = num(firstPayload.hist_figure_id) ?? num(plusOf(firstPayload).creator_hfid)
  return (
    <>
      <TimelineRow timeline={timeline} />
      <div className="flex flex-col gap-4">
        <Section title="The object">
          <Facts
            items={[
              { label: 'Made of', value: str(plus.mat) },
              {
                label: 'Kind',
                value:
                  [str(plus.item_subtype), str(plus.item_type)]
                    .filter(Boolean)
                    .map(words)
                    .join(', ') || null,
              },
              { label: 'Name string', value: cleanName(str(item.name_string)) || null },
              { label: 'Pages', value: num(item.page_count) },
              {
                label: 'Created',
                value:
                  first && str(firstPayload.type) === 'artifact created' ? (
                    <span>
                      {legendsDate(num(firstPayload.year), num(firstPayload.seconds72))}
                      {creator !== null && creator >= 0 ? (
                        <>
                          {' by '}
                          <NamedRef
                            kind="historical_figure"
                            id={creator}
                            names={names}
                            worldId={worldId}
                          />
                        </>
                      ) : null}
                    </span>
                  ) : null,
              },
              {
                label: 'Held by',
                value:
                  num(p.holder_hfid) !== null && (num(p.holder_hfid) ?? -1) >= 0 ? (
                    <NamedRef
                      kind="historical_figure"
                      id={num(p.holder_hfid)}
                      names={names}
                      worldId={worldId}
                    />
                  ) : null,
              },
              {
                label: 'Kept in',
                value:
                  num(p.site_id) !== null && (num(p.site_id) ?? -1) >= 0 ? (
                    <NamedRef kind="site" id={num(p.site_id)} names={names} worldId={worldId} />
                  ) : null,
              },
              {
                label: 'Bears the text',
                value:
                  writing !== null && writing >= 0 ? (
                    <NamedRef kind="written_content" id={writing} names={names} worldId={worldId} />
                  ) : null,
              },
              {
                label: 'Events on record',
                value: related.eventsTotal ? related.eventsTotal.toLocaleString() : null,
              },
            ]}
          />
        </Section>
      </div>
      <div className="lg:col-span-2" />
    </>
  )
}

// ---------------------------------------------------------------------------
// Written content

export function WrittenSections({
  payload: p,
  plus,
  names,
  related,
  worldId,
  timeline,
}: SectionProps) {
  const author = num(p.author_hfid) ?? num(plus.author)
  const styles = Array.isArray(plus.style)
    ? plus.style.map((s) => words(String(s)))
    : Array.isArray(p.style)
      ? p.style.map((s) => words(String(s).split(':')[0]))
      : []
  const start = num(plus.page_start)
  const end = num(plus.page_end)
  const references = objList(plus.reference).filter((r) => str(r.type) !== 'HISTORICAL_EVENT')
  const refKind: Record<string, string> = {
    ENTITY: 'entity',
    SITE: 'site',
    HISTORICAL_FIGURE: 'historical_figure',
    ARTIFACT: 'artifact',
    SUBREGION: 'region',
    REGION: 'region',
    WRITTEN_CONTENT: 'written_content',
    POETIC_FORM: 'poetic_form',
    MUSICAL_FORM: 'musical_form',
    DANCE_FORM: 'dance_form',
  }
  return (
    <>
      <TimelineRow timeline={timeline} />
      <div className="flex flex-col gap-4">
        <Section title="The work">
          <Facts
            items={[
              { label: 'Form', value: words(str(p.form) ?? str(plus.type)) || null },
              {
                label: 'Author',
                value:
                  author !== null && author >= 0 ? (
                    <NamedRef
                      kind="historical_figure"
                      id={author}
                      names={names}
                      worldId={worldId}
                    />
                  ) : null,
              },
              { label: 'Style', value: styles.length ? styles.join(', ') : null },
              {
                label: 'Length',
                value: start !== null && end !== null ? `${end - start + 1} pages` : null,
              },
              {
                label: 'Quality of writing',
                value: num(p.author_roll) !== null ? `${num(p.author_roll)} / 200` : null,
              },
              {
                label: 'Copies known',
                value: related.artifacts?.length ? related.artifacts.length : null,
              },
            ]}
          />
        </Section>
        {references.length ? (
          <Section title="Mentions" count={references.length}>
            <ul className="flex flex-col gap-1 text-sm">
              {references.map((r, i) => {
                const kind = refKind[str(r.type) ?? '']
                const id = num(r.id)
                return (
                  // biome-ignore lint/suspicious/noArrayIndexKey: references repeat ids across kinds
                  <li key={`${kind}-${id}-${i}`}>
                    {kind && id !== null ? (
                      <NamedRef kind={kind} id={id} names={names} worldId={worldId} />
                    ) : (
                      words(str(r.type))
                    )}
                    {kind ? (
                      <span className="text-muted-foreground">
                        {' '}
                        · {kindLabel(kind).toLowerCase()}
                      </span>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          </Section>
        ) : null}
      </div>
      <div className="flex flex-col gap-4 lg:col-span-2">
        {related.referencedEvents?.length ? (
          <Section
            title="Events it recounts"
            count={related.referencedEvents.length}
            description="What the text is about, in the order it happened."
          >
            <ol className="divide-y">
              {related.referencedEvents.map((event) => (
                <EventLine key={event.id} event={event} names={names} worldId={worldId} />
              ))}
            </ol>
          </Section>
        ) : null}
        {related.artifacts?.length ? (
          <Section
            title="Copies"
            count={related.artifacts.length}
            description="Books and scrolls that carry this text."
          >
            <HitRows hits={related.artifacts} worldId={worldId} />
          </Section>
        ) : null}
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// Event collections: wars, battles, festivals

interface Squad {
  race: string
  number: number
  deaths: number
  site: number | null
}

function squads(p: LegendsPayload, side: 'attacking' | 'defending'): Squad[] {
  const races = Array.isArray(p[`${side}_squad_race`]) ? (p[`${side}_squad_race`] as unknown[]) : []
  const numbers = numList(p[`${side}_squad_number`])
  const deaths = numList(p[`${side}_squad_deaths`])
  const sites = numList(p[`${side}_squad_site`])
  return races.map((race, i) => ({
    race: words(String(race)),
    number: numbers[i] ?? 0,
    deaths: deaths[i] ?? 0,
    site: sites[i] ?? null,
  }))
}

function SquadTable({
  title,
  list,
  leaders,
  names,
  worldId,
}: { title: string; list: Squad[]; leaders: number[]; names: NameIndex; worldId: number }) {
  const total = list.reduce((a, s) => a + s.number, 0)
  const dead = list.reduce((a, s) => a + s.deaths, 0)
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between text-sm">
        <span className="font-medium">{title}</span>
        <span className="text-muted-foreground tabular-nums">
          {total.toLocaleString()} fought, {dead.toLocaleString()} fell
        </span>
      </div>
      {list.length ? (
        <ul className="divide-y text-sm">
          {list.map((s, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: squads are positional
            <li key={i} className="flex items-baseline gap-3 py-1">
              <span className="flex-1">
                {s.number} {s.race}
                {s.number === 1 ? '' : 's'}
                {s.site !== null && s.site >= 0 ? (
                  <span className="text-muted-foreground">
                    {' '}
                    from <NamedRef kind="site" id={s.site} names={names} worldId={worldId} />
                  </span>
                ) : null}
              </span>
              <span
                className={cn(
                  'tabular-nums',
                  s.deaths ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground',
                )}
              >
                {s.deaths} dead
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {leaders.length ? (
        <div className="mt-2 text-sm">
          <span className="text-muted-foreground">Named fighters: </span>
          <RefList
            kind="historical_figure"
            ids={leaders}
            names={names}
            worldId={worldId}
            max={20}
          />
        </div>
      ) : null}
    </div>
  )
}

export function CollectionSections({
  payload: p,
  names,
  related,
  worldId,
  map,
  timeline,
}: SectionProps) {
  const type = str(p.type) ?? 'chapter'
  const at = parseCoord(p.coords)
  const attackers = squads(p, 'attacking')
  const defenders = squads(p, 'defending')
  const attackingHf = numList(p.attacking_hfid)
  const defendingHf = numList(p.defending_hfid)
  const noncom = numList(p.noncom_hfid)
  const isBattle = attackers.length || defenders.length || attackingHf.length || defendingHf.length
  const children = related.children ?? []
  const battles = children.filter((c) => c.type === 'battle')
  const conquests = children.filter((c) => c.type === 'site conquered')
  const otherChildren = children.filter((c) => c.type !== 'battle' && c.type !== 'site conquered')

  return (
    <>
      <div className="lg:col-span-3">
        <Section title="The chapter">
          <MapAndFacts
            map={at ? <MiniMap map={map} focus={at} /> : null}
            facts={
              <Facts
                items={[
                  {
                    label: 'Kind',
                    value: `${words(type)}${str(p.adjective) ? ` (${str(p.adjective)})` : ''}`,
                  },
                  {
                    label: 'When',
                    value: `${legendsDate(num(p.start_year), num(p.start_seconds72))}${num(p.end_year) !== null && (num(p.end_year) !== num(p.start_year) || num(p.end_seconds72) !== num(p.start_seconds72)) ? ` to ${legendsDate(num(p.end_year), num(p.end_seconds72))}` : ''}`,
                  },
                  { label: 'Outcome', value: str(p.outcome) },
                  {
                    label: 'Aggressor',
                    value: (
                      <NamedRef
                        kind="entity"
                        id={num(p.aggressor_ent_id) ?? num(p.attacking_enid)}
                        names={names}
                        worldId={worldId}
                        fallback=""
                      />
                    ),
                  },
                  {
                    label: 'Defender',
                    value: (
                      <NamedRef
                        kind="entity"
                        id={num(p.defender_ent_id) ?? num(p.defending_enid)}
                        names={names}
                        worldId={worldId}
                        fallback=""
                      />
                    ),
                  },
                  {
                    label: 'Target',
                    value:
                      num(p.target_entity_id) !== null ? (
                        <NamedRef
                          kind="entity"
                          id={num(p.target_entity_id)}
                          names={names}
                          worldId={worldId}
                        />
                      ) : null,
                  },
                  {
                    label: 'Held by',
                    value:
                      num(p.civ_id) !== null && (num(p.civ_id) ?? -1) >= 0 ? (
                        <NamedRef
                          kind="entity"
                          id={num(p.civ_id)}
                          names={names}
                          worldId={worldId}
                        />
                      ) : null,
                  },
                  {
                    label: 'Where',
                    value:
                      num(p.site_id) !== null && (num(p.site_id) ?? -1) >= 0 ? (
                        <NamedRef kind="site" id={num(p.site_id)} names={names} worldId={worldId} />
                      ) : num(p.subregion_id) !== null && (num(p.subregion_id) ?? -1) >= 0 ? (
                        <NamedRef
                          kind="region"
                          id={num(p.subregion_id)}
                          names={names}
                          worldId={worldId}
                        />
                      ) : null,
                  },
                  {
                    label: 'Part of',
                    value: related.parent ? (
                      <RecordLink
                        kind="historical_event_collection"
                        id={related.parent.id}
                        name={related.parent.name}
                        type={related.parent.type}
                        worldId={worldId}
                      >
                        {related.parent.name
                          ? titleCase(related.parent.name)
                          : `${words(related.parent.type)} #${related.parent.id}`}
                      </RecordLink>
                    ) : null,
                  },
                  {
                    label: 'Ordinal',
                    value:
                      num(p.ordinal) !== null
                        ? `${num(p.ordinal)}${['st', 'nd', 'rd'][(num(p.ordinal) ?? 0) - 1] ?? 'th'} of its kind`
                        : null,
                  },
                  { label: 'Events', value: numList(p.event).length || null },
                ]}
              />
            }
          />
        </Section>
      </div>

      <TimelineRow timeline={timeline} />

      <div className="flex flex-col gap-4 lg:col-span-3">
        {isBattle ? (
          <Section
            title="The forces"
            description="Who took the field, and how many did not leave it."
          >
            <div className="grid gap-6 md:grid-cols-2">
              <SquadTable
                title="Attackers"
                list={attackers}
                leaders={attackingHf}
                names={names}
                worldId={worldId}
              />
              <SquadTable
                title="Defenders"
                list={defenders}
                leaders={defendingHf}
                names={names}
                worldId={worldId}
              />
            </div>
            {noncom.length ? (
              <div className="mt-4 text-sm">
                <span className="text-muted-foreground">Caught in the fighting: </span>
                <RefList kind="historical_figure" ids={noncom} names={names} worldId={worldId} />
              </div>
            ) : null}
          </Section>
        ) : null}

        {battles.length ? (
          <Section title="Battles" count={battles.length}>
            <HitRows hits={battles} worldId={worldId} years />
          </Section>
        ) : null}
        {conquests.length ? (
          <Section title="Sites conquered" count={conquests.length}>
            <HitRows hits={conquests} worldId={worldId} years />
          </Section>
        ) : null}
        {otherChildren.length ? (
          <Section title="Episodes" count={otherChildren.length}>
            <HitRows hits={otherChildren} worldId={worldId} years />
          </Section>
        ) : null}
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// Region and other geography

export function RegionSections({
  record,
  payload: p,
  plus,
  related,
  worldId,
  map,
  timeline,
}: SectionProps) {
  const sitesInRegion = React.useMemo(() => {
    if (!map) return []
    const index = map.regions.findIndex((r) => r.id === record.id)
    if (index < 0) return []
    return map.sites.filter((s) => map.tiles[s.y * map.width + s.x] === index)
  }, [map, record.id])
  const tiles = str(plus.coords)?.split('|').filter(Boolean).length ?? 0
  const hits: LegendsHit[] = sitesInRegion.map((s) => {
    const civ = s.civ !== null ? map?.civs[s.civ] : null
    return {
      kind: 'site',
      id: s.id,
      name: s.name,
      type: s.type,
      year: null,
      detail: civ
        ? `held by ${civ.name ? titleCase(civ.name) : 'unknown'}${civ.race ? ` (${words(civ.race)}s)` : ''}`
        : 'unclaimed',
    }
  })
  return (
    <>
      <div className="lg:col-span-3">
        <Section title="The land">
          <MapAndFacts
            map={<MiniMap map={map} highlightRegion={record.id} />}
            facts={
              <Facts
                items={[
                  { label: 'Terrain', value: words(str(p.type)) },
                  {
                    label: 'Alignment',
                    value:
                      str(plus.evilness) && str(plus.evilness) !== 'neutral'
                        ? str(plus.evilness)
                        : 'neutral',
                  },
                  { label: 'Size', value: tiles ? `${tiles} tiles` : null },
                  {
                    label: 'Depth',
                    value: num(p.depth) !== null ? `cavern layer ${num(p.depth)}` : null,
                  },
                  { label: 'Sites', value: sitesInRegion.length || null },
                  {
                    label: 'Events on record',
                    value: related.eventsTotal ? related.eventsTotal.toLocaleString() : null,
                  },
                ]}
              />
            }
          />
        </Section>
      </div>
      <TimelineRow timeline={timeline} />
      <div className="flex flex-col gap-4 lg:col-span-3">
        {hits.length ? (
          <Section title="Sites in this region" count={hits.length}>
            <HitRows hits={hits} worldId={worldId} />
          </Section>
        ) : null}
      </div>
    </>
  )
}

export function PlaceSections({ payload: p, plus, map, timeline }: SectionProps) {
  const at = parseCoord(plus.coords)
  const end = parseCoord(plus.end_pos)
  const pathTiles = str(plus.path)?.split('|').filter(Boolean).length ?? 0
  return (
    <>
      <div className="lg:col-span-3">
        <Section title="The place">
          <MapAndFacts
            map={at ? <MiniMap map={map} focus={at} /> : null}
            facts={
              <Facts
                items={[
                  {
                    label: 'Height',
                    value: num(plus.height) !== null ? `${num(plus.height)}` : null,
                  },
                  { label: 'Volcano', value: plus.is_volcano === true ? 'yes' : null },
                  { label: 'Length', value: pathTiles ? `${pathTiles} tiles` : null },
                  { label: 'Flows to', value: end ? `${end.x}, ${end.y}` : null },
                  {
                    label: 'Coordinates',
                    value: at
                      ? `${at.x}, ${at.y}`
                      : str(plus.coord_1) && str(plus.coord_2)
                        ? `${plus.coord_1} to ${plus.coord_2}`
                        : null,
                  },
                  { label: 'Depth', value: num(p.depth) !== null ? `layer ${num(p.depth)}` : null },
                ]}
              />
            }
          />
        </Section>
      </div>
      <TimelineRow timeline={timeline} />
    </>
  )
}

// ---------------------------------------------------------------------------
// Art forms, creatures, identities, and anything else with prose

export function ProseSections({
  record,
  payload: p,
  plus,
  names,
  worldId,
  timeline,
}: SectionProps) {
  const description = str(p.description)
  const paragraphs = description
    ? description
        .split('[B]')
        .map((s) => s.trim())
        .filter(Boolean)
    : []
  const flags = Object.entries(plus)
    .filter(([k, v]) => v === true && !k.startsWith('has_any') && !k.startsWith('biome_pool'))
    .map(([k]) => words(k))
  const biomes = Object.keys(plus)
    .filter((k) => k.startsWith('biome_pool_'))
    .map((k) => words(k.replace('biome_pool_', '')))
  return (
    <>
      <TimelineRow timeline={timeline} />
      <div className="flex flex-col gap-4">
        <Section title="Details">
          <Facts
            items={[
              { label: 'Race', value: str(plus.race) ? words(str(plus.race)) : null },
              { label: 'Caste', value: str(plus.caste) ? words(str(plus.caste)) : null },
              {
                label: 'Profession',
                value: str(plus.profession) ? words(str(plus.profession)) : null,
              },
              {
                label: 'Born',
                value:
                  num(plus.birth_year) !== null && (num(plus.birth_year) ?? -1) >= 0
                    ? `year ${num(plus.birth_year)}`
                    : null,
              },
              {
                label: 'Used by',
                value: numList(plus.histfig_id).length ? (
                  <RefList
                    kind="historical_figure"
                    ids={numList(plus.histfig_id)}
                    names={names}
                    worldId={worldId}
                  />
                ) : null,
              },
              {
                label: 'Of',
                value:
                  num(plus.entity_id) !== null && (num(plus.entity_id) ?? -1) >= 0 ? (
                    <NamedRef
                      kind="entity"
                      id={num(plus.entity_id)}
                      names={names}
                      worldId={worldId}
                    />
                  ) : null,
              },
              { label: 'Singular', value: str(plus.name_singular) },
              { label: 'Plural', value: str(plus.name_plural) },
              { label: 'Traits', value: flags.length ? flags.join(', ') : null },
              { label: 'Found in', value: biomes.length ? biomes.join(', ') : null },
              {
                label: 'Begins',
                value:
                  record.kind === 'historical_era' && num(p.start_year) !== null
                    ? (num(p.start_year) ?? 0) < 0
                      ? 'at the dawn of time'
                      : `year ${num(p.start_year)}`
                    : null,
              },
            ]}
          />
        </Section>
      </div>
      <div className="flex flex-col gap-4 lg:col-span-2">
        {paragraphs.length ? (
          <Section title="As it is described">
            <div className="flex max-w-[70ch] flex-col gap-3 text-base leading-relaxed">
              {paragraphs.map((para, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: paragraphs are positional
                <p key={i}>{para}</p>
              ))}
            </div>
          </Section>
        ) : null}
      </div>
    </>
  )
}
