import { describe, expect, it } from 'vitest'
import { APTITUDE_BONUS_CHANCE, APTITUDE_DURATION, MIN_ACTION_MS, RHYTHM } from './balance'
import { resolveAptitude } from './aptitude/aptitude'
import { allSpeciesFacts } from './aptitude/speciesFacts'
import { CROP_BY_ID, FARM_ACTION_MS, TEND_BONUS_UNITS, type PlotSnapshot } from './farming'
import { RESOURCE_BY_ID } from './resources'
import { SKILL_IDS, type SkillId } from './skills'
import { evaluateWork, rhythmMultiplier, rollDrop, workDuration, type WorkTarget } from './workRules'
import { totalXpForLevel } from './xpCurve'

const xpAt = (levels: Partial<Record<SkillId, number>>): Record<SkillId, number> =>
  Object.fromEntries(SKILL_IDS.map(id => [id, totalXpForLevel(levels[id] ?? 1)])) as Record<SkillId, number>

const gather = (resourceId: string): WorkTarget => ({ kind: 'gather', resourceId })
const plot = (over: Partial<PlotSnapshot> = {}): PlotSnapshot => ({ plotId: 'p1', kind: 'town', stage: 'EMPTY', cropId: null, tended: false, ...over })

const GEODUDE = 74
const SCYTHER = 123
const MAGIKARP = 129
const SUDOWOODO = 185

describe('requirements: the skill level is the gate', () => {
  it('lets a level-1 player work the first rung of every skill', () => {
    for (const target of [gather('common_tree'), gather('stone_outcrop'), { kind: 'farm', action: 'plant', plot: plot(), cropId: 'oran' } as WorkTarget]) {
      expect(evaluateWork({ target, skillXp: xpAt({}), workerSpeciesId: MAGIKARP }).ok).toBe(true)
    }
  })

  it('refuses a resource above the player level and says which level', () => {
    const result = evaluateWork({ target: gather('iron_vein'), skillXp: xpAt({ mining: 19 }), workerSpeciesId: GEODUDE })
    expect(result).toMatchObject({ ok: false, reason: 'level_too_low', skillId: 'mining', requiredLevel: 20, playerLevel: 19 })
    expect(evaluateWork({ target: gather('iron_vein'), skillXp: xpAt({ mining: 20 }), workerSpeciesId: GEODUDE }).ok).toBe(true)
  })

  it('uses the right skill for each resource: mining XP does not open trees', () => {
    expect(evaluateWork({ target: gather('pine_tree'), skillXp: xpAt({ mining: 50 }), workerSpeciesId: SCYTHER }).ok).toBe(false)
  })

  it('refuses unknown resources', () => {
    expect(evaluateWork({ target: gather('shore_spot'), skillXp: xpAt({}), workerSpeciesId: GEODUDE })).toMatchObject({ ok: false, reason: 'unknown_resource' })
  })
})

describe('no tools: the Pokémon does the work', () => {
  it('lets every one of the 493 species work every level-1 resource', () => {
    for (const facts of allSpeciesFacts()) {
      for (const id of ['common_tree', 'stone_outcrop']) {
        expect(evaluateWork({ target: gather(id), skillXp: xpAt({}), workerSpeciesId: facts.speciesId }).ok, `${facts.name} ${id}`).toBe(true)
      }
    }
  })

  it('has no tool anywhere in its inputs or terms', () => {
    const result = evaluateWork({ target: gather('common_tree'), skillXp: xpAt({}), workerSpeciesId: SCYTHER })
    expect(JSON.stringify(result)).not.toMatch(/tool|pickaxe|axe"|hoe|sickle|rod|durab|energy/i)
  })
})

describe('aptitude: efficiency everywhere, a gate only at the top', () => {
  it('asks aptitude 2 only for the top rung', () => {
    const result = evaluateWork({ target: gather('boreal_tree'), skillXp: xpAt({ woodcutting: 50 }), workerSpeciesId: SUDOWOODO })
    expect(result).toMatchObject({ ok: false, reason: 'aptitude_too_low', minAptitude: 2, aptitude: 1 })
    expect(evaluateWork({ target: gather('hardwood_tree'), skillXp: xpAt({ woodcutting: 50 }), workerSpeciesId: SUDOWOODO }).ok).toBe(true)
  })

  it('makes a specialist faster and luckier than a clumsy worker on the same tree', () => {
    const levels = xpAt({ woodcutting: 12 })
    const fast = evaluateWork({ target: gather('pine_tree'), skillXp: levels, workerSpeciesId: SCYTHER })
    const slow = evaluateWork({ target: gather('pine_tree'), skillXp: levels, workerSpeciesId: SUDOWOODO })
    if (!fast.ok || !slow.ok) throw new Error('both should be allowed')
    expect(fast.terms.aptitude).toBe(5)
    expect(slow.terms.aptitude).toBe(1)
    expect(fast.terms.durationMs).toBeLessThan(slow.terms.durationMs)
    expect(fast.terms.drop!.bonusChance).toBeGreaterThan(slow.terms.drop!.bonusChance)
  })

  it('gives the same XP whatever the Pokémon: XP is what the player learns', () => {
    const levels = xpAt({ mining: 20 })
    const a = evaluateWork({ target: gather('iron_vein'), skillXp: levels, workerSpeciesId: GEODUDE })
    const b = evaluateWork({ target: gather('iron_vein'), skillXp: levels, workerSpeciesId: MAGIKARP })
    expect(a.ok && b.ok && a.terms.xp === b.terms.xp).toBe(true)
  })
})

describe('duration modifiers', () => {
  it('scales by aptitude around the aptitude-3 reference', () => {
    expect(workDuration(4000, 3, 1)).toBe(4000)
    expect(workDuration(4000, 5, 1)).toBe(Math.round(4000 * APTITUDE_DURATION[5]))
    expect(workDuration(4000, 1, 1)).toBe(Math.round(4000 * APTITUDE_DURATION[1]))
  })

  it('gets faster with Ritmo every ten levels, not every level', () => {
    expect(rhythmMultiplier(9)).toBe(1)
    expect(rhythmMultiplier(10)).toBeCloseTo(1 - RHYTHM.reduction)
    expect(rhythmMultiplier(19)).toBeCloseTo(1 - RHYTHM.reduction)
    expect(rhythmMultiplier(50)).toBeCloseTo(1 - 5 * RHYTHM.reduction)
  })

  it('never goes below the floor', () => {
    expect(workDuration(500, 5, 50)).toBe(MIN_ACTION_MS)
  })
})

describe('reward rules', () => {
  const drop = { itemId: 'stone' as const, min: 1, max: 1, bonusChance: 0.25, guaranteedBonus: 0 }

  it('gives the base amount without the bonus roll', () => {
    expect(rollDrop(drop, () => 0.99)).toEqual({ itemId: 'stone', quantity: 1, bonus: false })
  })

  it('adds one unit when the aptitude roll hits', () => {
    expect(rollDrop(drop, () => 0.1)).toEqual({ itemId: 'stone', quantity: 2, bonus: true })
  })

  it('rolls ranges inclusively and adds guaranteed units', () => {
    const range = { itemId: 'oran_berry' as const, min: 2, max: 3, bonusChance: 0, guaranteedBonus: 1 }
    expect(rollDrop(range, () => 0).quantity).toBe(3)
    expect(rollDrop(range, () => 0.999).quantity).toBe(4)
  })

  it('never rolls a bonus for an aptitude-1 worker', () => {
    expect(APTITUDE_BONUS_CHANCE[1]).toBe(0)
  })
})

describe('farming lifecycle', () => {
  const farm = (action: 'plant' | 'tend' | 'harvest', snapshot: PlotSnapshot, cropId: 'oran' | 'sitrus' | 'revival' | null = null, level = 50): ReturnType<typeof evaluateWork> =>
    evaluateWork({ target: { kind: 'farm', action, plot: snapshot, cropId }, skillXp: xpAt({ farming: level }), workerSpeciesId: 1 })

  it('plants on an empty plot and gives plant XP but no items', () => {
    const result = farm('plant', plot(), 'oran')
    if (!result.ok) throw new Error(result.reason)
    expect(result.terms.xp).toBe(CROP_BY_ID.get('oran')!.xp.plant)
    expect(result.terms.drop).toBeNull()
  })

  it('refuses illegal transitions', () => {
    expect(farm('plant', plot({ stage: 'GROWING', cropId: 'oran' }), 'oran')).toMatchObject({ ok: false, reason: 'plot_not_empty' })
    expect(farm('harvest', plot({ stage: 'GROWING', cropId: 'oran' }))).toMatchObject({ ok: false, reason: 'plot_not_ready' })
    expect(farm('tend', plot({ stage: 'READY', cropId: 'oran' }))).toMatchObject({ ok: false, reason: 'plot_not_growing' })
    expect(farm('tend', plot({ stage: 'GROWING', cropId: 'oran', tended: true }))).toMatchObject({ ok: false, reason: 'already_tended' })
    expect(farm('plant', plot(), null)).toMatchObject({ ok: false, reason: 'unknown_crop' })
  })

  it('keeps the best crops to fertile soil', () => {
    expect(farm('plant', plot({ kind: 'town' }), 'sitrus')).toMatchObject({ ok: false, reason: 'wrong_plot_kind' })
    expect(farm('plant', plot({ kind: 'fertile' }), 'sitrus').ok).toBe(true)
  })

  it('pays the harvest with items, plus a unit when the crop was tended', () => {
    const plain = farm('harvest', plot({ stage: 'READY', cropId: 'oran' }))
    const tended = farm('harvest', plot({ stage: 'READY', cropId: 'oran', tended: true }))
    if (!plain.ok || !tended.ok) throw new Error('harvest should be allowed')
    expect(plain.terms.drop!.guaranteedBonus).toBe(0)
    expect(tended.terms.drop!.guaranteedBonus).toBe(TEND_BONUS_UNITS)
    expect(plain.terms.durationMs).toBe(workDuration(FARM_ACTION_MS.harvest, resolveAptitude(1, 'farming').value, 50))
  })

  it('level-gates planting', () => {
    expect(farm('plant', plot({ kind: 'fertile' }), 'revival', 41)).toMatchObject({ ok: false, reason: 'level_too_low', requiredLevel: 42 })
  })
})

describe('early and midgame cases', () => {
  it('a brand-new player with a random starter can do all three skills', () => {
    for (const starter of [1, 4, 7, 152, 155, 158, 252, 255, 258, 387, 390, 393]) {
      expect(evaluateWork({ target: gather('common_tree'), skillXp: xpAt({}), workerSpeciesId: starter }).ok).toBe(true)
      expect(evaluateWork({ target: gather('stone_outcrop'), skillXp: xpAt({}), workerSpeciesId: starter }).ok).toBe(true)
      expect(evaluateWork({ target: { kind: 'farm', action: 'plant', plot: plot(), cropId: 'oran' }, skillXp: xpAt({}), workerSpeciesId: starter }).ok).toBe(true)
    }
  })

  it('a level-30 miner reaches iron but not gold', () => {
    const levels = xpAt({ mining: 30 })
    expect(evaluateWork({ target: gather('iron_vein'), skillXp: levels, workerSpeciesId: GEODUDE }).ok).toBe(true)
    expect(evaluateWork({ target: gather('gold_vein'), skillXp: levels, workerSpeciesId: GEODUDE })).toMatchObject({ ok: false, requiredLevel: 35 })
  })

  it('pays more XP per second on the rung you just unlocked than on the first one', () => {
    const perSecond = (id: string) => {
      const resource = RESOURCE_BY_ID.get(id)!
      return resource.xp / resource.baseDurationMs
    }
    expect(perSecond('pine_tree')).toBeGreaterThan(perSecond('common_tree'))
    expect(perSecond('boreal_tree')).toBeGreaterThan(perSecond('hardwood_tree'))
    expect(perSecond('crystal_cluster')).toBeGreaterThan(perSecond('gold_vein'))
  })
})
