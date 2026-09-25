// Catalog invariants: three skills, no fishing, every item has a purpose,
// and the world-as-tutorial rules the design depends on.

import { describe, expect, it } from 'vitest'
import { MAX_SKILL_LEVEL } from './balance'
import { CROPS } from './farming'
import { MATERIALS, MATERIAL_BY_ID } from './materials'
import { nextUnlock, roadmap, unlocksBetween, unlocksOf } from './roadmap'
import { RESOURCES, type ResourceDefinition } from './resources'
import { SKILLS, SKILL_IDS } from './skills'

describe('the three skills', () => {
  it('are exactly Talar, Minería and Agricultura', () => {
    expect([...SKILL_IDS]).toEqual(['woodcutting', 'mining', 'farming'])
    expect(SKILL_IDS.map(id => SKILLS[id].name)).toEqual(['Talar', 'Minería', 'Agricultura'])
  })

  it('have no trace of fishing', () => {
    const everything = JSON.stringify({ SKILLS, RESOURCES, CROPS, MATERIALS })
    expect(everything).not.toMatch(/fish|pesca|rod\b|caña|shore|reef|pearl|seaweed/i)
  })
})

describe('materials', () => {
  it('each answers "¿para qué quiero esto?"', () => {
    for (const material of MATERIALS) expect(material.purpose.length, material.id).toBeGreaterThan(10)
  })

  it('are all actually obtainable, and nothing drops an unknown item', () => {
    const obtainable = new Set([...RESOURCES.map(entry => entry.drop.itemId), ...CROPS.map(entry => entry.harvest.itemId)])
    expect(obtainable).toEqual(new Set(MATERIALS.map(entry => entry.id)))
    for (const id of obtainable) expect(MATERIAL_BY_ID.get(id)?.skill).toBeDefined()
  })
})

describe('ladders 1–50', () => {
  const ladder = (skill: 'woodcutting' | 'mining'): ResourceDefinition[] => RESOURCES.filter(entry => entry.skill === skill)

  it('start at level 1 and stay inside the provisional cap', () => {
    for (const skill of ['woodcutting', 'mining'] as const) {
      expect(ladder(skill)[0].requiredLevel).toBe(1)
      for (const entry of ladder(skill)) expect(entry.requiredLevel).toBeLessThanOrEqual(MAX_SKILL_LEVEL)
    }
    expect(CROPS[0].requiredLevel).toBe(1)
  })

  it('climb: each rung asks more, pays more, takes longer, lives further out', () => {
    for (const rungs of [ladder('woodcutting'), ladder('mining'), CROPS]) {
      for (let i = 1; i < rungs.length; i++) expect(rungs[i].requiredLevel).toBeGreaterThan(rungs[i - 1].requiredLevel)
    }
    for (const rungs of [ladder('woodcutting'), ladder('mining')]) {
      for (let i = 1; i < rungs.length; i++) {
        expect(rungs[i].xp).toBeGreaterThan(rungs[i - 1].xp)
        expect(rungs[i].baseDurationMs).toBeGreaterThan(rungs[i - 1].baseDurationMs)
        expect(rungs[i].world.minRing).toBeGreaterThanOrEqual(rungs[i - 1].world.minRing)
      }
    }
    for (let i = 1; i < CROPS.length; i++) {
      expect(CROPS[i].growMs).toBeGreaterThan(CROPS[i - 1].growMs)
      expect(CROPS[i].xp.harvest).toBeGreaterThan(CROPS[i - 1].xp.harvest)
    }
  })

  it('never leaves more than 10 levels without something new (resource, crop or Ritmo)', () => {
    for (const skill of SKILL_IDS) {
      const levels = [1, ...unlocksOf(skill).map(unlock => unlock.level), MAX_SKILL_LEVEL]
      for (let i = 1; i < levels.length; i++) expect(levels[i] - levels[i - 1], `${skill} ${levels[i - 1]}→${levels[i]}`).toBeLessThanOrEqual(10)
    }
  })

  it('gives every arc something to do: 1–10, 10–25, 25–40, 40–50', () => {
    for (const skill of SKILL_IDS) {
      const content = unlocksOf(skill).filter(unlock => unlock.kind !== 'rhythm').map(unlock => unlock.level)
      for (const [from, to] of [[1, 10], [10, 25], [25, 40], [40, 50]]) {
        expect(content.some(level => level >= from && level <= to), `${skill} ${from}-${to}`).toBe(true)
      }
    }
  })
})

describe('the map is the tutorial', () => {
  it('shows only level-1 resources right outside the first world (Pradera, ring 0)', () => {
    const nearSpawn = RESOURCES.filter(entry => entry.world.habitats.includes('grassland') && entry.world.minRing === 0)
    expect(nearSpawn.length).toBeGreaterThan(0)
    for (const entry of nearSpawn) expect(entry.requiredLevel, entry.id).toBe(1)
  })

  it('puts each skill\'s first rung near spawn', () => {
    for (const skill of ['woodcutting', 'mining'] as const) {
      expect(RESOURCES.some(entry => entry.skill === skill && entry.requiredLevel === 1 && entry.world.minRing === 0 && entry.world.habitats.includes('grassland'))).toBe(true)
    }
    expect(CROPS[0].plotKinds).toContain('town')
  })

  it('keeps level 25+ resources out of any area entrance', () => {
    for (const entry of RESOURCES.filter(resource => resource.requiredLevel >= 25)) expect(entry.world.minRing, entry.id).toBeGreaterThanOrEqual(1)
    for (const entry of RESOURCES.filter(resource => resource.requiredLevel >= 35)) expect(entry.world.minRing, entry.id).toBe(2)
  })
})

describe('unlock previews', () => {
  it('names the next thing to unlock', () => {
    expect(nextUnlock('mining', 1)).toMatchObject({ level: 10, kind: 'resource', id: 'coal_seam', title: 'Veta de carbón' })
    expect(nextUnlock('mining', 10)).toMatchObject({ level: 20, kind: 'resource', id: 'iron_vein' })
    expect(nextUnlock('woodcutting', 1)).toMatchObject({ level: 10, kind: 'rhythm' })
    expect(nextUnlock('farming', 42)).toMatchObject({ level: 50, kind: 'rhythm' })
    expect(nextUnlock('farming', 50)).toBeNull()
  })

  it('puts the new resource before the Ritmo when both land on the same level', () => {
    expect(unlocksBetween('mining', 9, 10).map(unlock => unlock.kind)).toEqual(['resource', 'rhythm'])
  })

  it('marks one entry as next and the rest as unlocked or locked', () => {
    const entries = roadmap('woodcutting', 12)
    expect(entries.filter(entry => entry.status === 'next')).toHaveLength(1)
    expect(entries.find(entry => entry.id === 'pine_tree')?.status).toBe('unlocked')
    expect(entries.find(entry => entry.id === 'boreal_tree')?.status).toBe('locked')
  })
})
