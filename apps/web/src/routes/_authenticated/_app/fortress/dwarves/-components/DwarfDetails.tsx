import type { FortBuilding, FortUnit } from '@fortress/db-drizzle'
import {
  Badge,
  Card,
  CardContent,
  DataTable,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  cn,
} from '@fortress/ui'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import type { ColumnDef } from '@tanstack/react-table'
import {
  BackpackIcon,
  BrainIcon,
  DramaIcon,
  HammerIcon,
  HandHelpingIcon,
  MapIcon,
  UserIcon,
  UsersIcon,
} from 'lucide-react'
import * as React from 'react'

import { CreatureSprite, ItemSprite } from '~/lib/df-assets/components'
import {
  careTips,
  injuries,
  needLevel,
  needWant,
  skillName,
  syndromeNames,
} from '~/lib/fortress/character'
import {
  formatGameTick,
  formatValue,
  humanize,
  hungerState,
  isLiving,
  sexLabel,
  skillRank,
  sleepState,
  splitPascal,
  stressLabel,
  thirstState,
} from '~/lib/fortress/format'
import {
  type GameTime,
  gameTimeOf,
  isCitizenish,
  makeNameLinker,
  storyKind,
  unitConcerns,
  unitStory,
} from '~/lib/fortress/insights'
import { useFortOverview, useFortUnit, useFortUnits } from '~/lib/fortress/queries'
import { type CarriedItem, type FortUnitDetail, getFortEvents } from '~/lib/fortress/server'
import { EmptyState, StatCard, UnitConditionBadges } from '../../-components/FortChrome'
import { AnnouncementText, StoryIcon } from '../../-components/Insights'
import { ActionsTab, ConcernRow } from './ActionsTab'
import { BodyTab } from './BodyTab'
import { MindTab, ThoughtRow } from './MindTab'
import { PeopleTab } from './PeopleTab'
import { RolePlayTab } from './RolePlayTab'
import { Facts, Meter, Muted, STANDING_BAR, STANDING_TEXT, Section, capitalize } from './SheetParts'
import type { UnitLegendsRef } from './UnitLinks'

export type DwarfTab = 'overview' | 'mind' | 'body' | 'people' | 'roleplay' | 'actions' | 'gear'

export const DWARF_TABS: { key: DwarfTab; label: string; Icon: typeof UserIcon }[] = [
  { key: 'overview', label: 'Overview', Icon: UserIcon },
  { key: 'mind', label: 'Mind', Icon: BrainIcon },
  { key: 'body', label: 'Skills & body', Icon: HammerIcon },
  { key: 'people', label: 'People', Icon: UsersIcon },
  { key: 'roleplay', label: 'Role play', Icon: DramaIcon },
  { key: 'actions', label: 'Actions', Icon: HandHelpingIcon },
  { key: 'gear', label: 'Gear', Icon: BackpackIcon },
]

export function isDwarfTab(value: unknown): value is DwarfTab {
  return DWARF_TABS.some((t) => t.key === value)
}

const HUNGER_DANGER = 75_000
const THIRST_DANGER = 50_000
const SLEEP_DANGER = 150_000

function buildingLabel(building: FortBuilding): string {
  if (building.custom) return building.custom
  if (building.name) return building.name
  if (building.type === 'Civzone') return `${splitPascal(building.subtype)} zone`
  if (building.subtype) {
    return `${splitPascal(building.subtype)}${building.type === 'Workshop' || building.type === 'Furnace' ? ` ${building.type.toLowerCase()}` : ''}`
  }
  return splitPascal(building.type)
}

const INVENTORY_COLUMNS: ColumnDef<CarriedItem>[] = [
  {
    id: 'item',
    header: 'Item',
    accessorFn: (row) => row.item?.description ?? `#${row.itemId}`,
    meta: { cellClassName: 'max-w-[320px] font-medium' },
    cell: ({ row }) => (
      <span className="flex items-center gap-2">
        {row.original.item ? (
          <ItemSprite item={row.original.item} size={24} className="-my-1" />
        ) : null}
        {row.original.item ? (
          <Link
            to="/fortress/items/$id"
            params={{ id: String(row.original.itemId) }}
            className="truncate hover:underline"
          >
            {row.original.item.description}
          </Link>
        ) : (
          <span className="truncate">#{row.original.itemId}</span>
        )}
      </span>
    ),
  },
  {
    id: 'mode',
    header: 'How held',
    accessorFn: (row) => splitPascal(row.mode) || row.mode,
    meta: { cellClassName: 'text-sm' },
  },
  {
    id: 'material',
    header: 'Material',
    accessorFn: (row) => row.item?.material ?? '',
    meta: { cellClassName: 'max-w-[200px] truncate text-sm' },
    cell: ({ row }) => row.original.item?.material || '—',
  },
  {
    id: 'quality',
    header: 'Quality',
    accessorFn: (row) => row.item?.quality ?? '',
    meta: { cellClassName: 'text-sm' },
    cell: ({ row }) => {
      const item = row.original.item
      if (!item) return '—'
      return (
        <>
          {item.quality !== 'Ordinary' ? (
            item.quality
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
          {item.wear > 0 ? (
            <span className="ml-1 text-xs text-amber-600">worn {item.wear}</span>
          ) : null}
        </>
      )
    },
  },
  {
    id: 'value',
    header: 'Value',
    accessorFn: (row) => row.item?.value ?? 0,
    meta: { align: 'right', cellClassName: 'tabular-nums' },
    cell: ({ row }) => (row.original.item ? formatValue(row.original.item.value) : '—'),
  },
]

export function DwarfDetails({
  unitId,
  compact,
  legends = null,
  tab,
  onTabChange,
}: {
  unitId: number
  compact?: boolean
  legends?: UnitLegendsRef | null
  /** Controlled tab, e.g. from the URL; otherwise the component keeps its own. */
  tab?: DwarfTab
  onTabChange?: (tab: DwarfTab) => void
}) {
  const { data, isLoading } = useFortUnit(unitId)
  const overview = useFortOverview()
  const everyone = useFortUnits()
  const now = gameTimeOf(overview.data?.state)
  const [ownTab, setOwnTab] = React.useState<DwarfTab>('overview')
  const current = tab ?? ownTab
  const setTab = (next: DwarfTab) => (onTabChange ? onTabChange(next) : setOwnTab(next))
  const units = React.useMemo(
    () => new Map((everyone.data?.units ?? []).map((u) => [u.id, u])),
    [everyone.data],
  )

  if (isLoading) {
    return (
      <div className={cn('grid gap-4', compact ? 'grid-cols-1' : 'lg:grid-cols-3')}>
        <Skeleton className="h-48" />
        <Skeleton className="h-48" />
        <Skeleton className="h-48" />
      </div>
    )
  }

  const unit = data?.unit ?? null
  if (!unit) {
    return (
      <EmptyState title="Not in the last dump">
        There is no unit with id {unitId} in the fortress dump. They may have left the map, or no
        dump has been taken yet.
      </EmptyState>
    )
  }

  const living = isLiving(unit)
  const concerns = unitConcerns(unit, now)

  return (
    <div className="flex flex-col gap-4">
      <Card className="gap-3 py-4">
        <CardContent className="flex flex-col gap-3 px-4">
          <p className="text-base leading-relaxed">{unitStory(unit, now)}</p>
          {concerns.length ? (
            <ul className="flex flex-col gap-2">
              {concerns.map((c) => (
                <ConcernRow key={c.key} concern={c} unit={unit} />
              ))}
            </ul>
          ) : living && isCitizenish(unit) ? (
            <p className="text-sm text-muted-foreground">
              Nothing troubles them that you could fix.
            </p>
          ) : null}
        </CardContent>
      </Card>

      <StatStrip unit={unit} detail={data} compact={compact} />

      <Tabs value={current} onValueChange={(v) => isDwarfTab(v) && setTab(v)} className="gap-4">
        <TabsList className="h-auto w-full flex-wrap justify-start gap-0.5">
          {DWARF_TABS.map(({ key, label, Icon }) => (
            <TabsTrigger key={key} value={key} className="flex-none gap-1.5 px-2.5">
              <Icon className="size-3.5" aria-hidden />
              {label}
              {key === 'actions' && unit.sheet && !unit.sheet.error ? (
                <TipCount unit={unit} />
              ) : null}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="overview">
          <OverviewTab
            unit={unit}
            detail={data}
            now={now}
            compact={compact}
            legends={legends}
            units={units}
            onTab={setTab}
          />
        </TabsContent>
        <TabsContent value="mind">
          <MindTab unit={unit} now={now} compact={compact} />
        </TabsContent>
        <TabsContent value="body">
          <BodyTab unit={unit} compact={compact} />
        </TabsContent>
        <TabsContent value="people">
          <PeopleTab unit={unit} units={units} compact={compact} />
        </TabsContent>
        <TabsContent value="roleplay">
          <RolePlayTab unit={unit} now={now} compact={compact} />
        </TabsContent>
        <TabsContent value="actions">
          <ActionsTab unit={unit} compact={compact} />
        </TabsContent>
        <TabsContent value="gear">
          <GearTab detail={data} compact={compact} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

function TipCount({ unit }: { unit: FortUnit }) {
  const count = unit.sheet
    ? careTips(unit, unit.sheet).filter((t) => t.standing !== 'ok').length
    : 0
  if (!count) return null
  return (
    <span className="rounded-full bg-amber-400/90 px-1.5 text-xs font-semibold text-black tabular-nums">
      {count}
    </span>
  )
}

function StatStrip({
  unit,
  detail,
  compact,
}: {
  unit: FortUnit
  detail: FortUnitDetail | undefined
  compact?: boolean
}) {
  const living = isLiving(unit)
  const sheet = unit.sheet && !unit.sheet.error ? unit.sheet : null
  const hurt = sheet ? injuries(sheet).length : unit.wounds
  const bloodPct =
    unit.blood !== null && unit.blood_max ? Math.round((unit.blood / unit.blood_max) * 100) : null
  const syndromes = sheet ? syndromeNames(sheet) : []
  const citizenish = isCitizenish(unit)
  return (
    <div className={cn('grid gap-4', compact ? 'grid-cols-2' : 'sm:grid-cols-2 lg:grid-cols-4')}>
      <StatCard
        title="Doing"
        value={living ? (unit.mood ? 'Strange mood' : unit.job ? 'Working' : 'Idle') : 'Dead'}
        hint={
          living && unit.job
            ? detail?.job
              ? `${unit.job} · ${detail.job.x},${detail.job.y} z${detail.job.z}`
              : unit.job
            : (unit.squad ?? undefined)
        }
      />
      <StatCard
        title="Condition"
        value={hurt > 0 ? `${hurt} wound${hurt === 1 ? '' : 's'}` : 'Unhurt'}
        hint={
          [
            bloodPct !== null && bloodPct < 100 ? `blood ${bloodPct}%` : null,
            syndromes.includes('inebriation') ? 'had a drink' : null,
            sheet?.pregnant ? 'expecting' : null,
          ]
            .filter(Boolean)
            .join(' · ') || undefined
        }
      >
        <div className="mt-3">
          <UnitConditionBadges unit={unit} />
        </div>
      </StatCard>
      <StatCard
        title={citizenish ? 'Mood' : 'Stress'}
        value={
          citizenish ? capitalize(stressLabel(unit.stress_category)) : unit.stress.toLocaleString()
        }
        hint={
          citizenish
            ? [
                `stress ${unit.stress.toLocaleString()}`,
                sheet?.focus !== null && sheet?.focus !== undefined
                  ? `focus ${sheet.focus}%`
                  : null,
              ]
                .filter(Boolean)
                .join(' · ')
            : unit.positions.length
              ? unit.positions.join(', ')
              : undefined
        }
      />
      <StatCard
        title="Where"
        value={
          unit.x !== null ? (
            <span className={cn('font-mono', compact ? 'text-lg' : 'text-xl')}>
              {unit.x},{unit.y} z{unit.z}
            </span>
          ) : (
            '—'
          )
        }
        hint={
          unit.x !== null ? (
            <Link
              to="/fortress/map"
              className="inline-flex items-center gap-1 hover:text-foreground hover:underline"
            >
              <MapIcon className="size-3.5" />
              Open map
            </Link>
          ) : undefined
        }
      />
    </div>
  )
}

function OverviewTab({
  unit,
  detail,
  now,
  compact,
  legends,
  units,
  onTab,
}: {
  unit: FortUnit
  detail: FortUnitDetail | undefined
  now: GameTime | null
  compact?: boolean
  legends: UnitLegendsRef | null
  units: Map<number, FortUnit>
  onTab: (tab: DwarfTab) => void
}) {
  const sheet = unit.sheet && !unit.sheet.error ? unit.sheet : null
  const bloodPct =
    unit.blood !== null && unit.blood_max ? Math.round((unit.blood / unit.blood_max) * 100) : null
  const unmet = sheet ? sheet.needs.filter((n) => n[1] < -999).slice(0, 4) : []
  const skills: [string, number][] = sheet
    ? sheet.skills.filter(([, r]) => r > 0).map(([t, r]) => [t, r])
    : unit.skills
  const civ = sheet?.groups.find(([, type, link]) => type === 'Civilization' && link === 'MEMBER')
  const tabLink = (tab: DwarfTab, label: string) => (
    <button
      type="button"
      className="text-primary underline-offset-4 hover:underline"
      onClick={() => onTab(tab)}
    >
      {label}
    </button>
  )
  return (
    <div className="flex flex-col gap-4">
      <div className={cn('grid gap-4', compact ? 'grid-cols-1' : 'lg:grid-cols-3')}>
        <Section
          title={
            <span className="flex w-full items-center justify-between gap-3">
              Who they are
              <CreatureSprite unit={unit} size={48} title={`${unit.race} as drawn in the game`} />
            </span>
          }
        >
          <Facts
            items={[
              { label: 'Name', value: unit.readable },
              {
                label: 'In plain words',
                value:
                  unit.name_english && unit.name_english !== unit.name ? unit.name_english : null,
              },
              {
                label: 'Race',
                value: `${unit.race}${unit.caste ? ` · ${unit.caste}` : ''}`,
              },
              { label: 'Sex', value: sexLabel(unit.sex) },
              {
                label: 'Age',
                value: `${Math.floor(unit.age)} years${sheet?.birth ? `, born ${formatGameTick(sheet.birth[0], sheet.birth[1])}` : ''}`,
              },
              {
                label: sheet?.custom_profession ? 'Title' : 'Profession',
                value: unit.profession,
              },
              {
                label: 'Office',
                value: unit.positions.length ? unit.positions.join(', ') : null,
              },
              { label: 'Squad', value: unit.squad },
              {
                label: 'Work details',
                value: sheet?.work_details.length ? sheet.work_details.join(', ') : null,
              },
              { label: 'Of', value: civ?.[0] },
              { label: 'Kills', value: sheet?.kills ? sheet.kills.toLocaleString() : null },
            ]}
          />
          <div className="mt-4 flex flex-wrap gap-1.5">
            {unit.flags.map((flag) => (
              <Badge key={flag} variant="outline">
                {humanize(flag)}
              </Badge>
            ))}
          </div>
        </Section>

        <Section title="Needs" action={sheet?.needs.length ? tabLink('mind', 'All needs') : null}>
          <div className="flex flex-col gap-4">
            <NeedMeter
              label="Hunger"
              timer={unit.hunger}
              dangerAt={HUNGER_DANGER}
              state={hungerState(unit.hunger)}
            />
            <NeedMeter
              label="Thirst"
              timer={unit.thirst}
              dangerAt={THIRST_DANGER}
              state={thirstState(unit.thirst)}
            />
            <NeedMeter
              label="Sleep"
              timer={unit.sleepiness}
              dangerAt={SLEEP_DANGER}
              state={sleepState(unit.sleepiness)}
            />
            {bloodPct !== null ? (
              <NeedMeter
                label="Blood"
                filled={bloodPct}
                state={
                  bloodPct < 50
                    ? { label: `${bloodPct}%`, severity: 'danger' }
                    : bloodPct < 80
                      ? { label: `${bloodPct}%`, severity: 'warning' }
                      : { label: `${bloodPct}%`, severity: 'ok' }
                }
              />
            ) : null}
            {unmet.length ? (
              <div className="border-t pt-3">
                <div className="mb-2 text-sm font-medium text-muted-foreground">Longs to</div>
                <ul className="flex flex-col gap-2">
                  {unmet.map((need) => {
                    const level = needLevel(need[1])
                    return (
                      <li key={`${need[0]}-${need[3] ?? ''}`} className="flex flex-col gap-1">
                        <div className="flex items-baseline justify-between gap-3 text-sm">
                          <span className="min-w-0 truncate">
                            {capitalize(needWant(need, unit))}
                          </span>
                          <span className={cn('shrink-0', STANDING_TEXT[level.standing])}>
                            {level.label}
                          </span>
                        </div>
                        <Meter pct={level.bar} barClassName={STANDING_BAR[level.standing]} />
                      </li>
                    )
                  })}
                </ul>
              </div>
            ) : null}
          </div>
        </Section>

        <Section
          title="Best at"
          count={skills.length}
          action={skills.length ? tabLink('body', 'All skills') : null}
        >
          {skills.length ? (
            <ul className="flex flex-col gap-1.5 text-sm">
              {skills.slice(0, 10).map(([skill, rating]) => (
                <li key={skill} className="flex items-baseline justify-between gap-3">
                  <span>{skillName(skill, unit)}</span>
                  <span className="text-muted-foreground tabular-nums">{skillRank(rating)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <Muted>No skills recorded.</Muted>
          )}
        </Section>
      </div>

      <div className={cn('grid gap-4', compact ? 'grid-cols-1' : 'lg:grid-cols-2')}>
        {unit.thoughts?.length ? (
          <Section
            title="Lately"
            action={
              unit.thoughts.length > 6 ? tabLink('mind', `All ${unit.thoughts.length}`) : null
            }
          >
            <ul className="flex flex-col gap-2">
              {unit.thoughts.slice(0, 6).map((thought) => (
                <ThoughtRow
                  key={`${thought[0]}-${thought[1]}-${thought[3]}-${thought[4]}`}
                  thought={thought}
                  now={now}
                />
              ))}
            </ul>
          </Section>
        ) : null}
        <ChronicleSection unit={unit} legends={legends} compact={compact} units={units} />
      </div>

      {detail?.buildings.length ? (
        <Section title="Rooms and workshops">
          <div className="flex flex-wrap gap-2">
            {detail.buildings.map((building) => (
              <Badge key={building.id} variant="secondary" className="gap-1.5 font-normal">
                {buildingLabel(building)}
                <span className="font-mono text-xs opacity-70">
                  {building.cx},{building.cy} z{building.z}
                </span>
              </Badge>
            ))}
          </div>
        </Section>
      ) : null}
    </div>
  )
}

function ChronicleSection({
  unit,
  legends,
  compact,
  units,
}: {
  unit: FortUnit
  legends: UnitLegendsRef | null
  compact?: boolean
  units: Map<number, FortUnit>
}) {
  const link = React.useMemo(() => makeNameLinker([...units.values()]), [units])
  const mentionedName = unit.name.trim()
  const mentions = useQuery({
    queryKey: ['fort', 'events', 'unit', mentionedName],
    queryFn: () =>
      getFortEvents({
        data: {
          unitName: mentionedName,
          fortressOnly: true,
          withoutCancellations: true,
          limit: 12,
        },
      }),
    enabled: mentionedName.length > 0,
    staleTime: 30_000,
  })
  if (!mentionedName && !legends) return null
  return (
    <Section
      title="In the chronicle"
      action={
        <span className="flex items-center gap-3">
          {legends ? (
            <Link
              to="/legends/$kind/$id"
              params={{ kind: 'historical_figure', id: String(legends.figureId) }}
              search={{ world: legends.worldId }}
              className="text-primary underline-offset-4 hover:underline"
            >
              Their legends
            </Link>
          ) : null}
          {mentionedName ? (
            <Link
              to="/fortress/chronicle"
              search={{ q: mentionedName, filter: 'all' }}
              className="text-primary underline-offset-4 hover:underline"
            >
              All events
            </Link>
          ) : null}
        </span>
      }
    >
      {mentionedName ? (
        mentions.data?.length ? (
          <ul className="flex flex-col gap-2 text-sm">
            {mentions.data.slice(0, compact ? 5 : 12).map((event) => (
              <li key={event.id} className="flex gap-3">
                <StoryIcon kind={storyKind(event)} className="mt-0.5" />
                <span className="min-w-0 flex-1">
                  <AnnouncementText parts={link(event.text)} />
                </span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {formatGameTick(event.game_year, event.game_tick) || '—'}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <Muted>
            {mentions.isLoading
              ? 'Looking through the chronicle…'
              : 'The chronicle has not mentioned them yet.'}
          </Muted>
        )
      ) : (
        <Muted>No name for the chronicle to quote. Their legends are linked above.</Muted>
      )}
    </Section>
  )
}

function GearTab({ detail, compact }: { detail: FortUnitDetail | undefined; compact?: boolean }) {
  const inventory = detail?.inventory ?? []
  const carriedValue = inventory.reduce((sum, row) => sum + (row.item?.value ?? 0), 0)
  return (
    <Card className="overflow-hidden p-0">
      <div className="border-b px-5 py-4">
        <div className="text-base font-semibold">Carried and worn</div>
        <p className="mt-1 text-sm text-muted-foreground">
          {inventory.length
            ? `${inventory.length} item${inventory.length === 1 ? '' : 's'} · ${formatValue(carriedValue)}`
            : 'Nothing in their hands or on their person.'}
        </p>
      </div>
      {inventory.length ? (
        <DataTable
          data={inventory}
          columns={INVENTORY_COLUMNS}
          showSelectColumn={false}
          showActionsColumn={false}
          showToolbar={false}
          enableSortingRemoval={false}
          defaultSort={[{ id: 'value', desc: true }]}
          getRowId={(row) => String(row.itemId)}
          pageSize={compact ? 25 : 50}
        />
      ) : null}
    </Card>
  )
}

function NeedMeter({
  label,
  timer,
  dangerAt,
  filled,
  state,
}: {
  label: string
  timer?: number
  dangerAt?: number
  filled?: number
  state: { label: string; severity: 'ok' | 'warning' | 'danger' } | null
}) {
  const pct =
    filled ??
    100 - Math.min(100, Math.max(0, dangerAt ? Math.round(((timer ?? 0) / dangerAt) * 100) : 0))
  const severity = state?.severity ?? 'ok'
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span>{label}</span>
        <span
          className={cn(
            'tabular-nums',
            severity === 'danger' && 'text-red-600 dark:text-red-400',
            severity === 'warning' && 'text-amber-700 dark:text-amber-300',
            severity === 'ok' && 'text-muted-foreground',
          )}
        >
          {state?.label ?? 'Fine'}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            'h-full rounded-full',
            severity === 'danger' && 'bg-red-500',
            severity === 'warning' && 'bg-amber-400',
            severity === 'ok' && 'bg-emerald-500',
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}
