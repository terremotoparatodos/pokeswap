import { describe, expect, it } from 'vitest'
import { createSeededRandom } from '../../domain/rng'
import { MIN_SWINGS, miningPose, miningTimeline, REWARD_MS, strikesBetween, SWING_MS, SWING_TOTAL_MS } from './miningAction'
import { highestRarity, rarityOfItem, rewardRarity } from './miningRarity'
import { MAX_PARTICLES, spawnImpact, stepParticles } from './particles'
import { nodeVisual, respawnFrame, type NodeVisualInput } from './nodeVisualState'

describe('mining action timeline', () => {
  it('fills the authorized duration with swings and never resolves early', () => {
    expect(miningTimeline(100).swings).toBe(MIN_SWINGS)
    expect(miningTimeline(1500).swings).toBe(3)
    for (const durationMs of [1200, 3000, 4400, 6000]) expect(miningTimeline(durationMs).resultAtMs).toBeGreaterThanOrEqual(durationMs)
    const timeline = miningTimeline(1500)
    expect(timeline.resultAtMs).toBe(3 * SWING_TOTAL_MS)
    expect(timeline.totalMs).toBe(timeline.resultAtMs + REWARD_MS)
  })

  it('walks windup → strike → recoil for each swing, then reward and done', () => {
    const timeline = miningTimeline(1000)
    expect(miningPose(timeline, 0)).toMatchObject({ phase: 'windup', swing: 0, toolFrame: 0 })
    expect(miningPose(timeline, SWING_MS.windup)).toMatchObject({ phase: 'strike', toolFrame: 2 })
    expect(miningPose(timeline, SWING_MS.windup).nodeShake).not.toBe(0)
    expect(miningPose(timeline, SWING_MS.windup + SWING_MS.strike + 10)).toMatchObject({ phase: 'recoil', toolFrame: 1 })
    expect(miningPose(timeline, SWING_TOTAL_MS + 5)).toMatchObject({ phase: 'windup', swing: 1 })
    expect(miningPose(timeline, timeline.resultAtMs + REWARD_MS / 2)).toMatchObject({ phase: 'reward', rewardProgress: 0.5 })
    expect(miningPose(timeline, timeline.totalMs)).toMatchObject({ phase: 'done', nodeShake: 0 })
  })

  it('reports each strike exactly once across frame boundaries', () => {
    const timeline = miningTimeline(1500)
    let last = 0
    const hits: number[] = []
    for (let t = 16; t <= timeline.totalMs; t += 16) {
      hits.push(...strikesBetween(timeline, last, t))
      last = t
    }
    expect(hits).toEqual([0, 1, 2])
  })
})

describe('drop rarity', () => {
  it('ranks materials by grade and results by their best drop', () => {
    expect(rarityOfItem('stone')).toBe('common')
    expect(rarityOfItem('iron_ore')).toBe('uncommon')
    expect(rarityOfItem('gold_ore')).toBe('rare')
    expect(rarityOfItem('crystal')).toBe('special')
    expect(rarityOfItem('unknown')).toBe('common')
    expect(highestRarity(['common', 'rare', 'uncommon'])).toBe('rare')
    expect(rewardRarity([{ itemId: 'coal', quantity: 1, bonus: false }])).toBe('common')
    expect(rewardRarity([{ itemId: 'coal', quantity: 2, bonus: true }])).toBe('uncommon')
    expect(rewardRarity([{ itemId: 'revival_herb', quantity: 1, bonus: false }])).toBe('special')
  })
})

describe('impact particles', () => {
  const random = createSeededRandom(7)
  const burst = (rarity: 'common' | 'special') => spawnImpact([], { x: 0, y: 0, z: 6, rarity, away: 1, random })

  it('scales the burst with rarity and caps the pool', () => {
    expect(burst('special').filter(p => p.kind === 'glint').length).toBeGreaterThan(0)
    expect(burst('common').some(p => p.kind === 'glint')).toBe(false)
    let pool = burst('common')
    for (let i = 0; i < 20; i++) pool = spawnImpact(pool, { x: 0, y: 0, z: 6, rarity: 'special', away: -1, random })
    expect(pool.length).toBeLessThanOrEqual(MAX_PARTICLES)
  })

  it('falls to the ground and expires', () => {
    let pool = burst('common')
    for (let i = 0; i < 20; i++) pool = stepParticles(pool, 0.02)
    for (const particle of pool) expect(particle.z).toBeGreaterThanOrEqual(0)
    for (let i = 0; i < 60; i++) pool = stepParticles(pool, 0.02)
    expect(pool).toEqual([])
  })
})

describe('node visual state', () => {
  const input = (overrides: Partial<NodeVisualInput> = {}): NodeVisualInput => ({
    status: 'available', adjacent: false, targeted: false, mining: false,
    respawnInSeconds: 0, respawnSeconds: 240, rareNode: false, detected: false, ...overrides,
  })

  it('stays quiet at a distance and invites when adjacent', () => {
    expect(nodeVisual(input())).toMatchObject({ visual: 'available', bubble: null, ring: 'none', glint: false })
    expect(nodeVisual(input({ adjacent: true }))).toMatchObject({ visual: 'interactable', bubble: 'pick', ring: 'soft' })
    expect(nodeVisual(input({ adjacent: true, targeted: true }))).toMatchObject({ visual: 'targeted', ring: 'strong' })
    expect(nodeVisual(input({ mining: true }))).toMatchObject({ visual: 'in_progress', art: 'ready' })
  })

  it('separates depleted from respawning by art', () => {
    expect(nodeVisual(input({ status: 'depleted' }))).toMatchObject({ visual: 'depleted', art: 'depleted' })
    const regrowing = nodeVisual(input({ status: 'depleted', respawnInSeconds: 60 }))
    expect(regrowing).toMatchObject({ visual: 'respawning', art: 'respawning' })
    expect(regrowing.respawnProgress).toBeCloseTo(0.75)
    expect(respawnFrame(0.75, 3)).toBe(2)
    expect(respawnFrame(0, 3)).toBe(0)
  })

  it('marks locks only up close and glints rare nodes only when detected', () => {
    expect(nodeVisual(input({ status: 'locked_level' })).bubble).toBeNull()
    expect(nodeVisual(input({ status: 'locked_level', adjacent: true })).bubble).toBe('lock')
    expect(nodeVisual(input({ rareNode: true })).glint).toBe(false)
    expect(nodeVisual(input({ rareNode: true, detected: true }))).toMatchObject({ visual: 'rare', glint: true })
  })
})
