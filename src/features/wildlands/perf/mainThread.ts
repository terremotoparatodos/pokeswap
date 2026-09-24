// Main-thread work outside the engine (PERF-1): long tasks, long animation
// frames with their script attribution, and heap where the browser exposes it.
// Every API is capability-detected: Safari has none of the three, and the
// report says so instead of reporting zeros as if they were measurements.

import { SampleRing, summarize, type Summary } from './stats'

interface LoafScript { invoker?: string; sourceURL?: string; sourceFunctionName?: string; duration: number }
interface LoafEntry extends PerformanceEntry { blockingDuration?: number; scripts?: LoafScript[] }
interface MemoryInfo { usedJSHeapSize: number; totalJSHeapSize: number }

export interface MainThreadReport {
  supported: { longtask: boolean; longAnimationFrame: boolean; memory: boolean }
  longTasks: { count: number; durationMs: Summary }
  longAnimationFrames: {
    count: number
    durationMs: Summary
    blockingMs: Summary
    /** Script time by source, summed over long animation frames; file names only. */
    topScripts: { source: string; ms: number }[]
  }
  /** used JS heap in MB, sampled once per second. */
  heapMb: Summary & { first: number; last: number }
}

const supported = (type: string) =>
  typeof PerformanceObserver !== 'undefined' && (PerformanceObserver.supportedEntryTypes ?? []).includes(type)

export class MainThreadTrace {
  private readonly longTasks = new SampleRing(5000)
  private readonly loaf = new SampleRing(5000)
  private readonly loafBlocking = new SampleRing(5000)
  private readonly heap = new SampleRing(7200)
  private heapFirst = 0
  private readonly scripts = new Map<string, number>()
  private readonly observers: PerformanceObserver[] = []
  private heapTimer: ReturnType<typeof setInterval> | null = null
  readonly support = {
    longtask: supported('longtask'),
    longAnimationFrame: supported('long-animation-frame'),
    memory: typeof performance !== 'undefined' && 'memory' in performance,
  }

  start(): void {
    if (this.support.longtask) this.observe('longtask', entry => this.longTasks.push(entry.duration))
    if (this.support.longAnimationFrame) {
      this.observe('long-animation-frame', raw => {
        const entry = raw as LoafEntry
        this.loaf.push(entry.duration)
        this.loafBlocking.push(entry.blockingDuration ?? 0)
        for (const script of entry.scripts ?? []) {
          const file = (script.sourceURL ?? '').split('/').pop()?.split('?')[0] || script.invoker || 'unknown'
          const key = script.sourceFunctionName ? `${file} ${script.sourceFunctionName}` : file
          this.scripts.set(key, (this.scripts.get(key) ?? 0) + script.duration)
        }
      })
    }
    if (this.support.memory && this.heapTimer === null) {
      const sample = () => {
        const memory = (performance as unknown as { memory: MemoryInfo }).memory
        const mb = memory.usedJSHeapSize / 1048576
        if (this.heap.total === 0) this.heapFirst = mb
        this.heap.push(mb)
      }
      sample()
      this.heapTimer = setInterval(sample, 1000)
    }
  }

  private observe(type: string, onEntry: (entry: PerformanceEntry) => void): void {
    const observer = new PerformanceObserver(list => { for (const entry of list.getEntries()) onEntry(entry) })
    observer.observe({ type, buffered: false })
    this.observers.push(observer)
  }

  stop(): void {
    for (const observer of this.observers) observer.disconnect()
    this.observers.length = 0
    if (this.heapTimer !== null) clearInterval(this.heapTimer)
    this.heapTimer = null
  }

  clear(): void {
    for (const ring of [this.longTasks, this.loaf, this.loafBlocking, this.heap]) ring.clear()
    this.scripts.clear()
  }

  report(): MainThreadReport {
    const heap = this.heap.values()
    return {
      supported: { ...this.support },
      longTasks: { count: this.longTasks.total, durationMs: summarize(this.longTasks.values()) },
      longAnimationFrames: {
        count: this.loaf.total,
        durationMs: summarize(this.loaf.values()),
        blockingMs: summarize(this.loafBlocking.values()),
        topScripts: [...this.scripts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)
          .map(([source, ms]) => ({ source, ms: Math.round(ms) })),
      },
      heapMb: { ...summarize(heap), first: Math.round(this.heapFirst * 10) / 10, last: heap.length ? Math.round(heap[heap.length - 1] * 10) / 10 : 0 },
    }
  }
}
