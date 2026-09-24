import { describe, expect, it } from 'vitest'
import { actorPosition, createActor, isMoving, RUN_SPEED, WALK_SPEED, type Actor } from './actors'
import { PLAYBACK, playbackRate, RemoteStepPlayback, RESYNC_BACKLOG, type RemoteStep } from './remotePlayback'

const FRAME = 1 / 60
const TILE_PX = actorPosition(createActor({ id: 'x', kind: 'remote', habitat: 'any', tx: 1, ty: 0 })).x
  - actorPosition(createActor({ id: 'x', kind: 'remote', habitat: 'any', tx: 0, ty: 0 })).x

function remote(): Actor {
  return createActor({ id: 'remote:a', kind: 'remote', habitat: 'any', tx: 0, ty: 0, speed: RUN_SPEED })
}
const east = (tx: number, speed = RUN_SPEED): RemoteStep => ({ tx, ty: 0, dir: 'right', speed })

/** Feeds moves at the given times (seconds) and records every frame. */
function play(arrivals: { at: number; step: RemoteStep }[], seconds: number) {
  const playback = new RemoteStepPlayback()
  const actor = remote()
  const frames: { t: number; x: number; tiles: number; moving: boolean }[] = []
  let next = 0
  for (let t = 0; t < seconds; t += FRAME) {
    while (next < arrivals.length && arrivals[next].at <= t) playback.push('a', actor, arrivals[next++].step)
    playback.advance('a', actor, FRAME)
    const tiles = actor.fromTx + (actor.tx - actor.fromTx) * actor.progress
    frames.push({ t, x: actorPosition(actor).x, tiles, moving: isMoving(actor) })
  }
  const jumps = frames.slice(1).map((f, i) => Math.abs(f.x - frames[i].x))
  return { playback, actor, frames, largestJumpPx: Math.max(...jumps) }
}

describe('remote step playback', () => {
  it('plays a steady cadence at exactly the sender pace once settled', () => {
    const steps = Array.from({ length: 40 }, (_, i) => ({ at: i / RUN_SPEED, step: east(i + 1) }))
    const { frames } = play(steps, 40 / RUN_SPEED)
    // After the first seconds the slack has settled: one tile per step time.
    const settled = frames.filter(f => f.t > 2 && f.t < 5)
    const pxPerS = (settled[settled.length - 1].x - settled[0].x) / (settled[settled.length - 1].t - settled[0].t)
    expect(pxPerS / TILE_PX).toBeCloseTo(RUN_SPEED, 0)
  })

  it('drains a burst of moves by catching up, animating every tile instead of snapping', () => {
    // Four moves stuck behind a stall arrive together, then the cadence resumes.
    const steps = [
      ...[1, 2, 3, 4, 5].map(tx => ({ at: 0.5, step: east(tx) })),
      ...Array.from({ length: 20 }, (_, i) => ({ at: 0.5 + (i + 1) / RUN_SPEED, step: east(6 + i) })),
    ]
    const { playback, largestJumpPx, frames } = play(steps, 5)
    expect(playback.resyncs).toBe(0)
    expect(largestJumpPx).toBeLessThan(TILE_PX / 2)
    // The backlog is gone well before the stream ends: the actor rests on the last tile.
    expect(frames[frames.length - 1].x).toBe(actorPosition({ ...remote(), tx: 25, fromTx: 25 }).x)
  })

  it('never plays faster than the catch-up cap', () => {
    const steps = Array.from({ length: 10 }, (_, i) => ({ at: 0, step: east(i + 1) }))
    const { frames } = play(steps, 3)
    const speeds = frames.slice(1).map((f, i) => (f.tiles - frames[i].tiles) / FRAME)
    expect(Math.max(...speeds)).toBeLessThanOrEqual(RUN_SPEED * PLAYBACK.maxRate + 1e-6)
    expect(Math.max(...speeds)).toBeGreaterThan(RUN_SPEED * 1.3)
  })

  it('resyncs only on a gap in the route or a runaway backlog, and counts it', () => {
    const playback = new RemoteStepPlayback()
    const actor = remote()
    playback.push('a', actor, east(1))
    expect(playback.push('a', actor, east(3))).toBe('resync')
    expect([actor.tx, isMoving(actor)]).toEqual([3, false])

    for (let tx = 4; tx <= 4 + RESYNC_BACKLOG; tx++) expect(playback.push('a', actor, east(tx))).not.toBe('resync')
    expect(playback.push('a', actor, east(5 + RESYNC_BACKLOG))).toBe('resync')
    expect(playback.resyncs).toBe(2)
    expect(playback.backlog('a')).toBe(0)
  })

  it('starts at nominal pace after a real stop, but slows down after a late move', () => {
    const playback = new RemoteStepPlayback()
    const actor = remote()
    playback.push('a', actor, east(1))
    for (let t = 0; t < 2; t += FRAME) playback.advance('a', actor, FRAME)
    playback.push('a', actor, east(2))
    playback.advance('a', actor, FRAME)
    expect(actor.progress).toBeCloseTo(RUN_SPEED * FRAME, 5)

    // Mid-run, the next move shows up 60 ms after the actor ran out of tiles.
    for (let t = 0; t < 1 / RUN_SPEED + 0.06; t += FRAME) playback.advance('a', actor, FRAME)
    playback.push('a', actor, east(3))
    let frames = 0
    do { playback.advance('a', actor, FRAME); frames++ } while (isMoving(actor))
    // Nominal is 8 frames per running tile; the stretch rebuilds the slack.
    expect(frames).toBeGreaterThan(8)
    expect(frames).toBeLessThanOrEqual(8 / PLAYBACK.minRate + 1)
  })

  it('maps slack to rate around the target, within the caps', () => {
    expect(playbackRate(PLAYBACK.targetSlackS)).toBe(1)
    expect(playbackRate(PLAYBACK.targetSlackS + 0.1)).toBeGreaterThan(1)
    expect(playbackRate(-1)).toBe(PLAYBACK.minRate)
    expect(playbackRate(10)).toBe(PLAYBACK.maxRate)
  })

  it('keeps the gait of each step, walking and running', () => {
    const playback = new RemoteStepPlayback()
    const actor = remote()
    playback.push('a', actor, east(1, WALK_SPEED))
    playback.push('a', actor, east(2, RUN_SPEED))
    expect([actor.speed, actor.running]).toEqual([WALK_SPEED, false])
    for (let t = 0; t < 1 / WALK_SPEED + FRAME; t += FRAME) playback.advance('a', actor, FRAME)
    expect([actor.speed, actor.running]).toEqual([RUN_SPEED, true])
  })
})
