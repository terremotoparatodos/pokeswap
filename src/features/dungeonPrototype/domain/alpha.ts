// The Alpha Boss: its modifier, its phases and how it scales (D4).
//
// APPROVED: the last floor holds an Alpha; it is a normal species from the
// dungeon's pool, drawn about twice the usual size with a red aura; it should
// feel roughly four times as powerful as an equivalent Pokémon — and explicitly
// **not** by multiplying every stat by four, and above all not Speed.
//
// PROTOTYPE ASSUMPTION: the split below. The target is an effective-power
// product near 4× reached almost entirely through bulk and damage, so the fight
// is long and dangerous rather than a coin flip against a blur.

import type { CombatModifiers } from './damage'
import type { DungeonTier } from './tiers'

export interface AlphaModifier {
  readonly hp: number
  readonly damageDealt: number
  /** Multiplies the Alpha's defences, i.e. divides the damage it takes. */
  readonly defense: number
  readonly speed: number
  /** 0…1 of an incoming status chance that is ignored. */
  readonly statusResistance: number
  /** Visual scale, for the lab to draw. */
  readonly size: number
}

/**
 * hp 2.5 × damage 1.35 × defence 1.15 ≈ 3.9 effective power, with Speed barely
 * touched (1.05) so the player still gets roughly one action per Alpha action.
 * Status resistance is what stops "paralyse it and win".
 */
export const BASE_ALPHA: AlphaModifier = {
  hp: 2.5, damageDealt: 1.35, defense: 1.15, speed: 1.05, statusResistance: 0.5, size: 2,
}

/** Deeper tiers lean a little further into bulk, never into Speed. */
const TIER_BULK: Readonly<Record<DungeonTier, number>> = { D: 0.9, C: 1, B: 1.05, A: 1.12, S: 1.2 }

export function alphaModifier(tier: DungeonTier, base: AlphaModifier = BASE_ALPHA): AlphaModifier {
  const bulk = TIER_BULK[tier]
  return { ...base, hp: Math.round(base.hp * bulk * 100) / 100 }
}

/**
 * The single number the design conversation is about: how much harder than a
 * normal Pokémon this thing is, as a product of bulk, damage and defence.
 */
export const effectivePowerMultiple = (modifier: AlphaModifier): number =>
  Math.round(modifier.hp * modifier.damageDealt * modifier.defense * 100) / 100

/** Phases: the Alpha hits harder as it falls. Readable, and it rewards pressure. */
export interface AlphaPhase {
  readonly index: number
  readonly fromHpFraction: number
  readonly damageBonus: number
}

export const ALPHA_PHASES: readonly AlphaPhase[] = [
  { index: 1, fromHpFraction: 1, damageBonus: 1 },
  { index: 2, fromHpFraction: 2 / 3, damageBonus: 1.15 },
  { index: 3, fromHpFraction: 1 / 3, damageBonus: 1.3 },
]

export const phaseFor = (hpFraction: number): AlphaPhase =>
  [...ALPHA_PHASES].reverse().find(phase => hpFraction <= phase.fromHpFraction) ?? ALPHA_PHASES[0]

// ── Co-op scaling ──────────────────────────────────────────────────────────

/**
 * APPROVED: up to four players, and for the prototype one player brings two
 * active Pokémon while two-to-four bring one each — at most four allies on
 * screen.
 *
 * PROTOTYPE ASSUMPTION: the scaling. Bulk grows clearly (+55 % per extra
 * player) while the Alpha's output grows slowly (+12 %), so a second player
 * helps without halving the fight and a fourth does not face a boss doing four
 * times the damage. Written as two separate knobs on purpose: the failure mode
 * to avoid is scaling everything by the party size.
 */
export const COOP = { hpPerExtraPlayer: 0.55, damagePerExtraPlayer: 0.12, maxPlayers: 4, maxActiveAllies: 4 } as const

export const activeAlliesFor = (players: number): number =>
  players <= 1 ? 2 : Math.min(COOP.maxActiveAllies, players)

export interface BossScaling {
  readonly players: number
  readonly hp: number
  readonly damageDealt: number
  readonly activeAllies: number
}

export function bossScaling(players: number, config = COOP): BossScaling {
  const clamped = Math.max(1, Math.min(config.maxPlayers, Math.round(players)))
  const extra = clamped - 1
  return {
    players: clamped,
    hp: Math.round((1 + config.hpPerExtraPlayer * extra) * 100) / 100,
    damageDealt: Math.round((1 + config.damagePerExtraPlayer * extra) * 100) / 100,
    activeAllies: activeAlliesFor(clamped),
  }
}

/** Everything the battle engine needs, as one set of modifiers. */
export function alphaCombatModifiers(
  tier: DungeonTier, players: number, hpFraction = 1,
): { modifiers: CombatModifiers; hpMultiplier: number; phase: AlphaPhase } {
  const alpha = alphaModifier(tier)
  const scaling = bossScaling(players)
  const phase = phaseFor(hpFraction)
  return {
    modifiers: {
      damageDealt: alpha.damageDealt * scaling.damageDealt * phase.damageBonus,
      damageTaken: 1 / alpha.defense,
      speed: alpha.speed,
      statusResistance: alpha.statusResistance,
    },
    hpMultiplier: alpha.hp * scaling.hp,
    phase,
  }
}
