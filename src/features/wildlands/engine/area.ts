// Areas — WildLands prototype
//
// An area is one playable map: the Ciudad Corazón lobby (a fixed image) or a
// procedural world. The game loop, renderer and navigation only talk to this
// interface, so travelling between them is just swapping the active area.

import type { Actor, Habitat } from './actors'
import type { WildRoster } from '../../../../services/realtime/src/world/worldProtocol.js'
import type { WeatherKind } from './atmosphere'
import type { Dir, TrainerSprites } from './characters'
import type { ChunkMetrics, DecorInstance } from './chunks'
import type { BuildingDoor } from './doors'
import type { Tile } from './pathfinding'
import type { PlazaResident } from './plazaPokemon'
import type { PokedexEntry } from './population'
import type { LensName } from './projection'

export type AreaId = string

export interface Portal {
  /** Tiles that trigger the trip when the player steps onto them. */
  tiles: readonly Tile[]
  to: AreaId
  /** Shown when the player gets close. */
  label: string
  /** Draw a glowing pad on the ground (worlds); town gates are already in the art. */
  pad?: boolean
}

export interface Arrival extends Tile {
  dir: Dir
}

/**
 * WORLD-1: what the shared world offers a populace. Until `serverNow()` is
 * known, a populace keeps its legacy local wandering (old servers, offline).
 */
export interface SharedPopulace {
  serverNow(): number | null
  /** The server's wild roster for this area, or null when it has none. */
  wildRoster(): WildRoster | null
  /** Static walkability for a wanderer: terrain, props, gates and doors. Identical on every client. */
  walkable(habitat: Habitat, tx: number, ty: number): boolean
}

/** Wandering actors that belong to an area. */
export interface Populace {
  /** WORLD-1: switch to shared identities and patrols when the server provides them. */
  share?(shared: SharedPopulace): void
  readonly actors: Actor[]
  update(playerTx: number, playerTy: number): void
  /** Owned Pokémon that should stroll here (towns only). */
  setOwned?(list: readonly PlazaResident[]): void
  /** Current free members of the cosmetic WildLands pool (worlds only). */
  setWildPokemonIds?(ids: readonly number[]): void
}

export interface PopulaceContext {
  pokedex: readonly PokedexEntry[]
  npcSprites: readonly TrainerSprites[]
}

export interface Area {
  readonly id: AreaId
  readonly name: string
  readonly kind: 'town' | 'wild'
  readonly lens: LensName
  readonly portals: readonly Portal[]
  /** Buildings the player can enter (town only). */
  readonly doors?: readonly BuildingDoor[]

  isSolid(tx: number, ty: number): boolean
  /**
   * Whether a walkable tile can be walked to from the area's spawn. Bounded
   * areas implement it so a teleport (restored or authoritative position)
   * never lands in a fenced pocket; unbounded worlds omit it.
   */
  isReachable?(tx: number, ty: number): boolean
  isWater(tx: number, ty: number): boolean
  /** HUD label for a tile, e.g. the biome in a world. */
  placeName(tx: number, ty: number): string

  /** Where the player appears when arriving from `from` (or first loading the area). */
  arrival(from: AreaId | null): Arrival

  /** Paints the flat ground for the world-pixel rect [x0, x1) × [y0, y1) at canvas origin (x0, y0). */
  drawGround(g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number): void
  /** Upright props whose feet fall inside the world-pixel rect. */
  decorIn(x0: number, y0: number, x1: number, y1: number): readonly DecorInstance[]

  createPopulace(context: PopulaceContext): Populace
  weather(tx: number, ty: number, seconds: number): { kind: WeatherKind; intensity: number }
  /** Standing-NPC line for a blocked tile, if any. */
  talkAt(tx: number, ty: number): string | null
  /** True for the activity board's tile (town only). */
  noticeBoardAt?(tx: number, ty: number): boolean
  /** Collects a pickup on the tile; returns true when something was collected. */
  collect(tx: number, ty: number): boolean
  paintMinimap(canvas: HTMLCanvasElement, tx: number, ty: number): void
  /** Optionally prepares nearby terrain without blocking the active frame. */
  prefetch?(tx: number, ty: number): void
  /** Initial terrain warm-up performed while the loading screen is visible. */
  warm?(tx: number, ty: number): Promise<void>
  /** Releases heavyweight transient resources when another area becomes active. */
  deactivate?(): void
  /** Diagnostic counters for procedural terrain, when this area owns chunks. */
  chunkMetrics?(): Readonly<ChunkMetrics>
  /** Per-frame housekeeping (cache eviction). */
  tick(): void
}

export function portalAt(area: Area, tx: number, ty: number): Portal | null {
  return area.portals.find(p => p.tiles.some(t => t.tx === tx && t.ty === ty)) ?? null
}

export function isPortalTile(area: Area, tx: number, ty: number): boolean {
  return portalAt(area, tx, ty) !== null
}
