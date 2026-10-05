// Species categories the battle catalog does not carry (ECO-1).
//
// `core.json` has no legendary, mythical, pseudo-legendary, starter, fossil or
// baby flags (CAVE_TYPES_AND_FAMILIES.md §4.2, gap H3), and production's
// `pokemon.is_legendary` neither lives in the repo nor separates mythicals.
// So the lists are explicit data with their source. Never infer a category
// from a Pokédex number range or a name.
//
// Every id is checked against the battle catalog by the tests.

import type { SpeciesCategoryList } from './types'

const range = (from: number, to: number): number[] => Array.from({ length: to - from + 1 }, (_, i) => from + i)

const EXCLUSIONS = 'docs/design/CAVE_TYPES_AND_FAMILIES.md §4.3 (ids verified against core.json)'

export const SPECIES_CATEGORIES: readonly SpeciesCategoryList[] = [
  {
    category: 'legendary',
    speciesIds: [144, 145, 146, 150, 243, 244, 245, 249, 250, ...range(377, 384), ...range(480, 488)],
    source: `${EXCLUSIONS}; MMO_SPAWN_RARITY_AND_INSTANCES.md §6`,
  },
  {
    category: 'mythical',
    speciesIds: [151, 251, 385, 386, ...range(489, 493)],
    source: `${EXCLUSIONS}; MMO_SPAWN_RARITY_AND_INSTANCES.md §6`,
  },
  {
    category: 'pseudo_legendary',
    speciesIds: [147, 148, 149, 246, 247, 248, ...range(371, 376), 443, 444, 445],
    source: EXCLUSIONS,
  },
  {
    category: 'starter',
    speciesIds: [...range(1, 9), ...range(152, 160), ...range(252, 260), ...range(387, 395)],
    source: EXCLUSIONS,
  },
  {
    category: 'fossil',
    speciesIds: [...range(138, 142), ...range(345, 348), ...range(408, 411)],
    source: EXCLUSIONS,
  },
  {
    category: 'eevee_line',
    speciesIds: [133, 134, 135, 136, 196, 197, 470, 471],
    source: EXCLUSIONS,
  },
  {
    category: 'baby',
    speciesIds: [172, 173, 174, 175, 236, 238, 239, 240, 298, 360, 406, 433, 438, 439, 440, 446, 447, 458],
    source: 'docs/design/MMO_SPAWN_RARITY_AND_INSTANCES.md §6 (canonical knowledge, gap H1)',
  },
]
