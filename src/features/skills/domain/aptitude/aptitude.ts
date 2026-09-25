// Resolves a species' work aptitudes: override if there is one, derived
// default otherwise, and a safe fallback when the species is unknown.
//
// Belongs to the species (PokemonSpecies), not to the individual Pokémon: a
// level-5 Scyther and a level-80 Scyther are equally good woodcutters. Level,
// nature, IVs and abilities are deliberately left out until there is a design
// reason to let them in (SKILLS-1 brief).

import { SKILL_IDS, type SkillId } from '../skills'
import { clampAptitude, type Aptitude } from './aptitudeScale'
import { APTITUDE_BASE, statTier, typeTier } from './aptitudeRules'
import { APTITUDE_OVERRIDES, type AptitudeOverride } from './overrides'
import { speciesFacts, type SpeciesFacts } from './speciesFacts'

export type WorkAptitudes = Readonly<Record<SkillId, Aptitude>>

export type AptitudeSource = 'override' | 'derived' | 'fallback'

export interface ResolvedAptitude {
  readonly value: Aptitude
  readonly source: AptitudeSource
}

/** Unknown species (not in the catalog) work like a neutral average species. */
export const FALLBACK_APTITUDE: Aptitude = APTITUDE_BASE as Aptitude

export function derivedAptitude(facts: Pick<SpeciesFacts, 'types' | 'baseStats'>, skill: SkillId): Aptitude {
  return clampAptitude(APTITUDE_BASE + typeTier(skill, facts.types) + statTier(skill, facts.baseStats))
}

export function indexOverrides(overrides: readonly AptitudeOverride[]): ReadonlyMap<number, AptitudeOverride> {
  return new Map(overrides.map(entry => [entry.speciesId, entry]))
}

const DEFAULT_OVERRIDES = indexOverrides(APTITUDE_OVERRIDES)

export function resolveAptitude(
  speciesId: number,
  skill: SkillId,
  overrides: ReadonlyMap<number, AptitudeOverride> = DEFAULT_OVERRIDES,
): ResolvedAptitude {
  const patched = overrides.get(speciesId)?.aptitudes[skill]
  if (patched !== undefined) return { value: patched, source: 'override' }
  const facts = speciesFacts(speciesId)
  if (!facts) return { value: FALLBACK_APTITUDE, source: 'fallback' }
  return { value: derivedAptitude(facts, skill), source: 'derived' }
}

export function workAptitudes(speciesId: number, overrides?: ReadonlyMap<number, AptitudeOverride>): WorkAptitudes {
  const entries = SKILL_IDS.map(skill => [skill, resolveAptitude(speciesId, skill, overrides).value] as const)
  return Object.fromEntries(entries) as Record<SkillId, Aptitude>
}
