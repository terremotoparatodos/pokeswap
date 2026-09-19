// What a *kind* of station is (R33).
//
// Three layers, the same split R31 uses for everything else (`domain/types.ts`):
//
//   StationDefinition   the type of station — static catalog data, versioned
//                       in code. "A furnace is 2×2, looks like this, and can
//                       run these recipes."
//   PlacedStation       one concrete station standing somewhere in the world
//                       (`stationInstance.ts`).
//   StationProcessState the work that one station is doing right now
//                       (`stationProcess.ts`).
//
// A definition is plain data: no Vue, no renderer, no engine, no area and no
// city. It names the art it uses so a renderer can find it, and declares the
// physical shape so collision, navigation, picking and a future server all read
// the same footprint — but it draws nothing and blocks nothing by itself.
//
// Supported recipes are **not** copied in here. R31 already declares which
// station each recipe needs (`RecipeDefinition.station`), and duplicating that
// is exactly the kind of second parallel system R33 must not create; the
// definition points at the same `StationKind` and `recipesForStation` reads the
// one catalog.

import { RECIPES } from '../domain/catalog/recipes'
import type { ItemId, RecipeDefinition, StationKind } from '../domain/types'
import {
  CAMPFIRE_AX, CAMPFIRE_AY, CAMPFIRE_H, CAMPFIRE_W,
} from '../art/campfireStation'
import {
  FURNACE_AX, FURNACE_AY, FURNACE_H, FURNACE_W,
} from '../art/furnaceStation'
import {
  WORKBENCH_AX, WORKBENCH_AY, WORKBENCH_H, WORKBENCH_W,
} from '../art/workbenchStation'
import { STATION_STATES, type StationState } from '../art/stationVisuals'
import { rectFootprint, type StationFootprint } from './stationFootprint'

/**
 * The stations R33 knows about.
 *
 * These are the same four `StationKind`s the recipe catalog already uses, so a
 * definition id *is* the recipe's station key. The Alchemy table predates all
 * of this and keeps its own art module and its own controller; it is listed so
 * the product catalog is complete and so nothing downstream has to special-case
 * "the station that is not in the table".
 */
export type StationTypeId = StationKind

export const STATION_TYPE_IDS: readonly StationTypeId[] = ['smelter', 'campfire', 'workbench', 'alchemyTable']

/** Loose labels a feature or a future blueprint can filter on. Not rules. */
export type StationTag = 'heat' | 'metal' | 'cooking' | 'crafting' | 'brewing'

/**
 * The size and anchor of the art, in art pixels — a *drawing* measurement,
 * copied from the approved visual language (`art/stationVisuals.ts`). It is
 * deliberately separate from `footprint`: a sprite may overhang the tiles a
 * station stands on, and sprite bounds must never become collision.
 */
export interface StationArtBounds {
  readonly width: number
  readonly height: number
  readonly anchorX: number
  readonly anchorY: number
}

export interface StationDefinition {
  readonly id: StationTypeId
  readonly name: string
  /** The catalog item a built station comes from (`domain/catalog/items.ts`). */
  readonly structureItemId: ItemId
  /** Tiles it stands on. Collision, navigation, picking and placement all read this. */
  readonly footprint: StationFootprint
  /**
   * How far a player may stand to use it, in tiles from the footprint.
   * 1 is the orthogonal ring — the same gesture the Alchemy bench uses.
   */
  readonly interactionReach: 1
  readonly art: StationArtBounds
  /** Every visual state this station's art draws. All four, for all of them. */
  readonly visualStates: readonly StationState[]
  readonly tags: readonly StationTag[]
  /**
   * Whether R33 makes this station *run*. The art and the definition of the
   * campfire and the workbench are approved and carried, so the catalog is
   * complete and a later phase adds behaviour without re-deciding shape; only
   * the furnace has a working process in R33.
   */
  readonly productive: boolean
}

/**
 * The furnace stands on 2×2 tiles.
 *
 * Not a number pulled out of the air and not read off the sprite: a furnace
 * with a chimney is the bulkiest thing in the clearing, and a second tile of
 * depth is what makes the player walk *around* it instead of brushing past a
 * one-tile marker. Its 30×34 art is narrower than the 32×32 of ground it
 * occupies, which is the intended direction — art may overhang a footprint,
 * never the other way round.
 */
const FURNACE_FOOTPRINT = rectFootprint(2, 2)

const DEFINITIONS: readonly StationDefinition[] = [
  {
    id: 'smelter',
    name: 'Horno de Fundición',
    structureItemId: 'smelter',
    footprint: FURNACE_FOOTPRINT,
    interactionReach: 1,
    art: { width: FURNACE_W, height: FURNACE_H, anchorX: FURNACE_AX, anchorY: FURNACE_AY },
    visualStates: STATION_STATES,
    tags: ['heat', 'metal'],
    productive: true,
  },
  {
    id: 'campfire',
    name: 'Fogata',
    structureItemId: 'campfire',
    footprint: rectFootprint(1, 1),
    interactionReach: 1,
    art: { width: CAMPFIRE_W, height: CAMPFIRE_H, anchorX: CAMPFIRE_AX, anchorY: CAMPFIRE_AY },
    visualStates: STATION_STATES,
    tags: ['heat', 'cooking'],
    productive: false,
  },
  {
    id: 'workbench',
    name: 'Banco de Trabajo',
    structureItemId: 'workbench',
    footprint: rectFootprint(2, 1),
    interactionReach: 1,
    art: { width: WORKBENCH_W, height: WORKBENCH_H, anchorX: WORKBENCH_AX, anchorY: WORKBENCH_AY },
    visualStates: STATION_STATES,
    tags: ['crafting'],
    productive: false,
  },
  {
    // The bench that already exists (R31-C4 / F-1). Its art, its placement and
    // its controller are untouched by R33; this entry only lets the shared
    // catalog answer for all four stations.
    id: 'alchemyTable',
    name: 'Mesa de Alquimia',
    structureItemId: 'alchemy_table',
    footprint: rectFootprint(1, 1),
    interactionReach: 1,
    art: { width: 34, height: 30, anchorX: 17, anchorY: 29 },
    visualStates: STATION_STATES,
    tags: ['brewing'],
    productive: true,
  },
]

export const STATION_DEFINITIONS: readonly StationDefinition[] = DEFINITIONS

export const STATION_BY_ID: ReadonlyMap<StationTypeId, StationDefinition> =
  new Map(DEFINITIONS.map(definition => [definition.id, definition]))

export function stationDefinition(id: StationTypeId): StationDefinition | null {
  return STATION_BY_ID.get(id) ?? null
}

/**
 * The recipes this station can run, straight from the R31 recipe catalog.
 * Derived, never copied: adding a smelter recipe there is all it takes.
 */
export function recipesForStation(id: StationTypeId): readonly RecipeDefinition[] {
  return RECIPES.filter(recipe => recipe.station === id)
}

/** True when this station can run this recipe at all — before level or inputs are considered. */
export function stationSupportsRecipe(id: StationTypeId, recipeId: string): boolean {
  return RECIPES.some(recipe => recipe.id === recipeId && recipe.station === id)
}
