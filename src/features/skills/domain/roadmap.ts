// What each skill unlocks, and when. Derived from the catalogs and balance —
// never written by hand — so the Skills tab and the rules cannot disagree.
//
// Three kinds of unlock:
//   resource  a tree/rock you may now work           (Talar, Minería)
//   crop      something you may now plant            (Agricultura)
//   rhythm    you work faster in this skill          (every RHYTHM.everyLevels)

import { MAX_SKILL_LEVEL, RHYTHM } from './balance'
import { CROPS } from './farming'
import { materialName } from './materials'
import { RESOURCES } from './resources'
import type { SkillId } from './skills'

export type UnlockKind = 'resource' | 'crop' | 'rhythm'

export interface Unlock {
  readonly skillId: SkillId
  readonly level: number
  readonly kind: UnlockKind
  /** Resource or crop id; `rhythm-<level>` for Ritmo. */
  readonly id: string
  readonly title: string
  /** Short: what you get, or where to find it. */
  readonly detail: string
}

export type UnlockStatus = 'unlocked' | 'next' | 'locked'

const WHERE: Readonly<Record<string, string>> = {
  common_tree: 'Árboles en todas partes, desde la salida de la ciudad',
  pine_tree: 'Pinos del Bosque Umbrío',
  hardwood_tree: 'Lo profundo del Bosque Umbrío',
  boreal_tree: 'Tundra Helada, lejos de la entrada',
  stone_outcrop: 'Rocas sueltas, desde la salida de la ciudad',
  coal_seam: 'Rocas oscuras, un poco más lejos',
  iron_vein: 'Peñascos del Desierto y la Tundra',
  gold_vein: 'Lo más lejano del Desierto y la Tundra, y cuevas',
  crystal_cluster: 'Cuevas y la Tundra profunda',
}

function rhythmPercent(level: number): number {
  return Math.round(Math.floor(level / RHYTHM.everyLevels) * RHYTHM.reduction * 100)
}

function buildUnlocks(): readonly Unlock[] {
  const list: Unlock[] = []
  for (const resource of RESOURCES) {
    list.push({
      skillId: resource.skill, level: resource.requiredLevel, kind: 'resource', id: resource.id,
      title: resource.name, detail: `${materialName(resource.drop.itemId)} · ${WHERE[resource.id] ?? ''}`.trim(),
    })
  }
  for (const crop of CROPS) {
    const where = crop.plotKinds.includes('town') ? 'Huerta comunal' : 'Sólo tierra fértil'
    list.push({ skillId: 'farming', level: crop.requiredLevel, kind: 'crop', id: crop.id, title: crop.name, detail: `Plantar · ${where}` })
  }
  for (const skillId of ['woodcutting', 'mining', 'farming'] as const) {
    for (let level = RHYTHM.everyLevels; level <= MAX_SKILL_LEVEL; level += RHYTHM.everyLevels) {
      list.push({
        skillId, level, kind: 'rhythm', id: `rhythm-${level}`,
        title: `Ritmo ${level / RHYTHM.everyLevels}`, detail: `Todo trabajo ${rhythmPercent(level)} % más rápido`,
      })
    }
  }
  // Same level: the new thing to do comes before the speed-up.
  const order: Record<UnlockKind, number> = { resource: 0, crop: 0, rhythm: 1 }
  return list.sort((a, b) => a.level - b.level || order[a.kind] - order[b.kind])
}

const UNLOCKS = buildUnlocks()

export function unlocksOf(skillId: SkillId): readonly Unlock[] {
  return UNLOCKS.filter(unlock => unlock.skillId === skillId)
}

/** The first thing this level does not have yet, or null at the end of the arc. */
export function nextUnlock(skillId: SkillId, level: number): Unlock | null {
  return unlocksOf(skillId).find(unlock => unlock.level > level) ?? null
}

/** Unlocks gained going from `from` to `to` (exclusive, inclusive). For level-up feedback. */
export function unlocksBetween(skillId: SkillId, from: number, to: number): readonly Unlock[] {
  return unlocksOf(skillId).filter(unlock => unlock.level > from && unlock.level <= to)
}

export interface RoadmapEntry extends Unlock {
  readonly status: UnlockStatus
}

export function roadmap(skillId: SkillId, level: number): readonly RoadmapEntry[] {
  const next = nextUnlock(skillId, level)
  return unlocksOf(skillId).map(unlock => ({
    ...unlock,
    status: unlock.level <= level ? 'unlocked' : next && unlock.level === next.level && unlock.id === next.id ? 'next' : 'locked',
  }))
}
