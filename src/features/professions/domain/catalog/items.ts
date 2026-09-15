// Item catalog — R31 starter taxonomy.
//
// Deliberately small: enough raw resources, refined goods, tools, consumables
// and structures to prove that every profession feeds another one.

import type { ItemDefinition, ItemKind, ItemTag, ProfessionId, Tier } from '../types'

function item(id: string, name: string, kind: ItemKind, tier: Tier, profession: ProfessionId | null, tags: ItemTag[]): ItemDefinition {
  return { id, name, kind, tier, profession, tags }
}

export const ITEMS: readonly ItemDefinition[] = [
  // Mining — raw
  item('stone', 'Piedra', 'raw', 1, 'mining', ['mineral', 'construction']),
  item('coal', 'Carbón', 'raw', 1, 'mining', ['fuel']),
  item('iron_ore', 'Mineral de Hierro', 'raw', 2, 'mining', ['metal']),
  item('gold_ore', 'Mineral de Oro', 'raw', 3, 'mining', ['metal']),
  item('evolution_shard', 'Fragmento Evolutivo', 'raw', 3, 'mining', ['mineral', 'rare']),

  // Woodcutting — raw
  item('common_log', 'Tronco Común', 'raw', 1, 'woodcutting', ['wood', 'fuel']),
  item('hardwood_log', 'Madera Dura', 'raw', 2, 'woodcutting', ['wood']),
  item('boreal_log', 'Madera Boreal', 'raw', 3, 'woodcutting', ['wood']),
  item('resin', 'Resina', 'raw', 1, 'woodcutting', ['component']),
  item('apricorn', 'Bonguri', 'raw', 2, 'woodcutting', ['rare']),

  // Fishing — raw
  item('fish', 'Pescado', 'raw', 1, 'fishing', ['aquatic']),
  item('seaweed', 'Alga', 'raw', 1, 'fishing', ['aquatic', 'herb']),
  item('quality_fish', 'Pez Selecto', 'raw', 2, 'fishing', ['aquatic']),
  item('pearl', 'Perla', 'raw', 3, 'fishing', ['aquatic', 'rare']),
  item('heart_scale', 'Escama Corazón', 'raw', 3, 'fishing', ['aquatic', 'rare']),

  // Alchemy foraging — raw
  item('oran_berry', 'Baya Aranja', 'raw', 1, 'alchemy', ['berry']),
  item('medicinal_herb', 'Hierba Medicinal', 'raw', 1, 'alchemy', ['herb']),
  item('leppa_berry', 'Baya Zanama', 'raw', 2, 'alchemy', ['berry']),
  item('sitrus_berry', 'Baya Zidra', 'raw', 2, 'alchemy', ['berry']),
  item('revival_herb', 'Hierba Revivir', 'raw', 3, 'alchemy', ['herb', 'rare']),

  // Exploration / PvE drops — raw
  item('wild_essence', 'Esencia Salvaje', 'raw', 2, null, ['pveDrop']),
  item('boss_relic', 'Reliquia de Jefe', 'raw', 3, null, ['pveDrop', 'rare']),

  // Refined
  item('iron_ingot', 'Lingote de Hierro', 'refined', 2, 'mining', ['metal']),
  item('gold_ingot', 'Lingote de Oro', 'refined', 3, 'mining', ['metal']),
  item('steel_ingot', 'Lingote de Acero', 'refined', 3, 'mining', ['metal']),
  item('stone_brick', 'Bloque de Piedra', 'refined', 1, 'mining', ['construction']),
  item('vial', 'Frasco', 'refined', 1, 'mining', ['container']),
  item('plank', 'Tablón', 'refined', 1, 'woodcutting', ['wood', 'construction']),
  item('hardwood_plank', 'Tablón Duro', 'refined', 2, 'woodcutting', ['wood', 'construction']),
  item('tool_handle', 'Mango', 'refined', 1, 'woodcutting', ['component']),
  item('fish_oil', 'Aceite de Pescado', 'refined', 1, 'fishing', ['component']),
  item('herbal_extract', 'Extracto Herbal', 'refined', 1, 'alchemy', ['component']),

  // Tools
  item('stone_pickaxe', 'Pico de Piedra', 'tool', 1, 'mining', []),
  item('iron_pickaxe', 'Pico de Hierro', 'tool', 2, 'mining', []),
  item('steel_pickaxe', 'Pico de Acero', 'tool', 3, 'mining', []),
  item('stone_axe', 'Hacha de Piedra', 'tool', 1, 'mining', []),
  item('iron_axe', 'Hacha de Hierro', 'tool', 2, 'mining', []),
  item('steel_axe', 'Hacha de Acero', 'tool', 3, 'mining', []),
  item('stone_sickle', 'Hoz de Piedra', 'tool', 1, 'mining', []),
  item('iron_sickle', 'Hoz de Hierro', 'tool', 2, 'mining', []),
  item('steel_sickle', 'Hoz de Acero', 'tool', 3, 'mining', []),
  item('basic_rod', 'Caña Básica', 'tool', 1, 'woodcutting', []),
  item('reinforced_rod', 'Caña Reforzada', 'tool', 2, 'woodcutting', []),
  item('master_rod', 'Caña Maestra', 'tool', 3, 'woodcutting', []),

  // Consumables
  item('potion', 'Poción', 'consumable', 1, 'alchemy', []),
  item('super_potion', 'Superpoción', 'consumable', 2, 'alchemy', []),
  item('hyper_potion', 'Hiperpoción', 'consumable', 3, 'alchemy', []),
  item('revive', 'Revivir', 'consumable', 3, 'alchemy', []),
  item('ether', 'Éter', 'consumable', 2, 'alchemy', []),
  item('vigor_tea', 'Té de Vigor', 'consumable', 1, 'alchemy', []),

  // Structures
  item('workbench', 'Banco de Trabajo', 'structure', 1, 'woodcutting', []),
  item('campfire', 'Fogata', 'structure', 1, 'woodcutting', []),
  item('smelter', 'Horno de Fundición', 'structure', 2, 'mining', []),
  item('alchemy_table', 'Mesa de Alquimia', 'structure', 3, 'alchemy', []),
]

/** Raw items that enter the economy through PvE instead of gathering nodes. */
export const PVE_DROP_ITEMS: readonly string[] = ['wild_essence', 'boss_relic']

/**
 * Items whose sink belongs to a later phase. Kept explicit so the catalog
 * validation never silently accepts a resource with no use.
 */
export const RESERVED_SINKS: Readonly<Record<string, string>> = {
  apricorn: 'Fabricación de Poké Balls (fase posterior; toca captura y ownership).',
  boss_relic: 'Mejoras de estructuras nivel 2 (fase posterior, junto con housing).',
}

export const ITEM_BY_ID: ReadonlyMap<string, ItemDefinition> = new Map(ITEMS.map(entry => [entry.id, entry]))
