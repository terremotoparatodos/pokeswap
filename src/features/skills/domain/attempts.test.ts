import { describe, expect, it } from 'vitest'
import { ATTEMPTS, TIER_MAX_CHANCE } from './balance'
import {
  attemptCap, attemptChance, attemptDistribution, attemptQuantile, drawAttempts, expectedAttempts, isValidAttemptMs, levelProgress,
} from './attempts'
import type { Aptitude } from './aptitude/aptitudeScale'
import { CROPS, FARM_ACTION_MS, type FarmAction } from './farming'
import { RESOURCES, RESOURCE_BY_ID } from './resources'

// SKILLS PROB-2. Every number here is exact and deterministic: the formula is
// checked against the audit's table (docs/design/SKILLS_PROB_1_AUDIT.md §2.6)
// and the draw against scripted randomness. No Monte Carlo gate.

const TICK = 600

const chanceOf = (resourceId: string, level: number, aptitude: Aptitude = 3, attemptMs = TICK) => {
  const resource = RESOURCE_BY_ID.get(resourceId)!
  return attemptChance({ level, requiredLevel: resource.requiredLevel, baseMs: resource.baseDurationMs, tier: resource.tier, aptitude, attemptMs })
}
const meanMs = (chance: number) => TICK * expectedAttempts(chance, attemptCap(chance))
/** A random source that returns `values` in order (then fails loudly). */
const script = (...values: number[]) => () => {
  if (!values.length) throw new Error('the draw asked for more rolls than scripted')
  return values.shift()!
}

describe('chance per attempt: the audit table, γ = 2, tick 600 ms, aptitude 3', () => {
  const table: [string, number, number, number][] = [
    // resource, level, p, cap
    ['common_tree', 1, 0.16, 19],
    ['common_tree', 10, 0.186651, 17],
    ['common_tree', 20, 0.27878, 11],
    ['common_tree', 30, 0.436714, 7],
    ['common_tree', 40, 0.660454, 5],
    ['common_tree', 50, 0.95, 4],
    ['stone_outcrop', 1, 0.15, 20],
    ['pine_tree', 12, 0.133333, 23],
    ['pine_tree', 50, 0.85, 4],
    ['hardwood_tree', 25, 0.109091, 28],
    ['iron_vein', 50, 0.72, 5],
    ['gold_vein', 35, 0.092308, 33],
    ['crystal_cluster', 45, 0.08, 38],
    ['crystal_cluster', 50, 0.48, 7],
  ]
  for (const [id, level, p, cap] of table) {
    it(`${id} at level ${level}: p ≈ ${p}, cap ${cap}`, () => {
      const chance = chanceOf(id, level)
      expect(chance).toBeCloseTo(p, 5)
      expect(attemptCap(chance)).toBe(cap)
    })
  }

  it('reaches each tier’s pMax at level 50 with aptitude 3', () => {
    for (const resource of RESOURCES) expect(chanceOf(resource.id, 50)).toBeCloseTo(TIER_MAX_CHANCE[resource.tier], 10)
    expect(TIER_MAX_CHANCE).toEqual({ 'muy básico': 0.95, básico: 0.85, intermedio: 0.72, avanzado: 0.58, especializado: 0.48 })
  })

  it('at the unlock level equals tick / (1.25 · base duration)', () => {
    for (const resource of RESOURCES) {
      expect(chanceOf(resource.id, resource.requiredLevel)).toBeCloseTo(TICK / (ATTEMPTS.unlockSlowdown * resource.baseDurationMs), 10)
    }
  })

  it('follows x² between the two anchors (γ = 2)', () => {
    const at = (level: number) => chanceOf('common_tree', level)
    const low = at(1)
    const high = at(50)
    const x = (25 - 1) / 49
    expect(at(25)).toBeCloseTo(low + (high - low) * x * x, 10)
  })
})

describe('chance per attempt: shape and bounds', () => {
  it('never falls with level and never falls with aptitude', () => {
    for (const resource of RESOURCES) {
      for (let level = resource.requiredLevel; level < 50; level++) expect(chanceOf(resource.id, level + 1)).toBeGreaterThanOrEqual(chanceOf(resource.id, level))
      for (let level = resource.requiredLevel; level <= 50; level += 7) {
        for (const aptitude of [1, 2, 3, 4] as Aptitude[]) {
          expect(chanceOf(resource.id, level, (aptitude + 1) as Aptitude)).toBeGreaterThan(chanceOf(resource.id, level, aptitude))
        }
      }
    }
  })

  it('is always in (0, 1], and never above the cap of 0.98', () => {
    for (const resource of RESOURCES) {
      for (let level = 1; level <= 60; level++) {
        for (const aptitude of [1, 2, 3, 4, 5] as Aptitude[]) {
          for (const attemptMs of [ATTEMPTS.minTickMs, TICK, ATTEMPTS.maxTickMs]) {
            const chance = chanceOf(resource.id, level, aptitude, attemptMs)
            expect(chance).toBeGreaterThan(0)
            expect(chance).toBeLessThanOrEqual(ATTEMPTS.chanceCap)
          }
        }
      }
    }
  })

  it('does not divide by zero for a resource that unlocks at the level cap', () => {
    const at50 = (level: number) => attemptChance({ level, requiredLevel: 50, baseMs: 3000, tier: 'especializado', aptitude: 3, attemptMs: TICK })
    expect(levelProgress(50, 50)).toBe(1)
    expect(levelProgress(49, 50)).toBe(0)
    expect(Number.isFinite(at50(50))).toBe(true)
    expect(at50(50)).toBeCloseTo(0.48, 10)
  })

  it('treats levels below the unlock as the unlock and above 50 as 50', () => {
    expect(chanceOf('pine_tree', 3)).toBe(chanceOf('pine_tree', 12))
    expect(chanceOf('pine_tree', 70)).toBe(chanceOf('pine_tree', 50))
  })

  it('accepts only integer ticks between 400 and 1200 ms', () => {
    expect([400, 600, 1200].every(isValidAttemptMs)).toBe(true)
    expect([0, 2, 399, 1201, 600.5, NaN, '600', null, undefined].some(isValidAttemptMs)).toBe(false)
  })
})

describe('what a player feels (expected time, aptitude 3 unless said)', () => {
  it('a beginner on a basic resource averages 3–5 s, whatever the Pokémon', () => {
    for (const id of ['common_tree', 'stone_outcrop']) {
      for (const aptitude of [1, 2, 3, 4, 5] as Aptitude[]) {
        const ms = meanMs(chanceOf(id, 1, aptitude))
        expect(ms, `${id} aptitude ${aptitude}`).toBeGreaterThanOrEqual(2_950)
        expect(ms, `${id} aptitude ${aptitude}`).toBeLessThanOrEqual(5_000)
      }
    }
    expect(meanMs(chanceOf('common_tree', 1))).toBeCloseTo(3_613.4, 0)
  })

  it('a level-50 player usually succeeds on the very first tick of a basic resource', () => {
    const chance = chanceOf('common_tree', 50)
    expect(attemptDistribution(chance, attemptCap(chance))[0]).toBeCloseTo(0.95, 10)
    expect(attemptQuantile(chance, attemptCap(chance), 0.9)).toBe(1)
    expect(meanMs(chance)).toBeCloseTo(631.6, 0)
  })

  it('nobody waits past the cap: the worst case is ⌈3/p⌉ ticks', () => {
    const chance = chanceOf('common_tree', 1)
    expect(attemptCap(chance) * TICK).toBe(11_400)
    expect(attemptQuantile(chance, attemptCap(chance), 0.99)).toBe(19)
  })
})

describe('the cap: ⌈3 / p⌉, inside [3, 40]', () => {
  it('is ⌈3/p⌉ in the normal range', () => {
    for (const p of [0.08, 0.1, 0.16, 0.3, 0.5, 0.75]) expect(attemptCap(p)).toBe(Math.ceil(3 / p))
  })

  it('never goes below 3 nor above 40', () => {
    expect(attemptCap(0.98)).toBe(4)
    expect(attemptCap(1)).toBe(ATTEMPTS.minAttempts)
    expect(attemptCap(0.01)).toBe(ATTEMPTS.maxAttempts)
    // The one real case where 40 binds: a cúmulo cristalino at its unlock with an aptitude-2 worker.
    expect(Math.ceil(3 / chanceOf('crystal_cluster', 45, 2))).toBe(42)
    expect(attemptCap(chanceOf('crystal_cluster', 45, 2))).toBe(40)
  })
})

describe('the secret draw (scripted randomness)', () => {
  it('succeeds on the first attempt when the first roll is below p', () => {
    expect(drawAttempts(0.16, 19, script(0))).toBe(1)
    expect(drawAttempts(0.16, 19, script(0.159999))).toBe(1)
  })

  it('counts every failed roll before the success', () => {
    expect(drawAttempts(0.16, 19, script(0.16, 0.5, 0.99, 0.1))).toBe(4)
  })

  it('stops at the cap: the cap-th attempt always succeeds and costs no roll', () => {
    const rolls = Array<number>(18).fill(0.999999)
    const random = script(...rolls)
    expect(drawAttempts(0.16, 19, random)).toBe(19)
    expect(() => random()).toThrow('more rolls')
  })

  it('handles the extremes of the random source', () => {
    // 0 is the best roll, values close to 1 the worst.
    expect(drawAttempts(0.95, 4, script(0))).toBe(1)
    expect(drawAttempts(0.95, 4, script(0.9999999999, 0.9999999999, 0.9999999999))).toBe(4)
    // p = 1 always succeeds at once.
    expect(drawAttempts(1, 3, script(0.9999999999))).toBe(1)
  })

  it('never returns fewer than 1 or more than the cap', () => {
    for (const roll of [0, 0.25, 0.5, 0.75, 0.9999999999]) {
      const n = drawAttempts(0.3, 10, () => roll)
      expect(n).toBeGreaterThanOrEqual(1)
      expect(n).toBeLessThanOrEqual(10)
    }
  })
})

describe('the distribution, exactly', () => {
  it('is the capped geometric: P(n) = (1−p)^(n−1)·p, and the cap takes the rest', () => {
    const p = 0.16
    const cap = attemptCap(p)
    const distribution = attemptDistribution(p, cap)
    expect(distribution).toHaveLength(cap)
    for (let n = 1; n < cap; n++) expect(distribution[n - 1]).toBeCloseTo((1 - p) ** (n - 1) * p, 12)
    expect(distribution[cap - 1]).toBeCloseTo((1 - p) ** (cap - 1), 12)
    expect(distribution.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12)
  })

  it('has the mean the closed form says', () => {
    for (const p of [0.08, 0.16, 0.5, 0.95]) {
      const cap = attemptCap(p)
      const mean = attemptDistribution(p, cap).reduce((sum, q, i) => sum + q * (i + 1), 0)
      expect(expectedAttempts(p, cap)).toBeCloseTo(mean, 10)
    }
  })

  it('is what drawAttempts produces: inverting each roll lands on the same n', () => {
    // Deterministic: roll u < p succeeds, so a first roll in [0, p) is n = 1,
    // and a run of k failing rolls then a success is n = k + 1.
    const p = 0.25
    const cap = attemptCap(p)
    for (let k = 0; k < cap - 1; k++) {
      const rolls = [...Array<number>(k).fill(0.5), 0.1]
      expect(drawAttempts(p, cap, script(...rolls))).toBe(k + 1)
    }
  })

  it('makes waiting on always better than starting over once the cap is near (why restarts gain nothing)', () => {
    const p = 0.16
    const cap = attemptCap(p)
    const fresh = expectedAttempts(p, cap)
    for (let failed = 1; failed < cap; failed++) {
      // Remaining attempts after `failed` failures: a capped geometric with cap − failed.
      expect(expectedAttempts(p, cap - failed)).toBeLessThan(fresh)
    }
  })
})

describe('Agricultura: only the active interactions are attempts', () => {
  it('plant, tend and harvest each have a chance from FARM_ACTION_MS and the crop’s tier', () => {
    const actions: FarmAction[] = ['plant', 'tend', 'harvest']
    for (const crop of CROPS) {
      for (const action of actions) {
        const chance = attemptChance({ level: crop.requiredLevel, requiredLevel: crop.requiredLevel, baseMs: FARM_ACTION_MS[action], tier: crop.tier, aptitude: 3, attemptMs: TICK })
        expect(chance).toBeCloseTo(Math.min(ATTEMPTS.maxRequiredChance, TICK / (ATTEMPTS.unlockSlowdown * FARM_ACTION_MS[action])), 10)
      }
    }
    expect(CROPS.map(crop => crop.tier)).toEqual(['muy básico', 'básico', 'intermedio', 'avanzado', 'especializado'])
  })

  it('keeps every crop’s grow time as it was (growth is not probabilistic)', () => {
    expect(CROPS.map(crop => [crop.id, crop.growMs])).toEqual([
      ['oran', 90_000], ['medicinal', 180_000], ['leppa', 300_000], ['sitrus', 480_000], ['revival', 720_000],
    ])
  })
})
