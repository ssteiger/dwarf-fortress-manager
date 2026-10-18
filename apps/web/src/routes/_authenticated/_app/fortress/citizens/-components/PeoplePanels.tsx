import type { FortSquad, FortUnit } from '@fortress/db-drizzle'
import { Badge, Button, Skeleton, cn } from '@fortress/ui'
import { Link } from '@tanstack/react-router'
import {
  BabyIcon,
  BriefcaseIcon,
  EyeIcon,
  FootprintsIcon,
  GraduationCapIcon,
  HandHelpingIcon,
  HeartHandshakeIcon,
  ShieldIcon,
} from 'lucide-react'
import * as React from 'react'

import { useQuery } from '@tanstack/react-query'
import { CreatureSprite } from '~/lib/df-assets/components'
import { formatGameTick, skillRank, stressLabel, unitDisplayName } from '~/lib/fortress/format'
import { skillLabel } from '~/lib/fortress/people/dossier'
import type { Concern } from '~/lib/fortress/people/troubles'
import { firstName, isGrownCitizen } from '~/lib/fortress/people/units'
import { getUnitSketch } from '~/lib/fortress/server/roleplay'
import type { FortArrival, FortBond, FortWastedTalent } from '~/lib/fortress/server/units'
import { Section } from '../../-components/FortChrome'
import { ConcernBadges, type OpenUnit, UnitChip } from '../../-components/Insights'
import { LaborButton } from './LaborButton'

export const CitizenFilter = React.createContext('')

function matches(unit: FortUnit, query: string): boolean {
  if (!query) return true
  const q = query.toLowerCase()
  return [unit.name, unit.nickname, unit.readable, unit.profession, unit.name_english].some((s) =>
    s?.toLowerCase().includes(q),
  )
}

function chipClass(unit: FortUnit, query: string, extra?: string): string | undefined {
  return cn(extra, query && !matches(unit, query) && 'opacity-40')
}

const SEVERITY_ORDER: Record<Concern['severity'], number> = { danger: 0, warning: 1, info: 2 }

const ShowAll = ({ hidden, onClick }: { hidden: number; onClick: () => void }) => {
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
export const HelpList = ({ entries, onOpen }: { entries: HelpEntry[]; onOpen: OpenUnit }) => {
  const query = React.useContext(CitizenFilter)
  const [all, setAll] = React.useState(false)
  const shown = capped(entries, HELP_SHOWN, all)
  return (
    <Section
      className="gap-3"
      icon={<HandHelpingIcon className="size-4 text-primary" />}
      title={
        <>
          Could use your help
          {entries.length ? (
            <span className="text-sm font-normal text-muted-foreground tabular-nums">
              {entries.length}
            </span>
          ) : null}
        </>
      }
      description={
        entries.length
          ? 'A need, a wound, a dark mood or nothing to do, the worst first. Open someone for what would help.'
          : 'Nobody needs you right now.'
      }
    >
      {entries.length ? (
        <div className="flex flex-col">
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
                    className={cn(
                      '-mx-2 flex w-[calc(100%+1rem)] items-start gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-accent',
                      query && !matches(unit, query) && 'opacity-40',
                    )}
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
        </div>
      ) : null}
    </Section>
  )
}

const STRIP_SHOWN = 5

/** The worst few of `HelpList`, in a row, for the overview; each opens the dwarf's page. */
export const HelpStrip = ({ entries, className }: { entries: HelpEntry[]; className?: string }) => {
  const shown = entries.slice(0, STRIP_SHOWN)
  return (
    <Section
      className={cn('gap-3', className)}
      icon={<HandHelpingIcon className="size-4 text-primary" />}
      title={
        <>
          Could use your help
          <span className="text-sm font-normal text-muted-foreground tabular-nums">
            {entries.length}
          </span>
        </>
      }
      action={
        <Link
          to="/fortress/citizens"
          className="text-sm text-primary underline-offset-4 hover:underline"
        >
          {entries.length > shown.length
            ? `All ${entries.length} on the Citizens page`
            : 'More on the Citizens page'}
        </Link>
      }
    >
      <ul className="grid gap-x-4 gap-y-1 sm:grid-cols-2 lg:grid-cols-5">
        {shown.map(({ unit, concerns }) => {
          const worst = [...concerns].sort(
            (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
          )
          return (
            <li key={unit.id} className="min-w-0">
              <Link
                to="/fortress/citizens/$id"
                params={{ id: String(unit.id) }}
                className="-mx-2 flex h-full flex-col gap-1.5 rounded-md px-2 py-2 transition-colors hover:bg-accent"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <CreatureSprite unit={unit} size={24} className="shrink-0" />
                  <span className="truncate font-medium">{firstName(unit)}</span>
                </span>
                <ConcernBadges concerns={worst.slice(0, 2)} />
                {worst[0]?.hint ? (
                  <span className="line-clamp-2 text-sm text-muted-foreground">
                    {firstSentence(worst[0].hint)}
                  </span>
                ) : null}
              </Link>
            </li>
          )
        })}
      </ul>
    </Section>
  )
}

// ---------------------------------------------------------------------------
// Watch, arrivals, the young

const SketchLine = ({ unitId }: { unitId: number }) => {
  const sketch = useQuery({
    queryKey: ['fort', 'sketch', unitId],
    queryFn: () => getUnitSketch({ data: { unitId } }),
    staleTime: 30 * 60_000,
  })
  if (!sketch.data?.text) return null
  return (
    <span className="text-sm text-muted-foreground">
      {sketch.data.text} <span className="italic">A reading, not a fact from the game.</span>
    </span>
  )
}

const PersonRow = ({
  unit,
  onOpen,
  detail,
}: {
  unit: FortUnit
  onOpen: OpenUnit
  detail: React.ReactNode
}) => {
  const query = React.useContext(CitizenFilter)
  return (
    <li className={cn('min-w-0', query && !matches(unit, query) && 'opacity-40')}>
      <button
        type="button"
        onClick={() => onOpen(unit)}
        className="-mx-2 flex w-[calc(100%+1rem)] items-start gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-accent"
      >
        <CreatureSprite unit={unit} size={28} className="mt-0.5 shrink-0" />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="truncate font-medium">{unitDisplayName(unit)}</span>
            <span className="shrink-0 text-sm text-muted-foreground">{unit.profession}</span>
          </span>
          {detail}
        </span>
      </button>
    </li>
  )
}

/** Citizens you pinned with Watch. */
export const Watching = ({
  units,
  concerns,
  onOpen,
}: {
  units: FortUnit[]
  concerns: Map<number, Concern[]>
  onOpen: OpenUnit
}) => {
  return (
    <Section
      icon={<EyeIcon className="size-4 text-primary" />}
      title={
        <>
          You are watching
          {units.length ? (
            <span className="text-sm font-normal text-muted-foreground tabular-nums">
              {units.length}
            </span>
          ) : null}
        </>
      }
      description={
        units.length
          ? 'The dwarves you pinned. They come first in the chronicle and the glance window.'
          : 'Pin someone with Watch on their page and they will sit here.'
      }
    >
      {units.length ? (
        <ul className="grid gap-x-6 gap-y-0.5 lg:grid-cols-2">
          {units.map((unit) => {
            const list = concerns.get(unit.id) ?? []
            return (
              <PersonRow
                key={unit.id}
                unit={unit}
                onOpen={onOpen}
                detail={
                  <>
                    <span className="text-sm text-muted-foreground">
                      {stressLabel(unit.stress_category)}
                      {unit.job ? ` · ${unit.job}` : ''}
                    </span>
                    {list.length ? <ConcernBadges concerns={list} /> : null}
                    <SketchLine unitId={unit.id} />
                  </>
                }
              />
            )
          })}
        </ul>
      ) : null}
    </Section>
  )
}

/** Who joined the fortress this season, or the last wave the worker saw. */
export const JustArrived = ({
  arrivals,
  units,
  onOpen,
}: {
  arrivals: FortArrival[]
  units: FortUnit[]
  onOpen: OpenUnit
}) => {
  const byId = React.useMemo(() => new Map(units.map((unit) => [unit.id, unit])), [units])
  const rows = arrivals.flatMap((a) => {
    const unit = byId.get(a.unitId)
    return unit ? [{ unit, arrival: a }] : []
  })
  if (!rows.length) return null
  return (
    <Section
      icon={<FootprintsIcon className="size-4 text-primary" />}
      title={
        <>
          Just arrived
          <span className="text-sm font-normal text-muted-foreground tabular-nums">
            {rows.length}
          </span>
        </>
      }
      description="Who the worker saw join. Earlier waves from before it started are not here."
    >
      <ul className="grid gap-x-6 gap-y-0.5 lg:grid-cols-2">
        {rows.map(({ unit, arrival }) => (
          <PersonRow
            key={unit.id}
            unit={unit}
            onOpen={onOpen}
            detail={
              <span className="text-sm text-muted-foreground">
                Arrived {formatGameTick(arrival.year, arrival.tick)}
                {arrival.age !== null ? `, ${arrival.age} years old` : ''}
              </span>
            }
          />
        ))}
      </ul>
    </Section>
  )
}

/** Babies, children, and who is expecting. */
export const TheYoung = ({
  citizens,
  expecting,
  bonds,
  onOpen,
}: {
  citizens: FortUnit[]
  expecting: number[]
  bonds: FortBond[]
  onOpen: OpenUnit
}) => {
  const byId = React.useMemo(() => new Map(citizens.map((unit) => [unit.id, unit])), [citizens])
  const children = citizens.filter(
    (unit) => unit.flags.includes('child') || unit.flags.includes('baby'),
  )
  const mothers = expecting.flatMap((id) => {
    const unit = byId.get(id)
    return unit ? [unit] : []
  })
  if (!children.length && !mothers.length) return null
  const parentOf = (child: FortUnit): FortUnit | undefined => {
    const bond = bonds.find(
      (b) => b.to === child.id && /mother|father|parent/i.test(b.label) && byId.has(b.from),
    )
    return bond ? byId.get(bond.from) : undefined
  }
  return (
    <Section
      icon={<BabyIcon className="size-4 text-primary" />}
      title={
        <>
          The young
          <span className="text-sm font-normal text-muted-foreground tabular-nums">
            {children.length + mothers.length}
          </span>
        </>
      }
      description="Babies, children, and who is expecting."
    >
      <ul className="grid gap-x-6 gap-y-0.5 lg:grid-cols-2">
        {mothers.map((unit) => (
          <PersonRow
            key={`e${unit.id}`}
            unit={unit}
            onOpen={onOpen}
            detail={<span className="text-sm text-muted-foreground">Expecting a child</span>}
          />
        ))}
        {children.map((unit) => {
          const parent = parentOf(unit)
          return (
            <PersonRow
              key={unit.id}
              unit={unit}
              onOpen={onOpen}
              detail={
                <span className="text-sm text-muted-foreground">
                  {unit.flags.includes('baby') ? 'Baby' : `${Math.floor(unit.age)} years`}
                  {parent ? ` · child of ${firstName(parent)}` : ''}
                </span>
              }
            />
          )
        })}
      </ul>
    </Section>
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

  const trades = new Map<string, FortUnit[]>()
  const other: FortUnit[] = []
  for (const unit of citizens) {
    if (placed.has(unit.id)) continue
    if (unit.flags.includes('child') || unit.flags.includes('baby')) continue
    const trade = TRADES.find(([, test]) => test.test(unit.profession))?.[0]
    if (trade) trades.set(trade, [...(trades.get(trade) ?? []), unit])
    else other.push(unit)
  }
  for (const [label] of TRADES) {
    const members = trades.get(label)
    if (members?.length) groups.push({ key: label, label, units: members.sort(byName) })
  }
  if (other.length) groups.push({ key: 'other', label: 'Other work', units: other.sort(byName) })
  return groups
}

export const WorkGroups = ({ citizens, onOpen }: { citizens: FortUnit[]; onOpen: OpenUnit }) => {
  const query = React.useContext(CitizenFilter)
  const groups = React.useMemo(() => workGroups(citizens), [citizens])
  const idle = citizens.filter(isIdle).length
  return (
    <Section
      icon={<BriefcaseIcon className="size-4 text-primary" />}
      title="Who does what"
      description={
        <>
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
        </>
      }
    >
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
                    <UnitChip unit={unit} onOpen={onOpen} className={chipClass(unit, query)} />
                    <span className="text-sm text-muted-foreground">
                      {(group.offices.get(unit.id) ?? []).map(capitalize).join(', ')}
                    </span>
                  </span>
                ) : (
                  <UnitChip
                    key={unit.id}
                    unit={unit}
                    onOpen={onOpen}
                    className={chipClass(
                      unit,
                      query,
                      isIdle(unit) ? 'border-amber-500/70' : undefined,
                    )}
                  />
                ),
              )}
            </dd>
          </div>
        ))}
      </dl>
    </Section>
  )
}

// ---------------------------------------------------------------------------
// Squads

/** Each squad's alert routine, orders, uniform and who serves in it. */
export const Squads = ({
  squads,
  units,
  onOpen,
}: {
  squads: FortSquad[]
  units: FortUnit[]
  onOpen: OpenUnit
}) => {
  const query = React.useContext(CitizenFilter)
  const byId = React.useMemo(() => new Map(units.map((unit) => [unit.id, unit])), [units])
  if (!squads.length) return null
  return (
    <Section
      icon={<ShieldIcon className="size-4 text-primary" />}
      title={
        <>
          Squads
          <span className="text-sm font-normal text-muted-foreground tabular-nums">
            {squads.length}
          </span>
        </>
      }
      description={
        <>
          What each squad is doing, what it wears, and who serves. Soldiers with no equipment
          assigned are outlined in amber.
        </>
      }
    >
      <ul className="flex flex-col divide-y">
        {squads.map((squad) => {
          const uniforms = [...new Set(squad.members.map((m) => m.uniform).filter(Boolean))]
          const unequipped = squad.members.filter((m) => m.assigned_items === 0).length
          return (
            <li key={squad.id} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="font-medium">
                  {squad.alias || squad.name || `Squad ${squad.id}`}
                </span>
                {squad.alias && squad.name ? (
                  <span className="text-sm text-muted-foreground">{squad.name}</span>
                ) : null}
                <span className="text-sm text-muted-foreground tabular-nums">
                  {squad.members.length} of {squad.positions} filled
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 text-sm">
                {squad.routine ? <Badge variant="secondary">{squad.routine}</Badge> : null}
                {squad.orders.length ? (
                  squad.orders.map((order) => (
                    <Badge key={order} variant="outline">
                      {order}
                    </Badge>
                  ))
                ) : (
                  <span className="text-muted-foreground">no orders</span>
                )}
                {uniforms.length ? (
                  <span className="text-muted-foreground">· {uniforms.join(', ')}</span>
                ) : null}
                {unequipped ? (
                  <span className="text-amber-700 dark:text-amber-300">
                    · {unequipped} without equipment
                  </span>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {squad.members.map((member) => {
                  const unit = member.unit !== null ? byId.get(member.unit) : undefined
                  return unit ? (
                    <UnitChip
                      key={member.position}
                      unit={unit}
                      onOpen={onOpen}
                      className={chipClass(
                        unit,
                        query,
                        member.assigned_items === 0 ? 'border-amber-500/70' : undefined,
                      )}
                    />
                  ) : (
                    <span
                      key={member.position}
                      className="rounded-full border border-dashed px-2 py-0.5 text-sm text-muted-foreground"
                      title="Not on the map"
                    >
                      {member.name ?? `Position ${member.position + 1}`}
                    </span>
                  )
                })}
              </div>
            </li>
          )
        })}
      </ul>
    </Section>
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

export const SkillCoverage = ({
  citizens,
  wasted,
  loading,
  onOpen,
}: {
  citizens: FortUnit[]
  wasted: FortWastedTalent[]
  loading: boolean
  onOpen: OpenUnit
}) => {
  const query = React.useContext(CitizenFilter)
  const [allWasted, setAllWasted] = React.useState(false)
  const adults = React.useMemo(() => citizens.filter(isGrownCitizen), [citizens])
  const byId = React.useMemo(() => new Map(citizens.map((unit) => [unit.id, unit])), [citizens])
  const wastedKeys = new Set(wasted.map((w) => `${w.unitId}:${w.skill}`))
  const wastedRows = wasted.filter((w) => byId.has(w.unitId)).sort((a, b) => b.rating - a.rating)
  const shownWasted = capped(wastedRows, WASTED_SHOWN, allWasted)

  return (
    <Section
      icon={<GraduationCapIcon className="size-4 text-primary" />}
      title="Who is good at what"
      description="The best hand at each skill a fortress leans on, and how many others are competent."
    >
      <div className="flex flex-col gap-5">
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
                          <UnitChip
                            unit={best.unit}
                            onOpen={onOpen}
                            className={chipClass(best.unit, query)}
                          />
                          <span className="text-sm text-muted-foreground">
                            {skillRank(best.rating)}
                          </span>
                          {wastedKeys.has(`${best.unit.id}:${token}`) ? (
                            <>
                              <span className="text-xs text-amber-700 dark:text-amber-400">
                                labor off
                              </span>
                              <LaborButton unit={best.unit} skill={token} on />
                            </>
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
              Allow the work here, or add them to a work detail in the game.
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
                    <UnitChip unit={unit} onOpen={onOpen} className={chipClass(unit, query)} />
                    <span>
                      {skillRank(talent.rating)} at {skillLabel(talent.skill, unit)}
                    </span>
                    <LaborButton unit={unit} skill={talent.skill} on />
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
      </div>
    </Section>
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

const BondColumn = ({
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
}) => {
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

function familyLine(members: FortUnit[], bonds: FortBond[]): string {
  const children = members.filter(
    (unit) => unit.flags.includes('child') || unit.flags.includes('baby'),
  )
  const grown = members.filter((unit) => !children.includes(unit))
  const ids = new Set(members.map((unit) => unit.id))
  const spouse = bonds.find(
    (bond) =>
      ids.has(bond.from) && ids.has(bond.to) && /wife|husband|spouse|lover/i.test(bond.label),
  )
  if (spouse) {
    const a = members.find((unit) => unit.id === spouse.from)
    const b = members.find((unit) => unit.id === spouse.to)
    if (a && b) {
      const kids = children.length
        ? `, and their ${children.length === 1 ? 'child' : `${children.length} children`}`
        : ''
      return `${firstName(a)}, ${spouse.label.toLowerCase()} of ${firstName(b)}${kids}`
    }
  }
  if (grown.length && children.length)
    return `${grown.map(firstName).join(' and ')}, with ${children.length === 1 ? 'a child' : `${children.length} children`}`
  return members.map(firstName).join(', ')
}

export const Bonds = ({
  citizens,
  bonds,
  loading,
  onOpen,
}: {
  citizens: FortUnit[]
  bonds: FortBond[]
  loading: boolean
  onOpen: OpenUnit
}) => {
  const query = React.useContext(CitizenFilter)
  const [open, setOpen] = React.useState({ family: false, friends: false, foes: false })
  const byId = React.useMemo(() => new Map(citizens.map((unit) => [unit.id, unit])), [citizens])
  const families = React.useMemo(() => households(bonds, byId), [bonds, byId])
  const friends = React.useMemo(() => pairs(bonds, byId, 'friends'), [bonds, byId])
  const close = friends.filter((row) => row.close)
  const foes = React.useMemo(() => pairs(bonds, byId, 'foes'), [bonds, byId])
  const cap = <T,>(list: T[], all: boolean) => capped(list, BONDS_SHOWN, all)

  return (
    <Section
      icon={<HeartHandshakeIcon className="size-4 text-primary" />}
      title="Who they are to each other"
      description={
        <>
          Families, friendships and grudges between citizens, as each one's own memory has them.
          Grudges are where fights and tantrums start.
        </>
      }
    >
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
              <li key={members[0].id} className="flex flex-col gap-1.5 py-2 first:pt-0">
                <span className="text-sm text-muted-foreground">{familyLine(members, bonds)}</span>
                <span className="flex flex-wrap gap-1.5">
                  {members.map((unit) => (
                    <UnitChip
                      key={unit.id}
                      unit={unit}
                      onOpen={onOpen}
                      className={chipClass(unit, query)}
                    />
                  ))}
                </span>
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
                  <UnitChip unit={row.a} onOpen={onOpen} className={chipClass(row.a, query)} />
                  <UnitChip unit={row.b} onOpen={onOpen} className={chipClass(row.b, query)} />
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
                <UnitChip unit={row.a} onOpen={onOpen} className={chipClass(row.a, query)} />
                <span className="text-muted-foreground">{row.words}</span>
                <UnitChip unit={row.b} onOpen={onOpen} className={chipClass(row.b, query)} />
                {row.both ? <span className="text-muted-foreground">and back</span> : null}
              </li>
            ))}
          </BondColumn>
        </div>
      )}
    </Section>
  )
}
