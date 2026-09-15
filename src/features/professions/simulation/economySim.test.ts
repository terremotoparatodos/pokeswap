import { describe, expect, it } from 'vitest'
import { runEconomySimulation } from './economySim'
import { EconomyLedger } from './economyLedger'
import { formatReport } from './report'
import { BASE_SCENARIO, SCENARIOS } from './scenarios'

const small = { ...BASE_SCENARIO, players: 20, days: 3 }

describe('economy ledger', () => {
  it('crafts missing intermediates recursively and tracks faucets and sinks', () => {
    const ledger = new EconomyLedger()
    ledger.add('stone', 10, 'gathered')
    ledger.add('coal', 5, 'gathered')
    ledger.add('oran_berry', 4, 'gathered')
    expect(ledger.consume('potion', 2, 'consumption')).toBe(2)
    const items = ledger.snapshot()
    expect(items.vial).toMatchObject({ crafted: 2, craftingInput: 2, endStock: 0 })
    expect(items.potion).toMatchObject({ crafted: 2, consumption: 2, shortage: 0 })
    expect(items.stone).toMatchObject({ gathered: 10, craftingInput: 2, endStock: 8 })
  })

  it('records shortage without partial removal when materials are missing', () => {
    const ledger = new EconomyLedger()
    ledger.add('iron_ingot', 1, 'gathered')
    expect(ledger.acquire([{ itemId: 'iron_ingot', quantity: 1 }, { itemId: 'coal', quantity: 1 }], 'repair')).toBe(false)
    expect(ledger.stockOf('iron_ingot')).toBe(1)
    expect(ledger.snapshot().coal.shortage).toBe(1)
  })
})

describe('economy simulation', () => {
  it('is deterministic for a seed', () => {
    expect(runEconomySimulation(small)).toEqual(runEconomySimulation(small))
  })

  it('never spends more energy than regeneration provided', () => {
    const report = runEconomySimulation(small)
    expect(report.actions).toBeGreaterThan(0)
    expect(report.energy.spent).toBeLessThanOrEqual(report.energy.available)
    expect(report.dailyStock).toHaveLength(small.days)
  })

  it('shows repairs as a real material sink', () => {
    const withRepair = runEconomySimulation({ ...BASE_SCENARIO, players: 20, days: 5 })
    const withoutRepair = runEconomySimulation({ ...BASE_SCENARIO, players: 20, days: 5, repairTools: false })
    expect(withRepair.durability.lost).toBeGreaterThan(0)
    expect(withRepair.durability.repairs).toBeGreaterThan(0)
    expect(Object.values(withRepair.items).reduce((sum, flow) => sum + flow.repair, 0)).toBeGreaterThan(0)
    expect(withoutRepair.durability.repairs).toBe(0)
    expect(withoutRepair.durability.toolsEquipped).toBeGreaterThan(withRepair.durability.toolsEquipped)
  })

  it('cannot sustain mining tools without woodcutting (interdependence)', () => {
    const report = runEconomySimulation({ ...SCENARIOS['mining-only'], players: 20, days: 5 })
    expect(report.items.plank?.shortage ?? 0).toBeGreaterThan(0)
    expect(report.bareHandActions).toBeGreaterThan(0)
  })

  it('renders a readable report', () => {
    const text = formatReport(runEconomySimulation(small))
    expect(text).toContain('Energía disponible')
    expect(text).toContain('Piedra')
  })
})
