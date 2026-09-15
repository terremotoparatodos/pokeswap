// Player energy ("Vigor") — the economic faucet regulator.
//
// Same lazy pattern as slots.energy: store (current, updatedAt) and derive
// regeneration on read. Time must come from the server clock; a client clock
// is untrusted (AGENTS.md §2).

import type { EnergyConfig, EnergyState } from './types'

const HOUR_MS = 3_600_000

const round2 = (value: number): number => Math.round(value * 100) / 100

export function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

export function maxEnergy(config: EnergyConfig, totalProfessionLevels: number): number {
  const steps = Math.floor(Math.max(0, totalProfessionLevels) / config.maxBonus.per)
  return config.baseMax + Math.min(config.maxBonus.cap, steps * config.maxBonus.bonus)
}

export function createEnergyState(max: number, now: number): EnergyState {
  return { current: max, rested: 0, updatedAt: now, consumableRestoredToday: 0, consumableDay: utcDay(now) }
}

function rollDay(state: EnergyState, now: number): EnergyState {
  const day = utcDay(now)
  return day === state.consumableDay ? state : { ...state, consumableRestoredToday: 0, consumableDay: day }
}

/**
 * Applies regeneration since `updatedAt`. Regeneration beyond a full bar is
 * banked as rested energy, which only boosts XP — it never creates resources.
 * A clock that moves backwards regenerates nothing.
 */
export function regenerateEnergy(state: EnergyState, config: EnergyConfig, now: number, max: number, regenBonus = 0): EnergyState {
  const rolled = rollDay(state, now)
  if (now <= rolled.updatedAt) return rolled
  const gained = ((now - rolled.updatedAt) / HOUR_MS) * config.regenPerHour * (1 + Math.max(0, regenBonus))
  const applied = Math.min(Math.max(0, max - rolled.current), gained)
  return {
    ...rolled,
    current: round2(rolled.current + applied),
    rested: round2(Math.min(config.restedCap, rolled.rested + (gained - applied))),
    updatedAt: now,
  }
}

/** Energy cost of one action after Pokémon and level reductions, floored by `minCostRatio`. */
export function actionEnergyCost(baseCost: number, energySaving: number, levelReduction: number, config: EnergyConfig): number {
  const saving = Math.min(1, Math.max(0, energySaving))
  const ratio = Math.max(config.minCostRatio, (1 - saving) * (1 - Math.max(0, levelReduction)))
  return round2(baseCost * ratio)
}

/** Returns null when the action cannot be afforded. `rested` tells whether the XP bonus applies. */
export function spendEnergy(state: EnergyState, amount: number): { state: EnergyState; rested: boolean } | null {
  if (amount < 0 || amount > state.current + 1e-9) return null
  return {
    state: { ...state, current: round2(Math.max(0, state.current - amount)), rested: round2(Math.max(0, state.rested - amount)) },
    rested: state.rested > 0,
  }
}

/** Consumables (Té de Vigor) restore energy up to a daily cap, so Alchemy cannot bypass the regulator. */
export function restoreEnergy(state: EnergyState, amount: number, config: EnergyConfig, now: number, max: number): { state: EnergyState; restored: number } {
  const rolled = rollDay(state, now)
  const restored = round2(Math.max(0, Math.min(amount, config.consumableDailyCap - rolled.consumableRestoredToday, max - rolled.current)))
  return {
    state: { ...rolled, current: round2(rolled.current + restored), consumableRestoredToday: round2(rolled.consumableRestoredToday + restored) },
    restored,
  }
}
