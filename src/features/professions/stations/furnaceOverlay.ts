// The furnace inside the WildLands renderer (R33).
//
// Two jobs and no more: find the tile the furnace stands on in an area, and
// draw the approved art in the state the **domain** says it is in.
//
// It owns no gameplay. There is no timer here, no recipe, no inventory and no
// completion check: `state()` asks the controller, which asks the process
// (`stationVisualState`). The renderer's clock only picks an animation frame,
// and only while the station is working — which is why a reload lands on the
// right picture instead of restarting an animation.
//
// The contrast with the Alchemy bench is deliberate. The bench shows `ready`
// when the player walks up to it: that is hover state wearing a world state's
// name. The furnace is `ready` because a process is holding its ore (§11).
//
// Browser runtime (it builds canvases). Everything it decides comes from pure
// modules.

import { WORLDS } from '../../wildlands/areas/atlas'
import type { Area } from '../../wildlands/engine/area'
import type { OverlaySprite, SceneOverlay } from '../../wildlands/engine/sceneOverlay'
import { TILE, type World } from '../../wildlands/engine/world'
import { nodeAt, worldNodePort, type NodeWorldPort } from '../domain/nodePlacement'
import type { ItemStack } from '../domain/types'
import { furnaceStationArt } from '../art/furnaceStation'
import type { StationState } from '../art/stationVisuals'
import { toSprite } from '../art/pixelArt'
import { RewardPops } from '../overworld/rewardPops'
import { resourceIconArt } from '../art/miningItems'
import { STATION_BY_ID } from './stationDefinition'
import { footprintFeet, footprintTiles, type FootprintTile } from './stationFootprint'
import { findStationSpot } from './stationPlacement'

/** Four frames a second: the same cadence the campfire and the bench animate at. */
export const FURNACE_FRAME_HZ = 6

const FURNACE = STATION_BY_ID.get('smelter')!

export interface FurnaceOverlayDeps {
  /** What the domain says the station looks like right now. */
  state(): StationState
  /** Tiles another station already took in this area, so two derived stations never collide. */
  avoid?(area: Area): readonly FootprintTile[]
}

export class FurnaceOverlay implements SceneOverlay {
  private readonly ports = new Map<string, NodeWorldPort>()
  private readonly tiles = new Map<string, FootprintTile | null>()
  private readonly pops = new RewardPops()
  private seconds = 0

  constructor(private readonly deps: FurnaceOverlayDeps) {}

  /**
   * The anchor tile of the furnace in this area, derived once and cached.
   *
   * Same idea as the bench: a deterministic spiral out from the world's own
   * spawn, so everyone's furnace is on the same tile and a future server can
   * check a position instead of trusting one. It starts further out than the
   * bench and refuses tiles the bench already claimed, so the two stations
   * share a clearing without standing on each other.
   */
  stationAt(area: Area): FootprintTile | null {
    if (area.kind !== 'wild') return null
    const cached = this.tiles.get(area.id)
    if (cached !== undefined) return cached
    const world = (area as { world?: World }).world
    let tile: FootprintTile | null = null
    if (world) {
      let port = this.ports.get(area.id)
      if (!port) this.ports.set(area.id, (port = worldNodePort(world)))
      const nodePort = port
      const definition = WORLDS.find(entry => entry.id === area.id)
      const anchor = definition ? world.findSpawn(definition.prefer) : null
      if (anchor) {
        const taken = new Set((this.deps.avoid?.(area) ?? []).map(entry => `${entry.tx}:${entry.ty}`))
        tile = findStationSpot({
          isSolid: (tx, ty) => area.isSolid(tx, ty),
          isWater: (tx, ty) => area.isWater(tx, ty),
          hasNode: (tx, ty) => nodeAt(nodePort, tx, ty) !== null,
          isOccupied: (tx, ty) => taken.has(`${tx}:${ty}`),
        }, FURNACE.footprint, anchor, { minRing: 7, maxRing: 18 })
      }
    }
    this.tiles.set(area.id, tile)
    return tile
  }

  /** The tiles it stands on, so the wiring can declare them to F-1. */
  stationTiles(area: Area): readonly FootprintTile[] {
    const tile = this.stationAt(area)
    return tile ? footprintTiles(FURNACE.footprint, tile) : []
  }

  /** True when this tile belongs to the furnace — any of them, not only the anchor. */
  isStation(area: Area, tx: number, ty: number): boolean {
    return this.stationTiles(area).some(tile => tile.tx === tx && tile.ty === ty)
  }

  /** A reward pop over the furnace, for what a collect just credited. */
  celebrate(area: Area, stacks: readonly ItemStack[], xp: number): void {
    const tile = this.stationAt(area)
    if (!tile) return
    const { x, y } = this.feet(tile)
    stacks.forEach((stack, index) => {
      this.pops.push({
        itemId: stack.itemId, text: `+${stack.quantity}`, color: '#ffe9c9',
        x: x + (index - (stacks.length - 1) / 2) * 14, y, lift: 30, start: this.seconds + index * 0.1, life: 1.4,
      })
    })
    if (xp > 0) this.pops.pushXp(xp, x, y, 48, this.seconds)
  }

  /** The art's feet: the middle of the footprint's front row, not of the anchor tile. */
  private feet(tile: FootprintTile): { x: number; y: number } {
    const feet = footprintFeet(FURNACE.footprint, tile)
    return { x: feet.x * TILE, y: feet.y * TILE + TILE - 2 }
  }

  ground(_g: CanvasRenderingContext2D, _area: Area, _x0: number, _y0: number, seconds: number): void {
    // A new game restarts the scene clock; drop what belonged to the old one.
    if (seconds < this.seconds) this.pops.clear()
    this.seconds = seconds
    this.pops.prune(seconds)
  }

  sprites(area: Area, seconds: number): readonly OverlaySprite[] {
    const tile = this.stationAt(area)
    if (!tile) return []
    const { x, y } = this.feet(tile)
    const state = this.deps.state()
    // Only `working` animates, so every other state draws one cached frame.
    const frame = state === 'working' ? Math.floor(seconds * FURNACE_FRAME_HZ) : 0
    return [
      { wx: x, wy: y, sprite: toSprite(furnaceStationArt(state, frame)), lift: 0, depthBias: 0 },
      ...this.pops.iconSprites(seconds, resourceIconArt),
    ]
  }

  labels(_area: Area, seconds: number) {
    return this.pops.labels(seconds)
  }
}
