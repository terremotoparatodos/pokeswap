// Demo worker roster for the R31-B prototype.
//
// FIXTURE: species types normally come from the `pokemon` table (R31-A F1)
// and levels from `pokemon_xp`; the repository has no offline copy of either.
// Base stats come from the real generated catalog. Nothing here is ownership.

import { computeAffinity } from '../domain/affinity'
import { SPECIES_BASE_STATS } from '../domain/catalog/speciesBaseStats'
import type { PokemonProfessionAffinity, ProfessionId } from '../domain/types'

export interface DemoWorker {
  readonly speciesId: number
  readonly name: string
  readonly type1: string
  readonly type2: string | null
}

export const DEMO_WORKERS: readonly DemoWorker[] = [
  { speciesId: 68, name: 'Machamp', type1: 'fighting', type2: null },
  { speciesId: 74, name: 'Geodude', type1: 'rock', type2: 'ground' },
  { speciesId: 81, name: 'Magnemite', type1: 'electric', type2: 'steel' },
  { speciesId: 50, name: 'Diglett', type1: 'ground', type2: null },
  { speciesId: 400, name: 'Bibarel', type1: 'normal', type2: 'water' },
  { speciesId: 123, name: 'Scyther', type1: 'bug', type2: 'flying' },
  { speciesId: 9, name: 'Blastoise', type1: 'water', type2: null },
  { speciesId: 6, name: 'Charizard', type1: 'fire', type2: 'flying' },
  { speciesId: 129, name: 'Magikarp', type1: 'water', type2: null },
  { speciesId: 44, name: 'Gloom', type1: 'grass', type2: 'poison' },
  { speciesId: 242, name: 'Blissey', type1: 'normal', type2: null },
  { speciesId: 150, name: 'Mewtwo', type1: 'psychic', type2: null },
  // Size and shape references for the overworld worker (R31-C1): small, flying, long, wide, bulky.
  { speciesId: 25, name: 'Pikachu', type1: 'electric', type2: null },
  { speciesId: 18, name: 'Pidgeot', type1: 'normal', type2: 'flying' },
  { speciesId: 95, name: 'Onix', type1: 'rock', type2: 'ground' },
  { speciesId: 130, name: 'Gyarados', type1: 'water', type2: 'flying' },
  { speciesId: 143, name: 'Snorlax', type1: 'normal', type2: null },
]

export const TYPE_LABEL: Readonly<Record<string, string>> = {
  normal: 'Normal', fire: 'Fuego', water: 'Agua', grass: 'Planta', electric: 'Eléctrico', ice: 'Hielo',
  fighting: 'Lucha', poison: 'Veneno', ground: 'Tierra', flying: 'Volador', psychic: 'Psíquico', bug: 'Bicho',
  rock: 'Roca', ghost: 'Fantasma', dragon: 'Dragón', dark: 'Siniestro', steel: 'Acero', fairy: 'Hada',
}

export function findDemoWorker(speciesId: number | null): DemoWorker | null {
  return DEMO_WORKERS.find(worker => worker.speciesId === speciesId) ?? null
}

export function workerAffinity(worker: DemoWorker, profession: ProfessionId, level: number): PokemonProfessionAffinity {
  return computeAffinity({
    speciesId: worker.speciesId, type1: worker.type1, type2: worker.type2, level,
    baseStats: SPECIES_BASE_STATS[worker.speciesId] ?? null,
  }, profession)
}
