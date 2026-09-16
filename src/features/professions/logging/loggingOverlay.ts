// Logging scene overlay (R31-C3): everything the player sees of logging inside
// the WildLands renderer — harvestable trees, proximity markers, the axe, the
// bite, leaves and splinters, the tree giving way, stumps and regrowth.
//
// R31-Z: the lifecycle, rings, markers, worker and pops shared with mining and
// foraging live in `overworld/gatheringOverlayCore.ts`; this file keeps what
// is logging's own — tree art, the axe, splinters and leaves, and the fall on
// the action that takes the last charge.
//
// Browser runtime only (it builds canvases). Every decision comes from pure
// modules: node status (demo session), tree visual state, the chopping
// timeline, leaves and rarity. It never writes anything outside local memory.

import type { Area } from '../../wildlands/engine/area'
import type { DecorInstance } from '../../wildlands/engine/chunks'
import type { DecorStyle, OverlaySprite } from '../../wildlands/engine/sceneOverlay'
import { createSeededRandom } from '../domain/rng'
import { barkFlakeArt, leafArt, sawdustArt, splinterArt } from '../art/loggingFx'
import { axeSwingArt, LEAF_PARTICLE_TONES, loggingResourceIconArt } from '../art/loggingItems'
import type { AxeTier } from '../art/loggingPalette'
import { WOOD_TIERS } from '../art/loggingPalette'
import { isLoggingNodeId, isTreeKind, loggingTreeArt } from '../art/loggingTrees'
import { glintArt } from '../art/miningFx'
import { resourceIconArt } from '../art/miningItems'
import { toSprite } from '../art/pixelArt'
import { spawnImpact, stepParticles, type Particle } from '../mining/particles'
import {
  GatheringOverlayCore,
  type ActiveGathering, type GatheringOverlayDeps, type GatheringReward, type RingStyle, type StartGathering,
  type ViewInput, type VisibleNode,
} from '../overworld/gatheringOverlayCore'
import { bitesBetween, choppingPose, type ChoppingTimeline } from './choppingTimeline'
import { leafAlpha, leafFrame, spawnLeaves, stepLeaves, type Leaf } from './leaves'
import { treeVisual, type TreeVisualView } from './treeVisualState'

export type LoggingOverlayDeps = GatheringOverlayDeps
export type LoggingReward = GatheringReward
export type StartLogging = StartGathering<ChoppingTimeline, AxeTier>

type ActiveAction = ActiveGathering<StartLogging> & {
  /** The canopy lets go once, on the frame the fall starts. */
  fellStarted: boolean
}

/** Hardwood and boreal trees are the ones worth spotting from afar. */
const RARE_TREES = new Set(['hardwood_tree', 'boreal_tree'])

const loggingIcon = (itemId: string) => loggingResourceIconArt(itemId) ?? resourceIconArt(itemId)

export class LoggingOverlay extends GatheringOverlayCore<StartLogging, ActiveAction, TreeVisualView, VisibleNode<TreeVisualView>> {
  private readonly random = createSeededRandom(0x10cc)
  private particles: Particle[] = []
  private leaves: Leaf[] = []
  protected readonly rewardLift = 22
  protected readonly ring: RingStyle = { rx: 11, ry: 6.5, strongFill: 'rgba(255, 210, 122, 0.16)', strongStroke: '#ffd27a' }

  protected ownsNode(nodeId: string): boolean {
    return isLoggingNodeId(nodeId)
  }

  protected activate(options: StartLogging): ActiveAction {
    return { ...super.activate(options), fellStarted: false }
  }

  protected buildView({ target, status, inspection, adjacent, targeted, working, detected }: ViewInput): TreeVisualView {
    return treeVisual({
      status, adjacent, targeted, chopping: working,
      respawnInSeconds: inspection.respawnInSeconds, respawnSeconds: target.node.respawnSeconds,
      rareTree: RARE_TREES.has(target.node.id),
      detected,
    })
  }

  protected stepEffects(dt: number): void {
    this.particles = stepParticles(this.particles, dt)
    this.leaves = stepLeaves(this.leaves, dt)
  }

  protected resetEffects(): void {
    this.particles = []
    this.leaves = []
  }

  protected actionFrame(action: ActiveAction, elapsedMs: number, x: number, y: number): void {
    const away = this.awayFromPlayer(action)
    // Every bite: splinters and sawdust at the cut, a few leaves shaken loose.
    for (let i = bitesBetween(action.timeline, action.lastMs, elapsedMs).length; i > 0; i--) {
      this.particles = spawnImpact(this.particles, { x, y, z: 10, rarity: 'common', away, random: this.random })
      this.leaves = spawnLeaves(this.leaves, { x, y, z: 26, count: 2, tones: LEAF_PARTICLE_TONES, random: this.random })
    }

    const pose = choppingPose(action.timeline, elapsedMs)
    if (action.timeline.felling && !action.fellStarted && pose.phase === 'fell') {
      action.fellStarted = true
      // The canopy lets go all at once.
      this.leaves = spawnLeaves(this.leaves, { x, y, z: 30, count: 8, tones: LEAF_PARTICLE_TONES, random: this.random })
    }
  }

  protected celebrationEffects(action: ActiveAction, reward: GatheringReward, x: number, y: number): void {
    this.particles = spawnImpact(this.particles, { x, y, z: 12, rarity: reward.rarity, away: this.awayFromPlayer(action), random: this.random })
  }

  /** Splinters fly away from the player: -1, 0 or 1 along x. */
  private awayFromPlayer(action: ActiveAction): number {
    const player = this.deps.player()
    return player ? Math.sign(action.tx - player.tx) : 0
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
      if (pose.phase === 'bite') art = this.flashOf(art, 0.18)
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

  sprites(area: Area, seconds: number): readonly OverlaySprite[] {
    const out: OverlaySprite[] = []
    this.summonWorker(area)
    this.pushMarkers(out, seconds, () => ({ special: false, heightRatio: 0.55 }))

    const action = this.action
    const player = this.deps.player()
    if (action && player) {
      const pose = choppingPose(action.timeline, (seconds - action.startedAt) * 1000)
      if (pose.phase !== 'done' && pose.phase !== 'reward') {
        const side = player.dir === 'left' || player.dir === 'up'
        out.push(this.toolSprite(player, axeSwingArt(action.tier, pose.toolFrame, side), 7))
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

    out.push(...this.pops.iconSprites(seconds, loggingIcon))
    return out
  }
}
