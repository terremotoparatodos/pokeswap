// Alchemy scene overlay (R31-C4): the bench inside the WildLands renderer, and
// everything that happens on it — the flask taking the product's colour, the
// boil, the steam, the bottling, the worker Pokémon and the reward.
//
// Browser runtime only (it builds canvases). Every decision comes from pure
// modules: the brew timeline, the station placement and the recipe browser. It
// never writes anything outside local memory.

import { WORLDS } from '../../wildlands/areas/atlas'
import type { Area } from '../../wildlands/engine/area'
import type { OverlayLabel, OverlaySprite, SceneOverlay } from '../../wildlands/engine/sceneOverlay'
import { TILE, type World } from '../../wildlands/engine/world'
import { nodeAt, worldNodePort, type NodeWorldPort } from '../domain/nodePlacement'
import { createSeededRandom } from '../domain/rng'
import type { ItemStack } from '../domain/types'
import { bubbleFxArt, dropletArt, sparkleArt, steamArt } from '../art/alchemyFx'
import { alchemyIconArt } from '../art/alchemyItems'
import { liquidOf, type Liquid } from '../art/alchemyPalette'
import { alchemyStationArt, BREW_FRAME_HZ, type StationArtState } from '../art/alchemyStation'
import { fishingResourceIconArt } from '../art/fishingItems'
import { loggingResourceIconArt } from '../art/loggingItems'
import { bubbleArt } from '../art/miningFx'
import { resourceIconArt } from '../art/miningItems'
import { toSprite } from '../art/pixelArt'
import type { OverlayPlayer } from '../mining/miningOverlay'
import { RewardPops } from '../overworld/rewardPops'
import { WorkerCompanion } from '../overworld/workerCompanion'
import { openGround, summonWorkerOnce } from '../overworld/workerSummon'
import { bottlesBetween, brewPose, loadsBetween, type BrewTimeline } from './brewTimeline'
import { alchemyStationTile, type StationTile } from './stationPlacement'

export interface AlchemyOverlayDeps {
  player(): OverlayPlayer | null
  /** Anchor the bench is derived from; without one it is the world's own spawn. */
  anchor?(): StationTile | null
  /** True while the station panel is open, so the bench shows it is selected. */
  selected(): boolean
}

export interface AlchemyReward {
  readonly stacks: readonly ItemStack[]
  readonly xp: number
  /** Ingredients the Pokémon's processing trait saved, if any. */
  readonly savedInputs: number
}

export interface StartBrew {
  readonly timeline: BrewTimeline
  /** The product being made; it gives the flask its colour. */
  readonly productId: string
  readonly ingredients: number
  readonly workerSpeciesId: number | null
  /** Applies the craft (local demo) when the batch is bottled. */
  readonly onResult: () => AlchemyReward | null
  readonly onDone: () => void
}

interface ActiveBrew extends StartBrew {
  readonly startedAt: number
  lastMs: number
  resultApplied: boolean
  summoned: boolean
}

interface Puff {
  x: number
  y: number
  z: number
  age: number
  life: number
  kind: 'bubble' | 'steam' | 'drop' | 'spark'
  tone: Liquid
}

const MAX_PUFFS = 28

function iconFor(itemId: string) {
  return alchemyIconArt(itemId) ?? resourceIconArt(itemId) ?? fishingResourceIconArt(itemId) ?? loggingResourceIconArt(itemId)
}

export class AlchemyOverlay implements SceneOverlay {
  private readonly ports = new Map<string, NodeWorldPort>()
  private readonly tiles = new Map<string, StationTile | null>()
  private readonly companion = new WorkerCompanion()
  private readonly random = createSeededRandom(0xa1c4)
  private puffs: Puff[] = []
  private readonly pops = new RewardPops()
  private brew: ActiveBrew | null = null
  private seconds = 0

  constructor(private readonly deps: AlchemyOverlayDeps) {}

  get busy(): boolean {
    return this.brew !== null
  }

  /** The bench tile of an area, derived once and cached. */
  stationAt(area: Area): StationTile | null {
    if (area.kind !== 'wild') return null
    const cached = this.tiles.get(area.id)
    if (cached !== undefined) return cached
    const world = (area as { world?: World }).world
    let tile: StationTile | null = null
    if (world) {
      let port = this.ports.get(area.id)
      if (!port) this.ports.set(area.id, (port = worldNodePort(world)))
      const nodePort = port
      // Without an explicit anchor the bench belongs to the world's own spawn,
      // which is where a town would eventually put it.
      const definition = WORLDS.find(entry => entry.id === area.id)
      const anchor = this.deps.anchor?.() ?? (definition ? world.findSpawn(definition.prefer) : null)
      if (anchor) {
        tile = alchemyStationTile({
          isSolid: (tx, ty) => area.isSolid(tx, ty),
          isWater: (tx, ty) => area.isWater(tx, ty),
          hasNode: (tx, ty) => nodeAt(nodePort, tx, ty) !== null,
        }, anchor)
      }
    }
    this.tiles.set(area.id, tile)
    return tile
  }

  /** True when this tile is the bench: the engine uses it to walk the player beside it. */
  isStation(area: Area, tx: number, ty: number): boolean {
    const tile = this.stationAt(area)
    return !!tile && tile.tx === tx && tile.ty === ty
  }

  start(options: StartBrew): void {
    this.brew = { ...options, startedAt: this.seconds, lastMs: 0, resultApplied: false, summoned: false }
    if (options.workerSpeciesId !== null) this.companion.preload(options.workerSpeciesId)
  }

  preloadWorker(speciesId: number): void {
    this.companion.preload(speciesId)
  }

  cancel(): void {
    const brew = this.brew
    this.brew = null
    this.companion.dismiss(this.seconds)
    if (brew && !brew.resultApplied) brew.onDone()
  }

  /** A new game restarts the scene clock, so cached frames must be dropped. */
  private rewind(): void {
    this.puffs = []
    this.pops.clear()
    this.seconds = 0
  }

  private spawn(puff: Omit<Puff, 'age'>): void {
    if (this.puffs.length >= MAX_PUFFS) return
    this.puffs.push({ ...puff, age: 0 })
  }

  private tick(seconds: number, area: Area): void {
    if (seconds < this.seconds) this.rewind()
    const dt = Math.max(0, Math.min(0.1, seconds - this.seconds))
    this.seconds = seconds
    for (const puff of this.puffs) {
      puff.age += dt
      puff.z += (puff.kind === 'drop' ? -14 : 9) * dt
      puff.x += (puff.kind === 'steam' ? 3 : 0) * dt
    }
    this.puffs = this.puffs.filter(puff => puff.age < puff.life)
    this.pops.prune(seconds)

    const brew = this.brew
    const tile = this.stationAt(area)
    if (!brew || !tile) return
    const elapsed = (seconds - brew.startedAt) * 1000
    const ink = liquidOf(brew.productId)
    const x = tile.tx * TILE + TILE / 2
    const y = tile.ty * TILE + TILE - 2
    const pose = brewPose(brew.timeline, elapsed)

    // Loading: one drop per ingredient falling into the flask.
    for (let i = loadsBetween(brew.timeline, brew.ingredients, brew.lastMs, elapsed).length; i > 0; i--) {
      this.spawn({ x: x - 5, y, z: 34, life: 0.45, kind: 'drop', tone: ink })
    }
    // Boiling: bubbles off the surface and a thread of steam.
    if (pose.phase === 'boil' && this.random() < pose.boil * 0.9) {
      this.spawn({ x: x - 6 + this.random() * 4, y, z: 20, life: 0.5, kind: 'bubble', tone: ink })
      if (this.random() < 0.4) this.spawn({ x: x - 5, y, z: 28, life: 0.9, kind: 'steam', tone: ink })
    }
    // Bottling: a drop per unit poured into the phials.
    for (let i = bottlesBetween(brew.timeline, brew.lastMs, elapsed).length; i > 0; i--) {
      this.spawn({ x: x + 2, y, z: 26, life: 0.35, kind: 'drop', tone: ink })
    }

    if (!brew.resultApplied && elapsed >= brew.timeline.resultAtMs) {
      brew.resultApplied = true
      const reward = brew.onResult()
      if (reward) this.celebrate(reward, x, y, ink)
    }
    brew.lastMs = elapsed
    if (elapsed >= brew.timeline.totalMs) {
      this.brew = null
      this.companion.dismiss(seconds)
      brew.onDone()
    }
  }

  private celebrate(reward: AlchemyReward, x: number, y: number, ink: Liquid): void {
    for (let i = 0; i < 3; i++) this.spawn({ x: x - 4 + i * 4, y, z: 30 + i * 2, life: 0.7, kind: 'spark', tone: ink })
    // Processing products are not rarity-graded: one warm colour, a tighter stagger.
    reward.stacks.forEach((stack, index) => {
      this.pops.push({
        itemId: stack.itemId, text: `+${stack.quantity}`, color: '#ffe9c9',
        x: x + (index - (reward.stacks.length - 1) / 2) * 14, y, lift: 26, start: this.seconds + index * 0.1, life: 1.4,
      })
    })
    this.pops.pushXp(reward.xp, x, y, 44, this.seconds)
    if (reward.savedInputs > 0) {
      // The Pokémon's processing trait gave an ingredient back: worth saying.
      this.pops.push({
        itemId: null, text: `Ahorró ${reward.savedInputs}`, color: '#a4e27c',
        x, y, lift: 58, start: this.seconds + 0.35, life: 1.4,
      })
      this.spawn({ x, y, z: 36, life: 0.8, kind: 'spark', tone: ink })
    }
  }

  private stationState(adjacent: boolean): StationArtState {
    if (this.brew) {
      const pose = brewPose(this.brew.timeline, (this.seconds - this.brew.startedAt) * 1000)
      return pose.phase === 'reward' || pose.phase === 'done' ? 'done' : 'brewing'
    }
    return adjacent || this.deps.selected() ? 'ready' : 'idle'
  }

  ground(_g: CanvasRenderingContext2D, area: Area, _x0: number, _y0: number, seconds: number): void {
    this.tick(seconds, area)
  }

  sprites(area: Area, seconds: number): readonly OverlaySprite[] {
    const out: OverlaySprite[] = []
    const tile = this.stationAt(area)
    if (!tile) return out
    const player = this.deps.player()
    const adjacent = !!player && Math.abs(player.tx - tile.tx) + Math.abs(player.ty - tile.ty) === 1
    const x = tile.tx * TILE + TILE / 2
    const y = tile.ty * TILE + TILE - 2

    const brew = this.brew
    const ink = liquidOf(brew?.productId ?? 'potion')
    const state = this.stationState(adjacent)
    const frame = Math.floor(seconds * BREW_FRAME_HZ)
    out.push({ wx: x, wy: y, sprite: toSprite(alchemyStationArt(state, ink, frame)), lift: 0, depthBias: 0 })

    if (!brew && adjacent) {
      out.push({
        wx: x, wy: y, sprite: toSprite(bubbleArt('flask'), false),
        lift: 32 + Math.round(Math.sin(seconds * 3)), depthBias: 0.5,
      })
    }

    this.summonWorker(area, tile)
    out.push(...this.companion.sprites(seconds))

    for (const puff of this.puffs) {
      const t = puff.age / puff.life
      const art = puff.kind === 'bubble' ? bubbleFxArt(puff.tone, t > 0.6)
        : puff.kind === 'steam' ? steamArt(t > 0.66 ? 2 : t > 0.33 ? 1 : 0)
          : puff.kind === 'drop' ? dropletArt(puff.tone)
            : sparkleArt(t > 0.5)
      out.push({ wx: puff.x, wy: puff.y, sprite: toSprite(art, false), lift: puff.z, alpha: Math.min(1, (1 - t) * 2), depthBias: 1 })
    }

    out.push(...this.pops.iconSprites(seconds, iconFor))
    return out
  }

  /** Places the worker beside the player once per brew, never on the bench. */
  private summonWorker(area: Area, tile: StationTile): void {
    const brew = this.brew
    const player = this.deps.player()
    if (!brew || !player) return
    summonWorkerOnce(this.companion, brew, player, tile, openGround(area, (tx, ty) => this.isStation(area, tx, ty)))
  }

  labels(_area: Area, seconds: number): readonly OverlayLabel[] {
    return this.pops.labels(seconds)
  }
}
