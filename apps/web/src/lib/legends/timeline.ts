import type { SiteChange, SiteHistory } from './chronicle'
import type { MapSite } from './server'

/** Client-safe: what the site history says about each site in a given year. */

export interface SiteSnapshot {
  /** False before the site was founded. */
  exists: boolean
  ruined: boolean
  /** Civilization holding it, when known. */
  civ: number | null
}

export function changesBySite(history: SiteHistory): Map<number, SiteChange[]> {
  const bySite = new Map<number, SiteChange[]>()
  for (const change of history.changes) {
    const list = bySite.get(change.site) ?? []
    list.push(change)
    bySite.set(change.site, list)
  }
  return bySite
}

/**
 * Walk each site's changes up to `year`. Sites with no founding on record
 * have stood since the beginning; before the first recorded change they
 * belong to whoever lost them in it, or failing that to today's holder.
 */
export function siteStatesAt(
  sites: MapSite[],
  bySite: Map<number, SiteChange[]>,
  year: number,
): Map<number, SiteSnapshot> {
  const out = new Map<number, SiteSnapshot>()
  for (const site of sites) {
    const changes = bySite.get(site.id)
    if (!changes?.length) {
      out.set(site.id, { exists: true, ruined: false, civ: site.civ })
      continue
    }
    const first = changes[0]
    if (first.state === 'founded' && year < first.year) {
      out.set(site.id, { exists: false, ruined: false, civ: null })
      continue
    }
    let civ = first.state === 'founded' ? first.civ : (first.from ?? site.civ)
    let ruined = false
    for (const change of changes) {
      if (change.year > year) break
      switch (change.state) {
        case 'founded':
          civ = change.civ ?? civ
          ruined = false
          break
        case 'conquered':
          civ = change.civ ?? civ
          ruined = false
          break
        case 'ruined':
          civ = null
          ruined = true
          break
        case 'reclaimed':
          civ = change.civ ?? change.from ?? civ
          ruined = false
          break
      }
    }
    out.set(site.id, { exists: true, ruined, civ })
  }
  return out
}

/** Sites held per civilization in a year. */
export function holdingsAt(states: Map<number, SiteSnapshot>): Map<number, number> {
  const counts = new Map<number, number>()
  for (const state of states.values()) {
    if (!state.exists || state.ruined || state.civ === null) continue
    counts.set(state.civ, (counts.get(state.civ) ?? 0) + 1)
  }
  return counts
}
