import { describe, expect, it } from 'vitest'
import { ENERGY_CONFIG } from './catalog/professions'
import { actionEnergyCost, createEnergyState, maxEnergy, regenerateEnergy, restoreEnergy, spendEnergy } from './energy'
import type { EnergyState } from './types'

const HOUR = 3_600_000
const T0 = Date.UTC(2026, 8, 15, 10)
const empty = (overrides: Partial<EnergyState> = {}): EnergyState => ({ ...createEnergyState(600, T0), current: 0, ...overrides })

describe('energy capacity', () => {
  it('grows with total profession levels up to the cap', () => {
    expect(maxEnergy(ENERGY_CONFIG, 0)).toBe(600)
    expect(maxEnergy(ENERGY_CONFIG, 45)).toBe(680)
    expect(maxEnergy(ENERGY_CONFIG, 240)).toBe(800)
  })
})

describe('energy regeneration', () => {
  it('regenerates lazily and fills an empty bar in ten hours', () => {
    expect(regenerateEnergy(empty(), ENERGY_CONFIG, T0 + 5 * HOUR, 600).current).toBe(300)
    expect(regenerateEnergy(empty(), ENERGY_CONFIG, T0 + 10 * HOUR, 600)).toMatchObject({ current: 600, rested: 0 })
  })

  it('banks overflow as capped rested energy', () => {
    expect(regenerateEnergy(empty(), ENERGY_CONFIG, T0 + 12 * HOUR, 600)).toMatchObject({ current: 600, rested: 120 })
    expect(regenerateEnergy(empty(), ENERGY_CONFIG, T0 + 100 * HOUR, 600).rested).toBe(ENERGY_CONFIG.restedCap)
  })

  it('applies structure regen bonuses', () => {
    expect(regenerateEnergy(empty(), ENERGY_CONFIG, T0 + 5 * HOUR, 600, 0.1).current).toBe(330)
  })

  it('ignores a clock that moves backwards', () => {
    const state = empty({ current: 100 })
    expect(regenerateEnergy(state, ENERGY_CONFIG, T0 - HOUR, 600)).toMatchObject({ current: 100, updatedAt: T0 })
  })
})

describe('energy costs and spending', () => {
  it('reduces cost with Pokémon and level, never below the floor', () => {
    expect(actionEnergyCost(10, 0, 0, ENERGY_CONFIG)).toBe(10)
    expect(actionEnergyCost(10, 0.2, 0, ENERGY_CONFIG)).toBe(8)
    expect(actionEnergyCost(10, 0.5, 0.5, ENERGY_CONFIG)).toBe(6)
    expect(actionEnergyCost(10, 5, 0, ENERGY_CONFIG)).toBe(6)
  })

  it('refuses unaffordable actions and drains rested alongside energy', () => {
    expect(spendEnergy(empty({ current: 3 }), 4)).toBeNull()
    expect(spendEnergy(empty({ current: 3 }), -1)).toBeNull()
    const spent = spendEnergy(empty({ current: 10, rested: 3 }), 4)
    expect(spent).toEqual({ state: expect.objectContaining({ current: 6, rested: 0 }), rested: true })
    expect(spendEnergy(empty({ current: 10 }), 4)?.rested).toBe(false)
  })
})

describe('energy consumables', () => {
  it('enforces the daily cap and resets it on the next UTC day', () => {
    const first = restoreEnergy(empty(), 200, ENERGY_CONFIG, T0, 600)
    expect(first.restored).toBe(200)
    const second = restoreEnergy(first.state, 200, ENERGY_CONFIG, T0 + HOUR, 600)
    expect(second.restored).toBe(40)
    const nextDay = restoreEnergy(second.state, 200, ENERGY_CONFIG, T0 + 24 * HOUR, 600)
    expect(nextDay.restored).toBe(200)
  })

  it('never exceeds the bar', () => {
    expect(restoreEnergy(empty({ current: 590 }), 120, ENERGY_CONFIG, T0, 600).restored).toBe(10)
  })
})
