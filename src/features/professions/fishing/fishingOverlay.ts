// Fishing scene overlay (R31-C2): everything the player sees of fishing inside
// the WildLands renderer — spot marks painted on the water, the rod, the line
// and bobber, the bite, splashes, the reward and the worker Pokémon.
//
// Browser runtime only (it builds canvases). Every decision comes from pure
// modules: node status (demo session), spot visual state, the cast timeline,
// the approach rules and rarity. It never writes anything outside local memory.

import type { Area } from '../../wildlands/engine/area'
import type { DecorStyle, OverlayLabel, OverlaySprite, SceneOverlay } from '../../wildlands/engine/sceneOverlay'
import { TILE, type World } from '../../wildlands/engine/world'
import { NODE_BY_ID } from '../domain/catalog/nodes'
import { detectionRadius, nodeAt, worldNodePort, type NodeWorldPort } from '../domain/nodePlacement'
import { createSeededRandom } from '../domain/rng'
import type { ItemStack } from '../domain/types'
import { biteMarkArt, bobberArt, dropletArt, lineDotArt, rippleArt, RIPPLE_FRAMES, splashArt } from '../art/fishingFx'
import { fishingResourceIconArt, rodCastArt, rodTipOffset, type RodTier } from '../art/fishingItems'
import { fishingSpotArt, isFishingNodeId, SPOT_IDLE_FRAMES, SPOT_RESPAWN_FRAMES, type FishingNodeId } from '../art/fishingSpots'
import { bubbleArt, glintArt } from '../art/miningFx'
import { resourceIconArt } from '../art/miningItems'
import { toSprite } from '../art/pixelArt'
import { inspectDemoNode, type DemoNodeTarget, type DemoState } from '../demo/demoSession'
import { RARITY_FEEDBACK, rarityOfItem, type DropRarity } from '../mining/miningRarity'
import type { OverlayPlayer } from '../mining/miningOverlay'
import type { Particle } from '../mining/particles'
import { WorkerCompanion } from '../overworld/workerCompanion'
import { workerSpot, type TilePoint } from '../overworld/workerPresence'
import { resolveNodeStatus } from '../ui/nodeStatus'
import { spawnSplash, stepParticles } from './fishingSplash'
import { fishingPose, gradeReel, isCatch, type FishingPlan, type ReelGrade } from './fishingTimeline'
import { spotRespawnFrame, spotVisual, type SpotVisualView } from './spotVisualState'

export interface FishingOverlayDeps {
  state(): DemoState
  player(): OverlayPlayer | null
  /** Prospecting bonus used for the glint radius. */
  detection(): number
  targetId(): string | null
}

export interface FishingReward {
  readonly stacks: readonly ItemStack[]
  readonly xp: number
  readonly rarity: DropRarity
}

export interface StartFishing {
  readonly target: DemoNodeTarget
  /** Spot tile (shore or reef). */
  readonly tx: number
  readonly ty: number
  /** Water tile the line lands on. */
  readonly water: TilePoint
  readonly plan: FishingPlan
  readonly tier: RodTier
  readonly workerSpeciesId: number | null
  /** Applies the action (local demo) when a reel catches something. */
  readonly onResult: (grade: ReelGrade) => FishingReward | null
  readonly onDone: (grade: ReelGrade) => void
}

interface ActiveCast extends StartFishing {
  readonly startedAt: number
  reelAtMs: number | null
  grade: ReelGrade | null
  caught: boolean
  reward: FishingReward | null
  celebrated: boolean
  landed: boolean
  summoned: boolean
}

interface VisibleSpot {
  readonly target: DemoNodeTarget
  readonly nodeId: FishingNodeId
  readonly tx: number
  readonly ty: number
  /** Where the mark is painted: a shore node marks the water it touches. */
  readonly water: TilePoint
  readonly view: SpotVisualView
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

const RARE_SPOTS = new Set(['reef_spot', 'coastal_spot'])
const SIDES: readonly (readonly [number, number])[] = [[0, 1], [0, -1], [1, 0], [-1, 0]]
const SCAN_RADIUS = 10
const SCAN_SECONDS = 0.4
const VIEW_REFRESH_SECONDS = 0.2
/** Height of the water surface the bobber floats on. */
const WATER_Z = 1

export class FishingOverlay implements SceneOverlay {
  private readonly ports = new Map<string, NodeWorldPort>()
  private readonly placements = new Map<string, DemoNodeTarget | null>()
  private readonly views = new Map<string, { at: number; view: SpotVisualView }>()
  private readonly random = createSeededRandom(0x5f15)
  private readonly companion = new WorkerCompanion()
  private spots: VisibleSpot[] = []
  private scannedAt = -1
  private particles: Particle[] = []
  private pops: RewardPop[] = []
  private cast: ActiveCast | null = null
  private seconds = 0

  constructor(private readonly deps: FishingOverlayDeps) {}

  get busy(): boolean {
    return this.cast !== null
  }

  /** True while the fish is hooked and the window is still open. */
  get biting(): boolean {
    const cast = this.cast
    if (!cast) return false
    return fishingPose(cast.plan, (this.seconds - cast.startedAt) * 1000, cast.reelAtMs, cast.caught).phase === 'bite'
  }

  /** Fishing node hosted by a world tile, or null. Cached: placements are deterministic. */
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
      if (placement && node && isFishingNodeId(node.id)) target = { nodeId: placement.nodeId, node, biome: placement.biome }
    }
    this.placements.set(key, target)
    return target
  }

  /** The water a spot marks: the spot tile itself (reef) or the water it touches (shore). */
  waterOf(area: Area, tx: number, ty: number): TilePoint {
    if (area.isWater(tx, ty)) return { tx, ty }
    for (const [dx, dy] of SIDES) {
      if (area.isWater(tx + dx, ty + dy)) return { tx: tx + dx, ty: ty + dy }
    }
    return { tx, ty }
  }

  /**
   * Interaction probe: the spot tile itself, or the water tile its mark sits
   * on, so tapping the visible ripples reaches the node on the bank.
   */
  spotAt(area: Area, tx: number, ty: number): { target: DemoNodeTarget; tx: number; ty: number } | null {
    const direct = this.targetAt(area, tx, ty)
    if (direct) return { target: direct, tx, ty }
    if (!area.isWater(tx, ty)) return null
    for (const [dx, dy] of SIDES) {
      const nx = tx + dx
      const ny = ty + dy
      const neighbour = this.targetAt(area, nx, ny)
      if (!neighbour) continue
      const water = this.waterOf(area, nx, ny)
      if (water.tx === tx && water.ty === ty) return { target: neighbour, tx: nx, ty: ny }
    }
    return null
  }

  start(options: StartFishing): void {
    this.cast = {
      ...options, startedAt: this.seconds, reelAtMs: null, grade: null, caught: false,
      reward: null, celebrated: false, landed: false, summoned: false,
    }
    this.views.delete(options.target.nodeId)
    if (options.workerSpeciesId !== null) this.companion.preload(options.workerSpeciesId)
  }

  preloadWorker(speciesId: number): void {
    this.companion.preload(speciesId)
  }

  /** Player pulled the line; returns how good the reaction was (null when idle). */
  reel(): ReelGrade | null {
    const cast = this.cast
    if (!cast || cast.reelAtMs !== null) return null
    const elapsed = (this.seconds - cast.startedAt) * 1000
    const grade = gradeReel(cast.plan, elapsed)
    cast.reelAtMs = elapsed
    cast.grade = grade
    cast.caught = isCatch(grade)
    if (cast.caught) {
      cast.reward = cast.onResult(grade)
      if (!cast.reward) cast.caught = false
    }
    this.views.delete(cast.target.nodeId)
    return grade
  }

  /** Stops a running cast immediately (e.g. the view unmounts). */
  cancel(): void {
    const cast = this.cast
    this.cast = null
    this.companion.dismiss(this.seconds)
    if (cast) cast.onDone(cast.grade ?? 'missed')
  }

  /** A new game restarts the scene clock, so cached frames must be dropped. */
  private rewind(): void {
    this.views.clear()
    this.particles = []
    this.pops = []
    this.spots = []
    this.scannedAt = -1
    this.seconds = 0
  }

  private tick(area: Area, seconds: number): void {
    if (seconds < this.seconds) this.rewind()
    const dt = Math.max(0, Math.min(0.1, seconds - this.seconds))
    this.seconds = seconds
    this.particles = stepParticles(this.particles, dt)
    this.pops = this.pops.filter(pop => seconds - pop.start < pop.life)
    this.scan(area, seconds)

    const cast = this.cast
    if (!cast) return
    const elapsed = (seconds - cast.startedAt) * 1000
    const pose = fishingPose(cast.plan, elapsed, cast.reelAtMs, cast.caught)
    const wx = cast.water.tx * TILE + TILE / 2
    const wy = cast.water.ty * TILE + TILE / 2

    if (!cast.landed && (pose.phase === 'waiting' || pose.phase === 'bite')) {
      cast.landed = true
      this.particles = spawnSplash(this.particles, { x: wx, y: wy, z: WATER_Z, droplets: 4, foam: 2, rarity: 'common', random: this.random })
    }
    if (!cast.celebrated && pose.phase === 'reward' && cast.reward) {
      cast.celebrated = true
      this.celebrate(cast.reward, wx, wy)
    }
    if (pose.phase === 'done') {
      const grade = cast.grade ?? 'missed'
      this.cast = null
      this.companion.dismiss(seconds)
      this.views.delete(cast.target.nodeId)
      cast.onDone(grade)
    }
  }

  private celebrate(reward: FishingReward, x: number, y: number): void {
    const feedback = RARITY_FEEDBACK[reward.rarity]
    this.particles = spawnSplash(this.particles, {
      x, y, z: WATER_Z, droplets: feedback.chips, foam: feedback.dust + 1, rarity: reward.rarity, random: this.random,
    })
    const base = 18
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

  /** Spots near the player, refreshed a few times a second. */
  private scan(area: Area, seconds: number): void {
    const player = this.deps.player()
    if (!player || seconds - this.scannedAt < SCAN_SECONDS) return
    this.scannedAt = seconds
    const found: VisibleSpot[] = []
    for (let dy = -SCAN_RADIUS; dy <= SCAN_RADIUS; dy++) {
      for (let dx = -SCAN_RADIUS; dx <= SCAN_RADIUS; dx++) {
        const tx = player.tx + dx
        const ty = player.ty + dy
        const target = this.targetAt(area, tx, ty)
        if (!target || !isFishingNodeId(target.node.id)) continue
        found.push({ target, nodeId: target.node.id, tx, ty, water: this.waterOf(area, tx, ty), view: this.viewFor(target, tx, ty, player) })
      }
    }
    this.spots = found
  }

  private viewFor(target: DemoNodeTarget, tx: number, ty: number, player: OverlayPlayer): SpotVisualView {
    const targeted = this.deps.targetId() === target.nodeId
    const cast = this.cast
    const fishing = cast?.target.nodeId === target.nodeId
    const adjacent = !player.moving && Math.abs(player.tx - tx) + Math.abs(player.ty - ty) === 1
    const cached = this.views.get(target.nodeId)
    if (cached && !targeted && !fishing && this.seconds - cached.at < VIEW_REFRESH_SECONDS && (cached.view.bubble !== null) === adjacent) return cached.view
    const inspection = inspectDemoNode(this.deps.state(), target)
    const radius = detectionRadius(this.deps.detection())
    const view = spotVisual({
      status: resolveNodeStatus({ ...inspection, phase: 'idle' }),
      adjacent, targeted, fishing, biting: fishing && this.biting,
      respawnInSeconds: inspection.respawnInSeconds, respawnSeconds: target.node.respawnSeconds,
      rareSpot: RARE_SPOTS.has(target.node.id),
      detected: Math.max(Math.abs(player.tx - tx), Math.abs(player.ty - ty)) <= radius,
    })
    this.views.set(target.nodeId, { at: this.seconds, view })
    return view
  }

  /** Fishing never replaces props: reef coral and searock stay as they are. */
  decor(): DecorStyle | null {
    return null
  }

  ground(g: CanvasRenderingContext2D, area: Area, x0: number, y0: number, seconds: number): void {
    this.tick(area, seconds)
    const beat = Math.floor(seconds * 1.6)
    for (const spot of this.spots) {
      const frame = spot.view.art === 'respawning'
        ? spotRespawnFrame(spot.view.respawnProgress, SPOT_RESPAWN_FRAMES)
        : beat % SPOT_IDLE_FRAMES
      const art = fishingSpotArt(spot.nodeId, spot.view.art, frame)
      const cx = spot.water.tx * TILE + TILE / 2 - x0
      const cy = spot.water.ty * TILE + TILE / 2 - y0
      g.drawImage(toSprite(art, false).canvas, Math.round(cx - art.ax), Math.round(cy - art.ay))
      if (spot.view.ring === 'none') continue
      const strong = spot.view.ring === 'strong'
      const pulse = strong ? Math.sin(seconds * 5) * 0.6 : 0
      g.save()
      g.beginPath()
      g.ellipse(cx, cy + 2, 10 + pulse, 6 + pulse * 0.6, 0, 0, Math.PI * 2)
      g.lineWidth = strong ? 1.5 : 1
      g.strokeStyle = strong ? '#ffd27a' : 'rgba(255, 255, 255, 0.7)'
      g.stroke()
      g.restore()
    }
  }

  sprites(area: Area, seconds: number): readonly OverlaySprite[] {
    const out: OverlaySprite[] = []
    const player = this.deps.player()

    for (const spot of this.spots) {
      const x = spot.water.tx * TILE + TILE / 2
      const y = spot.water.ty * TILE + TILE - 2
      if (spot.view.bubble && !this.cast) {
        out.push({ wx: x, wy: y, sprite: toSprite(bubbleArt(spot.view.bubble), false), lift: 14 + Math.round(Math.sin(seconds * 3)), depthBias: 0.5 })
      }
      if (spot.view.glint && Math.sin(seconds * 2.3 + spot.tx * 1.7 + spot.ty) > 0.55) {
        out.push({ wx: x - 3, wy: y, sprite: toSprite(glintArt(spot.target.node.id === 'reef_spot'), false), lift: 8, depthBias: 0.6 })
      }
    }

    const cast = this.cast
    if (cast && player) {
      this.summonWorker(area, cast, player)
      const pose = fishingPose(cast.plan, (seconds - cast.startedAt) * 1000, cast.reelAtMs, cast.caught)
      const facingLeft = player.dir === 'left' || player.dir === 'up'
      const handX = player.x + (player.dir === 'right' ? 5 : player.dir === 'left' ? -5 : player.dir === 'down' ? 4 : -4)
      const handY = player.y + (player.dir === 'down' ? 1 : player.dir === 'up' ? -1 : 0)
      if (pose.phase !== 'done') {
        out.push({
          wx: handX, wy: handY, sprite: toSprite(rodCastArt(cast.tier, pose.rodFrame, facingLeft), false),
          lift: 7, depthBias: player.dir === 'up' ? -0.6 : 0.6,
        })
      }

      const waterX = cast.water.tx * TILE + TILE / 2
      const waterY = cast.water.ty * TILE + TILE / 2
      if (pose.flight > 0) {
        const tip = rodTipOffset(pose.rodFrame, facingLeft)
        const tipX = handX + tip.dx
        const tipY = handY + tip.dy
        const t = pose.flight
        const bobX = tipX + (waterX - tipX) * t
        const bobY = tipY + (waterY - tipY) * t
        // An arc while the line flies, then the bobber rests on the water.
        const lift = t < 1 ? 9 + Math.sin(Math.PI * t) * 10 : WATER_Z
        for (let i = 1; i <= 4; i++) {
          const k = i / 5
          out.push({
            wx: tipX + (bobX - tipX) * k, wy: tipY + (bobY - tipY) * k,
            sprite: toSprite(lineDotArt(), false), lift: 9 + (lift - 9) * k, alpha: 0.85, depthBias: 0.8,
          })
        }
        out.push({ wx: bobX, wy: bobY, sprite: toSprite(bobberArt(pose.sunk), false), lift, depthBias: 1 })
        if (pose.phase === 'bite') {
          out.push({ wx: bobX, wy: bobY, sprite: toSprite(biteMarkArt(), false), lift: lift + 12, depthBias: 1.2 })
          const ripple = rippleArt(Math.floor(seconds * 8) % RIPPLE_FRAMES, '#eaf6ff')
          out.push({ wx: bobX, wy: bobY, sprite: toSprite(ripple, false), lift: 0, alpha: 0.8, depthBias: 0.4 })
        }
      }
    }

    out.push(...this.companion.sprites(seconds))

    for (const p of this.particles) {
      const fade = 1 - p.age / p.life
      const art = p.kind === 'dust' ? splashArt(p.age > p.life / 2 ? 1 : 0) : p.kind === 'glint' ? glintArt(p.tone === 'special') : dropletArt()
      out.push({ wx: p.x, wy: p.y, sprite: toSprite(art, false), lift: p.z, alpha: Math.min(1, fade * 2), depthBias: 1 })
    }

    for (const pop of this.pops) {
      if (!pop.itemId) continue
      const icon = fishingResourceIconArt(pop.itemId) ?? resourceIconArt(pop.itemId)
      const t = (seconds - pop.start) / pop.life
      if (!icon || t < 0) continue
      out.push({ wx: pop.x, wy: pop.y, sprite: toSprite(icon, false), lift: pop.lift + t * 14, alpha: t > 0.7 ? (1 - t) / 0.3 : 1, depthBias: 2 })
    }
    return out
  }

  /** Places the worker beside the player once per cast, never in the water. */
  private summonWorker(area: Area, cast: ActiveCast, player: OverlayPlayer): void {
    if (cast.summoned) return
    cast.summoned = true
    if (cast.workerSpeciesId === null) return
    const spot = workerSpot(player, { tx: cast.tx, ty: cast.ty }, (tx, ty) =>
      !area.isSolid(tx, ty) && !area.isWater(tx, ty) && !this.targetAt(area, tx, ty))
    if (spot) this.companion.summon(cast.workerSpeciesId, spot)
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
