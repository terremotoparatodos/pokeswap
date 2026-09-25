// Tap-to-move navigation — WildLands prototype
//
// Turns a tap into a walk: plans a path to the tapped tile (or next to a
// tapped Pokémon/NPC/obstacle), feeds it to the walker one direction at a
// time, re-plans when a wanderer steps into the way, and reports the actor to
// talk to once the player arrives beside it.

import { isMoving, type Actor } from './actors'
import type { Dir } from './characters'
import { findPath, pathTiles, type Tile } from './pathfinding'
import type { Pick, RouteMarker } from './renderer'

const MAX_REPLANS = 3
const REJECT_SECONDS = 0.6
const EMPTY_ROUTE_TILES: readonly Tile[] = []

export interface NavWorld {
  /** Terrain/prop blocking for the player (ignores other actors). */
  isSolid(tx: number, ty: number): boolean
  /** Another actor stands on the tile. */
  occupied(tx: number, ty: number): boolean
  /** Walkable tiles the player should stand beside and face, like props (e.g. resource nodes). */
  isInteractive?(tx: number, ty: number): boolean
  /**
   * Tiles that start a trip (area portals, building doors). A planned route
   * never passes over one on its way somewhere else — only when it is the
   * tile that was tapped. Walking there by hand is unchanged (INTEGRATION-1:
   * a tap on the huerta north of the Pradera arrival used to cross the return
   * pad and send the player back to town).
   */
  isTransit?(tx: number, ty: number): boolean
}

export class TapNavigator {
  private path: Dir[] = []
  private target: Tile | null = null
  private goalActor: Actor | null = null
  /** The step in progress when a plan was made did not come from the path. */
  private skipArrival = false
  private replans = 0
  private rejected: (Tile & { age: number }) | null = null
  private readonly world: NavWorld
  private readonly marker: RouteMarker = { tiles: EMPTY_ROUTE_TILES, target: null, rejected: null }

  constructor(world: NavWorld) {
    this.world = world
  }

  get active(): boolean {
    return this.target !== null
  }

  /** Direction for the walker; read again every time a tile is reached. */
  readonly next = (): Dir | null => this.path[0] ?? null

  /** Plans toward whatever was tapped. Returns false (and flashes a cross) when unreachable. */
  goTo(player: Actor, pick: Pick): boolean {
    if (!pick.tile) return false
    this.replans = 0
    this.goalActor = pick.actor
    const planned = this.plan(player, pick.tile)
    if (!planned) {
      this.rejected = { ...pick.tile, age: 0 }
      this.cancel()
    }
    return planned
  }

  cancel(): void {
    this.path = []
    this.target = null
    this.goalActor = null
    this.skipArrival = false
  }

  /** Call from the walker's onArrive while navigating. */
  arrived(): void {
    if (this.skipArrival) this.skipArrival = false
    else this.path.shift()
  }

  /**
   * Per-frame bookkeeping after the walker ran. Returns true when the player
   * has just arrived beside a tapped actor or obstacle and faces it, i.e. it
   * is time to interact.
   */
  update(player: Actor, dt: number): boolean {
    if (this.rejected) {
      this.rejected.age += dt
      if (this.rejected.age > REJECT_SECONDS) this.rejected = null
    }
    if (!this.target) return false

    if (player.bumping && this.path.length) {
      // Someone walked into the path.
      if (this.replans++ >= MAX_REPLANS || !this.plan(player, this.goalTile())) this.giveUp()
      return false
    }
    if (isMoving(player) || this.path.length) return false

    const goal = this.goalTile()
    const adjacent = Math.abs(goal.tx - player.tx) + Math.abs(goal.ty - player.ty) === 1
    if (this.goalActor && !adjacent) {
      // It wandered off while we walked: follow it a few times.
      if (this.replans++ >= MAX_REPLANS || !this.plan(player, goal)) this.giveUp()
      return false
    }
    const faceIt = adjacent && (this.goalActor !== null || this.world.isSolid(goal.tx, goal.ty) || this.interactive(goal))
    if (faceIt) player.dir = faceToward(player, goal)
    this.cancel()
    return faceIt
  }

  route(player: Actor): RouteMarker {
    this.marker.tiles = this.target ? pathTiles({ tx: player.tx, ty: player.ty }, this.path) : EMPTY_ROUTE_TILES
    this.marker.target = this.target
    this.marker.rejected = this.rejected
    return this.marker
  }

  private interactive(tile: Tile): boolean {
    return this.world.isInteractive?.(tile.tx, tile.ty) ?? false
  }

  private goalTile(): Tile {
    return this.goalActor ? { tx: this.goalActor.tx, ty: this.goalActor.ty } : this.target!
  }

  private giveUp(): void {
    if (this.target) this.rejected = { ...this.target, age: 0 }
    this.cancel()
  }

  private plan(player: Actor, tile: Tile): boolean {
    const transit = (tx: number, ty: number) => (tx !== tile.tx || ty !== tile.ty) && (this.world.isTransit?.(tx, ty) ?? false)
    const blocked = (tx: number, ty: number) => this.world.isSolid(tx, ty) || this.world.occupied(tx, ty) || transit(tx, ty)
    // Solid props and actors can't be stood on: aim for a tile beside them instead.
    const beside = this.goalActor !== null || blocked(tile.tx, tile.ty) || this.interactive(tile)
    const isGoal = beside
      ? (tx: number, ty: number) => Math.abs(tx - tile.tx) + Math.abs(ty - tile.ty) === 1
      : (tx: number, ty: number) => tx === tile.tx && ty === tile.ty
    const path = findPath({ start: { tx: player.tx, ty: player.ty }, target: tile, isGoal, blocked })
    if (!path) return false
    this.path = path
    this.target = tile
    this.skipArrival = isMoving(player)
    return true
  }
}

function faceToward(from: Tile, to: Tile): Dir {
  const dx = to.tx - from.tx
  const dy = to.ty - from.ty
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'right' : 'left'
  return dy > 0 ? 'down' : 'up'
}
