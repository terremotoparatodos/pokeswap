// The rules of one piece of work, as pure functions.
//
//   Skill level  →  may the player work this at all?        (the only hard gate)
//   Aptitude     →  how well does this Pokémon do it?       (speed, bonus units)
//   Ritmo        →  how practised is the player?            (speed, per 10 levels)
//
// Level gates, aptitude does not — except the top rung of each ladder, which
// asks for aptitude 2 so that a specialist resource feels specialised. Every
// species is at least 1 and most are 2+, so no player is ever stuck for want
// of "the right type".
//
// XP does not depend on the Pokémon: it measures what the *player* learned.
// A specialist earns more XP per hour only because it finishes sooner.

import { APTITUDE_BONUS_CHANCE, APTITUDE_DURATION, MAX_SKILL_LEVEL, MIN_ACTION_MS, RHYTHM } from './balance'
import { resolveAptitude } from './aptitude/aptitude'
import type { Aptitude } from './aptitude/aptitudeScale'
import {
  CROP_BY_ID, FARM_ACTION_MS, TEND_BONUS_UNITS, checkPlotTransition,
  type CropId, type FarmAction, type PlotRejection, type PlotSnapshot,
} from './farming'
import type { MaterialId } from './materials'
import { RESOURCE_BY_ID } from './resources'
import type { SkillId } from './skills'
import { levelForXp } from './xpCurve'

export type WorkTarget =
  | { readonly kind: 'gather'; readonly resourceId: string }
  | { readonly kind: 'farm'; readonly action: FarmAction; readonly plot: PlotSnapshot; readonly cropId?: CropId | null }

export type WorkRejection =
  | 'unknown_resource' | 'level_too_low' | 'aptitude_too_low' | 'invalid_target' | PlotRejection

/** What an authorization locks in. Settlement uses these, never fresh input. */
export interface WorkTerms {
  readonly skillId: SkillId
  readonly target: WorkTarget
  readonly subjectId: string
  readonly subjectName: string
  readonly requiredLevel: number
  readonly playerLevel: number
  readonly aptitude: Aptitude
  readonly minAptitude: Aptitude
  readonly durationMs: number
  readonly xp: number
  /** Items on completion; null for actions that only teach (plant, tend). */
  readonly drop: WorkDrop | null
}

export interface WorkDrop {
  readonly itemId: MaterialId
  readonly min: number
  readonly max: number
  /** Chance of one extra unit (aptitude). */
  readonly bonusChance: number
  /** Guaranteed extra units (a tended crop). */
  readonly guaranteedBonus: number
}

export type WorkEvaluation =
  | { readonly ok: true; readonly terms: WorkTerms }
  | {
      readonly ok: false
      readonly reason: WorkRejection
      readonly skillId: SkillId | null
      readonly requiredLevel: number | null
      readonly playerLevel: number | null
      readonly minAptitude: Aptitude | null
      readonly aptitude: Aptitude | null
    }

export interface WorkInput {
  readonly target: WorkTarget
  /** The player's XP in each skill. */
  readonly skillXp: Readonly<Record<SkillId, number>>
  /** Species of the PokemonInstance doing the work. */
  readonly workerSpeciesId: number
}

/** 1 − reduction per full RHYTHM.everyLevels of skill level. Level 10 → 0.96, 50 → 0.80. */
export function rhythmMultiplier(level: number): number {
  const steps = Math.floor(Math.max(0, Math.min(MAX_SKILL_LEVEL, level)) / RHYTHM.everyLevels)
  return 1 - steps * RHYTHM.reduction
}

export function workDuration(baseMs: number, aptitude: Aptitude, level: number): number {
  return Math.max(MIN_ACTION_MS, Math.round(baseMs * APTITUDE_DURATION[aptitude] * rhythmMultiplier(level)))
}

interface Subject {
  readonly skillId: SkillId
  readonly subjectId: string
  readonly subjectName: string
  readonly requiredLevel: number
  readonly minAptitude: Aptitude
  readonly baseMs: number
  readonly xp: number
  readonly drop: Omit<WorkDrop, 'bonusChance'> | null
}

type SubjectLookup = { readonly ok: true; readonly subject: Subject } | { readonly ok: false; readonly reason: WorkRejection }

function subjectOf(target: WorkTarget): SubjectLookup {
  if (target.kind === 'gather') {
    const resource = RESOURCE_BY_ID.get(target.resourceId)
    if (!resource) return { ok: false, reason: 'unknown_resource' }
    return {
      ok: true,
      subject: {
        skillId: resource.skill, subjectId: resource.id, subjectName: resource.name,
        requiredLevel: resource.requiredLevel, minAptitude: resource.minAptitude,
        baseMs: resource.baseDurationMs, xp: resource.xp,
        drop: { ...resource.drop, guaranteedBonus: 0 },
      },
    }
  }
  if (target.kind !== 'farm' || !target.plot) return { ok: false, reason: 'invalid_target' }
  const cropId = target.action === 'plant' ? target.cropId ?? null : target.plot.cropId
  const plotProblem = checkPlotTransition(target.action, target.plot, cropId)
  if (plotProblem) return { ok: false, reason: plotProblem }
  const crop = CROP_BY_ID.get(cropId ?? '')!
  const harvest = target.action === 'harvest'
  return {
    ok: true,
    subject: {
      skillId: 'farming', subjectId: crop.id, subjectName: crop.name,
      requiredLevel: crop.requiredLevel, minAptitude: crop.minAptitude,
      baseMs: FARM_ACTION_MS[target.action], xp: crop.xp[target.action],
      drop: harvest ? { ...crop.harvest, guaranteedBonus: target.plot.tended ? TEND_BONUS_UNITS : 0 } : null,
    },
  }
}

/**
 * Decides whether this worker may do this work now, and on what terms.
 * Physical checks (distance, availability, ownership, concurrency) are
 * WORLD's and happen before this is called.
 */
export function evaluateWork(input: WorkInput): WorkEvaluation {
  const lookup = subjectOf(input.target)
  if (!lookup.ok) {
    return { ok: false, reason: lookup.reason, skillId: null, requiredLevel: null, playerLevel: null, minAptitude: null, aptitude: null }
  }
  const { subject } = lookup
  const playerLevel = levelForXp(input.skillXp[subject.skillId] ?? 0)
  const aptitude = resolveAptitude(input.workerSpeciesId, subject.skillId).value
  const refusal = (reason: WorkRejection): WorkEvaluation => ({
    ok: false, reason, skillId: subject.skillId, requiredLevel: subject.requiredLevel, playerLevel,
    minAptitude: subject.minAptitude, aptitude,
  })
  if (playerLevel < subject.requiredLevel) return refusal('level_too_low')
  if (aptitude < subject.minAptitude) return refusal('aptitude_too_low')
  return {
    ok: true,
    terms: {
      skillId: subject.skillId, target: input.target, subjectId: subject.subjectId, subjectName: subject.subjectName,
      requiredLevel: subject.requiredLevel, playerLevel, aptitude, minAptitude: subject.minAptitude,
      durationMs: workDuration(subject.baseMs, aptitude, playerLevel),
      xp: subject.xp,
      drop: subject.drop ? { ...subject.drop, bonusChance: APTITUDE_BONUS_CHANCE[aptitude] } : null,
    },
  }
}

export interface RolledReward {
  readonly itemId: MaterialId
  readonly quantity: number
  /** The aptitude roll added a unit. */
  readonly bonus: boolean
}

/** Rolls the items of a completed action. `random` must be server-side for persistent rewards. */
export function rollDrop(drop: WorkDrop, random: () => number): RolledReward {
  const span = drop.max - drop.min + 1
  const base = drop.min + Math.min(span - 1, Math.floor(random() * span))
  const bonus = random() < drop.bonusChance
  return { itemId: drop.itemId, quantity: base + drop.guaranteedBonus + (bonus ? 1 : 0), bonus }
}
