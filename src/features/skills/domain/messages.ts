// The few sentences Skills says to the player. Short, concrete, no wiki.

import type { Aptitude } from './aptitude/aptitudeScale'
import { SKILLS, type SkillId } from './skills'

type Refusal =
  | 'unknown_resource' | 'level_too_low' | 'aptitude_too_low' | 'invalid_target' | 'invalid_request' | 'duplicate_action'
  | 'plot_not_empty' | 'plot_not_growing' | 'plot_not_ready' | 'already_tended' | 'wrong_plot_kind' | 'unknown_crop'

/** "Requiere Minería 20" — the sentence that turns a locked rock into a goal. */
export function requirementLine(skillId: SkillId, level: number): string {
  return `Requiere ${SKILLS[skillId].name} ${level}`
}

export function refusalMessage(reason: Refusal, skillId: SkillId | null, requiredLevel: number | null, minAptitude: Aptitude | null): string {
  switch (reason) {
    case 'level_too_low':
      return skillId && requiredLevel ? requirementLine(skillId, requiredLevel) : 'Todavía no sabés trabajar esto.'
    case 'aptitude_too_low':
      return skillId && minAptitude
        ? `Este trabajo pide un Pokémon con aptitud ${minAptitude}+ en ${SKILLS[skillId].name}.`
        : 'Este Pokémon no puede con este trabajo.'
    case 'plot_not_empty': return 'La parcela ya está sembrada.'
    case 'plot_not_growing': return 'No hay nada creciendo para cuidar.'
    case 'plot_not_ready': return 'Todavía no está lista para cosechar.'
    case 'already_tended': return 'Ya la cuidaste esta vez.'
    case 'wrong_plot_kind': return 'Esto sólo crece en tierra fértil.'
    case 'unknown_crop': return 'No se puede plantar eso.'
    case 'duplicate_action': return 'Esa acción ya se registró.'
    case 'unknown_resource':
    case 'invalid_target':
    case 'invalid_request':
      return 'Eso no se puede trabajar.'
  }
}

/** "Talar 9 → 10", or null when the level did not change. */
export function levelUpLine(skillId: SkillId, before: number, after: number): string | null {
  return after > before ? `${SKILLS[skillId].name} ${before} → ${after}` : null
}
