import { describe, expect, test } from 'bun:test'

import {
  BACKUP_KIND,
  BACKUP_VERSION,
  BackupError,
  backupFileName,
  describeCounts,
  describeImport,
  readBackup,
} from './backupFormat'

const base = {
  kind: BACKUP_KIND,
  version: BACKUP_VERSION,
  exportedAt: '2026-10-04T12:00:00.000Z',
} as const

describe('readBackup', () => {
  test('refuses what is not a backup', () => {
    expect(() => readBackup(null)).toThrow(BackupError)
    expect(() => readBackup({ kind: 'something-else', version: 1 })).toThrow(
      'This file is not a backup from Dwarf Fortress Manager.',
    )
    expect(() => readBackup({ kind: BACKUP_KIND })).toThrow('does not say which version')
  })

  test('refuses a newer format and says what to do', () => {
    expect(() => readBackup({ ...base, version: BACKUP_VERSION + 1 })).toThrow(
      'Update the app, then import it again.',
    )
  })

  test('reads an exported file back unchanged', () => {
    const file = {
      ...base,
      unitNotes: [
        {
          fortKey: 'save:1',
          unitId: 4,
          note: 'Hates the cold.',
          updatedAt: '2026-10-01T00:00:00.000Z',
        },
      ],
      nicknames: [
        {
          fortKey: 'save:1',
          unitId: 4,
          nickname: 'Frostbeard',
          why: 'Hates the cold.',
          source: 'typed',
          createdAt: '2026-10-01T00:00:00.000Z',
        },
      ],
      nameList: [{ name: 'Gemhand', createdAt: '2026-10-01T00:00:00.000Z' }],
      journal: [
        {
          worldKey: 'region1-02000-01-01',
          worldName: 'Ngutegoram',
          targetKind: 'historical_figure',
          targetId: '12',
          title: 'Urist',
          note: 'Founded the fortress.',
          tags: ['founder'],
          createdAt: '2026-10-01T00:00:00.000Z',
          updatedAt: '2026-10-02T00:00:00.000Z',
        },
      ],
    }
    const { backup, dropped } = readBackup(JSON.parse(JSON.stringify(file)))
    expect(dropped).toBe(0)
    expect(backup as unknown).toEqual(file)
  })

  test('leaves out rows it cannot read, and counts them', () => {
    const { backup, dropped } = readBackup({
      ...base,
      unitNotes: [
        { fortKey: '', unitId: 1, note: 'x' },
        { fortKey: 'a', unitId: -1, note: 'x' },
        { fortKey: 'a', unitId: 1, note: '   ' },
        'not a row',
      ],
      nicknames: [{ fortKey: 'a', unitId: 1, nickname: '\u0007  ' }],
      nameList: 'not a list',
    })
    expect(backup.unitNotes).toEqual([])
    expect(backup.nicknames).toEqual([])
    expect(backup.nameList).toEqual([])
    expect(dropped).toBe(6)
  })

  test('cleans names and trims them to what the app keeps', () => {
    const { backup } = readBackup({
      ...base,
      nicknames: [
        {
          fortKey: 'a',
          unitId: 1,
          nickname: '  Iron\n\tfist   the Very Long Name That Goes On And On  ',
          source: 'invented',
        },
      ],
      journal: [
        {
          worldKey: 'w',
          targetKind: 'site',
          targetId: '3',
          tags: ['#Home', 'home', ' ', 7, 'Fort'],
        },
      ],
    })
    expect(backup.nicknames[0].nickname).toBe('Iron fist the Very Long Name That Goes O')
    expect(Array.from(backup.nicknames[0].nickname)).toHaveLength(40)
    expect(backup.nicknames[0].source).toBe('typed')
    expect(backup.nicknames[0].createdAt).toBe(base.exportedAt)
    expect(backup.journal[0].tags).toEqual(['home', 'fort'])
    expect(backup.journal[0].title).toBe('')
  })

  test('keeps the newest of two notes on the same creature', () => {
    const { backup } = readBackup({
      ...base,
      unitNotes: [
        { fortKey: 'a', unitId: 1, note: 'new', updatedAt: '2026-10-03T00:00:00.000Z' },
        { fortKey: 'a', unitId: 1, note: 'old', updatedAt: '2026-10-01T00:00:00.000Z' },
      ],
    })
    expect(backup.unitNotes.map((n) => n.note)).toEqual(['new'])
  })
})

describe('describing a backup', () => {
  test('counts read as a sentence', () => {
    expect(describeCounts({ unitNotes: 1, nicknames: 22, nameList: 0, journal: 3 })).toBe(
      '1 note on a creature, 22 nicknames and 3 journal entries',
    )
    expect(describeCounts({ unitNotes: 0, nicknames: 0, nameList: 0, journal: 0 })).toBeNull()
  })

  test('an import reads as sentences', () => {
    expect(
      describeImport({
        added: { unitNotes: 0, nicknames: 2, nameList: 10, journal: 0 },
        updated: 1,
        unchanged: 120,
        dropped: 1,
        listFull: 3,
        missingWorlds: [{ name: 'Ngutegoram', entries: 4 }],
      }),
    ).toBe(
      'Added 2 nicknames and 10 names on your list. One was replaced by a newer version from the file. 120 were already here. 4 journal entries are for Ngutegoram, whose legends are not imported here: import its legends export in Settings, then this file again. 3 names did not fit, since the list holds 500. 1 row in the file could not be read and was left out.',
    )
    expect(
      describeImport({
        added: { unitNotes: 0, nicknames: 0, nameList: 0, journal: 0 },
        updated: 0,
        unchanged: 5,
        dropped: 0,
        listFull: 0,
        missingWorlds: [],
      }),
    ).toBe('Nothing new to add. 5 were already here.')
  })

  test('the file is named by the day', () => {
    expect(backupFileName(new Date('2026-10-04T23:00:00.000Z'))).toBe(
      'dwarf-fortress-manager-backup-2026-10-04.json',
    )
  })
})
