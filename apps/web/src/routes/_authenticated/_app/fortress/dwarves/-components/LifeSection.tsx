import type { FortHistoryRow, FortLifeEvent, FortUnit } from '@fortress/db-drizzle'
import { GAME_TICKS_PER_YEAR } from '@fortress/db-drizzle/snapshots'
import { cn } from '@fortress/ui'
import { useQuery } from '@tanstack/react-query'
import * as React from 'react'

import type { TextPart } from '~/lib/fortress/chronicle/announcements'
import { historyEventParts, historyTone } from '~/lib/fortress/chronicle/historyEvents'
import { formatGameTick, stressLabel } from '~/lib/fortress/format'
import {
  LIFE_TONE,
  LIFE_TONE_DOT,
  type LifeTone,
  lifeEventParts,
} from '~/lib/fortress/people/lifeEvents'
import { getFortHistory, getUnitHistory } from '~/lib/fortress/server/history'
import { AnnouncementText } from '../../-components/Insights'
import { Sparkline } from '../../-components/Trends'
import { Muted, Section } from './SheetParts'
import { useFortLegendsWorldId, useKnownHistFigures } from './UnitLinks'

/** A daily-snapshot change the game's own history also records, by the history event type. */
const RECORDED_AS: Partial<Record<FortLifeEvent['kind'], string>> = {
  died: 'HIST_FIGURE_DIED',
  profession: 'CHANGE_HF_JOB',
  office: 'ADD_HF_ENTITY_LINK',
  bond: 'ADD_HF_HF_LINK',
}

/** Snapshots notice a change up to this long after the game recorded it. */
const SAME_CHANGE_TICKS = 28 * 1200

interface LifeLine {
  key: string
  year: number
  tick: number
  tone: LifeTone
  parts: TextPart[]
}

const ticksOf = (year: number, tick: number) => year * GAME_TICKS_PER_YEAR + tick

/** Life events and history events in one list, newest first, without the same change twice. */
function lifeLines(
  unit: FortUnit,
  units: Map<number, FortUnit>,
  events: FortLifeEvent[],
  recorded: FortHistoryRow[],
): LifeLine[] {
  const lines: LifeLine[] = recorded.map((e) => ({
    key: `h${e.event_id}`,
    year: e.game_year,
    tick: e.game_tick,
    tone: historyTone(e),
    parts: historyEventParts(e, units, { subject: unit.hist_figure_id }),
  }))
  for (const event of events) {
    const type = RECORDED_AS[event.kind]
    const at = ticksOf(event.game_year, event.game_tick)
    const told =
      type &&
      recorded.some((e) => {
        const gap = at - ticksOf(e.game_year, e.game_tick)
        return e.type === type && gap >= 0 && gap <= SAME_CHANGE_TICKS
      })
    if (told) continue
    lines.push({
      key: `l${event.id}`,
      year: event.game_year,
      tick: event.game_tick,
      tone: LIFE_TONE[event.kind],
      parts: lifeEventParts(event, units, { subject: false }),
    })
  }
  return lines.sort((a, b) => b.year - a.year || b.tick - a.tick)
}

/**
 * Their life in the fortress: what the worker's daily snapshots saw change,
 * what the world's history records of them, and their mood by day.
 */
export function LifeSection({
  unit,
  units,
  compact,
}: {
  unit: FortUnit
  units: Map<number, FortUnit>
  compact?: boolean
}) {
  const history = useQuery({
    queryKey: ['fort', 'unit-history', unit.id],
    queryFn: () => getUnitHistory({ data: { unitId: unit.id } }),
  })
  const hf = unit.hist_figure_id
  const recorded = useQuery({
    queryKey: ['fort', 'history', 'hf', hf],
    queryFn: () => getFortHistory({ data: { hf, limit: 200 } }),
    enabled: hf >= 0,
  })
  const worldId = useFortLegendsWorldId()
  const known = useKnownHistFigures(
    worldId,
    React.useMemo(() => (recorded.data ?? []).flatMap((e) => e.hfids), [recorded.data]),
  )
  const lines = React.useMemo(
    () => lifeLines(unit, units, history.data?.events ?? [], recorded.data ?? []),
    [unit, units, history.data, recorded.data],
  )
  const stress = history.data?.stress ?? []
  const moods = stress.map((s) => s.category)
  const first = stress[0]
  const lowest = moods.length ? Math.min(...moods) : null
  return (
    <Section title="Their life here" count={lines.length || undefined}>
      <div className="flex flex-col gap-4">
        {moods.length >= 2 && first ? (
          <div className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="text-muted-foreground">
                Mood by day since {formatGameTick(first.year, first.tick)}
              </span>
              <span className="tabular-nums">{stressLabel(moods[moods.length - 1])} now</span>
            </div>
            <Sparkline
              values={moods}
              min={0}
              max={6}
              label={`Mood from ${stressLabel(moods[0])} to ${stressLabel(moods[moods.length - 1])}`}
              strokeClassName={cn(
                lowest !== null && lowest <= 1 ? 'stroke-red-500' : 'stroke-emerald-500',
              )}
            />
            {lowest !== null && lowest <= 1 ? (
              <span className="text-xs text-muted-foreground">
                At worst {stressLabel(lowest)} in this time.
              </span>
            ) : null}
          </div>
        ) : null}
        {lines.length ? (
          <ul className="flex flex-col gap-2 text-sm">
            {lines.slice(0, compact ? 8 : 30).map((line) => (
              <li key={line.key} className="flex gap-3">
                <span
                  className={cn('mt-1.5 size-1.5 shrink-0 rounded-full', LIFE_TONE_DOT[line.tone])}
                  aria-hidden
                />
                <span className="min-w-0 flex-1">
                  <AnnouncementText
                    parts={line.parts}
                    legends={worldId !== null ? { worldId, known } : null}
                  />
                </span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {formatGameTick(line.year, line.tick)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <Muted>
            {history.isLoading
              ? 'Looking back through the days…'
              : 'Nothing has changed in their life since the worker began keeping a reading a day. New skills, friends, offices and hurts show up here as they happen, along with what the world’s history records of them.'}
          </Muted>
        )}
      </div>
    </Section>
  )
}
