// PERF-1 capture session: owns every trace, installs the engine hooks and
// exports one comparable JSON document per capture. Only VITE_PERF=on builds
// import this module (see WildlandsView.vue); nothing here ships otherwise.

import type { Actor } from '../engine/actors'
import type { Area } from '../engine/area'
import type { TrainerSprites } from '../engine/characters'
import { perfHooks, type FrameProbe, type RenderProbe } from '../engine/perfHooks'
import type { RemoteActorsPort, RemotePresenceActor } from '../multiplayer/domain/presence'
import { ChunkTrace } from './chunkTrace'
import { FramePacing } from './framePacing'
import { MainThreadTrace } from './mainThread'
import { MotionTrace } from './motionTrace'
import { RemoteTrace } from './remoteTrace'
import { ScenarioDriver, SCENARIOS, type DriverControls } from './scenarioDriver'
import { SampleRing, summarize } from './stats'

export interface PerfGame extends DriverControls {
  setFrameProbe(probe: FrameProbe | null, render: RenderProbe | null): void
}

interface SecondSample { t: number; fps: number; p95IntervalMs: number; maxIntervalMs: number; remotes: number; drawables: number; heapMb: number | null }

export class PerfSession {
  readonly pacing = new FramePacing()
  readonly motion = new MotionTrace()
  readonly remote = new RemoteTrace()
  readonly chunks = new ChunkTrace()
  readonly main = new MainThreadTrace()
  private readonly hudMs = new SampleRing(20_000)
  private readonly populace = new SampleRing(36_000)
  private readonly drawablesPerFrame = new SampleRing(36_000)
  private readonly timeline: SecondSample[] = []
  private second = { start: 0, frames: 0, intervals: [] as number[], remotes: 0, drawables: 0 }
  private lastRaf = -1
  private zoom = 0
  private drawables = 0
  private recording = false
  private startedAt = 0
  private label = ''
  private driver: ScenarioDriver | null = null
  private game: PerfGame | null = null
  private fallback: TrainerSprites | null = null
  private areaTimes = new Map<string, number>()
  private currentArea = ''
  private readonly onVisibility = () => {
    // A hidden page stops the loop; its gap is not a stutter.
    this.pacing.resetClock(); this.motion.resetClock(); this.lastRaf = -1
  }

  readonly frameProbe: FrameProbe = {
    attached: fallback => { this.fallback = fallback },
    frame: (raf, workStart, updateEnd, renderEnd, frameEnd, player, camX, camY, area, remotes, populace) =>
      this.onFrame(raf, workStart, updateEnd, renderEnd, frameEnd, player, camX, camY, area, remotes, populace),
  }

  readonly renderProbe: RenderProbe = {
    actor: (actor, outcome) => { if (this.recording) this.remote.drawOutcome(actor, outcome) },
    frame: (drawables, zoom) => { this.drawables = drawables; this.zoom = zoom },
  }

  install(game: PerfGame): void {
    this.game = game
    game.setFrameProbe(this.frameProbe, this.renderProbe)
    perfHooks.chunks = this.chunks
    perfHooks.sheets = {
      requested: (url, cached) => this.remote.sheetRequested(url, cached),
      settled: (url, ok) => this.remote.sheetSettled(url, ok),
    }
    document.addEventListener('visibilitychange', this.onVisibility)
    this.main.start()
  }

  uninstall(): void {
    this.game?.setFrameProbe(null, null)
    perfHooks.chunks = null
    perfHooks.sheets = null
    document.removeEventListener('visibilitychange', this.onVisibility)
    this.main.stop()
    this.game = null
  }

  /** Wraps the adapter's port so every presence message is also counted. */
  wrapPort(port: RemoteActorsPort): RemoteActorsPort {
    return {
      replaceRemoteActors: (actors: readonly RemotePresenceActor[]) => {
        if (this.recording) this.remote.snapshot(actors.length)
        port.replaceRemoteActors(actors)
      },
      upsertRemoteActor: actor => {
        if (this.recording) this.remote.received(actor)
        port.upsertRemoteActor(actor)
      },
      removeRemoteActor: id => {
        if (this.recording) this.remote.removedByNetwork()
        port.removeRemoteActor(id)
      },
      setAuthoritativeActor: (actor, source) => port.setAuthoritativeActor(actor, source),
      setPresenceAccess: access => port.setPresenceAccess(access),
      presenceRejected: reason => port.presenceRejected?.(reason),
    }
  }

  /** Vue work triggered by the HUD update, from assignment to the end of the next flush. */
  hudFlush(ms: number): void {
    if (this.recording) this.hudMs.push(ms)
  }

  get isRecording(): boolean { return this.recording }
  get scenario(): string | null { return this.driver?.def.id ?? null }
  get scenarioDone(): boolean { return this.driver?.finished ?? false }

  start(label: string, scenarioId: string | null = null): void {
    for (const trace of [this.pacing, this.motion, this.remote, this.chunks, this.main]) trace.clear()
    for (const ring of [this.hudMs, this.populace, this.drawablesPerFrame]) ring.clear()
    this.timeline.length = 0
    this.areaTimes.clear()
    this.label = label
    this.startedAt = performance.now()
    this.second = { start: this.startedAt, frames: 0, intervals: [], remotes: 0, drawables: 0 }
    this.lastRaf = -1
    const def = scenarioId ? SCENARIOS[scenarioId] : undefined
    this.driver = def && this.game ? new ScenarioDriver(def, this.game) : null
    this.recording = true
  }

  stop(): void {
    this.recording = false
    this.game?.setVirtualDir(null)
    this.game?.setVirtualSprint(false)
  }

  private onFrame(
    raf: number, workStart: number, updateEnd: number, renderEnd: number, frameEnd: number,
    player: Actor, camX: number, camY: number, area: Area, remotes: readonly Actor[], populace: number,
  ): void {
    if (!this.recording) return
    this.driver?.step(player, area)
    const interval = this.lastRaf >= 0 ? raf - this.lastRaf : 0
    this.lastRaf = raf
    this.pacing.record(raf, updateEnd - workStart, renderEnd - updateEnd, frameEnd - renderEnd)
    this.motion.record(player, camX, camY, interval, this.zoom)
    if (this.fallback) this.remote.frame(remotes, this.fallback)
    this.chunks.endFrame()
    this.populace.push(populace)
    this.drawablesPerFrame.push(this.drawables)
    if (area.id !== this.currentArea) this.currentArea = area.id
    this.areaTimes.set(area.id, (this.areaTimes.get(area.id) ?? 0) + interval)
    // One timeline row per second: exposes degradation over a soak.
    const s = this.second
    s.frames++; if (interval > 0) s.intervals.push(interval); s.remotes = remotes.length; s.drawables = this.drawables
    if (raf - s.start >= 1000) {
      const sorted = [...s.intervals].sort((a, b) => a - b)
      const memory = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory
      this.timeline.push({
        t: Math.round((raf - this.startedAt) / 100) / 10,
        fps: Math.round(s.frames / ((raf - s.start) / 1000)),
        p95IntervalMs: Math.round((sorted[Math.ceil(sorted.length * 0.95) - 1] ?? 0) * 10) / 10,
        maxIntervalMs: Math.round((sorted[sorted.length - 1] ?? 0) * 10) / 10,
        remotes: s.remotes, drawables: s.drawables,
        heapMb: memory ? Math.round(memory.usedJSHeapSize / 104857.6) / 10 : null,
      })
      this.second = { start: raf, frames: 0, intervals: [], remotes: 0, drawables: 0 }
    }
    if (this.driver?.finished) this.stop()
  }

  /** One JSON document: comparable across commits, devices and scenarios. */
  export(meta: Record<string, unknown> = {}): Record<string, unknown> {
    const nav = typeof navigator === 'undefined' ? null : navigator
    return {
      tool: 'pokeswap-perf-v1',
      label: this.label,
      scenario: this.driver?.def.id ?? null,
      scenarioCompleted: this.driver?.finished ?? null,
      capturedAt: new Date().toISOString(),
      durationS: Math.round((performance.now() - this.startedAt) / 100) / 10,
      environment: {
        build: import.meta.env.VITE_PLAYTEST === 'on' ? 'playtest' : 'normal',
        userAgent: nav?.userAgent ?? null,
        viewport: typeof window === 'undefined' ? null : { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio },
        hardwareConcurrency: nav?.hardwareConcurrency ?? null,
        zoom: this.zoom,
        ...meta,
      },
      pacing: this.pacing.report(),
      mainThread: this.main.report(),
      ui: { hudFlushMs: summarize(this.hudMs.values()) },
      motion: this.motion.report(),
      remote: this.remote.report(),
      chunks: this.chunks.report(),
      entities: {
        populace: summarize(this.populace.values()),
        drawables: summarize(this.drawablesPerFrame.values()),
      },
      areasMs: Object.fromEntries([...this.areaTimes].map(([id, ms]) => [id, Math.round(ms)])),
      driver: this.driver?.events ?? [],
      timeline: this.timeline,
    }
  }
}

let instance: PerfSession | null = null
export function perfSession(): PerfSession {
  instance ??= new PerfSession()
  return instance
}
