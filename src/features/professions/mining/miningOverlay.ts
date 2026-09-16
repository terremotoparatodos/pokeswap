// Mining scene overlay (R31-C1): everything the player sees of mining inside
// the WildLands renderer — node variants, proximity bubbles and rings,
// prospecting glints, the pickaxe swing, impact particles and reward pops.
//
// Browser runtime only (it builds canvases). All decisions come from pure
// modules: node status (demo session), visual state, action timeline,
// particles and rarity. It never writes anything outside local memory.

import type { Area } from '../../wildlands/engine/area'
import type { Dir } from '../../wildlands/engine/characters'
import type { DecorInstance } from '../../wildlands/engine/chunks'
import type { DecorStyle, OverlayLabel, OverlaySprite, SceneOverlay } from '../../wildlands/engine/sceneOverlay'
import { TILE, type World } from '../../wildlands/engine/world'
import { NODE_BY_ID } from '../domain/catalog/nodes'
import { detectionRadius, nodeAt, worldNodePort, type NodeWorldPort } from '../domain/nodePlacement'
import { createSeededRandom } from '../domain/rng'
import type { ItemStack } from '../domain/types'
import { bubbleArt, chipArt, dustArt, glintArt, RARITY_CHIP_TONES, sparkArt } from '../art/miningFx'
import { pickaxeSwingArt, resourceIconArt, type PickaxeTier } from '../art/miningItems'
import { isMiningAnchor, isMiningNodeId, miningNodeArt, RESPAWN_FRAMES } from '../art/miningNodes'
import { brighten, toSprite, type PixelArt } from '../art/pixelArt'
import { WorkerCompanion } from '../overworld/workerCompanion'
import { workerSpot } from '../overworld/workerPresence'
import { inspectDemoNode, type DemoNodeTarget, type DemoState } from '../demo/demoSession'
import { resolveNodeStatus } from '../ui/nodeStatus'
import { miningPose, strikesBetween, type MiningTimeline } from './miningAction'
import { RARITY_FEEDBACK, rarityOfItem, type DropRarity } from './miningRarity'
import { nodeVisual, respawnFrame, type NodeVisualView } from './nodeVisualState'
import { spawnImpact, stepParticles, type Particle } from './particles'

export interface OverlayPlayer {
  readonly tx: number
  readonly ty: number
  readonly dir: Dir
  readonly x: number
  readonly y: number
  readonly moving: boolean
  readonly areaId: string
}

export interface MiningOverlayDeps {
  state(): DemoState
  player(): OverlayPlayer | null
  /** Prospecting bonus (affinity `detection`) used for the glint radius. */
  detection(): number
  targetId(): string | null
}

export interface MiningReward {
  readonly stacks: readonly ItemStack[]
  readonly xp: number
  readonly rarity: DropRarity
}

export interface StartMining {
  readonly target: DemoNodeTarget
  readonly tx: number
  readonly ty: number
  readonly timeline: MiningTimeline
  readonly tier: PickaxeTier
  /** Species drawn beside the player during the action; null for bare work. */
  readonly workerSpeciesId: number | null
  /** Applies the action (local demo) when the last strike lands. */
  readonly onResult: () => MiningReward | null
  readonly onDone: () => void
}

interface ActiveAction extends StartMining {
  readonly startedAt: number
  lastMs: number
  resultApplied: boolean
  linger: number
  /** The worker spot is chosen on the first drawn frame, when the area is known. */
  summoned: boolean
}

interface VisibleNode {
  readonly target: DemoNodeTarget
  readonly tx: number
  readonly ty: number
  readonly x: number
  readonly y: number
  readonly height: number
  readonly view: NodeVisualView
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

const RARE_NODES = new Set(['gold_vein', 'crystal_cluster'])
const VIEW_REFRESH_SECONDS = 0.2

export class MiningOverlay implements SceneOverlay {
  private readonly ports = new Map<string, NodeWorldPort>()
  private readonly placements = new Map<string, DemoNodeTarget | null>()
  private readonly views = new Map<string, { at: number; view: NodeVisualView }>()
  private readonly flashes = new WeakMap<PixelArt, PixelArt>()
  private readonly random = createSeededRandom(0x51ab)
  private visible = new Map<string, VisibleNode>()
  private previous = new Map<string, VisibleNode>()
  private particles: Particle[] = []
  private pops: RewardPop[] = []
  private action: ActiveAction | null = null
  private readonly companion = new WorkerCompanion()
  private seconds = 0

  constructor(private readonly deps: MiningOverlayDeps) {}

  get busy(): boolean {
    return this.action !== null
  }

  /** Mining node hosted by a world tile, or null. Cached: nodes are deterministic. */
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
      if (placement && node && isMiningNodeId(node.id)) target = { nodeId: placement.nodeId, node, biome: placement.biome }
    }
    this.placements.set(key, target)
    return target
  }

  start(options: StartMining): void {
    this.action = { ...options, startedAt: this.seconds, lastMs: 0, resultApplied: false, linger: 0, summoned: false }
    this.views.delete(options.target.nodeId)
    if (options.workerSpeciesId !== null) this.companion.preload(options.workerSpeciesId)
  }

  /** Warms a worker sheet ahead of the first action. */
  preloadWorker(speciesId: number): void {
    this.companion.preload(speciesId)
  }

  /** Stops any running action immediately (e.g. the view unmounts); the worker fades out. */
  cancel(): void {
    const action = this.action
    this.action = null
    this.companion.dismiss(this.seconds)
    if (action && !action.resultApplied) action.onDone()
  }

  /** A new game restarts the scene clock, so cached frames must be dropped. */
  private rewind(): void {
    this.views.clear()
    this.particles = []
    this.pops = []
    this.visible = new Map()
    this.previous = new Map()
    this.seconds = 0
  }

  private tick(seconds: number): void {
    if (seconds < this.seconds) this.rewind()
    const dt = Math.max(0, Math.min(0.1, seconds - this.seconds))
    this.seconds = seconds
    this.particles = stepParticles(this.particles, dt)
    this.pops = this.pops.filter(pop => seconds - pop.start < pop.life)
    const action = this.action
    if (!action) return
    const elapsed = (seconds - action.startedAt) * 1000
    const x = action.tx * TILE + TILE / 2
    const y = action.ty * TILE + TILE - 3
    const player = this.deps.player()
    const away = player ? Math.sign(action.tx - player.tx) : 0
    const nodeRarity = rarityOfItem(action.target.node.drops.primary.itemId)
    for (let i = strikesBetween(action.timeline, action.lastMs, elapsed).length; i > 0; i--) {
      this.particles = spawnImpact(this.particles, { x, y, z: 6, rarity: nodeRarity === 'common' ? 'common' : 'uncommon', away, random: this.random })
    }
    if (!action.resultApplied && elapsed >= action.timeline.resultAtMs) {
      action.resultApplied = true
      this.views.delete(action.target.nodeId)
      const reward = action.onResult()
      if (reward) this.celebrate(action, reward, x, y, away)
    }
    action.lastMs = elapsed
    if (elapsed >= action.timeline.totalMs + action.linger) {
      this.action = null
      this.companion.dismiss(seconds)
      action.onDone()
    }
  }

  private celebrate(action: ActiveAction, reward: MiningReward, x: number, y: number, away: number): void {
    const feedback = RARITY_FEEDBACK[reward.rarity]
    action.linger = feedback.lingerMs
    this.particles = spawnImpact(this.particles, { x, y, z: 8, rarity: reward.rarity, away, random: this.random })
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

  private viewFor(target: DemoNodeTarget, tx: number, ty: number): NodeVisualView {
    const targeted = this.deps.targetId() === target.nodeId
    const mining = this.action?.target.nodeId === target.nodeId
    const player = this.deps.player()
    const adjacent = !!player && !player.moving && Math.abs(player.tx - tx) + Math.abs(player.ty - ty) === 1
    const cached = this.views.get(target.nodeId)
    if (cached && !targeted && !mining && this.seconds - cached.at < VIEW_REFRESH_SECONDS && (cached.view.bubble !== null) === adjacent) return cached.view
    const inspection = inspectDemoNode(this.deps.state(), target)
    const radius = detectionRadius(this.deps.detection())
    const view = nodeVisual({
      status: resolveNodeStatus({ ...inspection, phase: 'idle' }),
      adjacent, targeted, mining,
      respawnInSeconds: inspection.respawnInSeconds, respawnSeconds: target.node.respawnSeconds,
      rareNode: RARE_NODES.has(target.node.id),
      detected: !!player && Math.max(Math.abs(player.tx - tx), Math.abs(player.ty - ty)) <= radius,
    })
    this.views.set(target.nodeId, { at: this.seconds, view })
    return view
  }

  decor(decor: DecorInstance, area: Area): DecorStyle | null {
    if (!isMiningAnchor(decor.kind)) return null
    const target = this.targetAt(area, decor.tx, decor.ty)
    if (!target || !isMiningNodeId(target.node.id)) return null
    const view = this.viewFor(target, decor.tx, decor.ty)
    let art = miningNodeArt(target.node.id, decor.kind, view.art, respawnFrame(view.respawnProgress, RESPAWN_FRAMES))
    let dx = 0
    const action = this.action
    if (action?.target.nodeId === target.nodeId) {
      const pose = miningPose(action.timeline, (this.seconds - action.startedAt) * 1000)
      dx = pose.nodeShake
      if (pose.phase === 'strike') {
        let flash = this.flashes.get(art)
        if (!flash) this.flashes.set(art, (flash = brighten(art, 0.35)))
        art = flash
      }
    }
    this.visible.set(target.nodeId, { target, tx: decor.tx, ty: decor.ty, x: decor.x, y: decor.y, height: art.h, view })
    return { sprite: toSprite(art), dx }
  }

  ground(g: CanvasRenderingContext2D, _area: Area, x0: number, y0: number, seconds: number): void {
    this.tick(seconds)
    this.previous = this.visible
    this.visible = new Map()
    for (const node of this.previous.values()) {
      if (node.view.ring === 'none') continue
      const cx = node.tx * TILE + TILE / 2 - x0
      const cy = node.ty * TILE + TILE / 2 + 2 - y0
      const strong = node.view.ring === 'strong'
      const pulse = strong ? Math.sin(seconds * 5) * 0.6 : 0
      g.save()
      g.beginPath()
      g.ellipse(cx, cy, 10 + pulse, 6 + pulse * 0.6, 0, 0, Math.PI * 2)
      g.fillStyle = strong ? 'rgba(255, 210, 122, 0.16)' : 'rgba(255, 255, 255, 0.1)'
      g.fill()
      g.lineWidth = strong ? 1.5 : 1
      g.strokeStyle = strong ? '#ffd27a' : 'rgba(255, 255, 255, 0.7)'
      g.stroke()
      g.restore()
    }
  }

  sprites(area: Area, seconds: number): readonly OverlaySprite[] {
    const out: OverlaySprite[] = []
    this.summonWorker(area)
    for (const node of this.visible.values()) {
      if (node.view.bubble && !this.action) {
        out.push({ wx: node.x, wy: node.y, sprite: toSprite(bubbleArt(node.view.bubble), false), lift: node.height + 2 + Math.round(Math.sin(seconds * 3) * 1), depthBias: 0.5 })
      }
      if (node.view.glint && Math.sin(seconds * 2.3 + node.tx * 1.7 + node.ty) > 0.55) {
        out.push({ wx: node.x - 3, wy: node.y, sprite: toSprite(glintArt(node.target.node.id === 'crystal_cluster'), false), lift: Math.round(node.height * 0.6), depthBias: 0.6 })
      }
    }

    const action = this.action
    const player = this.deps.player()
    if (action && player) {
      const pose = miningPose(action.timeline, (seconds - action.startedAt) * 1000)
      if (pose.phase !== 'done') {
        const side = player.dir === 'left' || player.dir === 'up'
        const offsetX = player.dir === 'right' ? 5 : player.dir === 'left' ? -5 : player.dir === 'down' ? 4 : -4
        const offsetY = player.dir === 'down' ? 1 : player.dir === 'up' ? -1 : 0
        out.push({
          wx: player.x + offsetX, wy: player.y + offsetY,
          sprite: toSprite(pickaxeSwingArt(action.tier, pose.phase === 'reward' ? 1 : pose.toolFrame, side), false),
          lift: 7, depthBias: player.dir === 'up' ? -0.6 : 0.6,
        })
      }
    }

    out.push(...this.companion.sprites(seconds))

    for (const p of this.particles) {
      const fade = 1 - p.age / p.life
      const art = p.kind === 'chip' ? chipArt(RARITY_CHIP_TONES[p.tone][0], RARITY_CHIP_TONES[p.tone][1])
        : p.kind === 'spark' ? sparkArt()
          : p.kind === 'dust' ? dustArt(p.age > p.life / 2 ? 1 : 0)
            : glintArt(p.tone === 'special')
      out.push({ wx: p.x, wy: p.y, sprite: toSprite(art, false), lift: p.z, alpha: p.kind === 'chip' ? Math.min(1, fade * 2) : fade, depthBias: 1 })
    }

    for (const pop of this.pops) {
      if (!pop.itemId) continue
      const icon = resourceIconArt(pop.itemId)
      const t = (seconds - pop.start) / pop.life
      if (!icon || t < 0) continue
      out.push({ wx: pop.x, wy: pop.y, sprite: toSprite(icon, false), lift: pop.lift + t * 14, alpha: t > 0.7 ? (1 - t) / 0.3 : 1, depthBias: 2 })
    }
    return out
  }

  /** Places the worker beside the player once per action: never on the node, water or solid tiles. */
  private summonWorker(area: Area): void {
    const action = this.action
    const player = this.deps.player()
    if (!action || action.summoned || !player) return
    action.summoned = true
    if (action.workerSpeciesId === null) return
    const spot = workerSpot(player, action, (tx, ty) => !area.isSolid(tx, ty) && !area.isWater(tx, ty) && !this.targetAt(area, tx, ty))
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
