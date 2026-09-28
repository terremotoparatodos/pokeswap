import { describe, expect, it } from 'vitest'
import { WORK_TICK_MS } from '../../../../../services/realtime/src/world/worldProtocol.js'
import { TASK_BEATS, isImpact } from '../../../world/render/workerPose'
import { CHOP_MS, FELL_MS, REWARD_MS, choppingPose, choppingTimeline, closeChopping, type ChoppingTimeline } from '../logging/choppingTimeline'
import { SWING_MS, miningPose, miningTimeline } from '../mining/miningAction'
import {
  GatheringOverlayCore, type ActiveGathering, type GatheringOutcome, type GatheringReward, type GatheringView, type RingStyle,
  type StartGathering, type ViewInput, type VisibleNode,
} from './gatheringOverlayCore'

// SKILLS PROB-2: the owner's scene knows no duration. It swings once per tick
// until the server answers; the answer closes the timeline.

type Start = StartGathering<ChoppingTimeline>
type Active = ActiveGathering<Start>

class Probe extends GatheringOverlayCore<Start, Active, GatheringView, VisibleNode> {
  readonly frames: number[] = []
  readonly closes: { elapsedMs: number; success: boolean }[] = []
  protected readonly rewardLift = 0
  protected readonly ring: RingStyle = { rx: 1, ry: 1, strongFill: '', strongStroke: '' }
  protected ownsNode(): boolean { return true }
  protected buildView(input: ViewInput): GatheringView { return { bubble: null, ring: input.working ? 'strong' : 'none', glint: false } }
  protected stepEffects(): void {}
  protected resetEffects(): void {}
  protected actionFrame(_action: Active, elapsedMs: number): void { this.frames.push(elapsedMs) }
  protected celebrationEffects(): void {}
  protected closeTimeline(elapsedMs: number, success: boolean): ChoppingTimeline {
    this.closes.push({ elapsedMs, success })
    return closeChopping(elapsedMs, success)
  }
  timeline(): ChoppingTimeline | null { return this.action?.timeline ?? null }
}

const G = {} as CanvasRenderingContext2D
const target = { nodeId: 'pradera:1:1:tree', resource: {} as never, biome: 'grassland' as const }
const reward: GatheringReward = { stacks: [], xp: 10, rarity: 'common' }

function run(outcomeAt: (seconds: number) => GatheringOutcome, { elapsedMs = 0, rewardValue = reward as GatheringReward | null } = {}) {
  const probe = new Probe({ nodeState: () => ({ status: 'available', remainingCharges: 1, respawnInSeconds: 0 }), player: () => null, targetId: () => null })
  let seconds = 100
  let results = 0
  let done = 0
  probe.ground(G, {} as never, 0, 0, seconds)
  probe.start({
    target, tx: 1, ty: 1, timeline: choppingTimeline(), elapsedMs,
    outcome: () => outcomeAt(seconds - 100),
    onResult: () => { results++; return rewardValue },
    onDone: () => { done++ },
  })
  const step = (untilSeconds: number) => {
    while (seconds < 100 + untilSeconds) { seconds = Math.round((seconds + 0.016) * 1000) / 1000; probe.ground(G, {} as never, 0, 0, seconds) }
  }
  return { probe, step, results: () => results, done: () => done }
}

describe('the owner’s scene while the server has not answered', () => {
  it('keeps swinging, one blow per tick, and never ends or asks for the reward', () => {
    const scene = run(() => 'pending')
    scene.step(30)
    expect(scene.probe.timeline()?.open).toBe(true)
    expect(scene.results()).toBe(0)
    expect(scene.done()).toBe(0)
    expect(scene.probe.busy).toBe(true)
    expect(scene.probe.frames[scene.probe.frames.length - 1]).toBeGreaterThan(29_900)
  })

  it('starts on the server’s beat: the first frame is already `elapsedMs` into the action', () => {
    const scene = run(() => 'pending', { elapsedMs: 150 })
    scene.step(0.016)
    expect(scene.probe.frames[0]).toBeGreaterThanOrEqual(150)
    expect(scene.probe.frames[0]).toBeLessThan(150 + 20)
  })
})

describe('the server answers', () => {
  it('a success closes the timeline: the current bite finishes, the tree falls, the reward shows once, then done', () => {
    const scene = run(t => (t >= 2.05 ? 'success' : 'pending'))
    scene.step(2.1)
    expect(scene.probe.closes).toHaveLength(1)
    const { elapsedMs, success } = scene.probe.closes[0]
    expect(success).toBe(true)
    expect(elapsedMs).toBeGreaterThanOrEqual(2_050)
    const closed = scene.probe.timeline()!
    expect(closed).toMatchObject({ open: false, felling: true, chops: Math.floor(elapsedMs / WORK_TICK_MS) + 1 })
    expect(scene.results()).toBe(0)
    scene.step(closed.resultAtMs / 1000 + 0.05)
    expect(scene.results()).toBe(1)
    scene.step((closed.totalMs + 200) / 1000)
    expect(scene.done()).toBe(1)
    expect(scene.probe.busy).toBe(false)
    expect(closed.totalMs - closed.fellAtMs).toBe(FELL_MS + REWARD_MS)
  })

  it('a refusal or cancellation closes without a fall and without pops', () => {
    const scene = run(t => (t >= 1 ? 'failed' : 'pending'), { rewardValue: null })
    scene.step(1.05)
    expect(scene.probe.closes[0].success).toBe(false)
    expect(scene.probe.timeline()!.felling).toBe(false)
    scene.step(5)
    expect(scene.done()).toBe(1)
  })
})

describe('owner and observers see the same beat', () => {
  it('the owner’s bite and strike start exactly when every client’s worker lands its blow', () => {
    const startedAt = 1_000_000
    for (let serverNow = startedAt; serverNow < startedAt + 5 * WORK_TICK_MS; serverNow += 10) {
      const elapsed = serverNow - startedAt
      const bite = choppingPose(choppingTimeline(), elapsed).phase === 'bite'
      const strike = miningPose(miningTimeline(), elapsed).phase === 'strike'
      // The worker's impact window (90 ms) sits inside the scene's bite (100 ms) / strike (90 ms).
      if (isImpact('chop', startedAt, serverNow)) expect(bite, `chop at +${elapsed}`).toBe(true)
      if (isImpact('mine', startedAt, serverNow)) expect(strike, `mine at +${elapsed}`).toBe(true)
    }
    expect(TASK_BEATS.chop.impactMs).toBe(CHOP_MS.windup)
    expect(TASK_BEATS.mine.impactMs).toBe(SWING_MS.windup)
  })
})
