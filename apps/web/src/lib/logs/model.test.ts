import { describe, expect, test } from 'bun:test'

import {
  type RawLog,
  buildEntries,
  burstLabel,
  describeLog,
  headline,
  matchesFilter,
  matchesSearch,
  openProblem,
  overLabel,
} from './model'

let nextId = 1000
const line = (created_at: string, message: string): RawLog => ({
  id: nextId--,
  created_at,
  message,
})

describe('describeLog', () => {
  test('a connection reads as a sentence with its counts', () => {
    expect(
      describeLog(
        'Fortress worker connected: Fluffleduffmoonshine · 170 units, 14337 items, 14400 map blocks',
      ),
    ).toEqual({
      level: 'info',
      source: 'game',
      kind: 'connected',
      title: 'Connected to Fluffleduffmoonshine',
      detail: '170 units, 14,337 items, 14,400 map blocks.',
      hint: null,
    })
  })

  test('a failed read keeps the cause and says what to do', () => {
    const d = describeLog(
      'ERROR: Fortress worker: dump failed (DFHack closed the connection early)',
    )
    expect(d.level).toBe('error')
    expect(d.title).toBe('A read of the game failed')
    expect(d.detail).toBe('DFHack closed the connection early')
    expect(d.hint).toContain('closed, or crashed')
  })

  test('a database behind the worker points at the migrations', () => {
    const d = describeLog(
      'ERROR: Fortress worker: command processing failed (column "command" does not exist)',
    )
    expect(d.source).toBe('commands')
    expect(d.hint).toContain('bun run db:migrate')
  })

  test('legends lines', () => {
    expect(
      describeLog(
        'Legends: imported 373,325 records from region1-02000-01-01-legends.xml in 39.0s',
      ),
    ).toMatchObject({
      source: 'legends',
      title: 'Imported 373,325 legends records from region1-02000-01-01-legends.xml',
      detail: 'Took 39.0 seconds.',
    })
    expect(describeLog('Legends: world "region1" now has 416,175 records').title).toBe(
      'The world region1 now holds 416,175 records',
    )
  })

  test('a line it does not know stays as written', () => {
    expect(describeLog('Something else happened')).toMatchObject({
      source: 'other',
      title: 'Something else happened',
    })
  })
})

describe('buildEntries', () => {
  const rows = [
    line(
      '2026-10-04T21:21:06Z',
      'Fortress worker connected: Fluffleduffmoonshine · 170 units, 14337 items, 14400 map blocks',
    ),
    line(
      '2026-10-04T13:14:40Z',
      'ERROR: Fortress worker: dump failed (DFHack closed the connection early)',
    ),
    line(
      '2026-09-26T15:35:40Z',
      'ERROR: Fortress worker: command processing failed (column "command" does not exist)',
    ),
    line(
      '2026-09-26T15:35:20Z',
      'ERROR: Fortress worker: command processing failed (column "command" does not exist)',
    ),
    line(
      '2026-09-26T15:35:01Z',
      'ERROR: Fortress worker: command processing failed (column "command" does not exist)',
    ),
    line(
      '2026-09-26T14:04:53Z',
      'ERROR: Fortress worker: command processing failed (column "arg" does not exist)',
    ),
  ]
  const entries = buildEntries(rows)

  test('a burst of the same line is one entry', () => {
    expect(entries).toHaveLength(4)
    expect(entries[2].count).toBe(3)
    expect(entries[2].firstAt).toBe('2026-09-26T15:35:01Z')
    expect(burstLabel(entries[2])).toBe('3 times in 39 seconds')
  })

  test('a failed read is over once the worker connects again', () => {
    expect(entries[1].overAt).toBe('2026-10-04T21:21:06Z')
    expect(overLabel(entries[1])).toBe('Over: connected again 8 hours later.')
  })

  test('a connection says nothing about whether commands work again', () => {
    expect(entries[2].overAt).toBeNull()
  })

  test('a command that ran through since puts command failures behind', () => {
    const later = buildEntries(rows, '2026-10-03T13:25:07Z')
    expect(later[2].overBy).toBe('command')
    expect(overLabel(later[2])).toBe('Over: commands from the app have run since.')
    expect(buildEntries(rows, '2026-09-20T00:00:00Z')[2].overAt).toBeNull()
  })

  test('the same line hours apart stays two entries', () => {
    const apart = buildEntries([
      line('2026-10-04T12:00:00Z', 'WARNING: Fortress worker: game unreachable (refused)'),
      line('2026-10-04T08:00:00Z', 'WARNING: Fortress worker: game unreachable (refused)'),
    ])
    expect(apart).toHaveLength(2)
  })
})

describe('openProblem', () => {
  test('none once the worker has connected since', () => {
    expect(
      openProblem(
        buildEntries([
          line('2026-10-04T21:00:00Z', 'Fortress worker connected: Fort · 1 units, 2 items'),
          line('2026-10-04T20:00:00Z', 'WARNING: Fortress worker: game unreachable (refused)'),
        ]),
      ),
    ).toBeNull()
  })

  test('the newest problem while nothing good came after it', () => {
    const open = openProblem(
      buildEntries([
        line('2026-10-04T21:00:00Z', 'Legends: importing a.xml'),
        line('2026-10-04T20:00:00Z', 'WARNING: Fortress worker: game unreachable (refused)'),
        line('2026-10-04T19:00:00Z', 'Fortress worker connected: Fort · 1 units, 2 items'),
      ]),
    )
    expect(open?.title).toBe('Could not reach the game')
  })
})

describe('filters', () => {
  const [connected, failed] = buildEntries([
    line('2026-10-04T21:00:00Z', 'Fortress worker connected: Fort · 1 units, 2 items'),
    line(
      '2026-10-04T20:00:00Z',
      'ERROR: Fortress worker: dump failed (DFHack closed the connection early)',
    ),
  ])

  test('problems are errors and warnings', () => {
    expect(matchesFilter(connected, 'problems')).toBe(false)
    expect(matchesFilter(failed, 'problems')).toBe(true)
    expect(matchesFilter(failed, 'game')).toBe(true)
    expect(matchesFilter(failed, 'legends')).toBe(false)
  })

  test('search looks at the sentence and the line as written', () => {
    expect(matchesSearch(failed, 'closed the CONNECTION')).toBe(true)
    expect(matchesSearch(failed, 'dump failed')).toBe(true)
    expect(matchesSearch(failed, 'goblin')).toBe(false)
  })
})

describe('headline', () => {
  const entries = buildEntries([
    line(
      new Date().toISOString(),
      'Fortress worker connected: Fluffleduffmoonshine · 1 units, 2 items',
    ),
    line(
      new Date(Date.now() - 3 * 3_600_000).toISOString(),
      'ERROR: Fortress worker: dump failed (DFHack closed the connection early)',
    ),
  ])

  test('what the worker is doing, then the last problem', () => {
    expect(
      headline(entries, { running: true, seenAt: new Date().toISOString(), status: 'live' }),
    ).toBe(
      'The worker is running and reading Fluffleduffmoonshine. It last reported a problem about 3 hours ago, and has connected to the game since.',
    )
  })

  test('a stopped worker comes first', () => {
    expect(
      headline(entries, {
        running: false,
        seenAt: new Date(Date.now() - 5 * 60_000).toISOString(),
        status: 'live',
      }),
    ).toStartWith('The worker is not running; it was last heard from 5 minutes ago.')
  })
})
