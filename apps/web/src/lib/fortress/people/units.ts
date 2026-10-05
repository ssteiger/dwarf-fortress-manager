import type { FortUnit } from '@fortress/db-drizzle'

import { isLiving, unitGroup } from '../format'
import type { UnburiedBody } from '../types'

/*
 * Who a unit is to the fortress (citizen, resident, one of its own ghosts)
 * and how a sentence names them: first name, remains, pronouns. The basic
 * vocabulary every other reader of units builds on. Client-safe.
 */

export function isCitizenish(unit: FortUnit): boolean {
  const group = unitGroup(unit)
  return group === 'citizen' || group === 'resident'
}

export function isGrownCitizen(unit: FortUnit): boolean {
  return (
    isLiving(unit) &&
    isCitizenish(unit) &&
    !unit.flags.includes('child') &&
    !unit.flags.includes('baby')
  )
}

/** The restless ghost of one of the fortress's own dead. */
export function isOwnGhost(unit: FortUnit): boolean {
  return (
    unit.flags.includes('ghost') &&
    (unit.flags.includes('citizen') ||
      unit.flags.includes('own_civ') ||
      unit.flags.includes('resident'))
  )
}

/** "Thelma" for a nicknamed or named dwarf, the readable name for anyone else. */
export function firstName(unit: Pick<FortUnit, 'name' | 'nickname' | 'readable'>): string {
  return unit.nickname || unit.name.split(/\s+/)[0] || unit.readable
}

/** "Hilda’s skeleton": the game's word for the remains, with their owner named as elsewhere. */
export function remainsOf(
  body: Pick<UnburiedBody, 'name' | 'description'>,
  owner: FortUnit | undefined,
): string {
  const what = body.description.slice(body.name.length).replace(/^['’]s /, '') || 'body'
  return `${owner ? firstName(owner) : body.name}’s ${what}`
}

export function pronouns(unit: Pick<FortUnit, 'sex'>) {
  if (unit.sex === 0)
    return {
      they: 'she',
      them: 'her',
      their: 'her',
      self: 'herself',
      is: 'is',
      has: 'has',
    }
  if (unit.sex === 1)
    return {
      they: 'he',
      them: 'him',
      their: 'his',
      self: 'himself',
      is: 'is',
      has: 'has',
    }
  return {
    they: 'they',
    them: 'them',
    their: 'their',
    self: 'themselves',
    is: 'are',
    has: 'have',
  }
}
