import type { JsonObject } from '@fortress/db-drizzle'
import * as React from 'react'

import { words } from '~/lib/legends/model'
import type { NameIndex } from '~/lib/legends/server'
import { RecordLink } from './LegendsChrome'

/** Payload keys shown elsewhere on the page, or pure noise. */
const HIDDEN_KEYS = new Set(['id', 'name', 'plus', 'type'])

/** Fields that are ids of other records: key pattern -> kind. */
const ID_KINDS: [RegExp, string][] = [
  [/civ|entity|enid|owner|religion|(^|_)en$/i, 'entity'],
  [/site/i, 'site'],
  [/artifact/i, 'artifact'],
  [/wc_id|written_content|^writing$/i, 'written_content'],
  [/subregion|region/i, 'region'],
  [
    /hfid|hist_?fig|histfig|(^|_)hf$|^hf_|^(target|doer|victim|slayer|woundee|wounder|eater|group|creator|builder|appointer|leader|ruler|inhabitant|author|student|teacher|speaker|gambler|winner|competitor)$/i,
    'historical_figure',
  ],
]

function kindForKey(key: string): string | null {
  for (const [re, kind] of ID_KINDS) if (re.test(key)) return kind
  return null
}

function FactValue({
  keyName,
  value,
  names,
  worldId,
}: { keyName: string; value: unknown; names: NameIndex; worldId: number | null }) {
  if (value === true) return <span>yes</span>
  if (value === false) return <span>no</span>
  if (value === null || value === undefined || value === '')
    return <span className="text-muted-foreground">—</span>
  if (typeof value === 'number') {
    const kind = kindForKey(keyName)
    if (kind && value >= 0) {
      const name = names[kind]?.[value]
      return (
        <RecordLink
          kind={kind}
          id={value}
          name={name ?? null}
          worldId={worldId}
          className="font-normal"
        />
      )
    }
    if (value < 0 && kind) return <span className="text-muted-foreground">none</span>
    return <span className="tabular-nums">{value.toLocaleString()}</span>
  }
  if (typeof value === 'string') return <span>{value.replace(/_/g, ' ')}</span>
  if (Array.isArray(value)) {
    return (
      <ul className="flex flex-col gap-1">
        {value.slice(0, 60).map((entry, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: entries have no stable identity
          <li key={i}>
            {typeof entry === 'object' && entry !== null ? (
              <span className="text-sm">
                {Object.entries(entry as Record<string, unknown>).map(([k, v], j) => (
                  <span key={k}>
                    {j > 0 ? ' · ' : ''}
                    <span className="text-muted-foreground">{words(k)} </span>
                    <FactValue keyName={k} value={v} names={names} worldId={worldId} />
                  </span>
                ))}
              </span>
            ) : (
              <FactValue
                keyName={keyName.replace(/s$/, '')}
                value={entry}
                names={names}
                worldId={worldId}
              />
            )}
          </li>
        ))}
        {value.length > 60 ? (
          <li className="text-xs text-muted-foreground">+{value.length - 60} more</li>
        ) : null}
      </ul>
    )
  }
  if (typeof value === 'object') {
    return (
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-sm">
        {Object.entries(value as Record<string, unknown>).map(([k, v]) => (
          <React.Fragment key={k}>
            <dt className="text-muted-foreground">{words(k)}</dt>
            <dd>
              <FactValue keyName={k} value={v} names={names} worldId={worldId} />
            </dd>
          </React.Fragment>
        ))}
      </dl>
    )
  }
  return <span>{String(value)}</span>
}

/** Every field of the export, for when the summaries above are not enough. */
export function RawFacts({
  payload,
  names,
  worldId,
}: {
  payload: JsonObject
  names: NameIndex
  worldId: number | null
}) {
  const entries = Object.entries(payload).filter(([k]) => !HIDDEN_KEYS.has(k))
  if (entries.length === 0)
    return <p className="text-sm text-muted-foreground">Nothing more is recorded.</p>
  return (
    <dl className="grid gap-x-4 gap-y-3 text-sm leading-relaxed">
      {entries.map(([key, value]) => (
        <div
          key={key}
          className="grid grid-cols-[minmax(9rem,auto)_minmax(0,1fr)] gap-3 border-b pb-3 last:border-0"
        >
          <dt className="text-muted-foreground">{words(key)}</dt>
          <dd className="min-w-0 break-words">
            <FactValue keyName={key} value={value} names={names} worldId={worldId} />
          </dd>
        </div>
      ))}
    </dl>
  )
}
