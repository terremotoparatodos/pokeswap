// Skills pacing model (SKILLS PROB-2): how long 1→50 takes in each skill,
// from the real catalogs, the real XP curve and the CANONICAL probabilistic
// work model — the same functions and constants the server runs (through the
// realtime bundle) and the same work tick WORLD uses. There is no second
// formula here: an action's expected time is
//
//   WORK_TICK_MS × expectedAttempts(p, attemptCap(p)),  p = attemptChance(...)
//
// Model (deliberately simple, stated so it can be argued with):
//   Talar / Minería  the player always works the best resource unlocked, with
//                    one worker of the given aptitude. RESOURCE YIELD-2: one
//                    reservation of a node yields k units (k = the mean of the
//                    resource's normative stock range, `resource.stock`); the
//                    units' attempts run back to back (the commit pipeline),
//                    and `overhead` (picking, the card) and `walk` (to the next
//                    node) are paid ONCE PER NODE. Commits are strictly
//                    ordered, one `commit` of latency each: the sequence ends
//                    one latency after the last unit, plus whatever the
//                    commits fall behind the attempts when `commit` > t.
//                    Per unit:
//                        t + (overhead + walk + commit + (k − 1)·max(0, commit − t)) / k
//                    (multiYield.test.js measures the same end with simulated
//                    0.4 s and 1.5 s commits). `stock: 'single'` gives the
//                    world before YIELD-2 (k = 1).
//   Agricultura      `plots` plots in parallel on the best crop unlocked; each
//                    cycle is grow time + expected plant/tend/harvest time +
//                    `walk` seconds.
// It estimates active play, not a real player's evening. Used by
// scripts/skills/pacing.ts; drift is guarded by pacing.test.ts.

import { WORK_TICK_MS } from '../../../../services/realtime/src/world/worldProtocol.js'
import type { Aptitude } from './aptitude/aptitudeScale'
import { attemptCap, attemptChance, expectedAttempts } from './attempts'
import { MAX_SKILL_LEVEL } from './balance'
import { CROPS, FARM_ACTION_MS, PLOT_WORLD_HINTS, type CropDefinition, type FarmAction } from './farming'
import { RESOURCES, type ResourceDefinition } from './resources'
import { levelForXp } from './xpCurve'

export interface PacingOptions {
  readonly aptitude: Aptitude
  /** Seconds added to every gathering action. */
  readonly overhead: number
  /** Seconds to reach the next node / walk to the plots. */
  readonly walk: number
  readonly plots: number
  /** WORLD's work tick; defaults to the protocol's (tests may vary it within SKILLS' bounds). */
  readonly attemptMs?: number
  /** Seconds of the hosted commit that ends a sequence (0.4 typical, 1.5 bad). */
  readonly commit: number
  /** 'normative': k = the resource's mean stock (YIELD-2). 'single': one unit per node (before YIELD-2). */
  readonly stock: 'normative' | 'single'
}

export const DEFAULT_PACING: PacingOptions = { aptitude: 3, overhead: 1.5, walk: 8, plots: PLOT_WORLD_HINTS.town.perPlayer, commit: 0.4, stock: 'normative' }

/** Units one reservation of `resource` yields on average: the mean of its normative stock range. */
export function unitsPerNode(resource: ResourceDefinition, stock: PacingOptions['stock'] = 'normative'): number {
  return stock === 'single' ? 1 : (resource.stock[0] + resource.stock[1]) / 2
}

/** Seconds one unit costs in active play: its expected attempts plus its share of the per-node costs. */
export function gatherUnitSeconds(resource: ResourceDefinition, level: number, options: PacingOptions = DEFAULT_PACING): number {
  const k = unitsPerNode(resource, options.stock)
  const t = gatherActionMs(resource, level, options.aptitude, options.attemptMs) / 1000
  return t + (options.overhead + options.walk + options.commit + (k - 1) * Math.max(0, options.commit - t)) / k
}

export const PACING_MARKS = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50] as const

export interface PacingRow {
  readonly hours: number
  readonly subject: string
}

/** Expected milliseconds of one action, exactly as the server draws it (mean of the capped geometric × tick). */
export function expectedActionMs(input: { level: number; requiredLevel: number; baseMs: number; tier: ResourceDefinition['tier']; aptitude: Aptitude; attemptMs?: number }): number {
  const attemptMs: number = input.attemptMs ?? WORK_TICK_MS
  const chance = attemptChance({ ...input, attemptMs })
  return attemptMs * expectedAttempts(chance, attemptCap(chance))
}

export function gatherActionMs(resource: ResourceDefinition, level: number, aptitude: Aptitude, attemptMs: number = WORK_TICK_MS): number {
  return expectedActionMs({ level, requiredLevel: resource.requiredLevel, baseMs: resource.baseDurationMs, tier: resource.tier, aptitude, attemptMs })
}

export function farmActionMs(crop: CropDefinition, action: FarmAction, level: number, aptitude: Aptitude, attemptMs: number = WORK_TICK_MS): number {
  return expectedActionMs({ level, requiredLevel: crop.requiredLevel, baseMs: FARM_ACTION_MS[action], tier: crop.tier, aptitude, attemptMs })
}

export function gatherPacing(skill: 'woodcutting' | 'mining', options: PacingOptions = DEFAULT_PACING): Map<number, PacingRow> {
  const ladder = RESOURCES.filter(resource => resource.skill === skill)
  const out = new Map<number, PacingRow>()
  let xp = 0
  let seconds = 0
  while (levelForXp(xp) < MAX_SKILL_LEVEL) {
    const level = levelForXp(xp)
    const resource = [...ladder].reverse().find(entry => entry.requiredLevel <= level && entry.minAptitude <= options.aptitude)!
    seconds += gatherUnitSeconds(resource, level, options)
    xp += resource.xp
    const reached = levelForXp(xp)
    if (reached > level && (PACING_MARKS as readonly number[]).includes(reached)) out.set(reached, { hours: seconds / 3600, subject: resource.name })
  }
  return out
}

export function farmingPacing(options: PacingOptions = DEFAULT_PACING): Map<number, PacingRow> {
  const out = new Map<number, PacingRow>()
  let xp = 0
  let seconds = 0
  while (levelForXp(xp) < MAX_SKILL_LEVEL) {
    const level = levelForXp(xp)
    const crop = [...CROPS].reverse().find(entry => entry.requiredLevel <= level && entry.minAptitude <= options.aptitude)!
    const actions = (['plant', 'tend', 'harvest'] as const).reduce((sum, action) => sum + farmActionMs(crop, action, level, options.aptitude, options.attemptMs), 0) / 1000
    seconds += crop.growMs / 1000 + actions + options.walk
    xp += options.plots * (crop.xp.plant + crop.xp.tend + crop.xp.harvest)
    const reached = levelForXp(xp)
    if (reached > level) for (const mark of PACING_MARKS) if (mark > level && mark <= reached) out.set(mark, { hours: seconds / 3600, subject: crop.name })
  }
  return out
}
