import { createFileRoute, redirect } from '@tanstack/react-router'

import { BROWSE_TABS } from '~/lib/legends/model'
import { parseWorldParam } from './-components/LegendsChrome'

interface LegacySearch {
  world?: number
  tab?: 'world' | 'history' | 'archive'
  archive?: string
  q?: string
}

export const Route = createFileRoute('/_authenticated/_app/legends/')({
  validateSearch: (raw: Record<string, unknown>): LegacySearch => {
    const out: LegacySearch = {}
    const world = parseWorldParam(raw.world)
    if (world !== undefined) out.world = world
    if (raw.tab === 'world' || raw.tab === 'history' || raw.tab === 'archive') out.tab = raw.tab
    if (typeof raw.archive === 'string' && BROWSE_TABS.some((t) => t.key === raw.archive))
      out.archive = raw.archive
    if (typeof raw.q === 'string' && raw.q) out.q = raw.q
    return out
  },
  beforeLoad: ({ search }) => {
    if (search.tab === 'history') {
      throw redirect({ to: '/legends/history', search: { world: search.world } })
    }
    if (search.tab === 'archive') {
      throw redirect({
        to: '/legends/archive',
        search: { world: search.world, archive: search.archive, q: search.q },
      })
    }
    throw redirect({ to: '/legends/world', search: { world: search.world } })
  },
})
