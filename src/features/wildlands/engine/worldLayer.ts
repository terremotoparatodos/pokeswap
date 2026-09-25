// World layer port (WORLD-1).
//
// What the shared, server-authoritative world adds to a frame, seen from the
// engine: extra actors (a Pokémon working a node), companions it is drawing
// elsewhere (the follower that went to work), and the server clock. The engine
// knows nothing about nodes, actions or skills; the world feature implements
// this and the engine only asks.

import type { Actor } from './actors'
import type { Area } from './area'
import type { Tile } from './pathfinding'
import type { WildRoster } from '../../../../services/realtime/src/world/worldProtocol.js'

export interface WorldLayerContext {
  area(): Area
  /** Tile of a presence player (local or remote), or null when not in view. */
  playerTile(playerId: string): Tile | null
  /** Terrain, props and placed objects. */
  isSolid(tx: number, ty: number): boolean
}

export interface WorldLayer {
  update(dt: number, context: WorldLayerContext): void
  /** Drawn with the scene; never pickable and never solid. */
  actors(): readonly Actor[]
  /** True while the world draws `pokemonId` of `ownerId` as a worker: hide its follower. */
  hidesCompanion(ownerId: string, pokemonId: number): boolean
  /** Server time in ms once known; null before the first world message. */
  serverNow(): number | null
  /** The server's wild roster for an area, or null. */
  wildRoster(areaId: string): WildRoster | null
}
