import type { FortItem, FortUnit } from '@fortress/db-drizzle'

import type { LegendsHit } from '../legends/server'

/*
 * Client-safe: what the app can be searched for. The pages are listed here;
 * everything else comes from the dump, the chronicle and the legends export
 * through `globalSearch` in ./server.
 */

/** Every page the search can jump to. The router checks these against its routes. */
export type AppPath =
  | '/fortress'
  | '/fortress/dwarves'
  | '/fortress/items'
  | '/fortress/work'
  | '/fortress/map'
  | '/fortress/chronicle'
  | '/legends'
  | '/legends/world'
  | '/legends/history'
  | '/legends/stories'
  | '/legends/archive'
  | '/legends/journal'
  | '/nickname-dwarves'
  | '/activity-logs'
  | '/settings'
  | '/settings/account'
  | '/settings/connection'
  | '/settings/legends'
  | '/settings/notifications'

export interface PageEntry {
  to: AppPath
  title: string
  /** What the page is for, shown beside the title. */
  detail: string
  /** Other words that should find it, beyond the title and the detail. */
  keywords: string
}

export const PAGES: PageEntry[] = [
  {
    to: '/fortress',
    title: 'Overview',
    detail: 'How the fortress stands right now',
    keywords: 'home dashboard summary population mood alerts stocks wealth news',
  },
  {
    to: '/fortress/dwarves',
    title: 'Dwarves',
    detail: 'Every citizen, animal and visitor',
    keywords: 'units roster people citizens skills stress squad nobles health',
  },
  {
    to: '/fortress/items',
    title: 'Stores and items',
    detail: 'What the fortress keeps, and what to make next',
    keywords: 'stock stockpiles goods food drink loot artifacts forbidden refuse trade wealth',
  },
  {
    to: '/fortress/work',
    title: 'Work and advice',
    detail: 'Jobs, workshops and what needs doing',
    keywords: 'jobs queue workshops buildings zones labor advice checklist orders',
  },
  {
    to: '/fortress/map',
    title: 'Map',
    detail: 'The fortress level by level',
    keywords: 'tiles dig levels z terrain layout',
  },
  {
    to: '/fortress/chronicle',
    title: 'Chronicle',
    detail: 'Every announcement the game has made',
    keywords: 'announcements events log history cancellations combat',
  },
  {
    to: '/legends',
    title: 'Legends',
    detail: 'The world your fortress stands in',
    keywords: 'world history export figures civilizations',
  },
  {
    to: '/legends/world',
    title: 'The world',
    detail: 'The world map, region by region',
    keywords: 'atlas geography sites regions civilizations map',
  },
  {
    to: '/legends/history',
    title: 'History',
    detail: 'The ages, year by year',
    keywords: 'timeline ages wars events chart years',
  },
  { to: '/legends/stories', title: 'Stories', detail: 'Tales worth retelling', keywords: 'sagas' },
  {
    to: '/legends/archive',
    title: 'Archive',
    detail: 'Every record in the export',
    keywords: 'browse search figures sites artifacts entities regions writings',
  },
  {
    to: '/legends/journal',
    title: 'Journal',
    detail: 'Your notes and pinned records',
    keywords: 'notes pins bookmarks',
  },
  {
    to: '/nickname-dwarves',
    title: 'Nickname Dwarves',
    detail: 'Give your dwarves names that stick',
    keywords: 'rename nicknames naming',
  },
  {
    to: '/activity-logs',
    title: 'Worker logs',
    detail: 'What the worker has been doing',
    keywords: 'activity dfhack connection errors debug',
  },
  {
    to: '/settings',
    title: 'Settings',
    detail: 'How the app looks and behaves',
    keywords: 'preferences options configuration',
  },
  {
    to: '/settings/account',
    title: 'Account settings',
    detail: 'Your sign-in and profile',
    keywords: 'email password profile login logout',
  },
  {
    to: '/settings/connection',
    title: 'Connection settings',
    detail: 'How often the game is read, the worker, DFHack and one-click commands',
    keywords: 'dfhack worker commands actions game dump interval frequency refresh freeze pause',
  },
  {
    to: '/settings/legends',
    title: 'Legends settings',
    detail: 'Imported worlds and the narrator',
    keywords: 'import export worlds narrator model ai',
  },
  {
    to: '/settings/notifications',
    title: 'Notification settings',
    detail: 'What the app tells you about',
    keywords: 'alerts toasts warnings',
  },
]

// ---------------------------------------------------------------------------
// Ranking

/**
 * How well `name` answers the query, lower being better; null when it does
 * not. An exact name beats one that starts with it, which beats a match on
 * a later word, which beats a match anywhere in the name or in `extra`.
 */
export function rankMatch(name: string, extra: string, query: string): number | null {
  const q = query.trim().toLowerCase()
  if (!q) return null
  const n = name.toLowerCase()
  if (n === q) return 0
  if (n.startsWith(q)) return 1
  if (n.split(/[^\p{L}\p{N}]+/u).some((word) => word.startsWith(q))) return 2
  if (n.includes(q)) return 3
  return extra.toLowerCase().includes(q) ? 4 : null
}

// ---------------------------------------------------------------------------
// Results

/** The unit fields the search needs: enough to name it and draw its sprite. */
export type SearchUnit = Pick<
  FortUnit,
  'id' | 'name' | 'nickname' | 'readable' | 'profession' | 'flags' | 'race_id' | 'caste_id' | 'look'
>

export interface DwarfHit {
  unit: SearchUnit
  detail: string
}

export interface ItemHit {
  item: FortItem
  detail: string
}

export interface PlaceHit {
  id: number
  label: string
  detail: string
}

export interface EventHit {
  id: number
  text: string
  /** The game date it happened, if the announcement carried one. */
  when: string
}

export interface SearchResults {
  dwarves: DwarfHit[]
  items: ItemHit[]
  places: PlaceHit[]
  events: EventHit[]
  legends: LegendsHit[]
  /** The world the legends hits belong to, for the links. */
  worldId: number | null
  /** Set when a group had more matches than were returned. */
  more: { dwarves: number; items: number; places: number; events: number }
}

export const EMPTY_RESULTS: SearchResults = {
  dwarves: [],
  items: [],
  places: [],
  events: [],
  legends: [],
  worldId: null,
  more: { dwarves: 0, items: 0, places: 0, events: 0 },
}

/** The shortest query worth sending; one letter matches far too much. */
export const MIN_QUERY = 2
