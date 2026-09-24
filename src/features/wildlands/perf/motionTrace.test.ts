import { describe, expect, it } from 'vitest'
import { actorPosition, advance, createActor, RUN_SPEED, WALK_SPEED } from '../engine/actors'
import { MotionTrace } from './motionTrace'

/** Walks an actor east one tile after another at a fixed refresh, feeding the trace like the game does. */
function walkAt(hz: number, speed: number, frames: number): MotionTrace {
  const trace = new MotionTrace()
  const actor = createActor({ id: 'p', kind: 'player', habitat: 'any', tx: 0, ty: 0, speed })
  const dt = 1 / hz
  for (let i = 0; i < frames; i++) {
    if (actor.progress >= 1) { actor.fromTx = actor.tx; actor.tx++; actor.progress = 0 }
    advance(actor, dt)
    const cam = actorPosition(actor)
    trace.record(actor, cam.x, cam.y, dt * 1000, 3)
  }
  return trace
}

describe('motion trace', () => {
  it('walking at 60 Hz moves the rounded camera one world pixel every frame', () => {
    const report = walkAt(60, WALK_SPEED, 240).report()
    expect(report.stalledFrames).toBe(0)
    expect(report.unevenPercent).toBeLessThan(10)
  })

  it('shows the uneven cadence that pixel rounding creates at 144 Hz', () => {
    const report = walkAt(144, WALK_SPEED, 576).report()
    // 60 px/s over 144 frames/s: the camera advances 0 or 1 px, never evenly.
    expect(report.stalledFrames).toBeGreaterThan(report.movingFrames * 0.4)
    expect(report.unevenPercent).toBeGreaterThan(50)
    expect(report.exactStepVariationPx.max).toBeLessThan(0.01)
  })

  it('running at 60 Hz is two world pixels per frame', () => {
    const report = walkAt(60, RUN_SPEED, 240).report()
    expect(report.cameraStepPx[2]).toBeGreaterThan(report.movingFrames * 0.9)
  })
})
