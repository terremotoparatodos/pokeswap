// Gathering overlay core (R31-Z, SKILLS-1): what Minería and Talar share
// inside the WildLands renderer — which tiles host their nodes, the cached
// visual state of each visible node, the life of one action (start, result,
// linger, done, cancel), the selection rings, the proximity bubbles and rare
// glints and the reward pops. The working Pokémon itself is drawn by WORLD
// (`world/render/workerActors`), the same for its owner and for everyone else.
//
// Each skill keeps what makes it look like itself: its art, its timeline and
// pose, its particles, how it restyles the host prop, the falling tree.
// There is no tool in the player's hand: the Pokémon does the work.
//
// Browser runtime only (sprites become canvases). Presentation only: node
// state comes from `deps.nodeState`, results from `onResult`.

import type { Area } from '../../../wildlands/engine/area'
import type { OverlayLabel, OverlaySprite, SceneOverlay } from '../../../wildlands/engine/sceneOverlay'
import { TILE, type Biome } from '../../../wildlands/engine/world'
import { bubbleArt, glintArt, type BubbleKind } from '../art/miningFx'
import { brighten, toSprite, type PixelArt } from '../art/pixelArt'
import type { ItemStack } from '../../domain/materials'
import { resourceAt } from '../../../../../services/realtime/src/world/resourceLayout.js'
import { skillsResourceFor } from '../../../worldSkills/resourceMapping'
import { RARITY_FEEDBACK, type DropRarity } from '../mining/miningRarity'
import type { OverlayPlayer } from '../mining/miningOverlay'
import type { NodeState, NodeStatus, NodeTarget } from '../nodeTarget'
import { RewardPops } from './rewardPops'

export interface GatheringOverlayDeps {
  /** The node's state from whoever owns nodes (pre-WORLD stand-in, then WORLD-1). */
  nodeState(target: NodeTarget): NodeState
  player(): OverlayPlayer | null
  targetId(): string | null
}

export interface GatheringReward {
  readonly stacks: readonly ItemStack[]
  readonly xp: number
  readonly rarity: DropRarity
}

/** The two moments of a timeline the lifecycle needs; the rest is profession art. */
export interface GatheringTimeline {
  readonly resultAtMs: number
  readonly totalMs: number
}

export interface StartGathering<Timeline extends GatheringTimeline = GatheringTimeline> {
  readonly target: NodeTarget
  readonly tx: number
  readonly ty: number
  readonly timeline: Timeline
  /** Settles the action when the timeline reaches its result; null when nothing was granted. */
  /**
   * The action's reward at the scene's result beat. `undefined` means the
   * server has not settled yet: the scene holds on that beat and asks again
   * next frame (up to RESULT_WAIT_MS), so the pops show what was really paid.
   */
  readonly onResult: () => GatheringReward | null | undefined
  readonly onDone: () => void
}

export type ActiveGathering<Start extends StartGathering = StartGathering> = Start & {
  readonly startedAt: number
  lastMs: number
  resultApplied: boolean
  linger: number
}

/** What every node visual state shares. */
export interface GatheringView {
  readonly bubble: BubbleKind | null
  readonly ring: 'none' | 'soft' | 'strong'
  readonly glint: boolean
}

export interface VisibleNode<View extends GatheringView = GatheringView> {
  readonly target: NodeTarget
  readonly tx: number
  readonly ty: number
  readonly x: number
  readonly y: number
  readonly height: number
  readonly view: View
}

/** Everything a profession needs to decide one node's visual state. */
export interface ViewInput {
  readonly target: NodeTarget
  readonly status: NodeStatus
  readonly state: NodeState
  readonly adjacent: boolean
  readonly targeted: boolean
  /** The running action is on this node. */
  readonly working: boolean
  readonly detected: boolean
}

/** The selection ring drawn on the ground under a node. */
export interface RingStyle {
  readonly rx: number
  readonly ry: number
  readonly strongFill: string
  readonly strongStroke: string
}

/** How long the scene waits at its result beat for the server's settlement. */
const RESULT_WAIT_MS = 8_000
const VIEW_REFRESH_SECONDS = 0.2
/** Rare nodes glint when the player is within this many tiles. */
const GLINT_RADIUS = 8
const SOFT_FILL = 'rgba(255, 255, 255, 0.1)'
const SOFT_STROKE = 'rgba(255, 255, 255, 0.7)'

export abstract class GatheringOverlayCore<
  Start extends StartGathering,
  Action extends ActiveGathering<Start>,
  View extends GatheringView,
  Visible extends VisibleNode<View>,
> implements SceneOverlay {
  private readonly placements = new Map<string, NodeTarget | null>()
  private readonly views = new Map<string, { at: number; view: View }>()
  protected readonly flashes = new WeakMap<PixelArt, PixelArt>()
  protected readonly pops = new RewardPops()
  protected visible = new Map<string, Visible>()
  private previous = new Map<string, Visible>()
  protected action: Action | null = null
  protected seconds = 0

  constructor(protected readonly deps: GatheringOverlayDeps) {}

  // ── What each profession provides ──────────────────────────────────────

  /** True for the catalog nodes this overlay draws. */
  protected abstract ownsNode(nodeId: string): boolean
  /** The profession's visual state for one node. */
  protected abstract buildView(input: ViewInput): View
  /** Lift of the first reward pop over the node. */
  protected abstract readonly rewardLift: number
  protected abstract readonly ring: RingStyle
  /** Advances the profession's own particles by `dt` seconds. */
  protected abstract stepEffects(dt: number): void
  /** Drops the profession's own particles and caches when the scene clock rewinds. */
  protected abstract resetEffects(): void
  /** Per-frame effects of the running action (strikes, bites, takes…), before its result. */
  protected abstract actionFrame(action: Action, elapsedMs: number, x: number, y: number): void
  /** The profession's burst when the result lands; pops are added by the core. */
  protected abstract celebrationEffects(action: Action, reward: GatheringReward, x: number, y: number): void

  /** The running action's record; professions with extra per-action state extend it. */
  protected activate(options: Start): Action {
    return { ...options, startedAt: this.seconds, lastMs: 0, resultApplied: false, linger: 0 } as Action
  }

  // ── Public surface (unchanged from the per-profession overlays) ───────

  get busy(): boolean {
    return this.action !== null
  }

  /**
   * The node of this skill on a world tile, or null. Identity comes from WORLD
   * (the same id the server validates), the resource from the shared mapping
   * (INTEGRATION-1). Cached: both are deterministic.
   */
  targetAt(area: Area, tx: number, ty: number): NodeTarget | null {
    if (area.kind !== 'wild') return null
    const key = `${area.id}:${tx}:${ty}`
    if (this.placements.has(key)) return this.placements.get(key)!
    const node = resourceAt(area.id, tx, ty)
    const resource = node ? skillsResourceFor(node) : null
    const target = node && resource && this.ownsNode(resource.id) ? { nodeId: node.id, resource, biome: node.biome as Biome } : null
    this.placements.set(key, target)
    return target
  }

  start(options: Start): void {
    this.action = this.activate(options)
    this.views.delete(options.target.nodeId)
  }

  /** Stops any running action immediately (e.g. the view unmounts). */
  cancel(): void {
    const action = this.action
    this.action = null
    if (action && !action.resultApplied) action.onDone()
  }

  ground(g: CanvasRenderingContext2D, _area: Area, x0: number, y0: number, seconds: number): void {
    this.tick(seconds)
    this.previous = this.visible
    this.visible = new Map()
    const ring = this.ring
    for (const node of this.previous.values()) {
      if (node.view.ring === 'none') continue
      const cx = node.tx * TILE + TILE / 2 - x0
      const cy = node.ty * TILE + TILE / 2 + 2 - y0
      const strong = node.view.ring === 'strong'
      const pulse = strong ? Math.sin(seconds * 5) * 0.6 : 0
      g.save()
      g.beginPath()
      g.ellipse(cx, cy, ring.rx + pulse, ring.ry + pulse * 0.6, 0, 0, Math.PI * 2)
      g.fillStyle = strong ? ring.strongFill : SOFT_FILL
      g.fill()
      g.lineWidth = strong ? 1.5 : 1
      g.strokeStyle = strong ? ring.strongStroke : SOFT_STROKE
      g.stroke()
      g.restore()
    }
  }

  labels(_area: Area, seconds: number): readonly OverlayLabel[] {
    return this.pops.labels(seconds)
  }

  // ── Shared building blocks for the professions' `decor` and `sprites` ─

  /** Cached visual state of a node, refreshed a few times a second or when something about it changes. */
  protected viewFor(target: NodeTarget, tx: number, ty: number): View {
    const targeted = this.deps.targetId() === target.nodeId
    const working = this.action?.target.nodeId === target.nodeId
    const player = this.deps.player()
    const adjacent = !!player && !player.moving && Math.abs(player.tx - tx) + Math.abs(player.ty - ty) === 1
    const cached = this.views.get(target.nodeId)
    if (cached && !targeted && !working && this.seconds - cached.at < VIEW_REFRESH_SECONDS && (cached.view.bubble !== null) === adjacent) return cached.view
    const state = this.deps.nodeState(target)
    const view = this.buildView({
      target, state, adjacent, targeted, working, status: state.status,
      detected: !!player && Math.max(Math.abs(player.tx - tx), Math.abs(player.ty - ty)) <= GLINT_RADIUS,
    })
    this.views.set(target.nodeId, { at: this.seconds, view })
    return view
  }

  /** The art a node shows on a hit frame: a brightened copy, cached per art. */
  protected flashOf(art: PixelArt, amount: number): PixelArt {
    let flash = this.flashes.get(art)
    if (!flash) this.flashes.set(art, (flash = brighten(art, amount)))
    return flash
  }

  /** Proximity bubbles and rare glints over the visible nodes. */
  protected pushMarkers(out: OverlaySprite[], seconds: number, glint: (node: Visible) => { special: boolean; heightRatio: number }): void {
    for (const node of this.visible.values()) {
      if (node.view.bubble && !this.action) {
        out.push({
          wx: node.x, wy: node.y, sprite: toSprite(bubbleArt(node.view.bubble), false),
          lift: node.height + 2 + Math.round(Math.sin(seconds * 3) * 1), depthBias: 0.5,
        })
      }
      if (node.view.glint && Math.sin(seconds * 2.3 + node.tx * 1.7 + node.ty) > 0.55) {
        const { special, heightRatio } = glint(node)
        out.push({ wx: node.x - 3, wy: node.y, sprite: toSprite(glintArt(special), false), lift: Math.round(node.height * heightRatio), depthBias: 0.6 })
      }
    }
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────

  /** A new game restarts the scene clock, so cached frames must be dropped. */
  private rewind(): void {
    this.views.clear()
    this.resetEffects()
    this.pops.clear()
    this.visible = new Map()
    this.previous = new Map()
    this.seconds = 0
  }

  private tick(seconds: number): void {
    if (seconds < this.seconds) this.rewind()
    const dt = Math.max(0, Math.min(0.1, seconds - this.seconds))
    this.seconds = seconds
    this.stepEffects(dt)
    this.pops.prune(seconds)
    const action = this.action
    if (!action) return
    const elapsed = (seconds - action.startedAt) * 1000
    const x = action.tx * TILE + TILE / 2
    const y = action.ty * TILE + TILE - 3
    this.actionFrame(action, elapsed, x, y)
    if (!action.resultApplied && elapsed >= action.timeline.resultAtMs) {
      const reward = action.onResult()
      if (reward === undefined && elapsed < action.timeline.resultAtMs + RESULT_WAIT_MS) {
        // The server's answer is on its way: hold the result beat.
        action.lastMs = elapsed
        return
      }
      action.resultApplied = true
      this.views.delete(action.target.nodeId)
      if (reward) {
        action.linger = RARITY_FEEDBACK[reward.rarity].lingerMs
        this.celebrationEffects(action, reward, x, y)
        this.pops.pushGathered(reward.stacks, reward.xp, x, y, this.rewardLift, this.seconds)
      }
    }
    action.lastMs = elapsed
    if (elapsed >= action.timeline.totalMs + action.linger) {
      this.action = null
      action.onDone()
    }
  }
}
