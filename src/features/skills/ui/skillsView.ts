// What the Skills UI shows, computed without Vue or the DOM.
//
// Priority of the panel: "¿dónde estoy y qué desbloqueo después?". Each row is
// a level, a bar, the next unlock; the roadmap and the best worker of the
// party are one tap away. No wiki.

import { resolveAptitude } from '../domain/aptitude/aptitude'
import { speciesDisplayName } from '../domain/aptitude/speciesFacts'
import type { Aptitude } from '../domain/aptitude/aptitudeScale'
import { workDuration } from '../domain/workRules'
import { nextUnlock, roadmap, type RoadmapEntry, type Unlock } from '../domain/roadmap'
import { materialName } from '../domain/materials'
import { RESOURCES, type ResourceDefinition } from '../domain/resources'
import { SKILLS, SKILL_IDS, type SkillId } from '../domain/skills'
import { levelProgress } from '../domain/xpCurve'
import type { WorkerRef } from '../local/localSkillsSession'
import type { SettleResult } from '../service/skillsService'

export interface SkillRowView {
  readonly id: SkillId
  readonly name: string
  readonly icon: string
  readonly level: number
  readonly fraction: number
  readonly intoLevel: number
  readonly span: number
  readonly atCap: boolean
  readonly next: Unlock | null
  readonly roadmap: readonly RoadmapEntry[]
}

export function skillRows(xp: Readonly<Record<SkillId, number>>): readonly SkillRowView[] {
  return SKILL_IDS.map(id => {
    const progress = levelProgress(xp[id] ?? 0)
    return {
      id, name: SKILLS[id].name, icon: SKILLS[id].icon,
      level: progress.level, fraction: progress.fraction, intoLevel: progress.intoLevel, span: progress.span, atCap: progress.atCap,
      next: nextUnlock(id, progress.level), roadmap: roadmap(id, progress.level),
    }
  })
}

export const totalLevel = (rows: readonly SkillRowView[]): number => rows.reduce((sum, row) => sum + row.level, 0)

export interface WorkerOption {
  readonly instanceId: string
  readonly speciesId: number
  readonly name: string
  readonly aptitude: Aptitude
  /** Below the resource's minimum aptitude. */
  readonly unable: boolean
  readonly seconds: number
}

/** The party as seen from one resource: who can do it and how fast. Best first, ties in party order. */
export function workerOptions(workers: readonly WorkerRef[], resource: ResourceDefinition, playerLevel: number): readonly WorkerOption[] {
  return workers
    .map((worker, index) => {
      const aptitude = resolveAptitude(worker.speciesId, resource.skill).value
      return {
        index,
        option: {
          instanceId: worker.instanceId, speciesId: worker.speciesId, name: speciesDisplayName(worker.speciesId), aptitude,
          unable: aptitude < resource.minAptitude,
          seconds: Math.round(workDuration(resource.baseDurationMs, aptitude, playerLevel) / 100) / 10,
        },
      }
    })
    .sort((a, b) => b.option.aptitude - a.option.aptitude || a.index - b.index)
    .map(entry => entry.option)
}

/** "Machamp ★★★★★" for a skill, or null with an empty party. */
export function bestWorker(workers: readonly WorkerRef[], skill: SkillId): { readonly name: string; readonly aptitude: Aptitude } | null {
  let best: { name: string; aptitude: Aptitude } | null = null
  for (const worker of workers) {
    const aptitude = resolveAptitude(worker.speciesId, skill).value
    if (!best || aptitude > best.aptitude) best = { name: speciesDisplayName(worker.speciesId), aptitude }
  }
  return best
}

/** What to do about a locked node: "Tenés Talar 7 · seguí con Árbol común". */
export function trainingTip(resource: ResourceDefinition, playerLevel: number): string {
  const skill = SKILLS[resource.skill].name
  const workable = RESOURCES.filter(entry => entry.skill === resource.skill && entry.requiredLevel <= playerLevel)
  const best = workable[workable.length - 1]
  return best ? `Tenés ${skill} ${playerLevel} · seguí con ${best.name}` : `Tenés ${skill} ${playerLevel}`
}

export interface ResultView {
  readonly xpLine: string | null
  readonly items: readonly { readonly itemId: string; readonly quantity: number; readonly name: string }[]
  /** "¡Scyther consiguió uno extra!" when the aptitude roll hit. */
  readonly bonusLine: string | null
  readonly levelUpLine: string | null
  readonly unlockLines: readonly string[]
}

export function resultView(result: SettleResult | null, workerName: string | null): ResultView | null {
  if (!result || (result.status !== 'settled' && result.status !== 'already_settled')) return null
  const { settlement } = result
  if (settlement.outcome !== 'completed') return null
  const skill = SKILLS[settlement.skillId].name
  return {
    xpLine: settlement.xpGained > 0 ? `+${settlement.xpGained} XP ${skill}` : null,
    items: settlement.rewards.map(reward => ({ itemId: reward.itemId, quantity: reward.quantity, name: materialName(reward.itemId) })),
    bonusLine: settlement.rewards.some(reward => reward.bonus) && workerName ? `¡${workerName} consiguió uno extra!` : null,
    levelUpLine: result.levelUpLine,
    unlockLines: result.unlocks.map(unlock => (unlock.kind === 'rhythm' ? `${unlock.title}: ${unlock.detail.toLowerCase()}` : `Nuevo: ${unlock.title}`)),
  }
}
