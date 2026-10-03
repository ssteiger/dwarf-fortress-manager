import type { FortUnit } from '@fortress/db-drizzle'
import { Button, Card, CardContent, CardHeader, CardTitle, Skeleton, cn } from '@fortress/ui'
import { BriefcaseIcon, GraduationCapIcon, HandHelpingIcon, HeartHandshakeIcon } from 'lucide-react'
import * as React from 'react'

import { CreatureSprite } from '~/lib/df-assets/components'
import { skillLabel } from '~/lib/fortress/dossier'
import { skillRank, unitDisplayName } from '~/lib/fortress/format'
import { type Concern, isGrownCitizen } from '~/lib/fortress/insights'
import type { FortBond, FortWastedTalent } from '~/lib/fortress/server'
import { ConcernBadges, type OpenUnit, UnitChip } from '../../-components/Insights'

const SEVERITY_ORDER: Record<Concern['severity'], number> = { danger: 0, warning: 1, info: 2 }

function ShowAll({ hidden, onClick }: { hidden: number; onClick: () => void }) {
  if (hidden <= 0) return null
  return (
    <Button
      variant="ghost"
      size="sm"
      className="mt-1 self-start text-muted-foreground"
      onClick={onClick}
    >
      Show {hidden} more
    </Button>
  )
}

// ---------------------------------------------------------------------------
// Who needs you

export interface HelpEntry {
  unit: FortUnit
  concerns: Concern[]
}

const HELP_SHOWN = 8

/** Fold a list only when that hides more than a couple of rows. */
function capped<T>(list: T[], max: number, all: boolean): T[] {
  return all || list.length <= max + 2 ? list : list.slice(0, max)
}

/** The concern's own first sentence; the general advice after it is the same for many. */
function firstSentence(text: string): string {
  return text.split(/(?<=[.!?])\s/)[0] ?? text
}

/** Citizens with a need, a wound, a dark mood or nothing to do, the worst first. */
export function HelpList({ entries, onOpen }: { entries: HelpEntry[]; onOpen: OpenUnit }) {
  const [all, setAll] = React.useState(false)
  const shown = capped(entries, HELP_SHOWN, all)
  return (
    <Card className="gap-3">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <HandHelpingIcon className="size-4 text-primary" />
          Could use your help
          {entries.length ? (
            <span className="text-sm font-normal text-muted-foreground tabular-nums">
              {entries.length}
            </span>
          ) : null}
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          {entries.length
            ? 'A need, a wound, a dark mood or nothing to do, the worst first. Open someone for what would help.'
            : 'Nobody needs you right now.'}
        </p>
      </CardHeader>
      {entries.length ? (
        <CardContent className="flex flex-col">
          <ul className="grid gap-x-6 gap-y-0.5 lg:grid-cols-2">
            {shown.map(({ unit, concerns }) => {
              const worst = [...concerns].sort(
                (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
              )[0]
              return (
                <li key={unit.id}>
                  <button
                    type="button"
                    onClick={() => onOpen(unit)}
                    className="-mx-2 flex w-[calc(100%+1rem)] items-start gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-accent"
                  >
                    <CreatureSprite unit={unit} size={28} className="mt-0.5 shrink-0" />
                    <span className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className="flex min-w-0 items-baseline gap-2">
                        <span className="truncate font-medium">{unitDisplayName(unit)}</span>
                        <span className="shrink-0 text-sm text-muted-foreground">
                          {unit.profession}
                        </span>
                      </span>
                      <ConcernBadges concerns={concerns} />
                      {worst?.hint ? (
                        <span className="line-clamp-2 text-sm text-muted-foreground">
                          {firstSentence(worst.hint)}
                        </span>
                      ) : null}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
          <ShowAll hidden={entries.length - shown.length} onClick={() => setAll(true)} />
        </CardContent>
      ) : null}
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Who does what

/** Trades by the words the game uses for professions, checked in order. */
const TRADES: [label: string, test: RegExp][] = [
  ['Mining and masonry', /miner|mason|stonecutter|stone carver|engraver|mechanic|pump/i],
  ['Wood', /wood|carpenter|bowyer|potash|charcoal/i],
  ['Metal', /furnace|smith|armorer|metal|smelter/i],
  [
    'Crafts and cloth',
    /craft|glass|gem|bone|weaver|clothier|tanner|leather|dyer|spinner|soap|jewel/i,
  ],
  [
    'Food and farming',
    /farmer|planter|herbalist|brewer|cook|butcher|fish|cheese|milker|miller|thresher|presser|beekeeper|shearer|tallow|lye/i,
  ],
  ['Animals and the wild', /animal|trainer|caretaker|hunter|trapper|ranger/i],
  ['Healing', /doctor|diagnos|surgeon|bone setter|suturer/i],
  ['Fighters out of a squad', /recruit|wrestler|dwarf$|lasher|pikeman|militia|guard/i],
]

interface WorkGroup {
  key: string
  label: string
  units: FortUnit[]
  /** Officials list their office beside them instead of grouping by it. */
  offices?: Map<number, string[]>
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function isIdle(unit: FortUnit): boolean {
  return isGrownCitizen(unit) && !unit.job && !unit.squad && !unit.mood
}

/** Office holders, then each squad, then everyone else by trade, then the young. */
function workGroups(citizens: FortUnit[]): WorkGroup[] {
  const groups: WorkGroup[] = []
  const placed = new Set<number>()
  const byName = (a: FortUnit, b: FortUnit) => unitDisplayName(a).localeCompare(unitDisplayName(b))

  const officials = citizens.filter((unit) => unit.positions.length)
  if (officials.length) {
    groups.push({
      key: 'offices',
      label: 'Nobles and officials',
      units: officials,
      offices: new Map(officials.map((unit) => [unit.id, unit.positions])),
    })
    for (const unit of officials) placed.add(unit.id)
  }

  const squads = new Map<string, FortUnit[]>()
  for (const unit of citizens) {
    if (placed.has(unit.id) || !unit.squad) continue
    squads.set(unit.squad, [...(squads.get(unit.squad) ?? []), unit])
    placed.add(unit.id)
  }
  for (const [squad, members] of [...squads].sort((a, b) => a[0].localeCompare(b[0])))
    groups.push({ key: `squad-${squad}`, label: squad, units: members.sort(byName) })

  const young = citizens.filter(
    (unit) => !placed.has(unit.id) && (unit.flags.includes('child') || unit.flags.includes('baby')),
  )
  for (const unit of young) placed.add(unit.id)

  const trades = new Map<string, FortUnit[]>()
  const other: FortUnit[] = []
  for (const unit of citizens) {
    if (placed.has(unit.id)) continue
    const trade = TRADES.find(([, test]) => test.test(unit.profession))?.[0]
    if (trade) trades.set(trade, [...(trades.get(trade) ?? []), unit])
    else other.push(unit)
  }
  for (const [label] of TRADES) {
    const members = trades.get(label)
    if (members?.length) groups.push({ key: label, label, units: members.sort(byName) })
  }
  if (other.length) groups.push({ key: 'other', label: 'Other work', units: other.sort(byName) })
  if (young.length) groups.push({ key: 'young', label: 'Children', units: young.sort(byName) })
  return groups
}

export function WorkGroups({ citizens, onOpen }: { citizens: FortUnit[]; onOpen: OpenUnit }) {
  const groups = React.useMemo(() => workGroups(citizens), [citizens])
  const idle = citizens.filter(isIdle).length
  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <BriefcaseIcon className="size-4 text-primary" />
          Who does what
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          By office, squad and trade.
          {idle ? (
            <>
              {' '}
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block size-2 rounded-full bg-amber-500" />
                {idle} {idle === 1 ? 'adult has' : 'adults have'} nothing to do
              </span>
              , outlined in amber.
            </>
          ) : null}
        </p>
      </CardHeader>
      <CardContent>
        <dl className="flex flex-col divide-y">
          {groups.map((group) => (
            <div
              key={group.key}
              className="grid gap-2 py-3 first:pt-0 last:pb-0 sm:grid-cols-[9.5rem_1fr]"
            >
              <dt className="flex items-baseline gap-2 pt-0.5 text-sm text-muted-foreground">
                <span className="truncate">{group.label}</span>
                <span className="tabular-nums">{group.units.length}</span>
              </dt>
              <dd className="flex flex-wrap items-center gap-1.5">
                {group.units.map((unit) =>
                  group.offices ? (
                    <span key={unit.id} className="inline-flex items-center gap-1.5 pr-2">
                      <UnitChip unit={unit} onOpen={onOpen} />
                      <span className="text-sm text-muted-foreground">
                        {(group.offices.get(unit.id) ?? []).map(capitalize).join(', ')}
                      </span>
                    </span>
                  ) : (
                    <UnitChip
                      key={unit.id}
                      unit={unit}
                      onOpen={onOpen}
                      className={cn(isIdle(unit) && 'border-amber-500/70')}
                    />
                  ),
                )}
              </dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Who is good at what

/** The skills a fortress leans on, by what they keep going. */
const KEY_SKILLS: { area: string; skills: [token: string, name: string][] }[] = [
  {
    area: 'Dig and build',
    skills: [
      ['MINING', 'Mining'],
      ['MASONRY', 'Masonry'],
      ['CARPENTRY', 'Carpentry'],
      ['MECHANICS', 'Mechanics'],
    ],
  },
  {
    area: 'Food and drink',
    skills: [
      ['BREWING', 'Brewing'],
      ['COOK', 'Cooking'],
      ['PLANT', 'Growing'],
      ['FISH', 'Fishing'],
    ],
  },
  {
    area: 'Healing',
    skills: [
      ['DIAGNOSE', 'Diagnosis'],
      ['SURGERY', 'Surgery'],
      ['SET_BONE', 'Setting bones'],
      ['SUTURE', 'Suturing'],
      ['DRESS_WOUNDS', 'Dressing wounds'],
    ],
  },
  {
    area: 'Industry',
    skills: [
      ['SMELT', 'Smelting'],
      ['FORGE_WEAPON', 'Weaponsmithing'],
      ['FORGE_ARMOR', 'Armorsmithing'],
      ['WEAVING', 'Weaving'],
      ['CLOTHESMAKING', 'Clothesmaking'],
    ],
  },
]

/** Competent: good enough to be worth naming as a second pair of hands. */
const ABLE_RATING = 3
const WASTED_SHOWN = 6

function ratingOf(unit: FortUnit, token: string): number | null {
  const skill = unit.skills.find(([t]) => t === token)
  return skill ? skill[1] : null
}

export function SkillCoverage({
  citizens,
  wasted,
  loading,
  onOpen,
}: {
  citizens: FortUnit[]
  wasted: FortWastedTalent[]
  loading: boolean
  onOpen: OpenUnit
}) {
  const [allWasted, setAllWasted] = React.useState(false)
  const adults = React.useMemo(() => citizens.filter(isGrownCitizen), [citizens])
  const byId = React.useMemo(() => new Map(citizens.map((unit) => [unit.id, unit])), [citizens])
  const wastedKeys = new Set(wasted.map((w) => `${w.unitId}:${w.skill}`))
  const wastedRows = wasted.filter((w) => byId.has(w.unitId)).sort((a, b) => b.rating - a.rating)
  const shownWasted = capped(wastedRows, WASTED_SHOWN, allWasted)

  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <GraduationCapIcon className="size-4 text-primary" />
          Who is good at what
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          The best hand at each skill a fortress leans on, and how many others are competent.
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {KEY_SKILLS.map(({ area, skills }) => (
          <section key={area} className="flex flex-col">
            <h3 className="pb-1 text-xs font-medium text-muted-foreground">{area}</h3>
            <dl className="flex flex-col divide-y">
              {skills.map(([token, name]) => {
                const ranked = adults
                  .map((unit) => ({ unit, rating: ratingOf(unit, token) }))
                  .filter(
                    (entry): entry is { unit: FortUnit; rating: number } => entry.rating !== null,
                  )
                  .sort((a, b) => b.rating - a.rating)
                const best = ranked[0]
                const others = ranked.slice(1).filter((entry) => entry.rating >= ABLE_RATING)
                return (
                  <div
                    key={token}
                    className="grid grid-cols-[7.5rem_1fr] items-center gap-2 py-1.5 sm:grid-cols-[7.5rem_1fr_auto]"
                  >
                    <dt className="text-sm">{name}</dt>
                    <dd className="flex min-w-0 flex-wrap items-center gap-2">
                      {best ? (
                        <>
                          <UnitChip unit={best.unit} onOpen={onOpen} />
                          <span className="text-sm text-muted-foreground">
                            {skillRank(best.rating)}
                          </span>
                          {wastedKeys.has(`${best.unit.id}:${token}`) ? (
                            <span className="text-xs text-amber-700 dark:text-amber-400">
                              labor off
                            </span>
                          ) : null}
                        </>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                          <span className="inline-block size-1.5 rounded-full bg-amber-500" />
                          Nobody has learned it yet
                        </span>
                      )}
                    </dd>
                    <dd
                      className="hidden text-right text-sm whitespace-nowrap text-muted-foreground tabular-nums sm:block"
                      title={others.map((entry) => unitDisplayName(entry.unit)).join(', ')}
                    >
                      {others.length ? `+${others.length} competent` : ''}
                    </dd>
                  </div>
                )
              })}
            </dl>
          </section>
        ))}

        {loading ? (
          <Skeleton className="h-16 rounded-lg" />
        ) : wastedRows.length ? (
          <section className="flex flex-col border-t pt-4">
            <h3 className="text-sm font-medium">Good at it, but not allowed to</h3>
            <p className="text-sm text-muted-foreground">
              Enable the labor, or add them to a work detail that allows it.
            </p>
            <ul className="mt-2 flex flex-col gap-1.5">
              {shownWasted.map((talent) => {
                const unit = byId.get(talent.unitId)
                if (!unit) return null
                return (
                  <li
                    key={`${talent.unitId}:${talent.skill}`}
                    className="flex flex-wrap items-center gap-2 text-sm"
                  >
                    <UnitChip unit={unit} onOpen={onOpen} />
                    <span>
                      {skillRank(talent.rating)} at {skillLabel(talent.skill, unit)}
                    </span>
                  </li>
                )
              })}
            </ul>
            <ShowAll
              hidden={wastedRows.length - shownWasted.length}
              onClick={() => setAllWasted(true)}
            />
          </section>
        ) : null}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Who they are to each other

const BONDS_SHOWN = 8

/** Kindred spirits and lovers before plain friends. */
const FRIEND_RANK: Record<string, number> = {
  'kindred spirit': 0,
  lover: 1,
  'close friend': 2,
  'childhood friend': 3,
}

function plural(words: string): string {
  if (/[^aeiou]y$/.test(words)) return `${words.slice(0, -1)}ies`
  return `${words}s`
}

function foeVerb(label: string): string {
  const words = label.toLowerCase()
  if (words.includes('grudge')) return 'holds a grudge against'
  if (words.includes('jealous')) return 'is jealous of'
  if (words.includes('rival')) return 'is a rival of'
  if (words === 'disliked') return 'dislikes'
  if (words === 'hated' || words === 'pure hatred') return 'hates'
  return words
}

interface PairRow {
  key: string
  a: FortUnit
  b: FortUnit
  words: string
  both: boolean
  /** Friends only: kindred spirits, lovers, close and childhood friends. */
  close: boolean
}

function households(bonds: FortBond[], byId: Map<number, FortUnit>): FortUnit[][] {
  const parent = new Map<number, number>()
  const find = (id: number): number => {
    const up = parent.get(id) ?? id
    if (up === id) return id
    const root = find(up)
    parent.set(id, root)
    return root
  }
  for (const bond of bonds) {
    if (bond.group !== 'family' || !byId.has(bond.from) || !byId.has(bond.to)) continue
    parent.set(find(bond.from), find(bond.to))
  }
  const groups = new Map<number, FortUnit[]>()
  for (const id of parent.keys()) {
    const unit = byId.get(id)
    if (unit) groups.set(find(id), [...(groups.get(find(id)) ?? []), unit])
  }
  return [...groups.values()]
    .filter((members) => members.length > 1)
    .map((members) => members.sort((a, b) => b.age - a.age))
    .sort((a, b) => b.length - a.length)
}

function pairs(
  bonds: FortBond[],
  byId: Map<number, FortUnit>,
  group: 'friends' | 'foes',
): PairRow[] {
  const rows = new Map<string, PairRow & { rank: number }>()
  for (const bond of bonds) {
    if (bond.group !== group) continue
    const a = byId.get(bond.from)
    const b = byId.get(bond.to)
    if (!a || !b) continue
    const key = [bond.from, bond.to].sort((x, y) => x - y).join('-')
    const label = (bond.detail ?? bond.label).toLowerCase()
    const rank = group === 'friends' ? (FRIEND_RANK[label] ?? 9) : 0
    const existing = rows.get(key)
    if (existing) {
      existing.both = true
      // Either side may hold the warmer view; show the closer of the two.
      if (rank < existing.rank)
        Object.assign(existing, { rank, words: plural(label), close: rank < 9 })
      continue
    }
    rows.set(key, {
      key,
      a,
      b,
      words: group === 'friends' ? plural(label) : foeVerb(bond.label),
      both: false,
      close: rank < 9,
      rank,
    })
  }
  return [...rows.values()].sort((x, y) => x.rank - y.rank)
}

function BondColumn({
  title,
  count,
  empty,
  note,
  children,
  hidden,
  onShowAll,
}: {
  title: string
  count: number
  empty: string
  note?: string | null
  children: React.ReactNode
  hidden: number
  onShowAll: () => void
}) {
  return (
    <section className="flex min-w-0 flex-col">
      <h3 className="flex items-baseline gap-2 pb-2 text-sm font-medium">
        {title}
        <span className="font-normal text-muted-foreground tabular-nums">{count}</span>
      </h3>
      {count ? (
        <ul className="flex flex-col divide-y">{children}</ul>
      ) : (
        <p className="text-sm text-muted-foreground">{empty}</p>
      )}
      <ShowAll hidden={hidden} onClick={onShowAll} />
      {note ? <p className="mt-2 text-sm text-muted-foreground">{note}</p> : null}
    </section>
  )
}

export function Bonds({
  citizens,
  bonds,
  loading,
  onOpen,
}: {
  citizens: FortUnit[]
  bonds: FortBond[]
  loading: boolean
  onOpen: OpenUnit
}) {
  const [open, setOpen] = React.useState({ family: false, friends: false, foes: false })
  const byId = React.useMemo(() => new Map(citizens.map((unit) => [unit.id, unit])), [citizens])
  const families = React.useMemo(() => households(bonds, byId), [bonds, byId])
  const friends = React.useMemo(() => pairs(bonds, byId, 'friends'), [bonds, byId])
  const close = friends.filter((row) => row.close)
  const foes = React.useMemo(() => pairs(bonds, byId, 'foes'), [bonds, byId])
  const cap = <T,>(list: T[], all: boolean) => capped(list, BONDS_SHOWN, all)

  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <HeartHandshakeIcon className="size-4 text-primary" />
          Who they are to each other
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Families, friendships and grudges between citizens, as each one's own memory has them.
          Grudges are where fights and tantrums start.
        </p>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-32 rounded-lg" />
        ) : (
          <div className="grid gap-6 lg:grid-cols-3">
            <BondColumn
              title="Families"
              count={families.length}
              empty="No two citizens are related."
              hidden={families.length - cap(families, open.family).length}
              onShowAll={() => setOpen((o) => ({ ...o, family: true }))}
            >
              {cap(families, open.family).map((members) => (
                <li key={members[0].id} className="flex flex-wrap gap-1.5 py-2 first:pt-0">
                  {members.map((unit) => (
                    <UnitChip key={unit.id} unit={unit} onOpen={onOpen} />
                  ))}
                </li>
              ))}
            </BondColumn>
            <BondColumn
              title="Close friends"
              count={close.length}
              empty="No close friendships yet. Taverns, temples and shared work bring them."
              note={
                friends.length > close.length
                  ? `And ${friends.length - close.length} more pairs who call each other friends.`
                  : null
              }
              hidden={close.length - cap(close, open.friends).length}
              onShowAll={() => setOpen((o) => ({ ...o, friends: true }))}
            >
              {cap(close, open.friends).map((row) => (
                <li key={row.key} className="flex flex-col gap-1 py-2 first:pt-0">
                  <span className="text-xs text-muted-foreground">{row.words}</span>
                  <span className="flex flex-wrap gap-1.5">
                    <UnitChip unit={row.a} onOpen={onOpen} />
                    <UnitChip unit={row.b} onOpen={onOpen} />
                  </span>
                </li>
              ))}
            </BondColumn>
            <BondColumn
              title="Grudges"
              count={foes.length}
              empty="No grudges between citizens."
              hidden={foes.length - cap(foes, open.foes).length}
              onShowAll={() => setOpen((o) => ({ ...o, foes: true }))}
            >
              {cap(foes, open.foes).map((row) => (
                <li
                  key={row.key}
                  className="flex flex-wrap items-center gap-1.5 py-2 text-sm first:pt-0"
                >
                  <UnitChip unit={row.a} onOpen={onOpen} />
                  <span className="text-muted-foreground">{row.words}</span>
                  <UnitChip unit={row.b} onOpen={onOpen} />
                  {row.both ? <span className="text-muted-foreground">and back</span> : null}
                </li>
              ))}
            </BondColumn>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
