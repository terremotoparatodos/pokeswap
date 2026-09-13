// Travel between areas — WildLands prototype
//
// A trip fades out, swaps the active area at full black and fades back in.
// Also tracks which gate the player is standing near so it is announced once.

import { portalAt, type Area, type AreaId, type Portal } from './area'

/** Fade timeline for travelling, in seconds. */
const FADE_OUT = 0.35
const FADE_HOLD = 0.15
const FADE_IN = 0.4

interface Trip {
  to: AreaId
  from: AreaId
  t: number
  swapped: boolean
}

export class AreaTravel {
  private trip: Trip | null = null
  private nearPortal: Portal | null = null

  get active(): boolean {
    return this.trip !== null
  }

  /** Starts a fade-out trip; ignored mid-trip or when already in `to`. */
  begin(from: AreaId, to: AreaId): boolean {
    if (this.trip || to === from) return false
    this.trip = { to, from, t: 0, swapped: false }
    return true
  }

  /** Advances the fade; `swap` runs once, at full black. */
  update(dt: number, swap: (to: AreaId, from: AreaId) => void): void {
    const trip = this.trip
    if (!trip) return
    trip.t += dt
    if (!trip.swapped && trip.t >= FADE_OUT + FADE_HOLD / 2) {
      trip.swapped = true
      swap(trip.to, trip.from)
    }
    if (trip.t >= FADE_OUT + FADE_HOLD + FADE_IN) this.trip = null
  }

  /** 0 = fully visible, 1 = black. */
  fade(): number {
    const trip = this.trip
    if (!trip) return 0
    if (trip.t < FADE_OUT) return trip.t / FADE_OUT
    if (trip.t < FADE_OUT + FADE_HOLD) return 1
    return Math.max(0, 1 - (trip.t - FADE_OUT - FADE_HOLD) / FADE_IN)
  }

  /** Remembers the gate next to the arrival point so it is not announced on arrival. */
  arrived(area: Area, tx: number, ty: number): void {
    this.nearPortal = portalNear(area, tx, ty)
  }

  /** Label of a gate the player just walked up to, once per approach. */
  hint(area: Area, tx: number, ty: number): string | null {
    if (this.trip) return null
    const near = portalNear(area, tx, ty)
    const label = near && near !== this.nearPortal ? near.label : null
    this.nearPortal = near
    return label
  }

  /** Destination of a portal tile stepped on, if any. */
  destinationAt(area: Area, tx: number, ty: number): AreaId | null {
    return portalAt(area, tx, ty)?.to ?? null
  }
}

function portalNear(area: Area, tx: number, ty: number): Portal | null {
  return area.portals.find(p => p.tiles.some(t => Math.abs(t.tx - tx) + Math.abs(t.ty - ty) <= 2)) ?? null
}
