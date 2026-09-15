// Recipe catalog. Cross-profession inputs are intentional: metal tools need
// wood handles, potions need mined vials, hyper potions need fish oil, revives
// need PvE drops or rare fishing scales.

import type { ItemStack, ProfessionId, RecipeCategory, RecipeDefinition, StationKind } from '../types'

const s = (itemId: string, quantity = 1): ItemStack => ({ itemId, quantity })

function recipe(
  id: string, profession: ProfessionId, category: RecipeCategory, requiredLevel: number,
  inputs: ItemStack[], outputs: ItemStack[], baseSeconds: number, xp: number, station: StationKind | null,
): RecipeDefinition {
  return { id, profession, category, requiredLevel, inputs, outputs, baseSeconds, xp, station }
}

export const RECIPES: readonly RecipeDefinition[] = [
  // ── Mining: refining ──────────────────────────────────────────────────────
  recipe('cut_stone_brick', 'mining', 'refining', 3, [s('stone', 3)], [s('stone_brick')], 4, 5, 'workbench'),
  recipe('make_vial', 'mining', 'refining', 6, [s('stone', 2), s('coal')], [s('vial', 2)], 5, 8, 'smelter'),
  recipe('smelt_iron', 'mining', 'refining', 12, [s('iron_ore', 2), s('coal')], [s('iron_ingot')], 6, 18, 'smelter'),
  recipe('smelt_gold', 'mining', 'refining', 28, [s('gold_ore', 2), s('coal', 2)], [s('gold_ingot')], 8, 34, 'smelter'),
  recipe('forge_steel', 'mining', 'refining', 35, [s('iron_ingot', 2), s('coal', 2)], [s('steel_ingot')], 9, 45, 'smelter'),

  // ── Mining: metal tools (used by every gathering profession) ──────────────
  recipe('craft_stone_pickaxe', 'mining', 'toolCrafting', 1, [s('stone', 6), s('plank', 2)], [s('stone_pickaxe')], 8, 10, 'workbench'),
  recipe('craft_stone_axe', 'mining', 'toolCrafting', 1, [s('stone', 5), s('plank', 2)], [s('stone_axe')], 8, 10, 'workbench'),
  recipe('craft_stone_sickle', 'mining', 'toolCrafting', 1, [s('stone', 3), s('plank')], [s('stone_sickle')], 8, 8, 'workbench'),
  recipe('craft_iron_pickaxe', 'mining', 'toolCrafting', 15, [s('iron_ingot', 5), s('tool_handle')], [s('iron_pickaxe')], 12, 60, 'workbench'),
  recipe('craft_iron_axe', 'mining', 'toolCrafting', 15, [s('iron_ingot', 5), s('tool_handle')], [s('iron_axe')], 12, 60, 'workbench'),
  recipe('craft_iron_sickle', 'mining', 'toolCrafting', 15, [s('iron_ingot', 3), s('tool_handle')], [s('iron_sickle')], 12, 45, 'workbench'),
  recipe('craft_steel_pickaxe', 'mining', 'toolCrafting', 35, [s('steel_ingot', 5), s('tool_handle'), s('evolution_shard')], [s('steel_pickaxe')], 16, 160, 'workbench'),
  recipe('craft_steel_axe', 'mining', 'toolCrafting', 35, [s('steel_ingot', 5), s('tool_handle'), s('evolution_shard')], [s('steel_axe')], 16, 160, 'workbench'),
  recipe('craft_steel_sickle', 'mining', 'toolCrafting', 35, [s('steel_ingot', 3), s('tool_handle'), s('evolution_shard')], [s('steel_sickle')], 16, 130, 'workbench'),

  // ── Woodcutting: refining, rods, construction ─────────────────────────────
  recipe('saw_plank', 'woodcutting', 'refining', 1, [s('common_log', 2)], [s('plank')], 4, 5, 'workbench'),
  recipe('saw_hardwood_plank', 'woodcutting', 'refining', 15, [s('hardwood_log', 2)], [s('hardwood_plank')], 5, 16, 'workbench'),
  recipe('carve_tool_handle', 'woodcutting', 'refining', 5, [s('plank'), s('resin')], [s('tool_handle')], 5, 8, 'workbench'),
  recipe('craft_basic_rod', 'woodcutting', 'toolCrafting', 1, [s('plank', 3), s('resin')], [s('basic_rod')], 8, 10, 'workbench'),
  recipe('craft_reinforced_rod', 'woodcutting', 'toolCrafting', 15, [s('hardwood_plank', 3), s('iron_ingot', 2), s('resin', 2)], [s('reinforced_rod')], 12, 60, 'workbench'),
  recipe('craft_master_rod', 'woodcutting', 'toolCrafting', 35, [s('boreal_log', 4), s('steel_ingot', 2), s('resin', 3), s('pearl')], [s('master_rod')], 16, 160, 'workbench'),
  recipe('build_campfire', 'woodcutting', 'construction', 1, [s('common_log', 6), s('stone', 4)], [s('campfire')], 20, 20, null),
  recipe('build_workbench', 'woodcutting', 'construction', 5, [s('plank', 10), s('stone_brick', 4)], [s('workbench')], 30, 60, null),
  recipe('build_smelter', 'mining', 'construction', 10, [s('stone_brick', 16), s('coal', 10), s('plank', 4)], [s('smelter')], 40, 90, null),

  // ── Fishing: refining ─────────────────────────────────────────────────────
  recipe('render_fish_oil', 'fishing', 'refining', 5, [s('fish', 3)], [s('fish_oil')], 5, 9, 'campfire'),
  recipe('render_quality_fish_oil', 'fishing', 'refining', 15, [s('quality_fish')], [s('fish_oil', 2)], 5, 14, 'campfire'),

  // ── Alchemy ───────────────────────────────────────────────────────────────
  recipe('brew_herbal_extract', 'alchemy', 'alchemy', 1, [s('medicinal_herb', 2), s('seaweed')], [s('herbal_extract')], 5, 7, 'alchemyTable'),
  recipe('brew_potion', 'alchemy', 'alchemy', 1, [s('oran_berry', 2), s('vial')], [s('potion')], 5, 8, 'alchemyTable'),
  recipe('brew_vigor_tea', 'alchemy', 'alchemy', 8, [s('oran_berry', 3), s('medicinal_herb')], [s('vigor_tea')], 5, 10, 'campfire'),
  recipe('brew_super_potion', 'alchemy', 'alchemy', 12, [s('sitrus_berry'), s('herbal_extract'), s('vial')], [s('super_potion')], 6, 20, 'alchemyTable'),
  recipe('brew_ether', 'alchemy', 'alchemy', 18, [s('leppa_berry', 2), s('seaweed'), s('vial')], [s('ether')], 6, 24, 'alchemyTable'),
  recipe('brew_revive', 'alchemy', 'alchemy', 25, [s('revival_herb'), s('wild_essence'), s('vial')], [s('revive')], 8, 55, 'alchemyTable'),
  recipe('brew_revive_scale', 'alchemy', 'alchemy', 25, [s('revival_herb'), s('heart_scale'), s('vial')], [s('revive')], 8, 55, 'alchemyTable'),
  recipe('brew_hyper_potion', 'alchemy', 'alchemy', 30, [s('sitrus_berry', 2), s('herbal_extract', 2), s('fish_oil'), s('vial')], [s('hyper_potion')], 8, 45, 'alchemyTable'),
  recipe('build_alchemy_table', 'alchemy', 'construction', 15, [s('hardwood_plank', 8), s('vial', 4), s('gold_ingot')], [s('alchemy_table')], 40, 90, null),
]

export const RECIPE_BY_ID: ReadonlyMap<string, RecipeDefinition> = new Map(RECIPES.map(entry => [entry.id, entry]))
