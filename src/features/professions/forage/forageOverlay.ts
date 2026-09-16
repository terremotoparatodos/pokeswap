// Alchemy foraging scene overlay (R31-C4.1): the gathering half of Alchemy
// inside the WildLands renderer — berry bushes, herb patches, wild groves and
// frost blooms, the sickle sweep, the petals, the picked plant and its regrowth.
//
// R31-Z: the lifecycle, rings, markers, worker and pops shared with mining and
// logging live in `overworld/gatheringOverlayCore.ts`; this file keeps what is
// foraging's own — plant art and sway, hand or sickle, petals and motes, and
// the herb patch, which is terrain and is found by scanning around the player.
//
// Browser runtime only (it builds canvases). Every decision comes from pure
// modules: node status, the forage visual state, the timeline and the art. It
// never writes anything outside local memory.

import type { Area } from '../../wildlands/engine/area'
import type { DecorInstance } from '../../wildlands/engine/chunks'
import type { DecorStyle, OverlaySprite } from '../../wildlands/engine/sceneOverlay'
import { TILE } from '../../wildlands/engine/world'
import { createSeededRandom } from '../domain/rng'
import { alchemyIconArt } from '../art/alchemyItems'
import { bladeArt, frostMoteArt, petalArt, PETAL_TONES, pollenArt, seedArt } from '../art/forageFx'
import { forageNodeArt, FORAGE_ANCHORS, isForageAnchor, isForageNodeId, type ForageNodeId } from '../art/forageNodes'
import { sickleSwingArt } from '../art/forageItems'
import type { SickleTier } from '../art/foragePalette'
import { resourceIconArt } from '../art/miningItems'
import { fishingResourceIconArt } from '../art/fishingItems'
import { toSprite, type PixelArt } from '../art/pixelArt'
import type { DemoNodeTarget } from '../demo/demoSession'
import {
  GatheringOverlayCore,
  type ActiveGathering, type GatheringOverlayDeps, type GatheringReward, type RingStyle, type StartGathering,
  type ViewInput, type VisibleNode,
} from '../overworld/gatheringOverlayCore'
import { foragePose, takesBetween, type ForageTimeline } from './forageTimeline'
import { forageVisual, type ForageVisualView } from './forageVisualState'

export type ForageOverlayDeps = GatheringOverlayDeps
export type ForageReward = GatheringReward
export type StartForage = StartGathering<ForageTimeline, SickleTier>

type ActiveAction = ActiveGathering<StartForage>

interface VisiblePlant extends VisibleNode<ForageVisualView> {
  readonly nodeId: ForageNodeId
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

/** The grove and the frost bloom are the ones worth spotting from afar. */
const RARE_NODES = new Set<string>(['wild_grove', 'frost_bloom'])
const MAX_MOTES = 26
/** Tiles around the player scanned for herb patches, and how often. */
const PATCH_RADIUS = 13
const PATCH_SCAN_SECONDS = 0.3

function iconFor(itemId: string) {
  return alchemyIconArt(itemId) ?? resourceIconArt(itemId) ?? fishingResourceIconArt(itemId)
}

export class ForageOverlay extends GatheringOverlayCore<StartForage, ActiveAction, ForageVisualView, VisiblePlant> {
  private readonly random = createSeededRandom(0xf04a)
  private motes: Mote[] = []
  private patches: { target: DemoNodeTarget; tx: number; ty: number }[] = []
  private patchesAt = -1
  private patchesArea = ''
  protected readonly rewardLift = 20
  protected readonly ring: RingStyle = { rx: 10, ry: 6, strongFill: 'rgba(164, 226, 124, 0.18)', strongStroke: '#a4e27c' }

  protected ownsNode(nodeId: string): boolean {
    return isForageNodeId(nodeId)
  }

  protected buildView({ target, status, inspection, adjacent, targeted, working, detected }: ViewInput): ForageVisualView {
    return forageVisual({
      status, adjacent, targeted, gathering: working,
      respawnInSeconds: inspection.respawnInSeconds, respawnSeconds: target.node.respawnSeconds,
      rareNode: RARE_NODES.has(target.node.id),
      detected,
      needsTool: target.node.minToolTier > 0,
    })
  }

  protected stepEffects(dt: number): void {
    for (const mote of this.motes) {
      mote.age += dt
      mote.x += mote.vx * dt
      // Petals drift down instead of falling: they are light.
      mote.vz -= 34 * dt
      mote.z = Math.max(0, mote.z + mote.vz * dt)
    }
    this.motes = this.motes.filter(mote => mote.age < mote.life)
  }

  protected resetEffects(): void {
    this.motes = []
    this.patches = []
    this.patchesAt = -1
  }

  protected actionFrame(action: ActiveAction, elapsedMs: number, x: number, y: number): void {
    const player = this.deps.player()
    const away = player ? Math.sign(action.tx - player.tx) || 1 : 1
    const nodeId = action.target.node.id as ForageNodeId
    for (let i = takesBetween(action.timeline, action.lastMs, elapsedMs).length; i > 0; i--) {
      this.spawnMotes(nodeId, x, y, action.timeline.style === 'sickle' ? 5 : 3, away)
    }
  }

  protected celebrationEffects(action: ActiveAction, reward: GatheringReward, x: number, y: number): void {
    this.spawnMotes(action.target.node.id as ForageNodeId, x, y, reward.rarity === 'common' ? 3 : 6, 0)
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

  /** Art plus the sway of the plant while it is being gathered. */
  private plantArt(target: DemoNodeTarget, view: ForageVisualView): { art: PixelArt; dx: number } {
    const nodeId = target.node.id as ForageNodeId
    let art = forageNodeArt(nodeId, view.art, view.frame)
    let dx = 0
    const action = this.action
    if (action?.target.nodeId === target.nodeId) {
      const pose = foragePose(action.timeline, (this.seconds - action.startedAt) * 1000)
      dx = pose.sway
      if (pose.phase === 'take') art = this.flashOf(art, 0.16)
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

    this.pushMarkers(out, seconds, plant => ({ special: plant.nodeId === 'frost_bloom', heightRatio: 0.7 }))

    const action = this.action
    const player = this.deps.player()
    // The sickle only exists when the plant asks for it; berries are picked by hand.
    if (action && player && action.timeline.style === 'sickle') {
      const pose = foragePose(action.timeline, (seconds - action.startedAt) * 1000)
      if (pose.phase !== 'done' && pose.phase !== 'reward') {
        const side = player.dir === 'left' || player.dir === 'up'
        out.push(this.toolSprite(player, sickleSwingArt(action.tier, pose.toolFrame, side), 6))
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

    out.push(...this.pops.iconSprites(seconds, iconFor))
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
}
