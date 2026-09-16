import { describe, expect, it } from 'vitest'
import { canCastFrom, castFacing, castTile, hasDryBank, isStandable } from './fishingApproach'
import { FISHING_TUNING, fishingEndsAtMs, fishingPose, gradeReel, isCatch, planCast, type ReelGrade } from './fishingTimeline'
import { spotRespawnFrame, spotVisual, type SpotVisualInput } from './spotVisualState'

/** A coast: water everywhere with y >= 10, dry land above, one rock at (6, 8). */
const coast = {
  isWater: (_tx: number, ty: number) => ty >= 10,
  isSolid: (tx: number, ty: number) => tx === 6 && ty === 8,
}

describe('fishing approach', () => {
  it('knows dry, walkable ground', () => {
    expect(isStandable(coast, 5, 9)).toBe(true)
    expect(isStandable(coast, 5, 11)).toBe(false)
    expect(isStandable(coast, 6, 8)).toBe(false)
  })

  it('fishes from land on every bank orientation', () => {
    const shoreSpot = { tx: 5, ty: 9 }
    expect(hasDryBank(coast, shoreSpot)).toBe(true)
    expect(canCastFrom(coast, { tx: 5, ty: 8 }, shoreSpot)).toBe(true)
    expect(canCastFrom(coast, { tx: 4, ty: 9 }, shoreSpot)).toBe(true)
    expect(canCastFrom(coast, { tx: 6, ty: 9 }, shoreSpot)).toBe(true)
    // Standing in the water is refused while the spot still has a bank.
    expect(canCastFrom(coast, { tx: 5, ty: 10 }, shoreSpot)).toBe(false)
    // Diagonals and distance are not "beside".
    expect(canCastFrom(coast, { tx: 4, ty: 8 }, shoreSpot)).toBe(false)
    expect(canCastFrom(coast, { tx: 5, ty: 7 }, shoreSpot)).toBe(false)
  })

  it('lets an open reef be fished from the water, since it has no bank', () => {
    const reef = { tx: 3, ty: 14 }
    expect(hasDryBank(coast, reef)).toBe(false)
    expect(canCastFrom(coast, { tx: 3, ty: 13 }, reef)).toBe(true)
  })

  it('drops the line in the water beyond the bank, or on the spot itself', () => {
    expect(castTile(coast, { tx: 5, ty: 8 }, { tx: 5, ty: 9 })).toEqual({ tx: 5, ty: 10 })
    expect(castTile(coast, { tx: 3, ty: 13 }, { tx: 3, ty: 14 })).toEqual({ tx: 3, ty: 14 })
    // Casting along the coast still finds water next to the spot.
    expect(castTile(coast, { tx: 4, ty: 9 }, { tx: 5, ty: 9 })).toEqual({ tx: 5, ty: 10 })
    expect(castTile({ isWater: () => false, isSolid: () => false }, { tx: 0, ty: 0 }, { tx: 0, ty: 1 })).toBeNull()
  })

  it('faces the water it casts into', () => {
    expect(castFacing({ tx: 5, ty: 8 }, { tx: 5, ty: 10 }, 'up')).toBe('down')
    expect(castFacing({ tx: 8, ty: 11 }, { tx: 6, ty: 11 }, 'up')).toBe('left')
  })
})

describe('fishing timeline', () => {
  const plan = planCast(() => 0.5)

  it('casts, flies, waits and opens a bite window', () => {
    expect(plan.lineAtMs).toBe(FISHING_TUNING.castMs + FISHING_TUNING.flightMs)
    expect(plan.biteEndsAtMs - plan.biteAtMs).toBe(FISHING_TUNING.biteWindowMs)
    expect(fishingPose(plan, 0, null, false)).toMatchObject({ phase: 'cast', rodFrame: 0 })
    expect(fishingPose(plan, FISHING_TUNING.castMs + 10, null, false).phase).toBe('flight')
    expect(fishingPose(plan, plan.lineAtMs + 10, null, false)).toMatchObject({ phase: 'waiting', flight: 1 })
    expect(fishingPose(plan, plan.biteAtMs + 10, null, false)).toMatchObject({ phase: 'bite', sunk: true })
    expect(fishingPose(plan, plan.biteEndsAtMs + 10, null, false).phase).toBe('escaped')
  })

  it('grades the reaction: early, perfect, good, late, missed', () => {
    expect(gradeReel(plan, plan.biteAtMs - 200)).toBe('early')
    expect(gradeReel(plan, plan.biteAtMs + 10)).toBe('perfect')
    expect(gradeReel(plan, plan.biteAtMs + FISHING_TUNING.perfectMs + 50)).toBe('good')
    expect(gradeReel(plan, plan.biteEndsAtMs - 100)).toBe('late')
    expect(gradeReel(plan, plan.biteEndsAtMs + 1)).toBe('missed')
    expect((['perfect', 'good', 'late'] as ReelGrade[]).every(isCatch)).toBe(true)
    expect(isCatch('early')).toBe(false)
    expect(isCatch('missed')).toBe(false)
  })

  it('reels in, then rewards or lets the fish go', () => {
    const reelAt = plan.biteAtMs + 100
    expect(fishingPose(plan, reelAt + 10, reelAt, true).phase).toBe('reeling')
    expect(fishingPose(plan, reelAt + FISHING_TUNING.reelMs + 10, reelAt, true).phase).toBe('reward')
    expect(fishingPose(plan, reelAt + FISHING_TUNING.reelMs + 10, reelAt, false).phase).toBe('escaped')
    expect(fishingEndsAtMs(plan, reelAt, true)).toBe(reelAt + FISHING_TUNING.reelMs + FISHING_TUNING.rewardMs)
    expect(fishingEndsAtMs(plan, null, false)).toBe(plan.biteEndsAtMs + FISHING_TUNING.escapeMs)
    expect(fishingPose(plan, fishingEndsAtMs(plan, reelAt, true), reelAt, true).phase).toBe('done')
  })

  it('keeps the wait inside the tuned range', () => {
    expect(planCast(() => 0).biteAtMs - planCast(() => 0).lineAtMs).toBe(FISHING_TUNING.minWaitMs)
    expect(planCast(() => 1).biteAtMs - planCast(() => 1).lineAtMs).toBe(FISHING_TUNING.maxWaitMs)
  })
})

describe('spot visual state', () => {
  const input = (overrides: Partial<SpotVisualInput> = {}): SpotVisualInput => ({
    status: 'available', adjacent: false, targeted: false, fishing: false, biting: false,
    respawnInSeconds: 0, respawnSeconds: 90, rareSpot: false, detected: false, ...overrides,
  })

  it('stays quiet at a distance and invites when adjacent', () => {
    expect(spotVisual(input())).toMatchObject({ visual: 'available', bubble: null, ring: 'none' })
    expect(spotVisual(input({ adjacent: true }))).toMatchObject({ visual: 'interactable', bubble: 'rod', ring: 'soft' })
    expect(spotVisual(input({ targeted: true }))).toMatchObject({ visual: 'targeted', ring: 'strong' })
  })

  it('separates waiting from the bite', () => {
    expect(spotVisual(input({ fishing: true }))).toMatchObject({ visual: 'waiting', art: 'ready' })
    expect(spotVisual(input({ fishing: true, biting: true }))).toMatchObject({ visual: 'bite', art: 'bite' })
  })

  it('separates spent water from water that is filling up again', () => {
    expect(spotVisual(input({ status: 'depleted' }))).toMatchObject({ visual: 'depleted', art: 'spent' })
    const regrowing = spotVisual(input({ status: 'depleted', respawnInSeconds: 30 }))
    expect(regrowing).toMatchObject({ visual: 'respawning', art: 'respawning' })
    expect(regrowing.respawnProgress).toBeCloseTo(0.666, 2)
    expect(spotRespawnFrame(0.9, 3)).toBe(2)
    expect(spotRespawnFrame(0, 3)).toBe(0)
  })

  it('marks locks only up close and glints rare spots only when detected', () => {
    expect(spotVisual(input({ status: 'locked_level' })).bubble).toBeNull()
    expect(spotVisual(input({ status: 'locked_level', adjacent: true })).bubble).toBe('lock')
    expect(spotVisual(input({ status: 'locked_access', adjacent: true })).visual).toBe('special_access')
    expect(spotVisual(input({ rareSpot: true })).glint).toBe(false)
    expect(spotVisual(input({ rareSpot: true, detected: true }))).toMatchObject({ visual: 'rare', glint: true })
  })
})
