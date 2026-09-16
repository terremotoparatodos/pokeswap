import { describe, expect, it } from 'vitest'
import { createSeededRandom } from '../domain/rng'
import {
  bitesBetween, CHOP_MS, CHOP_TOTAL_MS, choppingPose, choppingTimeline, FELL_MS, MAX_CHOPS, MIN_CHOPS, REWARD_MS,
} from './choppingTimeline'
import { leafAlpha, leafFrame, MAX_LEAVES, spawnLeaves, stepLeaves } from './leaves'
import { treeVisual, type TreeVisualInput } from './treeVisualState'

describe('chopping timeline', () => {
  it('maps action seconds to 2–4 bites and ends with the reward', () => {
    expect(choppingTimeline(1, false).chops).toBe(MIN_CHOPS)
    expect(choppingTimeline(12, false).chops).toBe(2)
    expect(choppingTimeline(60, false).chops).toBe(MAX_CHOPS)
    const timeline = choppingTimeline(18, false)
    expect(timeline.resultAtMs).toBe(timeline.chops * CHOP_TOTAL_MS)
    expect(timeline.totalMs).toBe(timeline.resultAtMs + REWARD_MS)
  })

  it('only makes the tree give way when the action takes its last charge', () => {
    const standing = choppingTimeline(18, false)
    const felling = choppingTimeline(18, true)
    expect(felling.resultAtMs - felling.fellAtMs).toBe(FELL_MS)
    expect(standing.resultAtMs).toBe(standing.fellAtMs)
    expect(felling.totalMs - standing.totalMs).toBe(FELL_MS)
    expect(choppingPose(standing, standing.fellAtMs - 1).phase).not.toBe('fell')
  })

  it('walks windup → bite → recoil, then the fall and the reward', () => {
    const timeline = choppingTimeline(12, true)
    expect(choppingPose(timeline, 0)).toMatchObject({ phase: 'windup', chop: 0, toolFrame: 0 })
    expect(choppingPose(timeline, CHOP_MS.windup)).toMatchObject({ phase: 'bite', toolFrame: 2 })
    expect(choppingPose(timeline, CHOP_MS.windup).trunkShake).not.toBe(0)
    expect(choppingPose(timeline, CHOP_MS.windup + CHOP_MS.bite + 10).phase).toBe('recoil')
    expect(choppingPose(timeline, CHOP_TOTAL_MS + 5)).toMatchObject({ phase: 'windup', chop: 1 })
    const falling = choppingPose(timeline, timeline.fellAtMs + FELL_MS / 2)
    expect(falling.phase).toBe('fell')
    expect(falling.fall).toBeCloseTo(0.5)
    expect(choppingPose(timeline, timeline.resultAtMs + REWARD_MS / 2)).toMatchObject({ phase: 'reward', fall: 1 })
    expect(choppingPose(timeline, timeline.totalMs).phase).toBe('done')
  })

  it('reports each bite exactly once across frame boundaries', () => {
    const timeline = choppingTimeline(18, true)
    let last = 0
    const hits: number[] = []
    for (let t = 16; t <= timeline.totalMs; t += 16) {
      hits.push(...bitesBetween(timeline, last, t))
      last = t
    }
    expect(hits).toEqual([0, 1, 2])
  })
})

describe('falling leaves', () => {
  const random = createSeededRandom(11)
  const burst = (count: number) => spawnLeaves([], { x: 0, y: 0, z: 24, count, tones: ['#2c7a37', '#44a043'], random })

  it('drifts sideways while it sinks, and caps the pool', () => {
    let pool = burst(4)
    const start = pool[0]
    for (let i = 0; i < 10; i++) pool = stepLeaves(pool, 0.03)
    expect(pool[0].z).toBeLessThan(start.z)
    expect(pool[0].x).not.toBe(start.x)
    let many = burst(4)
    for (let i = 0; i < 20; i++) many = spawnLeaves(many, { x: 0, y: 0, z: 24, count: 4, tones: ['#2c7a37'], random })
    expect(many.length).toBeLessThanOrEqual(MAX_LEAVES)
  })

  it('settles on the ground and then expires', () => {
    let pool = burst(3)
    for (let i = 0; i < 60; i++) pool = stepLeaves(pool, 0.03)
    for (const leaf of pool) expect(leaf.z).toBeGreaterThanOrEqual(0)
    for (let i = 0; i < 120; i++) pool = stepLeaves(pool, 0.03)
    expect(pool).toEqual([])
  })

  it('tumbles between two frames and fades at the end', () => {
    const leaf = burst(1)[0]
    const frames = new Set<number>()
    let pool = [leaf]
    for (let i = 0; i < 30; i++) {
      frames.add(leafFrame(pool[0]))
      pool = stepLeaves(pool, 0.03)
      if (!pool.length) break
    }
    expect(frames.size).toBe(2)
    expect(leafAlpha({ ...leaf, age: 0 })).toBe(1)
    expect(leafAlpha({ ...leaf, age: leaf.life * 0.95 })).toBeLessThan(1)
  })
})

describe('tree visual state', () => {
  const input = (overrides: Partial<TreeVisualInput> = {}): TreeVisualInput => ({
    status: 'available', adjacent: false, targeted: false, chopping: false,
    respawnInSeconds: 0, respawnSeconds: 90, rareTree: false, detected: false, ...overrides,
  })

  it('stays quiet at a distance and invites when adjacent', () => {
    expect(treeVisual(input())).toMatchObject({ visual: 'available', bubble: null, ring: 'none' })
    expect(treeVisual(input({ adjacent: true }))).toMatchObject({ visual: 'interactable', bubble: 'axe', ring: 'soft' })
    expect(treeVisual(input({ targeted: true }))).toMatchObject({ visual: 'targeted', ring: 'strong' })
    expect(treeVisual(input({ chopping: true }))).toMatchObject({ visual: 'chopping', art: 'ready' })
  })

  it('leaves a stump and grows it back through sprout and sapling', () => {
    expect(treeVisual(input({ status: 'depleted' }))).toMatchObject({ visual: 'stump', art: 'stump' })
    expect(treeVisual(input({ status: 'depleted', respawnInSeconds: 80 })).art).toBe('stump')
    expect(treeVisual(input({ status: 'depleted', respawnInSeconds: 50 })).art).toBe('sprout')
    expect(treeVisual(input({ status: 'depleted', respawnInSeconds: 10 })).art).toBe('sapling')
    expect(treeVisual(input({ status: 'depleted', respawnInSeconds: 10 })).regrowProgress).toBeCloseTo(0.888, 2)
  })

  it('marks locks only up close and glints rare trees only when detected', () => {
    expect(treeVisual(input({ status: 'locked_level' })).bubble).toBeNull()
    expect(treeVisual(input({ status: 'locked_level', adjacent: true })).bubble).toBe('lock')
    expect(treeVisual(input({ status: 'locked_access', adjacent: true })).visual).toBe('special_access')
    expect(treeVisual(input({ rareTree: true })).glint).toBe(false)
    expect(treeVisual(input({ rareTree: true, detected: true }))).toMatchObject({ visual: 'rare', glint: true })
  })
})
