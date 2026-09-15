// Profession catalog — one shared framework, four data entries.
// Adding a profession = new id in PROFESSION_IDS + an entry here + its nodes,
// recipes and affinity profile. No resolver changes.

import type { EnergyConfig, ProfessionDefinition, ProfessionId } from '../types'

export const MAX_PROFESSION_LEVEL = 60

export const PROFESSIONS: Readonly<Record<ProfessionId, ProfessionDefinition>> = {
  mining: {
    id: 'mining',
    name: 'Minería',
    description: 'Extrae piedra, carbón y metales; funde lingotes y forja herramientas de metal.',
    maxLevel: MAX_PROFESSION_LEVEL,
    toolKind: 'pickaxe',
    signatureTraits: ['yield', 'energySaving', 'toolCare', 'detection'],
    milestones: [
      { level: 10, description: 'Puede construir un Horno de Fundición propio.' },
      { level: 45, description: 'Reservado: vetas ricas compartidas (R33+).' },
    ],
    specializations: [
      { id: 'prospector', name: 'Prospector', unlockLevel: 40, status: 'future' },
      { id: 'smith', name: 'Herrero', unlockLevel: 40, status: 'future' },
    ],
  },
  woodcutting: {
    id: 'woodcutting',
    name: 'Tala',
    description: 'Corta madera y resina; sierra tablones, fabrica mangos, cañas y estructuras.',
    maxLevel: MAX_PROFESSION_LEVEL,
    toolKind: 'axe',
    signatureTraits: ['speed', 'yield', 'critical'],
    milestones: [
      { level: 5, description: 'Puede construir un Banco de Trabajo propio.' },
      { level: 45, description: 'Reservado: árboles antiguos compartidos (R33+).' },
    ],
    specializations: [
      { id: 'forester', name: 'Guardabosques', unlockLevel: 40, status: 'future' },
      { id: 'carpenter', name: 'Carpintero', unlockLevel: 40, status: 'future' },
    ],
  },
  fishing: {
    id: 'fishing',
    name: 'Pesca',
    description: 'Pesca en orillas, costas y arrecifes; obtiene ingredientes acuáticos y rarezas.',
    maxLevel: MAX_PROFESSION_LEVEL,
    toolKind: 'rod',
    signatureTraits: ['rareFind', 'detection', 'quality'],
    milestones: [
      { level: 30, description: 'Arrecifes para Pokémon con acceso a aguas profundas.' },
    ],
    specializations: [
      { id: 'angler', name: 'Pescador de altura', unlockLevel: 40, status: 'future' },
    ],
  },
  alchemy: {
    id: 'alchemy',
    name: 'Alquimia',
    description: 'Recolecta bayas y hierbas y las combina con productos de otras profesiones en consumibles.',
    maxLevel: MAX_PROFESSION_LEVEL,
    toolKind: 'sickle',
    signatureTraits: ['processing', 'quality', 'detection'],
    milestones: [
      { level: 15, description: 'Puede construir una Mesa de Alquimia propia.' },
    ],
    specializations: [
      { id: 'apothecary', name: 'Boticario', unlockLevel: 40, status: 'future' },
      { id: 'herbalist', name: 'Herbolario', unlockLevel: 40, status: 'future' },
    ],
  },
}

/** Starting balance numbers. Tune with `npm run sim:economy`, not by intuition. */
export const ENERGY_CONFIG: EnergyConfig = {
  baseMax: 600,
  maxBonus: { per: 10, bonus: 20, cap: 200 },
  regenPerHour: 60,
  restedCap: 600,
  restedXpBonus: 0.5,
  consumableDailyCap: 240,
  minCostRatio: 0.6,
}
