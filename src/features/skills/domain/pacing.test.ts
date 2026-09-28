// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { WORK_TICK_MS } from '../../../../services/realtime/src/world/worldProtocol.js'
import { praderaNodesNearSpawn } from '../../../../services/realtime/src/world/testing.js'
import { skillsResourceFor } from '../../worldSkills/resourceMapping'
import { resolveAptitude } from './aptitude/aptitude'
import type { Aptitude } from './aptitude/aptitudeScale'
import { attemptCap, attemptChance, attemptDistribution, isValidAttemptMs } from './attempts'
import { ATTEMPTS, TIER_MAX_CHANCE } from './balance'
import { CROP_BY_ID, FARM_ACTION_MS, type FarmAction } from './farming'
import { DEFAULT_PACING, expectedActionMs, farmActionMs, farmingPacing, gatherActionMs, gatherPacing } from './pacing'
import { RESOURCES, RESOURCE_BY_ID, type ResourceTier } from './resources'
import { totalXpForLevel } from './xpCurve'

// SKILLS PROB-2 drift guard: ONE probabilistic model. The server runs it from
// the generated bundle, the tests and the pacing tool from the TypeScript
// source; the tick comes from the wire contract. If any of them moves, this
// file fails.

describe('the canonical constants (change them here on purpose, or not at all)', () => {
  it('tick 600 ms, γ 2, unlock ×1.25, cap ⌈3/p⌉ in [3, 40], p ≤ 0.98, pMax by tier', () => {
    expect(WORK_TICK_MS).toBe(600)
    expect(isValidAttemptMs(WORK_TICK_MS)).toBe(true)
    expect({ ...ATTEMPTS }).toEqual({
      unlockSlowdown: 1.25, curveGamma: 2, maxRequiredChance: 0.5, chanceCap: 0.98, capFactor: 3, minAttempts: 3, maxAttempts: 40, minTickMs: 400, maxTickMs: 1200,
    })
    expect({ ...TIER_MAX_CHANCE }).toEqual({ 'muy básico': 0.95, básico: 0.85, intermedio: 0.72, avanzado: 0.58, especializado: 0.48 })
  })
})

describe('the pacing tool uses the canonical model, not a copy', () => {
  it('an action’s expected time is Σ n·P(n)·tick of the server’s capped geometric, for every resource, level and aptitude', () => {
    for (const resource of RESOURCES) {
      for (let level = resource.requiredLevel; level <= 50; level += 7) {
        for (const aptitude of [1, 3, 5] as Aptitude[]) {
          const p = attemptChance({ level, requiredLevel: resource.requiredLevel, baseMs: resource.baseDurationMs, tier: resource.tier, aptitude, attemptMs: WORK_TICK_MS })
          const mean = attemptDistribution(p, attemptCap(p)).reduce((sum, q, i) => sum + q * (i + 1), 0) * WORK_TICK_MS
          expect(gatherActionMs(resource, level, aptitude)).toBeCloseTo(mean, 6)
        }
      }
    }
  })

  it('defaults to the protocol’s tick', () => {
    const tree = RESOURCE_BY_ID.get('common_tree')!
    expect(gatherActionMs(tree, 1, 3)).toBe(gatherActionMs(tree, 1, 3, WORK_TICK_MS))
    expect(gatherActionMs(tree, 1, 3)).toBeCloseTo(3_613.4, 1)
    expect(gatherActionMs(tree, 50, 3)).toBeCloseTo(631.6, 1)
  })

  it('Agricultura: plant, tend and harvest use the crop’s tier and FARM_ACTION_MS', () => {
    const oran = CROP_BY_ID.get('oran')!
    for (const action of ['plant', 'tend', 'harvest'] as const) {
      expect(farmActionMs(oran, action, 1, 3)).toBe(expectedActionMs({ level: 1, requiredLevel: 1, baseMs: FARM_ACTION_MS[action], tier: 'muy básico', aptitude: 3 }))
    }
  })

  it('reaches 50 in every skill with the reference worker, in a plausible time', () => {
    for (const table of [gatherPacing('woodcutting'), gatherPacing('mining'), farmingPacing()]) {
      const top = table.get(50)!
      expect(top.hours).toBeGreaterThan(5)
      expect(top.hours).toBeLessThan(40)
      expect(table.get(10)!.hours).toBeLessThan(table.get(50)!.hours)
    }
    // Pinned so a model change is a visible diff (SKILLS_PROB_2_REPORT.md §12).
    expect(gatherPacing('woodcutting', DEFAULT_PACING).get(50)!.hours).toBeCloseTo(13.78, 2)
    expect(gatherPacing('mining', DEFAULT_PACING).get(50)!.hours).toBeCloseTo(19.66, 2)
    expect(farmingPacing(DEFAULT_PACING).get(50)!.hours).toBeCloseTo(19.08, 2)
  })
})

// ── The server's bundle against the TypeScript source ────────────────────────

interface BundlePolicy {
  authorizeWorkAttempt(attempt: unknown): Promise<{ ok: boolean; durationMs?: number; reason?: string }>
}
type CreatePolicy = (options: { store: unknown; random: () => number }) => BundlePolicy

const BUNDLE = '../../../../services/realtime/src/world/skills/skills.generated.js'
const speciesWith = (skill: 'woodcutting' | 'mining' | 'farming', aptitude: Aptitude): number => {
  for (let id = 1; id < 900; id++) if (resolveAptitude(id, skill).value === aptitude) return id
  throw new Error(`no species with ${skill} aptitude ${aptitude}`)
}

/** The server's policy for a player at `level` in `skill`, with a constant random roll. */
async function serverDuration(create: CreatePolicy, target: { node: unknown; farm?: unknown; skill: 'woodcutting' | 'mining' | 'farming' }, level: number, aptitude: Aptitude, roll: number): Promise<number> {
  const speciesId = speciesWith(target.skill, aptitude)
  const store = {
    async playerState() { return { xp: { [target.skill]: totalXpForLevel(level) }, materials: {}, pokemon: [] } },
    async commitWork() { throw new Error('not settled here') },
  }
  const policy = create({ store, random: () => roll })
  const answer = await policy.authorizeWorkAttempt({
    actionId: `drift-${Math.random().toString(16).slice(2)}`, playerId: 'drift', pokemon: { instanceId: speciesId, speciesId },
    node: target.node, workKind: 'x', requestedAt: 0, attemptMs: WORK_TICK_MS, ...(target.farm ? { farm: target.farm } : {}),
  })
  if (!answer.ok) throw new Error(`refused: ${answer.reason}`)
  return answer.durationMs!
}

/** The server's chance per attempt, recovered from its draw: one tick iff roll < p (bisection on the injected roll). */
async function serverChance(create: CreatePolicy, target: Parameters<typeof serverDuration>[1], level: number, aptitude: Aptitude): Promise<number> {
  let low = 0
  let high = 1
  for (let i = 0; i < 40; i++) {
    const mid = (low + high) / 2
    if ((await serverDuration(create, target, level, aptitude, mid)) === WORK_TICK_MS) low = mid
    else high = mid
  }
  return (low + high) / 2
}

describe('the realtime bundle runs exactly the TypeScript model (server = source = pacing)', async () => {
  const { createSkillsWorldPolicy } = (await import(/* @vite-ignore */ BUNDLE)) as { createSkillsWorldPolicy: CreatePolicy }
  const nodes = praderaNodesNearSpawn(40)
  const nodeOf = (resourceId: string) => nodes.find(({ node }) => skillsResourceFor(node)?.id === resourceId)?.node
  const gather = (resourceId: string, skill: 'woodcutting' | 'mining') => ({ node: nodeOf(resourceId), skill })
  const farm = (cropId: string, action: FarmAction, plotKind: 'town' | 'fertile') => ({
    node: { id: 'pradera:-7:-73:plot', resourceKind: 'plot', variantId: 'plot', areaId: 'pradera', tx: -7, ty: -73, zone: 0, biome: 'grassland' },
    farm: { action, plotKind, stage: action === 'plant' ? 'EMPTY' : action === 'tend' ? 'GROWING' : 'READY', cropId: action === 'plant' ? null : cropId, tended: false, requestedCropId: action === 'plant' ? cropId : null },
    skill: 'farming' as const,
  })

  const cases: { name: string; target: ReturnType<typeof gather> | ReturnType<typeof farm>; requiredLevel: number; baseMs: number; tier: ResourceTier; levels: number[] }[] = [
    { name: 'common_tree', target: gather('common_tree', 'woodcutting'), requiredLevel: 1, baseMs: 3000, tier: 'muy básico', levels: [1, 20, 50] },
    { name: 'pine_tree', target: gather('pine_tree', 'woodcutting'), requiredLevel: 12, baseMs: 3600, tier: 'básico', levels: [12, 30, 50] },
    { name: 'stone_outcrop', target: gather('stone_outcrop', 'mining'), requiredLevel: 1, baseMs: 3200, tier: 'muy básico', levels: [1, 35] },
    { name: 'plant oran', target: farm('oran', 'plant', 'town'), requiredLevel: 1, baseMs: FARM_ACTION_MS.plant, tier: 'muy básico', levels: [1, 50] },
    { name: 'tend medicinal', target: farm('medicinal', 'tend', 'town'), requiredLevel: 10, baseMs: FARM_ACTION_MS.tend, tier: 'básico', levels: [10, 40] },
    { name: 'harvest leppa', target: farm('leppa', 'harvest', 'town'), requiredLevel: 20, baseMs: FARM_ACTION_MS.harvest, tier: 'intermedio', levels: [20] },
    { name: 'plant sitrus', target: farm('sitrus', 'plant', 'fertile'), requiredLevel: 30, baseMs: FARM_ACTION_MS.plant, tier: 'avanzado', levels: [30, 50] },
    { name: 'harvest revival', target: farm('revival', 'harvest', 'fertile'), requiredLevel: 42, baseMs: FARM_ACTION_MS.harvest, tier: 'especializado', levels: [42, 50] },
  ]

  it('finds the fixtures', () => {
    for (const { name, target } of cases) expect(target.node, name).toBeTruthy()
  })

  for (const { name, target, requiredLevel, baseMs, tier, levels } of cases) {
    it(`${name}: same chance per attempt and same cap on the server as in the source and the pacing tool`, async () => {
      for (const level of levels) {
        for (const aptitude of [2, 5] as Aptitude[]) {
          const source = attemptChance({ level, requiredLevel, baseMs, tier, aptitude, attemptMs: WORK_TICK_MS })
          expect(await serverChance(createSkillsWorldPolicy, target, level, aptitude), `${name} Nv ${level} apt ${aptitude}`).toBeCloseTo(source, 9)
          // The worst roll lands on the cap, in whole ticks.
          expect(await serverDuration(createSkillsWorldPolicy, target, level, aptitude, 1 - 1e-12)).toBe(attemptCap(source) * WORK_TICK_MS)
          // And the pacing tool's expected time is built on that same p and cap.
          expect(expectedActionMs({ level, requiredLevel, baseMs, tier, aptitude })).toBeCloseTo(
            attemptDistribution(source, attemptCap(source)).reduce((sum, q, i) => sum + q * (i + 1), 0) * WORK_TICK_MS, 6,
          )
        }
      }
    })
  }

  it('the server refuses any other tick than the protocol’s bounds', async () => {
    const store = { async playerState() { return { xp: {}, materials: {}, pokemon: [] } }, async commitWork() { throw new Error('no') } }
    const policy = createSkillsWorldPolicy({ store, random: () => 0 })
    for (const attemptMs of [0, 399, 1201]) {
      const answer = await policy.authorizeWorkAttempt({
        actionId: `tick-${attemptMs}`, playerId: 'p', pokemon: { instanceId: 1, speciesId: 1 }, node: nodeOf('common_tree'), workKind: 'chop', requestedAt: 0, attemptMs,
      })
      expect(answer.ok).toBe(false)
    }
  })
})
