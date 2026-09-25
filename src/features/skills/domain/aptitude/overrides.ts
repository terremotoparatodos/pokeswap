// Per-species aptitude patches.
//
// This is the file a designer edits. One line per species, only the skills
// that need patching, and a reason a reviewer can argue with. An override
// replaces the derived value outright; it never nudges a hidden weight.
//
// Add a species here when the derived value contradicts what the species
// *is* (its Pokédex identity, its body, its role in the anime/games), not to
// balance numbers. Balance lives in balance.ts.

import type { SkillId } from '../skills'
import type { Aptitude } from './aptitudeScale'

export interface AptitudeOverride {
  readonly speciesId: number
  readonly aptitudes: Readonly<Partial<Record<SkillId, Aptitude>>>
  readonly reason: string
}

export const APTITUDE_OVERRIDES: readonly AptitudeOverride[] = [
  // ── Talar ────────────────────────────────────────────────────────────────
  { speciesId: 123, aptitudes: { woodcutting: 5 }, reason: 'Scyther: guadañas; tala por excelencia.' },
  { speciesId: 127, aptitudes: { woodcutting: 5 }, reason: 'Pinsir: pinzas que parten troncos.' },
  { speciesId: 83, aptitudes: { woodcutting: 4 }, reason: "Farfetch'd: corta con su puerro como con una espada." },
  { speciesId: 141, aptitudes: { woodcutting: 4 }, reason: 'Kabutops: brazos de guadaña.' },
  { speciesId: 399, aptitudes: { woodcutting: 4 }, reason: 'Bidoof: roe troncos sin parar (Pokédex).' },
  { speciesId: 400, aptitudes: { woodcutting: 5 }, reason: 'Bibarel: construye diques talando árboles (Pokédex).' },
  { speciesId: 185, aptitudes: { woodcutting: 1 }, reason: 'Sudowoodo: se hace pasar por árbol; no tala a sus primos.' },

  // ── Minería ──────────────────────────────────────────────────────────────
  { speciesId: 50, aptitudes: { mining: 5 }, reason: 'Diglett: vive excavando bajo tierra.' },
  { speciesId: 51, aptitudes: { mining: 5 }, reason: 'Dugtrio: excava a gran profundidad.' },
  { speciesId: 66, aptitudes: { mining: 4 }, reason: 'Machop: entrena levantando rocas.' },
  { speciesId: 67, aptitudes: { mining: 5, woodcutting: 5 }, reason: 'Machoke: el trabajador pesado clásico (Pokédex).' },
  { speciesId: 68, aptitudes: { mining: 5, woodcutting: 5 }, reason: 'Machamp: cuatro brazos, trabajo pesado.' },
  { speciesId: 27, aptitudes: { mining: 4 }, reason: 'Sandshrew: garras para cavar.' },
  { speciesId: 28, aptitudes: { mining: 5 }, reason: 'Sandslash: garras para cavar.' },
  { speciesId: 232, aptitudes: { mining: 5 }, reason: 'Donphan: embiste y derriba rocas.' },
  { speciesId: 81, aptitudes: { mining: 4 }, reason: 'Magnemite: atrae el mineral metálico; frágil para golpear.' },
  { speciesId: 299, aptitudes: { mining: 4 }, reason: 'Nosepass: brújula viviente, encuentra vetas; lento.' },

  // ── Agricultura ──────────────────────────────────────────────────────────
  { speciesId: 241, aptitudes: { farming: 5 }, reason: 'Miltank: el Pokémon de granja por excelencia.' },
  { speciesId: 182, aptitudes: { farming: 5 }, reason: 'Bellossom: su danza llama al sol.' },
  { speciesId: 192, aptitudes: { farming: 5 }, reason: 'Sunflora: convierte la luz en energía.' },
  { speciesId: 421, aptitudes: { farming: 5 }, reason: 'Cherrim: florece con el sol.' },
  { speciesId: 251, aptitudes: { farming: 5 }, reason: 'Celebi: guardián de los bosques.' },
  { speciesId: 492, aptitudes: { farming: 5 }, reason: 'Shaymin: hace florecer la tierra a su paso.' },
  { speciesId: 324, aptitudes: { farming: 1 }, reason: 'Torkoal: quema todo lo que siembra.' },
  { speciesId: 143, aptitudes: { farming: 2 }, reason: 'Snorlax: se come la cosecha antes de juntarla.' },
]
