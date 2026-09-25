// Mining scene overlay (R31-C1, SKILLS-1): everything the player sees of
// Minería inside the WildLands renderer — node variants, proximity bubbles
// and rings, rare glints, the rock shaking under the Pokémon's blows, impact
// particles and reward pops.
//
// R31-Z: the lifecycle, rings, markers, worker and pops shared with logging
// and foraging live in `overworld/gatheringOverlayCore.ts`; this file keeps
// what is mining's own — rock art, the swing, the chips.
//
// Browser runtime only (it builds canvases). All decisions come from pure
// modules: node state (its owner), visual state, action timeline, particles
// and rarity. It never writes anything outside local memory.

import type { Area } from '../../../wildlands/engine/area'
import type { Dir } from '../../../wildlands/engine/characters'
import type { DecorInstance } from '../../../wildlands/engine/chunks'
import type { DecorStyle, OverlaySprite } from '../../../wildlands/engine/sceneOverlay'
import { createSeededRandom } from '../../domain/rng'
import { chipArt, dustArt, glintArt, RARITY_CHIP_TONES, sparkArt } from '../art/miningFx'
import { resourceIconArt } from '../art/miningItems'
import { isMiningAnchor, isMiningNodeId, miningNodeArt, RESPAWN_FRAMES } from '../art/miningNodes'
import { toSprite } from '../art/pixelArt'
import {
  GatheringOverlayCore,
  type ActiveGathering, type GatheringOverlayDeps, type GatheringReward, type RingStyle, type StartGathering,
  type ViewInput, type VisibleNode,
} from '../overworld/gatheringOverlayCore'
import { miningPose, strikesBetween, type MiningTimeline } from './miningAction'
import { rarityOfItem } from './miningRarity'
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

export type MiningOverlayDeps = GatheringOverlayDeps
export type MiningReward = GatheringReward
export type StartMining = StartGathering<MiningTimeline>

type ActiveAction = ActiveGathering<StartMining>

const RARE_NODES = new Set(['gold_vein', 'crystal_cluster'])

export class MiningOverlay extends GatheringOverlayCore<StartMining, ActiveAction, NodeVisualView, VisibleNode<NodeVisualView>> {
  private readonly random = createSeededRandom(0x51ab)
  private particles: Particle[] = []
  protected readonly rewardLift = 20
  protected readonly ring: RingStyle = { rx: 10, ry: 6, strongFill: 'rgba(255, 210, 122, 0.16)', strongStroke: '#ffd27a' }

  protected ownsNode(nodeId: string): boolean {
    return isMiningNodeId(nodeId)
  }

  protected buildView({ target, status, state, adjacent, targeted, working, detected }: ViewInput): NodeVisualView {
    return nodeVisual({
      status, adjacent, targeted, mining: working,
      respawnInSeconds: state.respawnInSeconds, respawnSeconds: target.resource.world.respawnSeconds,
      rareNode: RARE_NODES.has(target.resource.id),
      detected,
    })
  }

  protected stepEffects(dt: number): void {
    this.particles = stepParticles(this.particles, dt)
  }

  protected resetEffects(): void {
    this.particles = []
  }

  protected actionFrame(action: ActiveAction, elapsedMs: number, x: number, y: number): void {
    const nodeRarity = rarityOfItem(action.target.resource.drop.itemId)
    const away = this.awayFromPlayer(action)
    for (let i = strikesBetween(action.timeline, action.lastMs, elapsedMs).length; i > 0; i--) {
      this.particles = spawnImpact(this.particles, { x, y, z: 6, rarity: nodeRarity === 'common' ? 'common' : 'uncommon', away, random: this.random })
    }
  }

  protected celebrationEffects(action: ActiveAction, reward: GatheringReward, x: number, y: number): void {
    this.particles = spawnImpact(this.particles, { x, y, z: 8, rarity: reward.rarity, away: this.awayFromPlayer(action), random: this.random })
  }

  /** Chips fly away from the player: -1, 0 or 1 along x. */
  private awayFromPlayer(action: ActiveAction): number {
    const player = this.deps.player()
    return player ? Math.sign(action.tx - player.tx) : 0
  }

  decor(decor: DecorInstance, area: Area): DecorStyle | null {
    if (!isMiningAnchor(decor.kind)) return null
    const target = this.targetAt(area, decor.tx, decor.ty)
    if (!target || !isMiningNodeId(target.resource.id)) return null
    const view = this.viewFor(target, decor.tx, decor.ty)
    let art = miningNodeArt(target.resource.id, decor.kind, view.art, respawnFrame(view.respawnProgress, RESPAWN_FRAMES))
    let dx = 0
    const action = this.action
    if (action?.target.nodeId === target.nodeId) {
      const pose = miningPose(action.timeline, (this.seconds - action.startedAt) * 1000)
      dx = pose.nodeShake
      if (pose.phase === 'strike') art = this.flashOf(art, 0.35)
    }
    this.visible.set(target.nodeId, { target, tx: decor.tx, ty: decor.ty, x: decor.x, y: decor.y, height: art.h, view })
    return { sprite: toSprite(art), dx }
  }

  sprites(area: Area, seconds: number): readonly OverlaySprite[] {
    const out: OverlaySprite[] = []
    this.summonWorker(area)
    this.pushMarkers(out, seconds, node => ({ special: node.target.resource.id === 'crystal_cluster', heightRatio: 0.6 }))

    out.push(...this.companion.sprites(seconds))

    for (const p of this.particles) {
      const fade = 1 - p.age / p.life
      const art = p.kind === 'chip' ? chipArt(RARITY_CHIP_TONES[p.tone][0], RARITY_CHIP_TONES[p.tone][1])
        : p.kind === 'spark' ? sparkArt()
          : p.kind === 'dust' ? dustArt(p.age > p.life / 2 ? 1 : 0)
            : glintArt(p.tone === 'special')
      out.push({ wx: p.x, wy: p.y, sprite: toSprite(art, false), lift: p.z, alpha: p.kind === 'chip' ? Math.min(1, fade * 2) : fade, depthBias: 1 })
    }

    out.push(...this.pops.iconSprites(seconds, resourceIconArt))
    return out
  }
}
