// Numerical validity shared by selection, distribution and catalog validation.
import { ENCOUNTER_RARITIES, type EncounterEntry, type EncounterZone } from './types'

export const SHARE_TOTAL = 100
export const SHARE_TOLERANCE = 1e-9 // same authored-data tolerance as ECO-1; never rescales shares

export function validShares(shares: EncounterZone['rarityShares']): boolean {
  const known: readonly string[] = ENCOUNTER_RARITIES
  const values = ENCOUNTER_RARITIES.map(r => shares[r])
  const total = values.reduce((sum, value) => sum + value, 0)
  return Object.keys(shares).every(r => known.includes(r))
    && values.every(v => typeof v === 'number' && Number.isFinite(v) && v >= 0)
    && Number.isFinite(total) && Math.abs(total - SHARE_TOTAL) <= SHARE_TOLERANCE
}

/** Empty tiers total zero; malformed weights or non-finite sums return null. */
export function tierWeightTotal(entries: readonly Pick<EncounterEntry, 'weight'>[]): number | null {
  if (!entries.every(e => typeof e.weight === 'number' && Number.isFinite(e.weight) && e.weight > 0)) return null
  const total = entries.reduce((sum, e) => sum + e.weight, 0)
  return Number.isFinite(total) ? total : null
}
