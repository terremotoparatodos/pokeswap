// Local player and camera continuity (PERF-1). Observes; changes nothing.
//
// The camera follows `actorPosition`, which rounds to whole world pixels. This
// records, for every frame the local player moves, how far the camera moved,
// how far the unrounded position moved, and how uneven consecutive steps are,
// so the effect of pixel rounding on smoothness can be measured at any refresh
// rate instead of argued about.

import type { Actor } from '../engine/actors'
import { TILE } from '../engine/world'
import { Histogram, SampleRing, summarize, type Summary } from './stats'

export interface MotionReport {
  movingFrames: number
  /** Camera displacement per moving frame in world pixels: [0, 1, 2, 3, 4+]. */
  cameraStepPx: number[]
  /** Moving frames in which the camera did not move at all. */
  stalledFrames: number
  /** |camera step − unrounded step|, world px: what rounding adds per frame. */
  roundingErrorPx: Summary
  /** |step − previous step| between consecutive moving frames, world px. */
  stepVariationPx: Summary
  /** Share of consecutive moving frames whose camera step differs from the previous one. */
  unevenPercent: number
  /** Same measures on the unrounded position, as the reference the eye expects. */
  exactStepVariationPx: Summary
  /** Camera speed / nominal speed per moving frame (1 = exact). */
  speedRatio: Summary
  /** Frames the camera eased or jumped more than 3 tiles (teleports, reconciliation). */
  cameraJumps: number
  /** Screen pixels per world pixel while measuring (last value). */
  zoom: number
}

/** Unrounded feet position, the value `actorPosition` rounds. */
export function exactPosition(actor: Actor): { x: number; y: number } {
  const t = actor.progress
  return {
    x: (actor.fromTx + (actor.tx - actor.fromTx) * t) * TILE + TILE / 2,
    y: (actor.fromTy + (actor.ty - actor.fromTy) * t) * TILE + TILE - 2,
  }
}

export class MotionTrace {
  private readonly steps = new Histogram(5)
  private readonly rounding = new SampleRing(36_000)
  private readonly variation = new SampleRing(36_000)
  private readonly exactVariation = new SampleRing(36_000)
  private readonly speed = new SampleRing(36_000)
  private movingFrames = 0
  private stalled = 0
  private uneven = 0
  private pairs = 0
  private jumps = 0
  private zoom = 0
  private last: { camX: number; camY: number; ex: number; ey: number; step: number; exact: number; moving: boolean } | null = null

  record(player: Actor, camX: number, camY: number, intervalMs: number, zoom: number): void {
    const exact = exactPosition(player)
    const moving = player.progress < 1
    this.zoom = zoom
    const last = this.last
    if (last) {
      const step = Math.abs(camX - last.camX) + Math.abs(camY - last.camY)
      const exactStep = Math.abs(exact.x - last.ex) + Math.abs(exact.y - last.ey)
      if (step > TILE * 3) this.jumps++
      else if (moving && last.moving) {
        this.movingFrames++
        this.steps.add(Math.min(4, step))
        if (step === 0) this.stalled++
        this.rounding.push(Math.abs(step - exactStep))
        const nominal = player.speed * TILE * (intervalMs / 1000)
        if (nominal > 0) this.speed.push(step / nominal)
        if (last.step >= 0) {
          this.pairs++
          this.variation.push(Math.abs(step - last.step))
          this.exactVariation.push(Math.abs(exactStep - last.exact))
          if (step !== last.step) this.uneven++
        }
      }
      this.last = { camX, camY, ex: exact.x, ey: exact.y, step: moving && last.moving ? step : -1, exact: exactStep, moving }
    } else {
      this.last = { camX, camY, ex: exact.x, ey: exact.y, step: -1, exact: 0, moving }
    }
  }

  resetClock(): void {
    this.last = null
  }

  clear(): void {
    this.steps.clear(); this.rounding.clear(); this.variation.clear(); this.exactVariation.clear(); this.speed.clear()
    this.movingFrames = 0; this.stalled = 0; this.uneven = 0; this.pairs = 0; this.jumps = 0; this.last = null
  }

  report(): MotionReport {
    return {
      movingFrames: this.movingFrames,
      cameraStepPx: [...this.steps.counts],
      stalledFrames: this.stalled,
      roundingErrorPx: summarize(this.rounding.values()),
      stepVariationPx: summarize(this.variation.values()),
      unevenPercent: this.pairs ? Math.round(this.uneven / this.pairs * 1000) / 10 : 0,
      exactStepVariationPx: summarize(this.exactVariation.values()),
      speedRatio: summarize(this.speed.values()),
      cameraJumps: this.jumps,
      zoom: Math.round(this.zoom * 100) / 100,
    }
  }
}
