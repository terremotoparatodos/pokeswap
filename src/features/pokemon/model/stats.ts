// Stats of one Pokémon, Generation VI (R32.2).
//
// Everything here is derived: give it a base stat line, a level, IVs, EVs and
// a nature, and it answers what that individual's stats are. Nothing is stored
// — a stat that can be recomputed is never persisted, so it can never drift
// from the values it came from.
//
// These are the *base combat stats* of an individual. Buffs, debuffs, stat
// stages, burn's Attack cut and anything a battle does live in the runtime
// state (R32.3), never here.

export interface StatValues {
  readonly hp: number
  readonly atk: number
  readonly def: number
  readonly spa: number
  readonly spd: number
  readonly spe: number
}

export const STAT_KEYS = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'] as const
export type StatKey = (typeof STAT_KEYS)[number]

/** The catalog stores base stats in this order. */
export type BaseStatTuple = readonly [number, number, number, number, number, number]

export const MIN_LEVEL = 1
export const MAX_LEVEL = 100
export const MAX_IV = 31
export const MAX_EV_PER_STAT = 252
export const MAX_EV_TOTAL = 510

export const ZERO_STATS: StatValues = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }
export const PERFECT_IVS: StatValues = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }

export const statsFromTuple = (tuple: BaseStatTuple): StatValues => ({
  hp: tuple[0], atk: tuple[1], def: tuple[2], spa: tuple[3], spd: tuple[4], spe: tuple[5],
})

/** The nature's effect, as the catalog describes it: which stat is up, which is down. */
export interface NatureEffect {
  /** Catalog stat identifier, e.g. `attack`, `special-attack`; null when neutral. */
  readonly increased: string | null
  readonly decreased: string | null
}

/** The catalog names stats in full; the model uses short keys. */
const CATALOG_STAT_KEY: Readonly<Record<string, StatKey>> = {
  hp: 'hp',
  attack: 'atk',
  defense: 'def',
  'special-attack': 'spa',
  'special-defense': 'spd',
  speed: 'spe',
}

/**
 * The nature multiplier for one stat: 1.1, 0.9 or 1.
 *
 * A neutral nature raises and lowers the same stat, which is why they cancel
 * out rather than being special-cased. HP is never affected.
 */
export function natureMultiplier(nature: NatureEffect | null, stat: StatKey): number {
  if (!nature || stat === 'hp') return 1
  const up = nature.increased ? CATALOG_STAT_KEY[nature.increased] : null
  const down = nature.decreased ? CATALOG_STAT_KEY[nature.decreased] : null
  if (up === down) return 1
  if (up === stat) return 1.1
  if (down === stat) return 0.9
  return 1
}

export interface StatInput {
  readonly base: StatValues
  readonly level: number
  readonly ivs: StatValues
  readonly evs: StatValues
  readonly nature: NatureEffect | null
}

/**
 * Max HP, Gen VI.
 *
 * `floor((2·base + IV + floor(EV/4)) · level / 100) + level + 10`, and Shedinja
 * — the one species whose base HP is 1 — always has exactly 1.
 */
export function maxHp(input: StatInput, alwaysOneHp = false): number {
  if (alwaysOneHp) return 1
  const { base, ivs, evs, level } = input
  return Math.floor(((2 * base.hp + ivs.hp + Math.floor(evs.hp / 4)) * level) / 100) + level + 10
}

/**
 * Any stat other than HP, Gen VI.
 *
 * `floor((floor((2·base + IV + floor(EV/4)) · level / 100) + 5) · nature)`.
 */
export function otherStat(input: StatInput, stat: Exclude<StatKey, 'hp'>): number {
  const { base, ivs, evs, level, nature } = input
  const flat = Math.floor(((2 * base[stat] + ivs[stat] + Math.floor(evs[stat] / 4)) * level) / 100) + 5
  return Math.floor(flat * natureMultiplier(nature, stat))
}

/** Every stat of one individual at its current level. */
export function deriveStats(input: StatInput, alwaysOneHp = false): StatValues {
  return {
    hp: maxHp(input, alwaysOneHp),
    atk: otherStat(input, 'atk'),
    def: otherStat(input, 'def'),
    spa: otherStat(input, 'spa'),
    spd: otherStat(input, 'spd'),
    spe: otherStat(input, 'spe'),
  }
}

// ── Validation ──────────────────────────────────────────────────────────────

export const isWholeInRange = (value: number, min: number, max: number): boolean =>
  Number.isInteger(value) && value >= min && value <= max

export const isValidLevel = (level: number): boolean => isWholeInRange(level, MIN_LEVEL, MAX_LEVEL)

/** Every IV is a whole number in 0…31. */
export function validateIvs(ivs: StatValues): string[] {
  return STAT_KEYS
    .filter(key => !isWholeInRange(ivs[key], 0, MAX_IV))
    .map(key => `IV ${key} must be a whole number between 0 and ${MAX_IV}`)
}

/** Gen VI EVs: 0…252 per stat and 510 in total. */
export function validateEvs(evs: StatValues): string[] {
  const issues = STAT_KEYS
    .filter(key => !isWholeInRange(evs[key], 0, MAX_EV_PER_STAT))
    .map(key => `EV ${key} must be a whole number between 0 and ${MAX_EV_PER_STAT}`)
  const total = STAT_KEYS.reduce((sum, key) => sum + (Number.isFinite(evs[key]) ? evs[key] : 0), 0)
  if (total > MAX_EV_TOTAL) issues.push(`EVs total ${total}, above the ${MAX_EV_TOTAL} limit`)
  return issues
}

export const totalEvs = (evs: StatValues): number => STAT_KEYS.reduce((sum, key) => sum + evs[key], 0)

/** How many EVs can still be spent on one stat without breaking either limit. */
export function evHeadroom(evs: StatValues, stat: StatKey): number {
  return Math.max(0, Math.min(MAX_EV_PER_STAT - evs[stat], MAX_EV_TOTAL - totalEvs(evs)))
}
