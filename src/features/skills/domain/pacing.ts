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
//                    one worker of the given aptitude; every action costs its
//                    expected time plus `overhead` seconds (walking, picking,
//                    the card), and a depleted node costs `walk / charges`
//                    more seconds (the catalog's advisory charges).
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
}

export const DEFAULT_PACING: PacingOptions = { aptitude: 3, overhead: 1.5, walk: 8, plots: PLOT_WORLD_HINTS.town.perPlayer }

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
    const charges = (resource.world.charges[0] + resource.world.charges[1]) / 2
    seconds += gatherActionMs(resource, level, options.aptitude, options.attemptMs) / 1000 + options.overhead + options.walk / charges
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
