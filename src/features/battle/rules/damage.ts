// Damage, Generation VI (R32.3).
//
// The core formula, with the rounding written down rather than implied. The
// order below is the contract: change it and the same battle stops replaying,
// which is why it is documented here and not only in the design doc.
//
//   1. `levelTerm   = floor(2 * level / 5) + 2`
//   2. `base        = floor(floor(levelTerm * power * Atk / Def) / 50) + 2`
//   3. `× critical` (1.5)                        → floor
//   4. `× random`   (85…100 / 100)               → floor
//   5. `× STAB`     (1.5)                        → floor
//   6. `× type effectiveness`                    → floor
//   7. at least 1, unless the target is immune, and then exactly 0.
//
// Where burn is: **in the Attack stat**, not as a step here. PokeSwap's burn
// is `Attack ×0.5` (§25), applied by `effectiveStat`, and applying it twice
// would halve damage twice. It is called out because the Gen VI formula puts a
// burn modifier in the chain and a reader will look for it.
//
// Every roll is injected. There is no `Math.random()` in this file and no
// clock: an accuracy check, a crit, the damage spread and a secondary chance
// each take one draw from the battle's own `RngState`, in that order, and the
// order is part of the contract too.

import type { TypeName } from '../catalog'
import type { BattleRulesConfig } from './config'
import type { RngState } from './rng'
import { drawChance, drawInt, drawRandom } from './rng'
import type { BattleCombatant } from './state'
import { accuracyMultiplier, effectiveStat } from './stats'

export interface DamageInput {
  readonly attacker: BattleCombatant
  readonly defender: BattleCombatant
  readonly power: number
  readonly category: 'physical' | 'special'
  readonly moveType: TypeName
  readonly attackerTypes: readonly TypeName[]
  readonly defenderTypes: readonly TypeName[]
  /** Catalog `meta.critRate`; 0 or null is the ordinary 1/16. */
  readonly critStage: number
  /** False for Struggle, which ignores typing entirely in Gen VI. */
  readonly appliesTyping: boolean
  readonly effectiveness: number
}

export interface DamageResult {
  readonly damage: number
  readonly critical: boolean
  readonly effectiveness: number
  readonly stab: number
  readonly rng: RngState
}

/** Whether the move lands. `accuracy === null` means it cannot miss. */
export function rollAccuracy(
  accuracy: number | null,
  attacker: BattleCombatant,
  defender: BattleCombatant,
  config: BattleRulesConfig,
  rng: RngState,
): { hit: boolean; rng: RngState } {
  // A move that cannot miss still spends its draw, so adding or removing an
  // always-hit move never shifts the rolls of everything after it.
  const draw = drawRandom(rng)
  if (accuracy === null) return { hit: true, rng: draw.rng }
  const chance = (accuracy / 100) * accuracyMultiplier(attacker, defender, config)
  return { hit: draw.value < chance, rng: draw.rng }
}

/** Gen VI crit chances by stage; anything past the table is a guaranteed crit. */
export function critChance(stage: number, config: BattleRulesConfig): number {
  const table = config.damage.critChanceByStage
  return table[Math.max(0, Math.min(table.length - 1, Math.floor(stage)))]
}

/**
 * One hit's damage. Spends exactly two draws: the crit, then the spread.
 *
 * Accuracy is *not* rolled here — a multi-hit move checks accuracy once and
 * then rolls damage per hit, so the two have to be callable apart.
 */
export function computeDamage(input: DamageInput, config: BattleRulesConfig, rng: RngState): DamageResult {
  const stab = input.appliesTyping && input.attackerTypes.includes(input.moveType)
    ? config.damage.stabMultiplier
    : 1
  const effectiveness = input.appliesTyping ? input.effectiveness : 1

  const crit = drawChance(rng, critChance(input.critStage, config))
  const spread = drawInt(crit.rng, 0, config.damage.randomRollSteps - 1)

  if (effectiveness === 0) {
    return { damage: 0, critical: false, effectiveness: 0, stab, rng: spread.rng }
  }

  const attack = effectiveStat(input.attacker, input.category === 'physical' ? 'atk' : 'spa', config)
  const defense = effectiveStat(input.defender, input.category === 'physical' ? 'def' : 'spd', config)

  const levelTerm = Math.floor((2 * input.attacker.level) / 5) + 2
  let damage = Math.floor(Math.floor(levelTerm * input.power * (attack / defense)) / 50) + 2

  if (crit.value) damage = Math.floor(damage * config.damage.critMultiplier)
  damage = Math.floor((damage * (config.damage.randomRollFloorPercent + spread.value)) / 100)
  damage = Math.floor(damage * stab)
  damage = Math.floor(damage * effectiveness)

  return {
    damage: Math.max(1, damage),
    critical: crit.value,
    effectiveness,
    stab,
    rng: spread.rng,
  }
}

/**
 * A confused Pokémon hitting itself: a typeless physical hit of its own
 * Attack against its own Defence, as in the games. No crit, no STAB, no type.
 */
export function confusionSelfDamage(
  combatant: BattleCombatant, config: BattleRulesConfig,
): number {
  const attack = effectiveStat(combatant, 'atk', config)
  const defense = effectiveStat(combatant, 'def', config)
  const levelTerm = Math.floor((2 * combatant.level) / 5) + 2
  return Math.max(1, Math.floor(Math.floor(levelTerm * config.confusion.power * (attack / defense)) / 50) + 2)
}

/** How many times a 2–5 hit move connects, with Gen VI's own distribution. */
export function rollHitCount(
  minHits: number, maxHits: number, rng: RngState,
): { hits: number; rng: RngState } {
  if (minHits === maxHits) {
    // Still spends a draw: a fixed-count move must not shift later rolls.
    return { hits: minHits, rng: drawRandom(rng).rng }
  }
  if (minHits === 2 && maxHits === 5) {
    // 2 and 3 hits are 3/8 each; 4 and 5 are 1/8 each.
    const draw = drawInt(rng, 0, 7)
    const hits = draw.value < 3 ? 2 : draw.value < 6 ? 3 : draw.value === 6 ? 4 : 5
    return { hits, rng: draw.rng }
  }
  const draw = drawInt(rng, minHits, maxHits)
  return { hits: draw.value, rng: draw.rng }
}
