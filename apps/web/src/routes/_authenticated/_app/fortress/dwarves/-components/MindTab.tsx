import type { FortUnit, UnitSheet } from '@fortress/db-drizzle'
import { Badge, cn } from '@fortress/ui'
import { LightbulbIcon } from 'lucide-react'

import {
  deityText,
  dreamText,
  needLevel,
  needText,
  preferenceGroups,
} from '~/lib/fortress/character'
import { facetPhrase, valuePhrase } from '~/lib/fortress/dossier'
import { formatGameTick, humanize, splitPascal } from '~/lib/fortress/format'
import {
  type GameTime,
  emotionTone,
  gameAgo,
  thoughtHint,
  thoughtPhrase,
} from '~/lib/fortress/insights'
import {
  Meter,
  Muted,
  STANDING_BAR,
  STANDING_TEXT,
  Section,
  SheetMissing,
  capitalize,
} from './SheetParts'

export function tokenLabel(token: string): string {
  if (token.includes('_')) return humanize(token)
  return splitPascal(token)
}

function facetLevel(value: number): string {
  if (value <= 24) return 'very low'
  if (value <= 40) return 'low'
  if (value >= 76) return 'very high'
  return 'high'
}

function focusStanding(focus: number) {
  if (focus >= 100) return 'good' as const
  if (focus >= 90) return 'ok' as const
  if (focus >= 75) return 'warning' as const
  return 'danger' as const
}

export function MindTab({
  unit,
  now,
  compact,
}: {
  unit: FortUnit
  now: GameTime | null
  compact?: boolean
}) {
  const sheet = unit.sheet && !unit.sheet.error ? unit.sheet : null
  const noMind = unit.traits == null && unit.values == null && unit.thoughts == null
  return (
    <div className={cn('grid gap-4', compact ? 'grid-cols-1' : 'lg:grid-cols-2')}>
      {sheet ? <NeedsSection unit={unit} sheet={sheet} /> : null}
      {noMind ? (
        <Muted>Personality and thoughts arrive with the next fortress dump.</Muted>
      ) : (
        <PersonalitySection unit={unit} />
      )}
      {sheet ? <DrivesSection unit={unit} sheet={sheet} /> : null}
      {sheet ? <LikesSection sheet={sheet} /> : null}
      {unit.thoughts?.length ? (
        <Section title="Thoughts" count={unit.thoughts.length}>
          <ul className="flex flex-col gap-2">
            {unit.thoughts.map((thought) => (
              <ThoughtRow
                key={`${thought[0]}-${thought[1]}-${thought[3]}-${thought[4]}`}
                thought={thought}
                now={now}
              />
            ))}
          </ul>
        </Section>
      ) : null}
      {sheet ? <MemoriesSection unit={unit} sheet={sheet} now={now} /> : null}
      {!sheet && !noMind ? (
        <div className={compact ? undefined : 'lg:col-span-2'}>
          <SheetMissing what="Needs, likes, dreams, faith and memories" />
        </div>
      ) : null}
    </div>
  )
}

function NeedsSection({ unit, sheet }: { unit: FortUnit; sheet: UnitSheet }) {
  if (!sheet.needs.length) return null
  const focus = sheet.focus
  const unmet = sheet.needs.filter((n) => n[1] < -999).length
  return (
    <Section
      title="Needs"
      count={unmet || undefined}
      action={
        focus !== null && focus !== undefined ? (
          <span
            className={cn('tabular-nums', STANDING_TEXT[focusStanding(focus)])}
            title="How well their needs are met, as the game weighs them. Below 100% they work less well."
          >
            Focus {focus}%
          </span>
        ) : null
      }
      description={
        unmet
          ? `${unmet} need${unmet === 1 ? '' : 's'} going unmet, least met first. Hover one for what helps.`
          : 'Every need is met well enough. Least met first.'
      }
    >
      <ul className="flex flex-col gap-2.5">
        {sheet.needs.map((need) => {
          const level = needLevel(need[1])
          const text = needText(need[0], unit)
          return (
            <li
              key={`${need[0]}-${need[3] ?? ''}`}
              className="flex flex-col gap-1"
              title={text.tip}
            >
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate">
                    {text.label}
                    {need[3] ? <span className="text-muted-foreground"> · {need[3]}</span> : null}
                  </span>
                  {need[2] >= 5 ? (
                    <Badge variant="outline" className="px-1.5 py-0 text-xs font-normal">
                      strong
                    </Badge>
                  ) : null}
                </span>
                <span className={cn('shrink-0', STANDING_TEXT[level.standing])}>{level.label}</span>
              </div>
              <Meter
                pct={level.bar}
                barClassName={STANDING_BAR[level.standing]}
                label={text.label}
              />
            </li>
          )
        })}
      </ul>
    </Section>
  )
}

function PersonalitySection({ unit }: { unit: FortUnit }) {
  const traits = unit.traits ?? []
  const values = unit.values ?? []
  if (!traits.length && !values.length) return null
  return (
    <Section title="Personality">
      <div className="flex flex-col gap-4">
        {traits.length ? (
          <ul className="flex flex-col gap-2">
            {traits.map(([facet, value]) => {
              const phrase = facetPhrase(unit, facet, value)
              const towardHigh = value >= 61
              const pct = Math.min(100, Math.round((Math.abs(value - 50) / 50) * 100))
              return (
                <li key={facet} className="flex flex-col gap-0.5 text-sm">
                  <div className="flex items-center gap-3">
                    <span className="min-w-0 flex-1 truncate">{tokenLabel(facet)}</span>
                    <span className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
                      <span
                        className={cn('block h-full', towardHigh ? 'bg-primary' : 'bg-amber-500')}
                        style={{ width: `${pct}%` }}
                      />
                    </span>
                    <span className="w-16 text-right text-muted-foreground">
                      {facetLevel(value)}
                    </span>
                  </div>
                  {phrase ? (
                    <span className="text-muted-foreground italic">{capitalize(phrase)}</span>
                  ) : null}
                </li>
              )
            })}
          </ul>
        ) : null}
        {values.length ? (
          <div>
            <div className="mb-1.5 text-sm font-medium text-muted-foreground">Beliefs</div>
            <ul className="flex flex-col gap-1.5 text-sm">
              {values.map(([value, strength]) => {
                const phrase = valuePhrase(unit, value, strength)
                return (
                  <li key={value} className="flex flex-col gap-0.5">
                    <div className="flex items-baseline justify-between gap-3">
                      <span>{tokenLabel(value)}</span>
                      <span
                        className={
                          strength < 0
                            ? 'text-amber-700 dark:text-amber-300'
                            : 'text-muted-foreground'
                        }
                      >
                        {Math.abs(strength) >= 41 ? 'strongly ' : ''}
                        {strength < 0 ? 'rejects it' : 'holds it'}
                      </span>
                    </div>
                    {phrase ? (
                      <span className="text-muted-foreground italic">{capitalize(phrase)}</span>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          </div>
        ) : null}
      </div>
    </Section>
  )
}

function DrivesSection({ unit, sheet }: { unit: FortUnit; sheet: UnitSheet }) {
  const religions = sheet.groups.filter(
    ([, type, link]) => type === 'Religion' && !/^FORMER/.test(link),
  )
  if (!sheet.dreams.length && !sheet.deities.length && !religions.length) return null
  return (
    <Section title="Dreams and faith">
      <div className="flex flex-col gap-3 text-sm">
        {sheet.dreams.map((dream) => (
          <p key={dream[0]} className="leading-relaxed">
            {capitalize(dreamText(dream, unit))}
            {dream[1] ? (
              <Badge variant="secondary" className="ml-2 font-normal">
                realised
              </Badge>
            ) : null}
          </p>
        ))}
        {sheet.deities.length ? (
          <ul className="flex flex-col gap-2">
            {sheet.deities.map((deity) => (
              <li key={deity[0]} className="flex flex-col gap-1">
                <span>{deityText(deity)}</span>
                <Meter pct={deity[1]} className="max-w-48" label={`Devotion to ${deity[0]}`} />
              </li>
            ))}
          </ul>
        ) : (
          <Muted>They worship no god.</Muted>
        )}
        {religions.map(([name]) => (
          <p key={name}>Member of {name}</p>
        ))}
      </div>
    </Section>
  )
}

function LikesSection({ sheet }: { sheet: UnitSheet }) {
  const groups = preferenceGroups(sheet)
  if (!groups.length) return null
  return (
    <Section title="Likes and dislikes">
      <div className="flex flex-col gap-3">
        {groups.map((group) => (
          <div key={group.key}>
            <div className="mb-1 text-sm font-medium text-muted-foreground">{group.label}</div>
            <div className="flex flex-wrap gap-1.5">
              {group.items.map((item) => (
                <Badge
                  key={item}
                  variant="outline"
                  className={cn(
                    'font-normal',
                    group.key === 'hates' && 'border-red-500/40 text-red-700 dark:text-red-300',
                  )}
                >
                  {item}
                </Badge>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Section>
  )
}

function MemoriesSection({
  unit,
  sheet,
  now,
}: {
  unit: FortUnit
  sheet: UnitSheet
  now: GameTime | null
}) {
  const memories = sheet.memories ?? []
  const core = sheet.core_memories ?? []
  if (!memories.length && !core.length) return null
  const long = memories.filter((m) => m[5] === 'long')
  const short = memories.filter((m) => m[5] === 'short')
  return (
    <Section
      title="Memories"
      description="What stays with them after the thought has passed. Long-term memories can resurface for years."
    >
      <div className="flex flex-col gap-4">
        {core.length ? (
          <div>
            <div className="mb-1.5 text-sm font-medium text-muted-foreground">Changed them</div>
            <ul className="flex flex-col gap-1.5 text-sm">
              {core.map(([thought, emotion, year, tick, facet, from, to, value]) => (
                <li key={`${thought}-${year}-${tick}`}>
                  {capitalize(thoughtPhrase(thought, emotion))}
                  <span className="text-muted-foreground">
                    {' '}
                    · {gameAgo({ year, tick }, now) ?? formatGameTick(year, tick)}
                    {facet && from !== null && to !== null
                      ? ` · ${tokenLabel(facet).toLowerCase()} ${to > from ? 'rose' : 'fell'} from ${from} to ${to}`
                      : value
                        ? ` · changed their view of ${tokenLabel(value).toLowerCase()}`
                        : ''}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <MemoryList label="Long-term" memories={long} now={now} />
        <MemoryList label="Recent" memories={short} now={now} />
        {unit.flags.includes('insane') ? (
          <Muted>Their mind is gone; memories no longer move them.</Muted>
        ) : null}
      </div>
    </Section>
  )
}

function MemoryList({
  label,
  memories,
  now,
}: {
  label: string
  memories: NonNullable<UnitSheet['memories']>
  now: GameTime | null
}) {
  if (!memories.length) return null
  return (
    <div>
      <div className="mb-1.5 text-sm font-medium text-muted-foreground">{label}</div>
      <ul className="flex flex-col gap-1.5">
        {memories.map(([thought, emotion, , year, tick]) => (
          <ThoughtRow
            key={`${thought}-${emotion}-${year}-${tick}`}
            thought={[thought, emotion, 0, year, tick]}
            now={now}
            hideHint
          />
        ))}
      </ul>
    </div>
  )
}

export function ThoughtRow({
  thought,
  now,
  hideHint,
}: {
  thought: [string, string, number, number, number]
  now: GameTime | null
  hideHint?: boolean
}) {
  const [name, emotion, , year, tick] = thought
  const tone = emotionTone(emotion)
  const phrase = thoughtPhrase(name, emotion)
  const hint = tone === 'bad' && !hideHint ? thoughtHint(name) : undefined
  return (
    <li className="flex flex-col gap-0.5 text-sm">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <span className="min-w-0 flex-1">{capitalize(phrase)}</span>
        {emotion ? (
          <span
            className={cn(
              tone === 'bad' && 'text-red-600 dark:text-red-400',
              tone === 'good' && 'text-emerald-700 dark:text-emerald-400',
              tone === 'neutral' && 'text-muted-foreground',
            )}
          >
            {tokenLabel(emotion).toLowerCase()}
          </span>
        ) : null}
        <span className="tabular-nums text-muted-foreground" title={formatGameTick(year, tick)}>
          {gameAgo({ year, tick }, now) ?? formatGameTick(year, tick)}
        </span>
      </div>
      {hint ? (
        <span className="flex gap-1.5 text-xs text-muted-foreground">
          <LightbulbIcon className="mt-px size-3 shrink-0 text-primary" aria-hidden />
          {hint}
        </span>
      ) : null}
    </li>
  )
}
