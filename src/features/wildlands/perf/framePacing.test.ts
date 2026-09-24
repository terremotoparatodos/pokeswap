import { describe, expect, it } from 'vitest'
import { FramePacing, inferCadence } from './framePacing'

function run(pacing: FramePacing, intervals: number[]): void {
  let t = 1000
  pacing.record(t, 1, 1, 0)
  for (const interval of intervals) {
    t += interval
    pacing.record(t, 1, 1, 0)
  }
}

describe('frame pacing', () => {
  it('infers the panel cadence instead of assuming 60 Hz', () => {
    expect(inferCadence(new Array(100).fill(1000 / 144)).nominalHz).toBe(144)
    expect(inferCadence(new Array(100).fill(1000 / 120)).nominalHz).toBe(120)
    expect(inferCadence(new Array(100).fill(1000 / 60)).nominalHz).toBe(60)
    expect(inferCadence(new Array(100).fill(1000 / 75)).nominalHz).toBe(75)
  })

  it('reports late frames and dropped vsyncs against the inferred budget', () => {
    const pacing = new FramePacing()
    // 144 Hz with one frame that took three vsyncs.
    run(pacing, [...new Array(50).fill(1000 / 144), 3000 / 144, ...new Array(50).fill(1000 / 144)])
    const report = pacing.report()
    expect(report.cadence.nominalHz).toBe(144)
    expect(report.lateFrames).toBe(1)
    expect(report.droppedVsyncs).toBe(2)
    expect(report.over33ms).toBe(0)
  })

  it('counts pauses a player notices', () => {
    const pacing = new FramePacing()
    run(pacing, [...new Array(30).fill(16.7), 120, 60, 40, ...new Array(30).fill(16.7)])
    const report = pacing.report()
    expect(report.over100ms).toBe(1)
    expect(report.over50ms).toBe(2)
    expect(report.over33ms).toBe(3)
  })

  it('separates time spent outside the engine from engine work', () => {
    const pacing = new FramePacing()
    run(pacing, new Array(20).fill(16.7))
    const report = pacing.report()
    expect(report.workMs.p50).toBe(2)
    expect(report.outsideEngineMs.p50).toBeCloseTo(14.7, 1)
  })

  it('does not count a resumed page as one long frame', () => {
    const pacing = new FramePacing()
    run(pacing, new Array(10).fill(16.7))
    pacing.resetClock()
    pacing.record(99_999, 1, 1, 0)
    expect(pacing.report().over100ms).toBe(0)
  })
})
