import { describe, expect, it } from 'vitest'
import { actorPosition, createActor, isMoving } from '../../wildlands/engine/actors'
import { CHOP_MS, CHOP_TOTAL_MS } from '../../skills/scene/logging/choppingTimeline'
import { SWING_MS, SWING_TOTAL_MS } from '../../skills/scene/mining/miningAction'
import { TASK_BEATS, beatTime, isImpact, taskBeat, workerPose, type WorkKind } from './workerPose'

const STAND = { tx: 4, ty: 7, dir: 'left' as const }
const START = 1_000_000
const KINDS: WorkKind[] = ['chop', 'mine', 'farm']

const drawnAt = (kind: WorkKind, serverNow: number, reduceMotion = false) => {
  const actor = createActor({ id: 'w', kind: 'pokemon', habitat: 'any', tx: 0, ty: 0 })
  Object.assign(actor, workerPose(STAND, kind, START, serverNow, reduceMotion))
  return { ...actorPosition(actor), hop: actor.hop, frame: Math.floor(actor.walkClock * 2), moving: isMoving(actor) }
}
/** One beat sampled every 10 ms: x offset toward the node (left is toward) and hop. */
const trace = (kind: WorkKind) => Array.from({ length: Math.ceil(TASK_BEATS[kind].periodMs / 10) }, (_, i) => {
  const d = drawnAt(kind, START + i * 10)
  return `${72 - d.x}:${d.hop.toFixed(1)}`
}).join(' ')

describe('worker pose per task', () => {
  it('is a pure function of task and server time: two clients with the same clock draw the same thing', () => {
    for (const kind of KINDS) {
      for (const t of [0, 1, 149, 260, 310, 599, 12_345, -40]) {
        expect(workerPose(STAND, kind, START, START + t)).toEqual(workerPose({ ...STAND }, kind, START, START + t))
        expect(drawnAt(kind, START + t)).toEqual(drawnAt(kind, START + t))
      }
    }
  })

  it('Talar, Minería and Agricultura are visibly different beats', () => {
    const [chop, mine, farm] = KINDS.map(trace)
    expect(new Set([chop, mine, farm]).size).toBe(3)
    expect(new Set(KINDS.map(kind => TASK_BEATS[kind].periodMs)).size).toBe(3)
  })

  it('Talar and Minería land their blow on the Skills scene’s bite and strike', () => {
    expect(TASK_BEATS.chop).toMatchObject({ periodMs: CHOP_TOTAL_MS, impactMs: CHOP_MS.windup })
    expect(TASK_BEATS.mine).toMatchObject({ periodMs: SWING_TOTAL_MS, impactMs: SWING_MS.windup })
    for (const kind of ['chop', 'mine'] as const) {
      const peak = drawnAt(kind, START + TASK_BEATS[kind].impactMs)
      const rest = drawnAt(kind, START)
      // Facing left: the node is toward smaller x. About 4 px into it at the blow.
      expect(rest.x - peak.x).toBe(4)
      expect(isImpact(kind, START, START + TASK_BEATS[kind].impactMs)).toBe(true)
      expect(isImpact(kind, START, START + TASK_BEATS[kind].impactMs - 30)).toBe(false)
    }
  })

  it('Minería bounces back off the rock after the strike; Talar pulls back before the bite', () => {
    const mineBounce = drawnAt('mine', START + 370)
    expect(mineBounce.x).toBeGreaterThan(drawnAt('mine', START).x)
    expect(mineBounce.hop).toBeGreaterThan(1)
    expect(drawnAt('chop', START + 150).x).toBeGreaterThan(drawnAt('chop', START).x)
  })

  it('Agricultura is softer and lower: a small lean, the sprite dips, no impact', () => {
    const low = drawnAt('farm', START + 450)
    expect(drawnAt('farm', START).x - low.x).toBeLessThanOrEqual(2)
    expect(low.hop).toBeLessThan(0)
    for (let t = 0; t < 900; t += 25) expect(isImpact('farm', START, START + t)).toBe(false)
  })

  it('stays on its stand (the lean never reaches the node) and steps from the shared clock', () => {
    for (const kind of KINDS) {
      for (let t = 0; t < TASK_BEATS[kind].periodMs; t += 20) {
        const pose = workerPose(STAND, kind, START, START + t)
        expect([pose.fromTx, pose.fromTy]).toEqual([STAND.tx, STAND.ty])
        expect(Math.abs(pose.progress)).toBeLessThan(0.3)
      }
      expect(drawnAt(kind, START - 250).frame).toBe(0)
    }
    expect(drawnAt('chop', START + CHOP_TOTAL_MS).frame - drawnAt('chop', START).frame).toBe(2)
    expect(drawnAt('farm', START + TASK_BEATS.farm.periodMs).frame - drawnAt('farm', START).frame).toBe(1)
  })

  it('reduced motion keeps the stepping but drops lean and hop', () => {
    for (const kind of KINDS) {
      const still = drawnAt(kind, START + TASK_BEATS[kind].impactMs, true)
      expect({ x: still.x, hop: still.hop }).toEqual({ x: 72, hop: 0 })
    }
  })

  it('an unknown or missing task falls back to the Talar beat; phase counts from the action start', () => {
    expect(taskBeat(undefined)).toBe(TASK_BEATS.chop)
    expect(taskBeat('dig')).toBe(TASK_BEATS.chop)
    expect(beatTime(TASK_BEATS.mine, START, START - 100)).toBe(400)
    expect(beatTime(TASK_BEATS.mine, START + 100, START + 600)).toBe(0)
  })
})
