import { describe, expect, it } from 'vitest'
import { craftingFeedback, gatheringFeedback, inventoryFeedback } from './feedback'

const base = { ok: true as const, drops: [{ itemId: 'iron_ore', quantity: 2 }], rareDrops: [], fineUnits: 0, critical: false, energySpent: 19.5, actionSeconds: 14.84, xp: 110, durabilityLoss: 1 }
const context = { profession: 'mining' as const, leveledUp: false, newLevel: 16, toolBroke: false, hasTool: true }

describe('gathering feedback', () => {
  it('lists items, XP, energy and wear in that order', () => {
    expect(gatheringFeedback(base, context).map(line => line.text)).toEqual([
      '+2 Mineral de Hierro', '+110 XP Minería', '−19,5 energía', '−1 durabilidad',
    ])
  })

  it('makes rarities, criticals, level-ups and breakage stand out', () => {
    const lines = gatheringFeedback(
      { ...base, rareDrops: [{ itemId: 'evolution_shard', quantity: 1 }], critical: true, durabilityLoss: 0 },
      { ...context, leveledUp: true, newLevel: 17, toolBroke: true },
    )
    expect(lines.filter(line => line.tone === 'rare').map(line => line.text)).toEqual(['+1 Fragmento Evolutivo', 'Botín doble'])
    expect(lines.map(line => line.text)).toContain('Sin desgaste')
    expect(lines.find(line => line.tone === 'level')?.text).toBe('¡Minería sube a Nv. 17!')
    expect(lines[lines.length - 1]).toEqual({ text: 'Tu herramienta se rompió', tone: 'warn' })
  })

  it('omits wear when gathering bare-handed', () => {
    expect(gatheringFeedback(base, { ...context, hasTool: false }).some(line => line.tone === 'wear')).toBe(false)
  })
})

describe('inventory feedback', () => {
  it('announces completed stacks, new slots and pending overflow once each', () => {
    const lines = inventoryFeedback(
      [
        { itemId: 'iron_ore', newStack: false, filledStack: true },
        { itemId: 'iron_ore', newStack: true, filledStack: false },
        { itemId: 'coal', newStack: false, filledStack: false },
      ],
      [{ itemId: 'coal', quantity: 1 }],
    )
    expect(lines.map(line => line.text)).toEqual([
      'Stack de Mineral de Hierro completo', 'Nuevo espacio: Mineral de Hierro', 'No entró: 1 Carbón (queda pendiente)',
    ])
  })
})

describe('crafting feedback', () => {
  it('shows produced, consumed, savings and XP', () => {
    const lines = craftingFeedback(
      { ok: true, consumed: [{ itemId: 'oran_berry', quantity: 3 }], produced: [{ itemId: 'potion', quantity: 2 }], savedInputs: 1, seconds: 15, xp: 16 },
      'alchemy', false, 12,
    )
    expect(lines.map(line => line.text)).toEqual(['+2 Poción', '−3 Baya Aranja', 'Tu Pokémon ahorró 1 insumo', '+16 XP Alquimia'])
  })
})
