import { advance, isMoving, WALK_SPEED, type Actor } from './actors'
import type { Dir } from './characters'

/** One accepted remote move: the tile it ends on and the gait it was walked at. */
export interface RemoteStep {
  tx: number
  ty: number
  dir: Dir
  speed: number
}

/**
 * Moves arrive once per tile, quantised by the 50 ms presence batches and
 * spread by network jitter. Played at exactly the sender's pace, a remote
 * alternates between waiting on an empty queue and a backlog that never
 * drains, until the old queue cap turned it into a multi-tile snap.
 *
 * Instead the playback rate is re-decided each time a move arrives:
 *  - the base is the cadence moves actually arrive at, relative to the gait
 *    they report. It is 1 for a normal sender, but lower in water (the sender
 *    walks at 0.7× while reporting the nominal gait) or on a struggling device;
 *  - on top, a correction from the slack at that instant: how long, at
 *    nominal pace, the actor still had to go before running out of known
 *    tiles (negative when it was already waiting). Slack above the target
 *    drains through a slightly faster pace, slack below it is rebuilt through
 *    a slightly slower one.
 * Between arrivals the rate is constant, so steady motion plays at exactly the
 * sender's pace and only the jitter itself shows up, as a few percent of speed
 * rather than a stop or a snap. Rate changes are slew-limited so the pace
 * never visibly lurches.
 */
export const PLAYBACK = {
  /** Slack kept when a move arrives: one presence batch window. */
  targetSlackS: 0.05,
  /** A slack error of this many seconds changes the rate by 100 %. */
  horizonS: 0.6,
  minRate: 0.8,
  maxRate: 1.75,
  /** Largest rate change per second. */
  slewPerS: 2.5,
  /** Idle longer than this many steps means the sender stopped, not a late move. */
  restartSteps: 1.5,
  /** Smoothing of the arrival interval, per move (batching makes single intervals ±50 ms). */
  cadenceAlpha: 0.15,
  minCadence: 0.6,
  maxCadence: 1.2,
} as const

interface Pacing {
  /** Rate decided at the last arrival, and the slew-limited rate on screen. */
  target: number
  rate: number
  /** Time since the actor ran out of tiles; Infinity before its first move. */
  idleS: number
  sinceArrivalS: number
  /** Smoothed time between moves over the duration of the step that arrived (1 = on pace). */
  intervalRatio: number
}
/**
 * Resync only past this many waiting steps (~1.6 s of running): a stalled or
 * backgrounded sender, never ordinary jitter, which the catch-up absorbs.
 */
export const RESYNC_BACKLOG = 12

export type RemoteStepOutcome = 'started' | 'queued' | 'resync'

/**
 * Turns the discrete stream of remote moves into continuous movement.
 * Owns the per-actor step queues; the game owns the actors themselves.
 */
export class RemoteStepPlayback {
  private readonly queues = new Map<string, RemoteStep[]>()
  private readonly pacing = new Map<string, Pacing>()
  /** Moves that could not be animated (a gap, an area correction or a runaway backlog). */
  resyncs = 0

  /** Tail of the route the actor will walk: its last queued step, else the actor. */
  tail(id: string, actor: Actor): { tx: number; ty: number } {
    const queue = this.queues.get(id)
    return queue?.[queue.length - 1] ?? actor
  }

  /** Steps waiting behind the one on screen. */
  backlog(id: string): number {
    return this.queues.get(id)?.length ?? 0
  }

  push(id: string, actor: Actor, step: RemoteStep): RemoteStepOutcome {
    const tail = this.tail(id, actor)
    const distance = Math.abs(tail.tx - step.tx) + Math.abs(tail.ty - step.ty)
    if (distance !== 1 || this.backlog(id) >= RESYNC_BACKLOG) {
      // Area corrections and a stalled sender must converge immediately rather
      // than animating through an old route for several seconds.
      this.resyncs++
      actor.fromTx = step.tx; actor.fromTy = step.ty
      actor.tx = step.tx; actor.ty = step.ty; actor.progress = 1
      setGait(actor, step)
      this.queues.delete(id)
      return 'resync'
    }
    const queue = this.queues.get(id)
    const stepS = 1 / step.speed
    const pacing = this.pacing.get(id) ?? { target: 1, rate: 1, idleS: Infinity, sinceArrivalS: 0, intervalRatio: 1 }
    this.pacing.set(id, pacing)
    const waiting = !isMoving(actor) && !queue?.length
    if (waiting && pacing.idleS > PLAYBACK.restartSteps * stepS) {
      // A fresh start after a real stop: nothing to catch up on.
      pacing.target = 1; pacing.rate = 1; pacing.intervalRatio = 1
    } else {
      // With moves sent on arrival, the interval before a move is how long its step took the sender.
      const ratio = Math.min(pacing.sinceArrivalS / stepS, 3)
      pacing.intervalRatio += (ratio - pacing.intervalRatio) * PLAYBACK.cadenceAlpha
      const cadence = Math.min(PLAYBACK.maxCadence, Math.max(PLAYBACK.minCadence, 1 / pacing.intervalRatio))
      pacing.target = playbackRate(waiting ? -pacing.idleS : lagSeconds(actor, queue), cadence)
    }
    pacing.idleS = 0
    pacing.sinceArrivalS = 0
    if (!isMoving(actor)) {
      start(actor, step)
      return 'started'
    }
    if (queue) queue.push(step)
    else this.queues.set(id, [step])
    return 'queued'
  }

  /** Advances one actor by `dt`, chaining its queued steps without a stall frame. */
  advance(id: string, actor: Actor, dt: number): void {
    const queue = this.queues.get(id)
    const pacing = this.pacing.get(id)
    if (pacing) pacing.sinceArrivalS += dt
    let time = dt
    for (let guard = 0; guard < 4 && time > 0; guard++) {
      if (!isMoving(actor)) {
        const next = queue?.shift()
        if (!next) break
        start(actor, next)
      }
      const rate = this.rate(id, time)
      const pace = actor.speed * rate
      const toGo = (1 - actor.progress) / pace
      const used = Math.min(time, toGo)
      advance(actor, used * rate)
      if (used >= toGo) actor.progress = 1
      time -= used
      if (isMoving(actor)) break
    }
    if (!isMoving(actor)) {
      advance(actor, 0)
      if (pacing) pacing.idleS += time
    }
    if (queue && !queue.length) this.queues.delete(id)
  }

  private rate(id: string, dt: number): number {
    const pacing = this.pacing.get(id)
    if (!pacing) return 1
    const slew = PLAYBACK.slewPerS * dt
    pacing.rate = Math.min(pacing.rate + slew, Math.max(pacing.rate - slew, pacing.target))
    return pacing.rate
  }

  delete(id: string): void {
    this.queues.delete(id)
    this.pacing.delete(id)
  }
}

/** Seconds, at nominal pace, until the actor reaches the newest tile it knows about. */
export function lagSeconds(actor: Actor, queue: readonly RemoteStep[] | undefined): number {
  let lag = isMoving(actor) ? (1 - actor.progress) / actor.speed : 0
  if (queue) for (const step of queue) lag += 1 / step.speed
  return lag
}

/**
 * Playback rate until the next arrival, for the slack left when a move arrives
 * and the cadence moves arrive at (1 = the pace their gait reports).
 */
export function playbackRate(slackS: number, cadence = 1): number {
  const error = slackS - PLAYBACK.targetSlackS
  const rate = cadence * (1 + error / PLAYBACK.horizonS)
  return Math.min(PLAYBACK.maxRate, Math.max(PLAYBACK.minRate * cadence, rate))
}

function start(actor: Actor, step: RemoteStep): void {
  actor.fromTx = actor.tx; actor.fromTy = actor.ty
  actor.tx = step.tx; actor.ty = step.ty
  setGait(actor, step)
  actor.progress = 0
}

function setGait(actor: Actor, step: RemoteStep): void {
  actor.dir = step.dir; actor.speed = step.speed; actor.running = step.speed > WALK_SPEED
}
