// Chunk building, prefetch and eviction as they happen (PERF-1). Implements the
// engine's ChunkProbe; an idle-time build that runs past its deadline is counted,
// and so is every build that happens inside a frame.

import type { ChunkBuildSource, ChunkProbe } from '../engine/perfHooks'
import { SampleRing, summarize, type Summary } from './stats'

export interface ChunkReport {
  /** Capability of this browser: without it, every chunk is built inside a frame. */
  requestIdleCallback: boolean
  builds: Record<ChunkBuildSource, number>
  buildMs: Record<ChunkBuildSource, Summary>
  /** Idle-time builds that took longer than the idle time left when they started. */
  idleOverruns: number
  idleOverrunMs: Summary
  evicted: number
  released: number
  /** Builds per rendered frame that happened during the frame itself. */
  framesWithInFrameBuild: number
}

export class ChunkTrace implements ChunkProbe {
  private readonly ms: Record<ChunkBuildSource, SampleRing> = {
    frame: new SampleRing(5000), prefetch: new SampleRing(5000), warm: new SampleRing(5000),
  }
  private readonly overrun = new SampleRing(5000)
  private evictions = 0
  private releases = 0
  private frameBuilds = 0
  private framesWithBuild = 0

  built(ms: number, source: ChunkBuildSource, idleRemainingMs: number | null): void {
    this.ms[source].push(ms)
    if (source === 'frame') this.frameBuilds++
    if (idleRemainingMs !== null && ms > idleRemainingMs) this.overrun.push(ms - idleRemainingMs)
  }

  evicted(count: number): void { this.evictions += count }
  released(count: number): void { this.releases += count }

  /** Called once per frame by the session. */
  endFrame(): void {
    if (this.frameBuilds > 0) this.framesWithBuild++
    this.frameBuilds = 0
  }

  clear(): void {
    for (const ring of [...Object.values(this.ms), this.overrun]) ring.clear()
    this.evictions = 0; this.releases = 0; this.frameBuilds = 0; this.framesWithBuild = 0
  }

  report(): ChunkReport {
    return {
      requestIdleCallback: typeof requestIdleCallback === 'function',
      builds: { frame: this.ms.frame.total, prefetch: this.ms.prefetch.total, warm: this.ms.warm.total },
      buildMs: { frame: summarize(this.ms.frame.values()), prefetch: summarize(this.ms.prefetch.values()), warm: summarize(this.ms.warm.values()) },
      idleOverruns: this.overrun.total,
      idleOverrunMs: summarize(this.overrun.values()),
      evicted: this.evictions,
      released: this.releases,
      framesWithInFrameBuild: this.framesWithBuild,
    }
  }
}
