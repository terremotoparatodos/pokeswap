// Worker Pokémon drawn beside the player while a gathering action runs
// (R31-C1). Uses the species' regular overworld sheet — no per-species work
// animation — through the scene overlay, so it has no collision, never
// affects navigation and exists only in this browser.
//
// Browser runtime only (sheets load into canvases).

import { loadOverworldFrames, type PokemonFrames } from '../../wildlands/engine/characters'
import type { OverlaySprite } from '../../wildlands/engine/sceneOverlay'
import { TILE } from '../../wildlands/engine/world'
import { glintArt } from '../art/miningFx'
import { toSprite } from '../art/pixelArt'
import { presencePose, type WorkerSpot } from './workerPresence'

export type WorkerFramesLoader = (speciesId: number) => Promise<PokemonFrames | null>

const framesCache = new Map<number, Promise<PokemonFrames | null>>()

/** Bundled overworld sheet, cached per species; null when the species has none. */
export function loadWorkerFrames(speciesId: number): Promise<PokemonFrames | null> {
  let pending = framesCache.get(speciesId)
  if (!pending) framesCache.set(speciesId, (pending = loadOverworldFrames(speciesId, false).catch(() => null)))
  return pending
}

/** Idle stepping rate, like WildLands followers. */
const STEP_RATE = 1.6

export class WorkerCompanion {
  private frames: PokemonFrames | null = null
  private speciesId: number | null = null
  private spot: WorkerSpot | null = null
  private shownAt: number | null = null
  private dismissedAt: number | null = null

  constructor(private readonly load: WorkerFramesLoader = loadWorkerFrames) {}

  get active(): boolean {
    return this.spot !== null
  }

  /** Warms the sheet so the first summon pops in on time. */
  preload(speciesId: number): void {
    void this.load(speciesId)
  }

  summon(speciesId: number, spot: WorkerSpot): void {
    this.spot = spot
    this.shownAt = null
    this.dismissedAt = null
    if (speciesId === this.speciesId && this.frames) return
    this.speciesId = speciesId
    this.frames = null
    void this.load(speciesId).then(frames => {
      if (this.speciesId === speciesId) this.frames = frames
    })
  }

  /** Fades out; a worker that never got drawn (sheet still loading) just disappears. */
  dismiss(seconds: number): void {
    if (!this.spot) return
    if (this.shownAt === null) {
      this.spot = null
      return
    }
    this.dismissedAt ??= seconds
  }

  sprites(seconds: number): readonly OverlaySprite[] {
    const { spot, frames } = this
    if (!spot || !frames) return []
    // The pop-in starts on the first drawn frame, even if the sheet arrived late.
    this.shownAt ??= seconds
    const pose = presencePose(this.shownAt, this.dismissedAt, seconds)
    if (pose.gone) {
      this.spot = null
      return []
    }
    const cycle = frames[spot.dir]
    const wx = spot.tx * TILE + TILE / 2
    const wy = spot.ty * TILE + TILE - 2
    const out: OverlaySprite[] = [{ wx, wy, sprite: cycle[Math.floor(seconds * STEP_RATE) % cycle.length], scale: pose.scale, alpha: pose.alpha }]
    if (pose.burst !== null) {
      const glint = toSprite(glintArt(false), false)
      for (let i = 0; i < 4; i++) {
        const angle = (i * Math.PI) / 2 + pose.burst * 1.4
        const radius = 5 + pose.burst * 9
        out.push({ wx: wx + Math.cos(angle) * radius, wy, sprite: glint, lift: 12 + Math.sin(angle) * radius * 0.7, alpha: 1 - pose.burst, depthBias: 0.5 })
      }
    }
    return out
  }
}
