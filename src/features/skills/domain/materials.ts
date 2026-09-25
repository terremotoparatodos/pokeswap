// Every item Skills can hand out. Fourteen, each with an answer to
// "¿para qué quiero esto?".
//
// `use` is what the item is for *today or in an approved next step*. The
// ones marked `planned` point at a decision that is documented but not built
// (SKILLS_1_REPORT.md §6); nothing here implements a system to justify an item.

import type { SkillId } from './skills'

export type MaterialId =
  | 'common_log' | 'pine_log' | 'hardwood_log' | 'boreal_log'
  | 'stone' | 'coal' | 'iron_ore' | 'gold_ore' | 'crystal'
  | 'oran_berry' | 'medicinal_herb' | 'leppa_berry' | 'sitrus_berry' | 'revival_herb'

export type MaterialUse = 'building' | 'fuel' | 'metal' | 'valuable' | 'consumable'

export interface MaterialDefinition {
  readonly id: MaterialId
  readonly name: string
  readonly skill: SkillId
  /** 1 = first thing a player gets; 5 = end of the 1–50 arc. */
  readonly grade: 1 | 2 | 3 | 4 | 5
  readonly use: MaterialUse
  /** One sentence the UI can show. */
  readonly purpose: string
  /** True when the purpose depends on a documented, not-yet-built step. */
  readonly planned: boolean
}

const m = (
  id: MaterialId, name: string, skill: SkillId, grade: MaterialDefinition['grade'],
  use: MaterialUse, purpose: string, planned = true,
): MaterialDefinition => ({ id, name, skill, grade, use, purpose, planned })

export const MATERIALS: readonly MaterialDefinition[] = [
  m('common_log', 'Tronco común', 'woodcutting', 1, 'building', 'Madera básica: construcción y venta.'),
  m('pine_log', 'Madera de pino', 'woodcutting', 2, 'building', 'Madera liviana: mejores construcciones y venta.'),
  m('hardwood_log', 'Madera dura', 'woodcutting', 3, 'building', 'Madera resistente: construcciones de midgame.'),
  m('boreal_log', 'Madera boreal', 'woodcutting', 4, 'valuable', 'La madera más valiosa: construcciones avanzadas y venta alta.'),

  m('stone', 'Piedra', 'mining', 1, 'building', 'Material básico: construcción y venta.'),
  m('coal', 'Carbón', 'mining', 2, 'fuel', 'Combustible: sin él no se funde metal.'),
  m('iron_ore', 'Mineral de hierro', 'mining', 3, 'metal', 'El metal de trabajo del midgame.'),
  m('gold_ore', 'Mineral de oro', 'mining', 4, 'valuable', 'Metal precioso: venta alta.'),
  m('crystal', 'Cristal', 'mining', 5, 'valuable', 'Cristal puro de cueva: el recurso más raro del arco 1–50.'),

  m('oran_berry', 'Baya Aranja', 'farming', 1, 'consumable', 'Cura un poco a un Pokémon.'),
  m('medicinal_herb', 'Hierba medicinal', 'farming', 2, 'consumable', 'Cura estados alterados.'),
  m('leppa_berry', 'Baya Zanama', 'farming', 3, 'consumable', 'Restaura PP de un movimiento.'),
  m('sitrus_berry', 'Baya Zidra', 'farming', 4, 'consumable', 'Cura mucho a un Pokémon.'),
  m('revival_herb', 'Hierba Revivir', 'farming', 5, 'valuable', 'Revive a un Pokémon debilitado.'),
]

export const MATERIAL_BY_ID: ReadonlyMap<string, MaterialDefinition> = new Map(MATERIALS.map(entry => [entry.id, entry]))

export const materialName = (id: string): string => MATERIAL_BY_ID.get(id)?.name ?? id

/** An amount of one material. */
export interface ItemStack {
  readonly itemId: string
  readonly quantity: number
}
