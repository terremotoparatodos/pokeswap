// The numbers the rules run on (R32.3).
//
// Everything a playtest may want to move lives here and **nowhere else**: no
// rule file writes a magic number. The config is plain data and travels inside
// `BattleState`, so a replay carries the exact numbers it ran with and a
// balance change can never silently re-interpret a stored battle.
//
// `PLAYTEST` marks a value whose *shape* is approved but whose *number* is not
// settled. `APPROVED` marks one that comes from the product decisions of D1 /
// R32.2.1 and is not a knob.
//
// Times are whole milliseconds. Seconds would be a float accumulating over a
// three-hour expedition, and determinism is worth more than the convenience.

export interface ActionBarConfig {
  /** PLAYTEST. `clamp(base * sqrt(reference / Speed), min, max)`, in seconds. */
  readonly baseSeconds: number
  readonly referenceSpeed: number
  readonly minSeconds: number
  readonly maxSeconds: number
  /** APPROVED shape, PLAYTEST value: a priority move shortens the next cooldown. */
  readonly priorityMultiplier: number
  /** APPROVED shape, PLAYTEST value: a recharge move lengthens the next one. */
  readonly rechargeMultiplier: number
  /** APPROVED shape, PLAYTEST value: paralysis lengthens every cooldown. */
  readonly paralysisMultiplier: number
  /** APPROVED shape, PLAYTEST value: spending the last Protect charge costs time. */
  readonly protectExpiryMultiplier: number
}

export interface StatusConfig {
  /** PLAYTEST. Poison ticks on its own clock, never on the Action Bar. */
  readonly poisonTickMs: number
  /** PLAYTEST. Fraction of max HP per tick. */
  readonly poisonFraction: number
  /** PLAYTEST. How long sleep eats Action Windows. */
  readonly sleepMs: number
  /** APPROVED: burn halves Attack (it deals no residual damage in PokeSwap). */
  readonly burnAttackMultiplier: number
  /** APPROVED: PokeSwap's freeze halves Sp. Attack instead of immobilising. */
  readonly freezeSpecialAttackMultiplier: number
}

export interface ConfusionConfig {
  /** PLAYTEST. Volatile: it never leaves the battle. */
  readonly durationMs: number
  /** PLAYTEST. Chance an Action Window becomes a self-hit. */
  readonly selfHitChance: number
  /** PLAYTEST. A typeless physical hit of this power, as in the games. */
  readonly power: number
}

export interface ProtectConfig {
  /** APPROVED: two offensive actions. A multi-hit move spends one charge. */
  readonly charges: number
}

export interface DamageConfig {
  /** APPROVED Gen VI: 1/16 at stage 0, 1/8 at stage 1. */
  readonly critChanceByStage: readonly number[]
  /** APPROVED Gen VI. */
  readonly critMultiplier: number
  /** APPROVED Gen VI. Adaptability is a future hook, not a value. */
  readonly stabMultiplier: number
  /** APPROVED Gen VI: the roll is an integer 0…15 and the factor is (85+r)/100. */
  readonly randomRollSteps: number
  readonly randomRollFloorPercent: number
}

/**
 * APPROVED: PokeSwap's temporary stat stages run **−2 … +2**, and the clamp is
 * on the **stage**, not on the multiplier.
 *
 * The first version clamped only the multiplier and kept a −6…+6 ladder
 * underneath. That hides accumulation: six Swords Dances read ×2 like two do,
 * and then a Growl takes the hidden +6 to +5 and the number on screen does not
 * move. A player cannot learn a rule they cannot see. With the clamp on the
 * stage, a debuff is felt on the very next action.
 */
export interface StatStageConfig {
  readonly minStage: number
  readonly maxStage: number
  /** The multiplier of each stage, keyed by stage. Classic values in this range. */
  readonly multiplierByStage: Readonly<Record<string, number>>
}

export interface StruggleConfig {
  /** APPROVED Gen VI: a quarter of the user's own **max** HP, not of the damage. */
  readonly recoilFractionOfMaxHp: number
}

export interface CaptureConfig {
  /** PLAYTEST, every number. The formula is a contract, not balance. */
  readonly scale: number
  readonly minChance: number
  readonly maxChance: number
  readonly statusBonus: Readonly<Record<string, number>>
}

export interface SwitchConfig {
  /** APPROVED: the incoming Pokémon starts its Action Bar at zero. */
  readonly incomingStartsAtZeroBar: boolean
}

export interface BattleRulesConfig {
  readonly actionBar: ActionBarConfig
  readonly status: StatusConfig
  readonly confusion: ConfusionConfig
  readonly protect: ProtectConfig
  readonly damage: DamageConfig
  readonly statStages: StatStageConfig
  readonly struggle: StruggleConfig
  readonly capture: CaptureConfig
  readonly switching: SwitchConfig
}

/**
 * The approved baseline of R32.3.
 *
 * The Action Bar numbers are the ones the R32.3 contract fixes:
 * `clamp(2.6 * sqrt(60 / Speed), 1.4, 4.0)`. The dungeon prototype ran with
 * D1.2.4's 1.5× readability pass (3.9 / 2.1 / 6.0); those are its numbers, not
 * these, and the difference is recorded in the docs.
 */
export const DEFAULT_BATTLE_RULES_CONFIG: BattleRulesConfig = {
  actionBar: {
    baseSeconds: 2.6,
    referenceSpeed: 60,
    minSeconds: 1.4,
    maxSeconds: 4,
    priorityMultiplier: 0.5,
    rechargeMultiplier: 2,
    paralysisMultiplier: 2,
    protectExpiryMultiplier: 2,
  },
  status: {
    poisonTickMs: 3000,
    poisonFraction: 1 / 16,
    sleepMs: 6000,
    burnAttackMultiplier: 0.5,
    freezeSpecialAttackMultiplier: 0.5,
  },
  confusion: { durationMs: 8000, selfHitChance: 0.33, power: 40 },
  protect: { charges: 2 },
  damage: {
    critChanceByStage: [1 / 16, 1 / 8, 1 / 2, 1],
    critMultiplier: 1.5,
    stabMultiplier: 1.5,
    randomRollSteps: 16,
    randomRollFloorPercent: 85,
  },
  statStages: {
    minStage: -2,
    maxStage: 2,
    // The classic ladder, read inside PokeSwap's narrower range: +1 is 3/2 and
    // −1 is its reciprocal, so a buff and the debuff that answers it cancel.
    multiplierByStage: { '-2': 0.5, '-1': 2 / 3, 0: 1, 1: 1.5, 2: 2 },
  },
  struggle: { recoilFractionOfMaxHp: 0.25 },
  capture: {
    scale: 0.5,
    minChance: 0.01,
    maxChance: 0.75,
    statusBonus: {
      none: 1, burn: 1.5, poison: 1.5, badlyPoisoned: 1.5, paralysis: 1.5, freeze: 2, sleep: 2.5,
    },
  },
  switching: { incomingStartsAtZeroBar: true },
}
