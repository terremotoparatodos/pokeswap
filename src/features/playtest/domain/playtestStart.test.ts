// The PLAYTEST RULE that everything else leans on: level 1, empty hands.
//
// Two claims are being made in `ProfessionWorldDemo`'s `fresh` prop, and both
// are the kind that is easy to assert and embarrassing to get wrong:
//
//   1. a player with **no tool** can still work a tier-1 node, so the Tienda is
//      a safety net rather than a gate;
//   2. the first levels of the real curve are cheap enough that a two-hour
//      session visibly moves the number, so nobody has to invent a multiplier.

import { describe, expect, it } from 'vitest'
import { GATHERING_NODES } from '../../professions/domain/catalog/nodes'
import { ENERGY_CONFIG } from '../../professions/domain/catalog/professions'
import { previewGathering } from '../../professions/domain/gathering'
import { levelForXp, totalXpForLevel } from '../../professions/domain/progression'
import { PROFESSION_IDS, type GatheringContext } from '../../professions/domain/types'

const nodeById = (id: string) => GATHERING_NODES.find(node => node.id === id)!

const context = (nodeId: string, professionLevel: number): GatheringContext => {
  const node = nodeById(nodeId)
  return {
    node,
    professionLevel,
    // The whole point: nothing equipped.
    tool: null,
    bonuses: {},
    access: [],
    homeBiomes: [],
    biome: node.biomes[0],
    availableEnergy: ENERGY_CONFIG.baseMax,
    rested: false,
    energyConfig: ENERGY_CONFIG,
    random: () => 0,
  }
}

/** The cheapest node of each profession: what a level-1 player can reach. */
const STARTER_NODES = ['stone_outcrop', 'common_tree', 'shore_spot', 'berry_bush'] as const

describe('starting with nothing', () => {
  it('has a level-1 node for every profession, so nobody starts locked out', () => {
    const professions = STARTER_NODES.map(id => nodeById(id).profession)
    expect(new Set(professions)).toEqual(new Set(PROFESSION_IDS))
    for (const id of STARTER_NODES) expect(nodeById(id).requiredLevel, id).toBe(1)
  })

  it('lets a player with no tool work every one of them', () => {
    for (const id of STARTER_NODES) {
      const check = previewGathering(context(id, 1))
      expect(check.ok, `${id} refused a bare-handed player`).toBe(true)
      if (check.ok) {
        expect(check.preview.bareHands, id).toBe(true)
        expect(check.preview.xp, id).toBeGreaterThan(0)
        // Slower without a tool, which is what makes the shop worth visiting.
        expect(check.preview.actionSeconds, id).toBeGreaterThan(nodeById(id).baseActionSeconds * 0.9)
      }
    }
  })

  it('refuses a node above the starting level, so the curve still means something', () => {
    const check = previewGathering(context('iron_vein', 1))
    expect(check.ok).toBe(false)
    if (!check.ok) expect(check.reason).toBe('level_too_low')
  })
})

describe('the real curve, at the levels a playtest actually sees', () => {
  it('reaches level 2 in a couple of swings', () => {
    const perSwing = nodeById('stone_outcrop').xp
    expect(Math.ceil(totalXpForLevel(2) / perSwing)).toBeLessThanOrEqual(2)
  })

  it('moves several levels inside one session, unlike a mid-career start', () => {
    const perSwing = nodeById('stone_outcrop').xp
    // Energy is the real limit: a full bar buys this many actions.
    const swings = Math.floor(ENERGY_CONFIG.baseMax / nodeById('stone_outcrop').energyCost)
    const fromScratch = levelForXp(swings * perSwing)
    expect(fromScratch).toBeGreaterThanOrEqual(5)

    // The same effort on top of the dev demo's starting Minería (16) is barely
    // half a level — which is exactly why the playtest starts at 1.
    const midCareer = levelForXp(totalXpForLevel(16) + swings * perSwing)
    expect(midCareer).toBeLessThanOrEqual(17)
  })
})
