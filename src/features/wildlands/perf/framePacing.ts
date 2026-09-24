// Frame pacing as the player sees it, not only engine CPU time (PERF-1).
//
// `interval` is the delta between consecutive requestAnimationFrame
// timestamps: that is what reaches the screen. Engine work (update, render,
// tick) is recorded beside it, so a frame that was cheap but late shows up.
// Nothing assumes 60 Hz: the cadence is inferred from the median interval.

import { SampleRing, summarize, type Summary } from './stats'

/** Common panel and browser cadences; an observed median within 4 % snaps to one. */
const KNOWN_RATES = [30, 48, 50, 60, 72, 75, 90, 100, 120, 144, 165, 170, 180, 200, 240, 360]

export interface Cadence {
  /** 1000 / median interval, unrounded. */
  observedHz: number
  /** Nearest known rate within 4 %, or null. */
  nominalHz: number | null
  /** Frame budget used for "late" frames: 1000 / (nominalHz ?? observedHz). */
  budgetMs: number
}

export function inferCadence(intervals: ArrayLike<number>): Cadence {
  const sorted = Float64Array.from(intervals).filter(value => value > 0).sort()
  if (sorted.length === 0) return { observedHz: 0, nominalHz: null, budgetMs: 1000 / 60 }
  const median = sorted[Math.floor(sorted.length / 2)]
  const observedHz = 1000 / median
  let nominalHz: number | null = null
  for (const rate of KNOWN_RATES) {
    if (Math.abs(observedHz - rate) / rate <= 0.04) { nominalHz = rate; break }
  }
  return { observedHz: Math.round(observedHz * 10) / 10, nominalHz, budgetMs: 1000 / (nominalHz ?? observedHz) }
}

export interface FramePacingReport {
  frames: number
  cadence: Cadence
  intervalMs: Summary
  /** Frames whose interval exceeded 1.5 × the cadence budget. */
  lateFrames: number
  latePercent: number
  /** Σ (round(interval / budget) − 1): vsyncs with no new frame. */
  droppedVsyncs: number
  over33ms: number
  over50ms: number
  /** Pauses a player notices: intervals over 100 ms while visible. */
  over100ms: number
  /** Std-dev of intervals among on-time frames: micro-stutter at full rate. */
  onTimeJitterMs: number
  updateMs: Summary
  renderMs: Summary
  tickMs: Summary
  workMs: Summary
  /** interval − work: time the frame spent outside the engine (browser, Vue, GC, compositor). */
  outsideEngineMs: Summary
}

export class FramePacing {
  private readonly intervals: SampleRing
  private readonly update: SampleRing
  private readonly render: SampleRing
  private readonly tick: SampleRing
  private readonly work: SampleRing
  private readonly outside: SampleRing
  private lastFrameAt = -1

  constructor(capacity = 36_000) {
    this.intervals = new SampleRing(capacity)
    this.update = new SampleRing(capacity)
    this.render = new SampleRing(capacity)
    this.tick = new SampleRing(capacity)
    this.work = new SampleRing(capacity)
    this.outside = new SampleRing(capacity)
  }

  /** `rafTime` is the rAF timestamp; the rest are engine phase durations in ms. */
  record(rafTime: number, updateMs: number, renderMs: number, tickMs: number): void {
    const work = updateMs + renderMs + tickMs
    if (this.lastFrameAt >= 0) {
      const interval = rafTime - this.lastFrameAt
      this.intervals.push(interval)
      this.outside.push(Math.max(0, interval - work))
    }
    this.lastFrameAt = rafTime
    this.update.push(updateMs)
    this.render.push(renderMs)
    this.tick.push(tickMs)
    this.work.push(work)
  }

  /** A paused or hidden page is not a stutter: the next interval restarts here. */
  resetClock(): void {
    this.lastFrameAt = -1
  }

  clear(): void {
    for (const ring of [this.intervals, this.update, this.render, this.tick, this.work, this.outside]) ring.clear()
    this.lastFrameAt = -1
  }

  report(): FramePacingReport {
    return reportFromIntervals(this.intervals.values(), {
      update: this.update.values(), render: this.render.values(), tick: this.tick.values(),
      work: this.work.values(), outside: this.outside.values(),
    })
  }
}

export function reportFromIntervals(
  intervals: Float64Array,
  phases: { update: ArrayLike<number>; render: ArrayLike<number>; tick: ArrayLike<number>; work: ArrayLike<number>; outside: ArrayLike<number> },
): FramePacingReport {
  const cadence = inferCadence(intervals)
  const budget = cadence.budgetMs
  let late = 0, dropped = 0, over33 = 0, over50 = 0, over100 = 0
  const onTime: number[] = []
  for (const interval of intervals) {
    if (interval > budget * 1.5) late++
    else onTime.push(interval)
    dropped += Math.max(0, Math.round(interval / budget) - 1)
    if (interval > 33.3) over33++
    if (interval > 50) over50++
    if (interval > 100) over100++
  }
  const mean = onTime.reduce((sum, value) => sum + value, 0) / Math.max(1, onTime.length)
  const variance = onTime.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(1, onTime.length)
  return {
    frames: intervals.length,
    cadence,
    intervalMs: summarize(intervals),
    lateFrames: late,
    latePercent: intervals.length ? Math.round(late / intervals.length * 1000) / 10 : 0,
    droppedVsyncs: dropped,
    over33ms: over33,
    over50ms: over50,
    over100ms: over100,
    onTimeJitterMs: Math.round(Math.sqrt(variance) * 100) / 100,
    updateMs: summarize(phases.update),
    renderMs: summarize(phases.render),
    tickMs: summarize(phases.tick),
    workMs: summarize(phases.work),
    outsideEngineMs: summarize(phases.outside),
  }
}
