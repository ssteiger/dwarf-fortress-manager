import type { FortBuilding, FortUnit } from '@fortress/db-drizzle'
import {
  Badge,
  DataTable,
  Skeleton,
  Stats,
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
  CheckIcon,
  CircleAlertIcon,
  DramaIcon,
  HammerIcon,
  HandHelpingIcon,
  MapIcon,
  SparklesIcon,
  UserIcon,
  UsersIcon,
} from 'lucide-react'
import * as React from 'react'

import { SectionGrid, SectionStack } from '~/lib/components/Section'
import { CreatureSprite, ItemSprite } from '~/lib/df-assets/components'
import { makeNameLinker, storyKind } from '~/lib/fortress/chronicle/announcements'
import { useFortOverview, useFortUnit, useFortUnits } from '~/lib/fortress/client/queries'
import {
  formatGameTick,
  formatValue,
  hungerState,
  isLiving,
  sexLabel,
  skillRank,
  sleepState,
  splitPascal,
  stressLabel,
  thirstState,
} from '~/lib/fortress/format'
import { unitStory } from '~/lib/fortress/people/activity'
import {
  careTips,
  injuries,
  needLevel,
  needWant,
  relations,
  skillName,
  syndromeNames,
} from '~/lib/fortress/people/character'
import { isHeadline, latestLifeSentence } from '~/lib/fortress/people/lifeEvents'
import { moodNeedsText, moodText, unitConcerns } from '~/lib/fortress/people/troubles'
import { firstName, isCitizenish, pronouns } from '~/lib/fortress/people/units'
import { getFortEvents } from '~/lib/fortress/server/events'
import { getUnitHistory } from '~/lib/fortress/server/history'
import { getNicknameReason } from '~/lib/fortress/server/nicknames'
import { getUnitSketch } from '~/lib/fortress/server/roleplay'
import type { CarriedItem, FortUnitDetail } from '~/lib/fortress/server/units'
import { type GameTime, gameTimeOf } from '~/lib/fortress/time'
import {
  EmptyState,
  Reading,
  SectionBoundary,
  UnitConditionBadges,
} from '../../-components/FortChrome'
import { AnnouncementText, StoryIcon } from '../../-components/Insights'
import { ActionsTab, ConcernRow } from './ActionsTab'
import { BodyTab } from './BodyTab'
import { LifeSection } from './LifeSection'
import { MindTab, ThoughtRow } from './MindTab'
import { PeopleTab } from './PeopleTab'
import { RolePlayTab } from './RolePlayTab'
import {
  Facts,
  Meter,
  Muted,
  PersonName,
  STANDING_BAR,
  STANDING_TEXT,
  Section,
  capitalize,
} from './SheetParts'
import type { UnitLegendsRef } from './UnitLinks'
import { FamousAncestorLine, WorldHistorySection } from './WorldHistory'

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

/** The coordinate the game gives a job that has no place yet, such as a strange mood's. */
const NO_POSITION = -30000

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

export const DwarfDetails = ({
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
}) => {
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
      <div className={cn('grid gap-4 p-4', compact ? 'grid-cols-1' : 'lg:grid-cols-3')}>
        <Skeleton className="h-48" />
        <Skeleton className="h-48" />
        <Skeleton className="h-48" />
      </div>
    )
  }

  const unit = data?.unit ?? null
  if (!unit) {
    return (
      <EmptyState title="Not in the last dump" className="m-4">
        There is no unit with id {unitId} in the fortress dump. They may have left the map, or no
        dump has been taken yet.
      </EmptyState>
    )
  }

  const archived = data?.archived ?? null
  const living = isLiving(unit)
  const concerns = archived ? [] : unitConcerns(unit, now)

  return (
    <SectionStack>
      <div className="p-4">
        <div className="flex flex-col gap-3">
          {archived ? <ArchivedNote unit={unit} archived={archived} /> : null}
          <OpeningStory unit={unit} now={now} />
          {isCitizenish(unit) ? (
            <FamousAncestorLine legends={legends} name={firstName(unit)} />
          ) : null}
          {archived ? null : concerns.length ? (
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
        </div>
      </div>

      <StatStrip unit={unit} detail={data} compact={compact} />

      <Tabs value={current} onValueChange={(v) => isDwarfTab(v) && setTab(v)} className="gap-0">
        <div className="border-b px-4 py-3">
          <TabsList className="h-auto w-full flex-wrap justify-start gap-0.5">
            {DWARF_TABS.map(({ key, label, Icon }) => (
              <TabsTrigger key={key} value={key} className="flex-none gap-1.5 px-2.5">
                <Icon className="size-3.5" aria-hidden />
                {label}
                {key === 'actions' && !archived && unit.sheet && !unit.sheet.error ? (
                  <TipCount unit={unit} />
                ) : null}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        <TabsContent value="overview">
          <SectionBoundary name="The overview">
            <OverviewTab
              unit={unit}
              detail={data}
              now={now}
              compact={compact}
              legends={legends}
              units={units}
              onTab={setTab}
            />
          </SectionBoundary>
        </TabsContent>
        <TabsContent value="mind">
          <SectionBoundary name="The mind tab">
            <MindTab unit={unit} now={now} compact={compact} legends={legends} />
          </SectionBoundary>
        </TabsContent>
        <TabsContent value="body">
          <SectionBoundary name="The skills and body tab">
            <BodyTab unit={unit} compact={compact} />
          </SectionBoundary>
        </TabsContent>
        <TabsContent value="people">
          <SectionBoundary name="The people tab">
            <PeopleTab unit={unit} units={units} compact={compact} />
          </SectionBoundary>
        </TabsContent>
        <TabsContent value="roleplay">
          <SectionBoundary name="The role play tab">
            <RolePlayTab unit={unit} now={now} compact={compact} />
          </SectionBoundary>
        </TabsContent>
        <TabsContent value="actions">
          <SectionBoundary name="The actions tab">
            <ActionsTab unit={unit} compact={compact} />
          </SectionBoundary>
        </TabsContent>
        <TabsContent value="gear">
          <SectionBoundary name="The gear tab">
            <GearTab detail={data} compact={compact} />
          </SectionBoundary>
        </TabsContent>
      </Tabs>
    </SectionStack>
  )
}

const OpeningStory = ({ unit, now }: { unit: FortUnit; now: GameTime | null }) => {
  const history = useQuery({
    queryKey: ['fort', 'unit-history', unit.id],
    queryFn: () => getUnitHistory({ data: { unitId: unit.id } }),
  })
  const sketch = useQuery({
    queryKey: ['fort', 'sketch', unit.id],
    queryFn: () => getUnitSketch({ data: { unitId: unit.id } }),
    staleTime: 30 * 60_000,
  })
  const latest = (history.data?.events ?? []).find(isHeadline)
  const extra = latest ? latestLifeSentence(latest, unit, now) : undefined
  return (
    <>
      <p className="text-base">{unitStory(unit, now, extra ? { latest: extra } : undefined)}</p>
      {sketch.data?.text ? (
        <p className="text-sm text-muted-foreground">
          {sketch.data.text} <span className="italic">A reading, not a fact from the game.</span>
        </p>
      ) : null}
    </>
  )
}

const ArchivedNote = ({
  unit,
  archived,
}: {
  unit: FortUnit
  archived: NonNullable<FortUnitDetail['archived']>
}) => {
  const p = pronouns(unit)
  const when = formatGameTick(archived.year, archived.tick)
  const what = archived.reason === 'died' ? 'died' : 'left the map'
  return (
    <p className="rounded-md bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
      {firstName(unit)} {what} on {when}. The game no longer lists {p.them}, so this page shows{' '}
      {p.them} as the worker last read {p.them}, before then.
    </p>
  )
}

const TipCount = ({ unit }: { unit: FortUnit }) => {
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

const StatStrip = ({
  unit,
  detail,
  compact,
}: {
  unit: FortUnit
  detail: FortUnitDetail | undefined
  compact?: boolean
}) => {
  const living = isLiving(unit)
  const sheet = unit.sheet && !unit.sheet.error ? unit.sheet : null
  const hurt = sheet ? injuries(sheet).length : unit.wounds
  const bloodPct =
    unit.blood !== null && unit.blood_max ? Math.round((unit.blood / unit.blood_max) * 100) : null
  const syndromes = sheet ? syndromeNames(sheet) : []
  const citizenish = isCitizenish(unit)
  return (
    <Stats className={cn(compact && 'grid-cols-2 sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-2')}>
      <Reading
        title="Doing"
        value={
          detail?.archived?.reason === 'left'
            ? 'Left the map'
            : living
              ? unit.strange_mood
                ? 'Strange mood'
                : unit.mood
                  ? (moodText(unit.mood)?.label ?? 'In a mood')
                  : unit.job
                    ? 'Working'
                    : 'Idle'
              : 'Dead'
        }
        hint={
          living && unit.job
            ? detail?.job && detail.job.x > NO_POSITION
              ? `${unit.job} · ${detail.job.x},${detail.job.y} z${detail.job.z}`
              : detail?.moodWorkshop
                ? `${unit.job} · ${buildingLabel(detail.moodWorkshop)}`
                : unit.job
            : (unit.squad ?? undefined)
        }
      />
      <Reading
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
      </Reading>
      <Reading
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
      <Reading
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
    </Stats>
  )
}

const OverviewTab = ({
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
}) => {
  const sheet = unit.sheet && !unit.sheet.error ? unit.sheet : null
  const bloodPct =
    unit.blood !== null && unit.blood_max ? Math.round((unit.blood / unit.blood_max) * 100) : null
  const unmet = sheet ? sheet.needs.filter((n) => n[1] < -999).slice(0, 4) : []
  const skills: [string, number][] = sheet
    ? sheet.skills.filter(([, r]) => r > 0).map(([t, r]) => [t, r])
    : unit.skills
  const civ = sheet?.groups.find(([, type, link]) => type === 'Civilization' && link === 'MEMBER')
  const nickname = unit.nickname?.trim() ?? ''
  const reason = useQuery({
    queryKey: ['fort', 'nickname-reason', unit.id],
    queryFn: () => getNicknameReason({ data: { unitId: unit.id } }),
    enabled: Boolean(nickname),
    staleTime: 60_000,
  })
  const named =
    reason.data && reason.data.nickname.toLowerCase() === nickname.toLowerCase()
      ? reason.data
      : null
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
    <SectionStack>
      {unit.strange_mood && isLiving(unit) ? (
        <StrangeMoodSection unit={unit} workshop={detail?.moodWorkshop ?? null} />
      ) : null}
      <SectionGrid className={compact ? 'grid-cols-1' : 'lg:grid-cols-3'}>
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
                label: 'Why the nickname',
                value: named?.why ? (
                  <>
                    {named.why}{' '}
                    <Link to="/nickname-dwarves" className="text-muted-foreground hover:underline">
                      Rename
                    </Link>
                  </>
                ) : null,
              },
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
          {['child', 'baby', 'merchant'].some((flag) => unit.flags.includes(flag)) ? (
            <div className="mt-4 flex flex-wrap gap-1.5">
              {unit.flags.includes('baby') ? <Badge variant="outline">Baby</Badge> : null}
              {unit.flags.includes('child') ? <Badge variant="outline">Child</Badge> : null}
              {unit.flags.includes('merchant') ? <Badge variant="outline">Merchant</Badge> : null}
            </div>
          ) : null}
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
      </SectionGrid>

      <SectionGrid className={compact ? 'grid-cols-1' : 'lg:grid-cols-2'}>
        {unit.thoughts?.length ? (
          <Section
            title="Lately"
            action={
              unit.thoughts.length > 6 ? tabLink('mind', `All ${unit.thoughts.length}`) : null
            }
          >
            <ul className="flex flex-col gap-2">
              {unit.thoughts.slice(0, 6).map((thought, i) => (
                <ThoughtRow
                  key={`${i}-${thought[0]}-${thought[3]}-${thought[4]}`}
                  thought={thought}
                  now={now}
                />
              ))}
            </ul>
          </Section>
        ) : null}
        <ChronicleSection unit={unit} legends={legends} compact={compact} units={units} />
      </SectionGrid>

      {isCitizenish(unit) ? <LifeSection unit={unit} units={units} compact={compact} /> : null}

      <ClosestPeople unit={unit} units={units} onTab={onTab} />

      {isCitizenish(unit) ? <WorldHistorySection legends={legends} units={units} /> : null}

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
    </SectionStack>
  )
}

const CLOSE_KIN = new Set(['SPOUSE', 'MOTHER', 'FATHER', 'CHILD', 'LOVER'])

const ClosestPeople = ({
  unit,
  units,
  onTab,
}: {
  unit: FortUnit
  units: Map<number, FortUnit>
  onTab: (tab: DwarfTab) => void
}) => {
  const sheet = unit.sheet && !unit.sheet.error ? unit.sheet : null
  if (!sheet) return null
  const all = relations(sheet)
  const family = all.filter((r) => CLOSE_KIN.has(r.person.kind))
  const friend = all.find((r) => r.group === 'friends')
  const shown = [...family, ...(friend && !family.includes(friend) ? [friend] : [])].slice(0, 8)
  if (!shown.length) return null
  return (
    <Section
      title="Closest people"
      action={
        <button
          type="button"
          className="text-primary underline-offset-4 hover:underline"
          onClick={() => onTab('people')}
        >
          Everyone they know
        </button>
      }
    >
      <ul className="flex flex-col gap-2 text-sm">
        {shown.map((r) => (
          <li
            key={`${r.person.kind}-${r.person.hf}`}
            className="flex flex-wrap items-baseline justify-between gap-x-3"
          >
            <PersonName person={r.person} units={units} />
            <span className="text-muted-foreground">
              {r.label}
              {r.detail ? ` · ${r.detail}` : ''}
            </span>
          </li>
        ))}
      </ul>
    </Section>
  )
}

/** What a dwarf in a strange mood demands, what they have, and what the stores hold. */
const StrangeMoodSection = ({
  unit,
  workshop,
}: { unit: FortUnit; workshop: FortBuilding | null }) => {
  const mood = unit.strange_mood
  if (!mood) return null
  const summary = moodNeedsText(mood)
  return (
    <Section
      title={
        <span className="flex items-center gap-2">
          <SparklesIcon className="size-4 text-primary" aria-hidden />
          {moodText(unit.mood)?.label ?? 'Strange mood'}
        </span>
      }
    >
      <div className="flex flex-col gap-4">
        {summary ? <p className="text-sm">{summary}</p> : null}
        <Facts
          items={[
            {
              label: 'Workshop',
              value: workshop ? (
                <span>
                  {buildingLabel(workshop)}
                  <span className="ml-2 font-mono text-xs text-muted-foreground">
                    {workshop.cx},{workshop.cy} z{workshop.z}
                  </span>
                </span>
              ) : (
                'not claimed yet'
              ),
            },
            { label: 'Skill', value: mood.skill ? skillName(mood.skill, unit) : null },
          ]}
        />
        {mood.needs.length ? (
          <ul className="flex flex-col divide-y text-sm">
            {mood.needs.map((need, i) => {
              const done = need.have >= need.need
              const none = !done && need.free === 0
              return (
                <li
                  // biome-ignore lint/suspicious/noArrayIndexKey: demands repeat (two rough gems) and keep their order
                  key={i}
                  className="flex items-center justify-between gap-3 py-1.5 first:pt-0 last:pb-0"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    {done ? (
                      <CheckIcon className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                    ) : (
                      <CircleAlertIcon
                        className={cn(
                          'size-4 shrink-0',
                          none ? 'text-red-600 dark:text-red-400' : 'text-amber-600',
                        )}
                      />
                    )}
                    <span className="truncate">
                      {need.need} {need.label}
                    </span>
                  </span>
                  <span
                    className={cn(
                      'shrink-0 tabular-nums',
                      none ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground',
                    )}
                  >
                    {done
                      ? 'brought'
                      : `${need.have} of ${need.need}${
                          need.free === undefined
                            ? ''
                            : need.free === 0
                              ? ' · none in the fortress'
                              : ` · ${need.free.toLocaleString()} in the stores`
                        }`}
                  </span>
                </li>
              )
            })}
          </ul>
        ) : null}
      </div>
    </Section>
  )
}

const ChronicleSection = ({
  unit,
  legends,
  compact,
  units,
}: {
  unit: FortUnit
  legends: UnitLegendsRef | null
  compact?: boolean
  units: Map<number, FortUnit>
}) => {
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

const GearTab = ({
  detail,
  compact,
}: { detail: FortUnitDetail | undefined; compact?: boolean }) => {
  const inventory = detail?.inventory ?? []
  const carriedValue = inventory.reduce((sum, row) => sum + (row.item?.value ?? 0), 0)
  return (
    <Section
      bleed
      title="Carried and worn"
      description={
        inventory.length
          ? `${inventory.length} item${inventory.length === 1 ? '' : 's'} · ${formatValue(carriedValue)}`
          : 'Nothing in their hands or on their person.'
      }
    >
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
    </Section>
  )
}

const NeedMeter = ({
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
}) => {
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
