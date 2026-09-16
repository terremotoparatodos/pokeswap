// Logging scene overlay (R31-C3): everything the player sees of logging inside
// the WildLands renderer — harvestable trees, proximity markers, the axe, the
// bite, leaves and splinters, the tree giving way, stumps and regrowth.
//
// Browser runtime only (it builds canvases). Every decision comes from pure
// modules: node status (demo session), tree visual state, the chopping
// timeline, leaves and rarity. It never writes anything outside local memory.

import type { Area } from '../../wildlands/engine/area'
import type { DecorInstance } from '../../wildlands/engine/chunks'
import type { DecorStyle, OverlayLabel, OverlaySprite, SceneOverlay } from '../../wildlands/engine/sceneOverlay'
import { TILE, type World } from '../../wildlands/engine/world'
import { NODE_BY_ID } from '../domain/catalog/nodes'
import { detectionRadius, nodeAt, worldNodePort, type NodeWorldPort } from '../domain/nodePlacement'
import { createSeededRandom } from '../domain/rng'
import type { ItemStack } from '../domain/types'
import { barkFlakeArt, leafArt, sawdustArt, splinterArt } from '../art/loggingFx'
import { axeSwingArt, LEAF_PARTICLE_TONES, loggingResourceIconArt } from '../art/loggingItems'
import type { AxeTier } from '../art/loggingPalette'
import { WOOD_TIERS } from '../art/loggingPalette'
import { isLoggingNodeId, isTreeKind, loggingTreeArt } from '../art/loggingTrees'
import { bubbleArt, glintArt } from '../art/miningFx'
import { resourceIconArt } from '../art/miningItems'
import { brighten, toSprite, type PixelArt } from '../art/pixelArt'
import { inspectDemoNode, type DemoNodeTarget, type DemoState } from '../demo/demoSession'
import { RARITY_FEEDBACK, type DropRarity } from '../mining/miningRarity'
import type { OverlayPlayer } from '../mining/miningOverlay'
import { spawnImpact, stepParticles, type Particle } from '../mining/particles'
import { RewardPops } from '../overworld/rewardPops'
import { WorkerCompanion } from '../overworld/workerCompanion'
import { openGround, summonWorkerOnce } from '../overworld/workerSummon'
import { resolveNodeStatus } from '../ui/nodeStatus'
import { bitesBetween, choppingPose, type ChoppingTimeline } from './choppingTimeline'
import { leafAlpha, leafFrame, spawnLeaves, stepLeaves, type Leaf } from './leaves'
import { treeVisual, type TreeVisualView } from './treeVisualState'

export interface LoggingOverlayDeps {
  state(): DemoState
  player(): OverlayPlayer | null
  /** Prospecting bonus used for the glint radius. */
  detection(): number
  targetId(): string | null
}

export interface LoggingReward {
  readonly stacks: readonly ItemStack[]
  readonly xp: number
  readonly rarity: DropRarity
}

export interface StartLogging {
  readonly target: DemoNodeTarget
  readonly tx: number
  readonly ty: number
  readonly timeline: ChoppingTimeline
  readonly tier: AxeTier
  readonly workerSpeciesId: number | null
  /** Applies the action (local demo) when the last bite lands. */
  readonly onResult: () => LoggingReward | null
  readonly onDone: () => void
}

interface ActiveAction extends StartLogging {
  readonly startedAt: number
  lastMs: number
  resultApplied: boolean
  fellStarted: boolean
  linger: number
  summoned: boolean
}

interface VisibleTree {
  readonly target: DemoNodeTarget
  readonly tx: number
  readonly ty: number
  readonly x: number
  readonly y: number
  readonly height: number
  readonly view: TreeVisualView
}

/** Hardwood and boreal trees are the ones worth spotting from afar. */
const RARE_TREES = new Set(['hardwood_tree', 'boreal_tree'])
const VIEW_REFRESH_SECONDS = 0.2

export class LoggingOverlay implements SceneOverlay {
  private readonly ports = new Map<string, NodeWorldPort>()
  private readonly placements = new Map<string, DemoNodeTarget | null>()
  private readonly views = new Map<string, { at: number; view: TreeVisualView }>()
  private readonly flashes = new WeakMap<PixelArt, PixelArt>()
  private readonly random = createSeededRandom(0x10cc)
  private readonly companion = new WorkerCompanion()
  private visible = new Map<string, VisibleTree>()
  private previous = new Map<string, VisibleTree>()
  private particles: Particle[] = []
  private leaves: Leaf[] = []
  private readonly pops = new RewardPops()
  private action: ActiveAction | null = null
  private seconds = 0

  constructor(private readonly deps: LoggingOverlayDeps) {}

  get busy(): boolean {
    return this.action !== null
  }

  /** Logging node hosted by a world tile, or null. Cached: nodes are deterministic. */
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
      if (placement && node && isLoggingNodeId(node.id)) target = { nodeId: placement.nodeId, node, biome: placement.biome }
    }
    this.placements.set(key, target)
    return target
  }

  start(options: StartLogging): void {
    this.action = { ...options, startedAt: this.seconds, lastMs: 0, resultApplied: false, fellStarted: false, linger: 0, summoned: false }
    this.views.delete(options.target.nodeId)
    if (options.workerSpeciesId !== null) this.companion.preload(options.workerSpeciesId)
  }

  preloadWorker(speciesId: number): void {
    this.companion.preload(speciesId)
  }

  /** Stops a running action immediately (e.g. the view unmounts). */
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
    this.leaves = []
    this.pops.clear()
    this.visible = new Map()
    this.previous = new Map()
    this.seconds = 0
  }

  private tick(seconds: number): void {
    if (seconds < this.seconds) this.rewind()
    const dt = Math.max(0, Math.min(0.1, seconds - this.seconds))
    this.seconds = seconds
    this.particles = stepParticles(this.particles, dt)
    this.leaves = stepLeaves(this.leaves, dt)
    this.pops.prune(seconds)

    const action = this.action
    if (!action) return
    const elapsed = (seconds - action.startedAt) * 1000
    const x = action.tx * TILE + TILE / 2
    const y = action.ty * TILE + TILE - 3
    const player = this.deps.player()
    const away = player ? Math.sign(action.tx - player.tx) : 0

    // Every bite: splinters and sawdust at the cut, a few leaves shaken loose.
    for (let i = bitesBetween(action.timeline, action.lastMs, elapsed).length; i > 0; i--) {
      this.particles = spawnImpact(this.particles, { x, y, z: 10, rarity: 'common', away, random: this.random })
      this.leaves = spawnLeaves(this.leaves, { x, y, z: 26, count: 2, tones: LEAF_PARTICLE_TONES, random: this.random })
    }

    const pose = choppingPose(action.timeline, elapsed)
    if (action.timeline.felling && !action.fellStarted && pose.phase === 'fell') {
      action.fellStarted = true
      // The canopy lets go all at once.
      this.leaves = spawnLeaves(this.leaves, { x, y, z: 30, count: 8, tones: LEAF_PARTICLE_TONES, random: this.random })
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

  private celebrate(action: ActiveAction, reward: LoggingReward, x: number, y: number, away: number): void {
    const feedback = RARITY_FEEDBACK[reward.rarity]
    action.linger = feedback.lingerMs
    this.particles = spawnImpact(this.particles, { x, y, z: 12, rarity: reward.rarity, away, random: this.random })
    this.pops.pushGathered(reward.stacks, reward.xp, x, y, 22, this.seconds)
  }

  private viewFor(target: DemoNodeTarget, tx: number, ty: number): TreeVisualView {
    const targeted = this.deps.targetId() === target.nodeId
    const chopping = this.action?.target.nodeId === target.nodeId
    const player = this.deps.player()
    const adjacent = !!player && !player.moving && Math.abs(player.tx - tx) + Math.abs(player.ty - ty) === 1
    const cached = this.views.get(target.nodeId)
    if (cached && !targeted && !chopping && this.seconds - cached.at < VIEW_REFRESH_SECONDS && (cached.view.bubble !== null) === adjacent) return cached.view
    const inspection = inspectDemoNode(this.deps.state(), target)
    const radius = detectionRadius(this.deps.detection())
    const view = treeVisual({
      status: resolveNodeStatus({ ...inspection, phase: 'idle' }),
      adjacent, targeted, chopping,
      respawnInSeconds: inspection.respawnInSeconds, respawnSeconds: target.node.respawnSeconds,
      rareTree: RARE_TREES.has(target.node.id),
      detected: !!player && Math.max(Math.abs(player.tx - tx), Math.abs(player.ty - ty)) <= radius,
    })
    this.views.set(target.nodeId, { at: this.seconds, view })
    return view
  }

  decor(decor: DecorInstance, area: Area): DecorStyle | null {
    if (!isTreeKind(decor.kind)) return null
    const target = this.targetAt(area, decor.tx, decor.ty)
    if (!target || !isLoggingNodeId(target.node.id)) return null
    const view = this.viewFor(target, decor.tx, decor.ty)
    let art = loggingTreeArt(target.node.id, decor.kind, view.art)
    let dx = 0
    let dy = 0
    const action = this.action
    if (action?.target.nodeId === target.nodeId) {
      const pose = choppingPose(action.timeline, (this.seconds - action.startedAt) * 1000)
      dx = pose.trunkShake
      if (pose.phase === 'bite') {
        let flash = this.flashes.get(art)
        if (!flash) this.flashes.set(art, (flash = brighten(art, 0.18)))
        art = flash
      }
      if (pose.fall > 0 && pose.phase === 'fell') {
        // The tree leans away from the player, then drops out of sight.
        const away = this.deps.player() ? Math.sign(decor.tx - this.deps.player()!.tx) || 1 : 1
        dx += away * pose.fall * 4
        dy += pose.fall * 3
        if (pose.fall > 0.7) art = loggingTreeArt(target.node.id, decor.kind, 'stump')
      }
    }
    this.visible.set(target.nodeId, { target, tx: decor.tx, ty: decor.ty, x: decor.x, y: decor.y, height: art.h, view })
    return { sprite: toSprite(art), dx, dy }
  }

  ground(g: CanvasRenderingContext2D, _area: Area, x0: number, y0: number, seconds: number): void {
    this.tick(seconds)
    this.previous = this.visible
    this.visible = new Map()
    for (const tree of this.previous.values()) {
      if (tree.view.ring === 'none') continue
      const cx = tree.tx * TILE + TILE / 2 - x0
      const cy = tree.ty * TILE + TILE / 2 + 2 - y0
      const strong = tree.view.ring === 'strong'
      const pulse = strong ? Math.sin(seconds * 5) * 0.6 : 0
      g.save()
      g.beginPath()
      g.ellipse(cx, cy, 11 + pulse, 6.5 + pulse * 0.6, 0, 0, Math.PI * 2)
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

    for (const tree of this.visible.values()) {
      if (tree.view.bubble && !this.action) {
        out.push({
          wx: tree.x, wy: tree.y, sprite: toSprite(bubbleArt(tree.view.bubble), false),
          lift: tree.height + 2 + Math.round(Math.sin(seconds * 3) * 1), depthBias: 0.5,
        })
      }
      if (tree.view.glint && Math.sin(seconds * 2.3 + tree.tx * 1.7 + tree.ty) > 0.55) {
        out.push({ wx: tree.x - 3, wy: tree.y, sprite: toSprite(glintArt(false), false), lift: Math.round(tree.height * 0.55), depthBias: 0.6 })
      }
    }

    const action = this.action
    const player = this.deps.player()
    if (action && player) {
      const pose = choppingPose(action.timeline, (seconds - action.startedAt) * 1000)
      if (pose.phase !== 'done' && pose.phase !== 'reward') {
        const side = player.dir === 'left' || player.dir === 'up'
        const offsetX = player.dir === 'right' ? 5 : player.dir === 'left' ? -5 : player.dir === 'down' ? 4 : -4
        const offsetY = player.dir === 'down' ? 1 : player.dir === 'up' ? -1 : 0
        out.push({
          wx: player.x + offsetX, wy: player.y + offsetY,
          sprite: toSprite(axeSwingArt(action.tier, pose.toolFrame, side), false),
          lift: 7, depthBias: player.dir === 'up' ? -0.6 : 0.6,
        })
      }
    }

    out.push(...this.companion.sprites(seconds))

    const barkTone = WOOD_TIERS.common.streak
    for (const p of this.particles) {
      const fade = 1 - p.age / p.life
      const art = p.kind === 'dust' ? sawdustArt(p.age > p.life / 2 ? 1 : 0)
        : p.kind === 'glint' ? glintArt(p.tone === 'special')
          : p.kind === 'spark' ? barkFlakeArt(barkTone)
            : splinterArt(p.age < p.life / 2)
      out.push({ wx: p.x, wy: p.y, sprite: toSprite(art, false), lift: p.z, alpha: Math.min(1, fade * 2), depthBias: 1 })
    }

    for (const leaf of this.leaves) {
      out.push({
        wx: leaf.x, wy: leaf.y, sprite: toSprite(leafArt(leafFrame(leaf), leaf.tone), false),
        lift: leaf.z, alpha: leafAlpha(leaf), depthBias: 0.9,
      })
    }

    out.push(...this.pops.iconSprites(seconds, itemId => loggingResourceIconArt(itemId) ?? resourceIconArt(itemId)))
    return out
  }

  /** Places the worker beside the player once per action, never inside a tree. */
  private summonWorker(area: Area): void {
    const action = this.action
    const player = this.deps.player()
    if (!action || !player) return
    summonWorkerOnce(this.companion, action, player, action, openGround(area, (tx, ty) => this.targetAt(area, tx, ty) !== null))
  }

  labels(_area: Area, seconds: number): readonly OverlayLabel[] {
    return this.pops.labels(seconds)
  }
}
