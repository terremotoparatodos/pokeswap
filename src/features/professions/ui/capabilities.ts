// Player-facing capabilities derived from R31-A affinity traits.
//
// Traits are designer vocabulary ("yield", "toolCare"). Players compare
// Pokémon by what they do for a profession: extract more, find rarities,
// spare the tool. Ratings are relative to what a specialist can reach, so a
// strong niche reads as strong even when its raw percentage is small.

import { AFFINITY_PROFILES } from '../domain/catalog/affinityProfiles'
import type { PokemonProfessionAffinity, ProfessionId, ProfessionTrait } from '../domain/types'

export type CapabilityId = 'extraction' | 'speed' | 'efficiency' | 'conservation' | 'prospecting' | 'quality' | 'processing' | 'habitat'

export interface CapabilityDefinition {
  readonly label: string
  readonly hint: string
  readonly traits: readonly ProfessionTrait[]
}

export const CAPABILITIES: Readonly<Record<CapabilityId, CapabilityDefinition>> = {
  extraction: { label: 'Extracción', hint: 'Más unidades por acción', traits: ['yield', 'critical'] },
  speed: { label: 'Velocidad', hint: 'Acciones más cortas', traits: ['speed'] },
  efficiency: { label: 'Eficiencia', hint: 'Menos energía por acción', traits: ['energySaving'] },
  conservation: { label: 'Conservación', hint: 'Menos desgaste de herramienta', traits: ['toolCare'] },
  prospecting: { label: 'Prospección', hint: 'Rarezas y detección de nodos', traits: ['rareFind', 'detection'] },
  quality: { label: 'Calidad', hint: 'Unidades finas', traits: ['quality'] },
  processing: { label: 'Procesado', hint: 'Crafteo más rápido y ahorro de insumos', traits: ['processing'] },
  habitat: { label: 'Hábitat', hint: 'Bonus en sus biomas', traits: ['biomeMastery'] },
}

/** Capabilities shown per profession, most relevant first. */
export const PROFESSION_CAPABILITIES: Readonly<Record<ProfessionId, readonly CapabilityId[]>> = {
  mining: ['extraction', 'prospecting', 'conservation', 'efficiency', 'speed'],
  woodcutting: ['speed', 'extraction', 'conservation', 'efficiency', 'habitat'],
  fishing: ['prospecting', 'extraction', 'quality', 'speed', 'habitat'],
  alchemy: ['processing', 'quality', 'prospecting', 'extraction', 'efficiency'],
}

/** A trait rates 5/5 when half of a Pokémon's whole budget goes into it. */
export const FULL_RATING_SHARE = 0.5
export const MAX_RATING = 5
/** Strength gap below which two Pokémon read as even. */
export const TIE_MARGIN = 0.05

export interface TraitLine {
  readonly trait: ProfessionTrait
  readonly value: number
  readonly text: string
}

export interface CapabilityRating {
  readonly id: CapabilityId
  readonly label: string
  readonly hint: string
  /** 0..1 relative to a specialist. */
  readonly strength: number
  /** 0..MAX_RATING, rounded strength. */
  readonly rating: number
  readonly lines: readonly TraitLine[]
}

const pct = (value: number): string => `${Math.round(value * 100)} %`

export function formatTrait(trait: ProfessionTrait, value: number): string {
  switch (trait) {
    case 'yield': return `+${pct(value)} de unidad extra`
    case 'critical': return `${pct(value)} de botín doble`
    case 'speed': return `−${pct(value)} de tiempo`
    case 'energySaving': return `−${pct(value)} de energía`
    case 'toolCare': return `${pct(value)} menos desgaste`
    case 'rareFind': return `×${(1 + value).toFixed(2).replace('.', ',')} rarezas`
    case 'detection': return `+${pct(value)} radio de detección`
    case 'quality': return `${pct(value)} de calidad fina`
    case 'processing': return `−${pct(value)} tiempo de procesado`
    case 'biomeMastery': return `+${pct(value)} en su bioma`
    case 'safety': return `${pct(value)} de seguridad (reservado)`
  }
}

export function rateCapabilities(affinity: PokemonProfessionAffinity): CapabilityRating[] {
  const scale = AFFINITY_PROFILES[affinity.profession].traitScale
  return PROFESSION_CAPABILITIES[affinity.profession].map(id => {
    const definition = CAPABILITIES[id]
    const strength = Math.min(1, Math.max(0, ...definition.traits.map(trait =>
      (affinity.bonuses[trait] ?? 0) / ((scale[trait] ?? 1) * FULL_RATING_SHARE))))
    const lines = definition.traits
      .map(trait => ({ trait, value: affinity.bonuses[trait] ?? 0 }))
      .filter(line => line.value >= 0.005)
      .map(line => ({ ...line, text: formatTrait(line.trait, line.value) }))
    return { id, label: definition.label, hint: definition.hint, strength, rating: Math.round(strength * MAX_RATING), lines }
  })
}

export interface WorkerSummary {
  readonly ratings: readonly CapabilityRating[]
  readonly specialty: CapabilityRating
  readonly weakest: CapabilityRating
}

export function summarizeWorker(affinity: PokemonProfessionAffinity): WorkerSummary {
  const ratings = rateCapabilities(affinity)
  const byStrength = [...ratings].sort((a, b) => b.strength - a.strength)
  return { ratings, specialty: byStrength[0], weakest: byStrength[byStrength.length - 1] }
}

export interface ComparisonRow {
  readonly id: CapabilityId
  readonly label: string
  readonly a: CapabilityRating
  readonly b: CapabilityRating
  readonly leader: 'a' | 'b' | 'tie'
}

export interface WorkerComparison {
  readonly rows: readonly ComparisonRow[]
  readonly aLeads: readonly CapabilityId[]
  readonly bLeads: readonly CapabilityId[]
}

/** Both affinities must belong to the same profession. */
export function compareWorkers(a: PokemonProfessionAffinity, b: PokemonProfessionAffinity): WorkerComparison {
  if (a.profession !== b.profession) throw new Error('compareWorkers needs the same profession')
  const ratingsB = rateCapabilities(b)
  const rows = rateCapabilities(a).map((rating, index): ComparisonRow => {
    const other = ratingsB[index]
    const gap = rating.strength - other.strength
    return { id: rating.id, label: rating.label, a: rating, b: other, leader: Math.abs(gap) <= TIE_MARGIN ? 'tie' : gap > 0 ? 'a' : 'b' }
  })
  return {
    rows,
    aLeads: rows.filter(row => row.leader === 'a').map(row => row.id),
    bLeads: rows.filter(row => row.leader === 'b').map(row => row.id),
  }
}
