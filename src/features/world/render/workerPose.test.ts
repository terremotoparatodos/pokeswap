import { describe, expect, it } from 'vitest'
import { actorPosition, createActor, isMoving } from '../../wildlands/engine/actors'
import { WORK_BEAT_MS, WORK_LEAN_PX, workBeat, workerPose } from './workerPose'

const STAND = { tx: 4, ty: 7, dir: 'left' as const }
const START = 1_000_000

const drawnAt = (serverNow: number) => {
  const actor = createActor({ id: 'w', kind: 'pokemon', habitat: 'any', tx: 0, ty: 0 })
  Object.assign(actor, workerPose(STAND, START, serverNow))
  return { ...actorPosition(actor), hop: actor.hop, frame: Math.floor(actor.walkClock * 2), moving: isMoving(actor) }
}

describe('worker pose', () => {
  it('is a pure function of the server time: two clients with the same clock draw the same thing', () => {
    for (const t of [0, 1, 149, 300, 599, 600, 12_345, -40]) {
      expect(workerPose(STAND, START, START + t)).toEqual(workerPose({ ...STAND }, START, START + t))
      expect(drawnAt(START + t)).toEqual(drawnAt(START + t))
    }
  })

  it('leans about 3 px toward the node and back once every 0.6 s', () => {
    const rest = drawnAt(START)
    const peak = drawnAt(START + WORK_BEAT_MS / 2)
    // Facing left: the node is at tx - 1, so the lean goes toward smaller x.
    expect(rest.x - peak.x).toBe(WORK_LEAN_PX)
    expect(peak.y).toBe(rest.y)
    expect(drawnAt(START + WORK_BEAT_MS)).toEqual({ ...rest, frame: rest.frame + 2 })
    expect(peak.hop).toBeGreaterThan(0)
    expect(rest.hop).toBe(0)
  })

  it('stays on its stand: the lean never reaches the node tile', () => {
    for (let t = 0; t < WORK_BEAT_MS; t += 25) {
      const pose = workerPose(STAND, START, START + t)
      expect(pose.fromTx).toBe(STAND.tx)
      expect(pose.fromTy).toBe(STAND.ty)
      expect(pose.progress).toBeGreaterThanOrEqual(0)
      expect(pose.progress).toBeLessThan(0.25)
    }
  })

  it('steps the sprite from the shared clock, two frames per beat, never a negative frame', () => {
    expect(drawnAt(START).moving).toBe(true)
    expect(drawnAt(START + WORK_BEAT_MS).frame - drawnAt(START).frame).toBe(2)
    expect(drawnAt(START - 250).frame).toBe(0)
  })

  it('phase is counted from the action start, so every viewer starts the beat together', () => {
    expect(workBeat(START, START)).toBe(0)
    expect(workBeat(START, START + 150)).toBeCloseTo(0.25)
    expect(workBeat(START, START - 150)).toBeCloseTo(0.75)
    expect(workBeat(START + 100, START + 700)).toBe(0)
  })
})
