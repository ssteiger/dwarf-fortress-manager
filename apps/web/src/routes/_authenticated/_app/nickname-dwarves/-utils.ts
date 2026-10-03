import type { FortUnit } from '@fortress/db-drizzle/fortress-types'

export function isLivingCitizen(unit: FortUnit): boolean {
  return (
    unit.flags.includes('citizen') && !unit.flags.includes('dead') && !unit.flags.includes('ghost')
  )
}

export function livingCitizens(units: FortUnit[]): FortUnit[] {
  return units
    .filter(isLivingCitizen)
    .sort((a, b) => a.readable.localeCompare(b.readable) || a.id - b.id)
}
