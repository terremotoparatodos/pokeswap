// Alchemy foraging scene overlay (R31-C4.1): the gathering half of Alchemy
// inside the WildLands renderer — berry bushes, herb patches, wild groves and
// frost blooms, the sickle sweep, the petals, the picked plant and its regrowth.
//
// Browser runtime only (it builds canvases). Every decision comes from pure
// modules: node status, the forage visual state, the timeline and the art. It
// never writes anything outside local memory.

import type { Area } from '../../wildlands/engine/area'
import type { DecorInstance } from '../../wildlands/engine/chunks'
import type { DecorStyle, OverlayLabel, OverlaySprite, SceneOverlay } from '../../wildlands/engine/sceneOverlay'
import { TILE, type World } from '../../wildlands/engine/world'
import { NODE_BY_ID } from '../domain/catalog/nodes'
import { detectionRadius, nodeAt, worldNodePort, type NodeWorldPort } from '../domain/nodePlacement'
import { createSeededRandom } from '../domain/rng'
import type { ItemStack } from '../domain/types'
import { alchemyIconArt } from '../art/alchemyItems'
import { bladeArt, frostMoteArt, petalArt, PETAL_TONES, pollenArt, seedArt } from '../art/forageFx'
import { forageNodeArt, FORAGE_ANCHORS, isForageAnchor, isForageNodeId, type ForageNodeId } from '../art/forageNodes'
import { sickleSwingArt } from '../art/forageItems'
import type { SickleTier } from '../art/foragePalette'
import { bubbleArt, glintArt } from '../art/miningFx'
import { resourceIconArt } from '../art/miningItems'
import { fishingResourceIconArt } from '../art/fishingItems'
import { brighten, toSprite, type PixelArt } from '../art/pixelArt'
import { inspectDemoNode, type DemoNodeTarget, type DemoState } from '../demo/demoSession'
import { RARITY_FEEDBACK, rarityOfItem, type DropRarity } from '../mining/miningRarity'
import type { OverlayPlayer } from '../mining/miningOverlay'
import { WorkerCompanion } from '../overworld/workerCompanion'
import { workerSpot } from '../overworld/workerPresence'
import { resolveNodeStatus } from '../ui/nodeStatus'
import { foragePose, takesBetween, type ForageTimeline } from './forageTimeline'
import { forageVisual, type ForageVisualView } from './forageVisualState'

export interface ForageOverlayDeps {
  state(): DemoState
  player(): OverlayPlayer | null
  detection(): number
  targetId(): string | null
}

export interface ForageReward {
  readonly stacks: readonly ItemStack[]
  readonly xp: number
  readonly rarity: DropRarity
}

export interface StartForage {
  readonly target: DemoNodeTarget
  readonly tx: number
  readonly ty: number
  readonly timeline: ForageTimeline
  readonly tier: SickleTier
  readonly workerSpeciesId: number | null
  readonly onResult: () => ForageReward | null
  readonly onDone: () => void
}

interface ActiveAction extends StartForage {
  readonly startedAt: number
  lastMs: number
  resultApplied: boolean
  linger: number
  summoned: boolean
}

interface VisiblePlant {
  readonly target: DemoNodeTarget
  readonly nodeId: ForageNodeId
  readonly tx: number
  readonly ty: number
  readonly x: number
  readonly y: number
  readonly height: number
  readonly view: ForageVisualView
}

interface Mote {
  x: number
  y: number
  z: number
  vx: number
  vz: number
  age: number
  life: number
  kind: 'petal' | 'blade' | 'seed' | 'pollen' | 'frost'
  tone: string
}

interface RewardPop {
  readonly itemId: string | null
  readonly text: string
  readonly color: string
  readonly x: number
  readonly y: number
  readonly lift: number
  readonly start: number
  readonly life: number
}

/** The grove and the frost bloom are the ones worth spotting from afar. */
const RARE_NODES = new Set<string>(['wild_grove', 'frost_bloom'])
const MAX_MOTES = 26
const VIEW_REFRESH_SECONDS = 0.2
/** Tiles around the player scanned for herb patches, and how often. */
const PATCH_RADIUS = 13
const PATCH_SCAN_SECONDS = 0.3

function iconFor(itemId: string) {
  return alchemyIconArt(itemId) ?? resourceIconArt(itemId) ?? fishingResourceIconArt(itemId)
}

export class ForageOverlay implements SceneOverlay {
  private readonly ports = new Map<string, NodeWorldPort>()
  private readonly placements = new Map<string, DemoNodeTarget | null>()
  private readonly views = new Map<string, { at: number; view: ForageVisualView }>()
  private readonly flashes = new WeakMap<PixelArt, PixelArt>()
  private readonly random = createSeededRandom(0xf04a)
  private readonly companion = new WorkerCompanion()
  private visible = new Map<string, VisiblePlant>()
  private previous = new Map<string, VisiblePlant>()
  private motes: Mote[] = []
  private pops: RewardPop[] = []
  private action: ActiveAction | null = null
  private patches: { target: DemoNodeTarget; tx: number; ty: number }[] = []
  private patchesAt = -1
  private patchesArea = ''
  private seconds = 0

  constructor(private readonly deps: ForageOverlayDeps) {}

  get busy(): boolean {
    return this.action !== null
  }

  /** Forage node hosted by a world tile, or null. Cached: nodes are deterministic. */
  targetAt(area: Area, tx: number, ty: number): DemoNodeTarget | null {
    if (area.kind !== 'wild') return null
    const key = `${area.id}:${tx}:${ty}`
    if (this.placements.has(key)) return this.placements.get(key)!
    const world = (area as { world?: World }).world
    let target: DemoNodeTarget | null = null
    if (world) {
      let port = this.ports.get(area.id)
      if (!port) this.ports.set(area.id, (port = worldNodePort(world)))
      const placement = nodeAt(port, tx, ty)
      const node = placement ? NODE_BY_ID.get(placement.definitionId) : undefined
      if (placement && node && isForageNodeId(node.id)) target = { nodeId: placement.nodeId, node, biome: placement.biome }
    }
    this.placements.set(key, target)
    return target
  }

  start(options: StartForage): void {
    this.action = { ...options, startedAt: this.seconds, lastMs: 0, resultApplied: false, linger: 0, summoned: false }
    this.views.delete(options.target.nodeId)
    if (options.workerSpeciesId !== null) this.companion.preload(options.workerSpeciesId)
  }

  preloadWorker(speciesId: number): void {
    this.companion.preload(speciesId)
  }

  cancel(): void {
    const action = this.action
    this.action = null
    this.companion.dismiss(this.seconds)
    if (action && !action.resultApplied) action.onDone()
  }

  /** A new game restarts the scene clock, so cached frames must be dropped. */
  private rewind(): void {
    this.views.clear()
    this.motes = []
    this.pops = []
    this.visible = new Map()
    this.previous = new Map()
    this.patches = []
    this.patchesAt = -1
    this.seconds = 0
  }

  private spawnMotes(nodeId: ForageNodeId, x: number, y: number, count: number, away: number): void {
    const tones = PETAL_TONES[nodeId] ?? PETAL_TONES.berry_bush
    for (let i = 0; i < count; i++) {
      if (this.motes.length >= MAX_MOTES) return
      const kind: Mote['kind'] = nodeId === 'frost_bloom' ? 'frost'
        : nodeId === 'herb_patch' ? (i % 2 === 0 ? 'blade' : 'petal')
          : i % 3 === 0 ? 'seed' : 'petal'
      this.motes.push({
        x, y, z: 8 + this.random() * 8,
        vx: away * (6 + this.random() * 10) - 5 + this.random() * 10,
        vz: 10 + this.random() * 16,
        age: 0, life: 0.7 + this.random() * 0.5,
        kind, tone: tones[Math.floor(this.random() * tones.length)],
      })
    }
  }

  private tick(seconds: number): void {
    if (seconds < this.seconds) this.rewind()
    const dt = Math.max(0, Math.min(0.1, seconds - this.seconds))
    this.seconds = seconds
    for (const mote of this.motes) {
      mote.age += dt
      mote.x += mote.vx * dt
      // Petals drift down instead of falling: they are light.
      mote.vz -= 34 * dt
      mote.z = Math.max(0, mote.z + mote.vz * dt)
    }
    this.motes = this.motes.filter(mote => mote.age < mote.life)
    this.pops = this.pops.filter(pop => seconds - pop.start < pop.life)

    const action = this.action
    if (!action) return
    const elapsed = (seconds - action.startedAt) * 1000
    const x = action.tx * TILE + TILE / 2
    const y = action.ty * TILE + TILE - 3
    const player = this.deps.player()
    const away = player ? Math.sign(action.tx - player.tx) || 1 : 1
    const nodeId = action.target.node.id as ForageNodeId

    for (let i = takesBetween(action.timeline, action.lastMs, elapsed).length; i > 0; i--) {
      this.spawnMotes(nodeId, x, y, action.timeline.style === 'sickle' ? 5 : 3, away)
    }

    if (!action.resultApplied && elapsed >= action.timeline.resultAtMs) {
      action.resultApplied = true
      this.views.delete(action.target.nodeId)
      const reward = action.onResult()
      if (reward) this.celebrate(action, reward, x, y, nodeId)
    }
    action.lastMs = elapsed
    if (elapsed >= action.timeline.totalMs + action.linger) {
      this.action = null
      this.companion.dismiss(seconds)
      action.onDone()
    }
  }

  private celebrate(action: ActiveAction, reward: ForageReward, x: number, y: number, nodeId: ForageNodeId): void {
    const feedback = RARITY_FEEDBACK[reward.rarity]
    action.linger = feedback.lingerMs
    this.spawnMotes(nodeId, x, y, reward.rarity === 'common' ? 3 : 6, 0)
    const base = 20
    reward.stacks.forEach((stack, index) => {
      const rarity = rarityOfItem(stack.itemId)
      this.pops.push({
        itemId: stack.itemId, text: `+${stack.quantity}`, color: RARITY_FEEDBACK[rarity].labelColor,
        x: x + (index - (reward.stacks.length - 1) / 2) * 14, y, lift: base, start: this.seconds + index * 0.12,
        life: 1.2 + RARITY_FEEDBACK[rarity].lingerMs / 1000,
      })
    })
    this.pops.push({ itemId: null, text: `+${reward.xp} XP`, color: '#ffd27a', x, y, lift: base + 16, start: this.seconds + 0.2, life: 1.3 })
  }

  private viewFor(target: DemoNodeTarget, tx: number, ty: number): ForageVisualView {
    const targeted = this.deps.targetId() === target.nodeId
    const gathering = this.action?.target.nodeId === target.nodeId
    const player = this.deps.player()
    const adjacent = !!player && !player.moving && Math.abs(player.tx - tx) + Math.abs(player.ty - ty) === 1
    const cached = this.views.get(target.nodeId)
    if (cached && !targeted && !gathering && this.seconds - cached.at < VIEW_REFRESH_SECONDS && (cached.view.bubble !== null) === adjacent) return cached.view
    const inspection = inspectDemoNode(this.deps.state(), target)
    const radius = detectionRadius(this.deps.detection())
    const view = forageVisual({
      status: resolveNodeStatus({ ...inspection, phase: 'idle' }),
      adjacent, targeted, gathering,
      respawnInSeconds: inspection.respawnInSeconds, respawnSeconds: target.node.respawnSeconds,
      rareNode: RARE_NODES.has(target.node.id),
      detected: !!player && Math.max(Math.abs(player.tx - tx), Math.abs(player.ty - ty)) <= radius,
      needsTool: target.node.minToolTier > 0,
    })
    this.views.set(target.nodeId, { at: this.seconds, view })
    return view
  }

  /** Art plus the sway of the plant while it is being gathered. */
  private plantArt(target: DemoNodeTarget, view: ForageVisualView): { art: PixelArt; dx: number } {
    const nodeId = target.node.id as ForageNodeId
    let art = forageNodeArt(nodeId, view.art, view.frame)
    let dx = 0
    const action = this.action
    if (action?.target.nodeId === target.nodeId) {
      const pose = foragePose(action.timeline, (this.seconds - action.startedAt) * 1000)
      dx = pose.sway
      if (pose.phase === 'take') {
        let flash = this.flashes.get(art)
        if (!flash) this.flashes.set(art, (flash = brighten(art, 0.16)))
        art = flash
      }
    }
    return { art, dx }
  }

  /** Bushes and crystals are props: the overlay restyles them in place. */
  decor(decor: DecorInstance, area: Area): DecorStyle | null {
    if (!isForageAnchor(decor.kind)) return null
    const target = this.targetAt(area, decor.tx, decor.ty)
    if (!target || !isForageNodeId(target.node.id)) return null
    if (FORAGE_ANCHORS[target.node.id as ForageNodeId] !== decor.kind) return null
    const view = this.viewFor(target, decor.tx, decor.ty)
    const { art, dx } = this.plantArt(target, view)
    this.visible.set(target.nodeId, {
      target, nodeId: target.node.id as ForageNodeId, tx: decor.tx, ty: decor.ty,
      x: decor.x, y: decor.y, height: art.h, view,
    })
    return { sprite: toSprite(art), dx, dy: 0 }
  }

  ground(g: CanvasRenderingContext2D, _area: Area, x0: number, y0: number, seconds: number): void {
    this.tick(seconds)
    this.previous = this.visible
    this.visible = new Map()
    for (const plant of this.previous.values()) {
      if (plant.view.ring === 'none') continue
      const cx = plant.tx * TILE + TILE / 2 - x0
      const cy = plant.ty * TILE + TILE / 2 + 2 - y0
      const strong = plant.view.ring === 'strong'
      const pulse = strong ? Math.sin(seconds * 5) * 0.6 : 0
      g.save()
      g.beginPath()
      g.ellipse(cx, cy, 10 + pulse, 6 + pulse * 0.6, 0, 0, Math.PI * 2)
      g.fillStyle = strong ? 'rgba(164, 226, 124, 0.18)' : 'rgba(255, 255, 255, 0.1)'
      g.fill()
      g.lineWidth = strong ? 1.5 : 1
      g.strokeStyle = strong ? '#a4e27c' : 'rgba(255, 255, 255, 0.7)'
      g.stroke()
      g.restore()
    }
  }

  sprites(area: Area, seconds: number): readonly OverlaySprite[] {
    const out: OverlaySprite[] = []
    this.summonWorker(area)

    // The herb patch has no prop to restyle: it draws its own tuft on the tile.
    // Tall grass is terrain, so nothing else scans those tiles for us.
    for (const { target, tx, ty } of this.patchesAround(area, seconds)) {
      const view = this.viewFor(target, tx, ty)
      const { art, dx } = this.plantArt(target, view)
      const x = tx * TILE + TILE / 2
      const y = ty * TILE + TILE - 1
      out.push({ wx: x + dx, wy: y, sprite: toSprite(art, false), lift: 0, depthBias: 0 })
      this.visible.set(target.nodeId, { target, nodeId: 'herb_patch', tx, ty, x, y, height: art.h, view })
    }

    for (const plant of this.visible.values()) {
      if (plant.view.bubble && !this.action) {
        out.push({
          wx: plant.x, wy: plant.y, sprite: toSprite(bubbleArt(plant.view.bubble), false),
          lift: plant.height + 2 + Math.round(Math.sin(seconds * 3) * 1), depthBias: 0.5,
        })
      }
      if (plant.view.glint && Math.sin(seconds * 2.3 + plant.tx * 1.7 + plant.ty) > 0.55) {
        out.push({ wx: plant.x - 3, wy: plant.y, sprite: toSprite(glintArt(plant.nodeId === 'frost_bloom'), false), lift: Math.round(plant.height * 0.7), depthBias: 0.6 })
      }
    }

    const action = this.action
    const player = this.deps.player()
    // The sickle only exists when the plant asks for it; berries are picked by hand.
    if (action && player && action.timeline.style === 'sickle') {
      const pose = foragePose(action.timeline, (seconds - action.startedAt) * 1000)
      if (pose.phase !== 'done' && pose.phase !== 'reward') {
        const side = player.dir === 'left' || player.dir === 'up'
        const offsetX = player.dir === 'right' ? 5 : player.dir === 'left' ? -5 : player.dir === 'down' ? 4 : -4
        const offsetY = player.dir === 'down' ? 1 : player.dir === 'up' ? -1 : 0
        out.push({
          wx: player.x + offsetX, wy: player.y + offsetY,
          sprite: toSprite(sickleSwingArt(action.tier, pose.toolFrame, side), false),
          lift: 6, depthBias: player.dir === 'up' ? -0.6 : 0.6,
        })
      }
    }

    out.push(...this.companion.sprites(seconds))

    for (const mote of this.motes) {
      const t = mote.age / mote.life
      const art = mote.kind === 'blade' ? bladeArt(t < 0.5)
        : mote.kind === 'seed' ? seedArt()
          : mote.kind === 'pollen' ? pollenArt(t < 0.5)
            : mote.kind === 'frost' ? frostMoteArt(t < 0.5)
              : petalArt(mote.tone, t < 0.6)
      out.push({ wx: mote.x, wy: mote.y, sprite: toSprite(art, false), lift: mote.z, alpha: Math.min(1, (1 - t) * 2), depthBias: 1 })
    }

    for (const pop of this.pops) {
      if (!pop.itemId) continue
      const icon = iconFor(pop.itemId)
      const t = (seconds - pop.start) / pop.life
      if (!icon || t < 0) continue
      out.push({ wx: pop.x, wy: pop.y, sprite: toSprite(icon, false), lift: pop.lift + t * 14, alpha: t > 0.7 ? (1 - t) / 0.3 : 1, depthBias: 2 })
    }
    return out
  }

  /**
   * Herb patches near the player, rescanned a few times a second. Bushes and
   * crystals arrive through `decor`, but tall grass is terrain: without this
   * scan a patch would only appear once someone happened to tap its tile.
   */
  private patchesAround(area: Area, seconds: number): readonly { target: DemoNodeTarget; tx: number; ty: number }[] {
    const player = this.deps.player()
    if (!player) return []
    if (seconds - this.patchesAt > PATCH_SCAN_SECONDS || this.patchesArea !== area.id) {
      this.patchesAt = seconds
      this.patchesArea = area.id
      const found: { target: DemoNodeTarget; tx: number; ty: number }[] = []
      for (let ty = player.ty - PATCH_RADIUS; ty <= player.ty + PATCH_RADIUS; ty++) {
        for (let tx = player.tx - PATCH_RADIUS; tx <= player.tx + PATCH_RADIUS; tx++) {
          const target = this.targetAt(area, tx, ty)
          if (target && target.node.id === 'herb_patch') found.push({ target, tx, ty })
        }
      }
      this.patches = found
    }
    return this.patches
  }

  /** Places the worker beside the player once per action, never inside a plant. */
  private summonWorker(area: Area): void {
    const action = this.action
    const player = this.deps.player()
    if (!action || action.summoned || !player) return
    action.summoned = true
    if (action.workerSpeciesId === null) return
    const spot = workerSpot(player, action, (tx, ty) =>
      !area.isSolid(tx, ty) && !area.isWater(tx, ty) && !this.targetAt(area, tx, ty))
    if (spot) this.companion.summon(action.workerSpeciesId, spot)
  }

  labels(_area: Area, seconds: number): readonly OverlayLabel[] {
    return this.pops.flatMap(pop => {
      const t = (seconds - pop.start) / pop.life
      if (t < 0) return []
      return [{
        wx: pop.itemId ? pop.x + 12 : pop.x, wy: pop.y, lift: pop.lift + t * 14 + (pop.itemId ? 4 : 0),
        text: pop.text, color: pop.color, alpha: t > 0.7 ? (1 - t) / 0.3 : 1,
      }]
    })
  }
}
