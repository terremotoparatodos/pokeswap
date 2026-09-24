// Measurement hooks (PERF-1). The engine only calls them; `features/wildlands/perf`
// implements them, and only `VITE_PERF=on` builds ever install one. Every hook
// is null otherwise, so the cost in a normal build is one null check.

import type { Actor } from './actors'
import type { Area } from './area'
import type { TrainerSprites } from './characters'

export interface FrameProbe {
  /** The procedural sprites every remote wears until its sheet loads, to tell the two apart. */
  attached?(fallback: TrainerSprites): void
  /** Called once per rendered frame, after the engine's work. Times are performance.now() values. */
  frame(
    rafTime: number, workStart: number, updateEnd: number, renderEnd: number, frameEnd: number,
    player: Actor, camX: number, camY: number, area: Area, remotes: readonly Actor[], populace: number,
  ): void
}

export interface RenderProbe {
  /** What the renderer did with one actor: drawn, culled off screen, or no art to draw. */
  actor(actor: Actor, outcome: 'drawn' | 'culled' | 'noArt'): void
  /** Drawables sorted this frame and the camera zoom in screen px per world px. */
  frame(drawables: number, zoom: number): void
}

export type ChunkBuildSource = 'frame' | 'prefetch' | 'warm'

export interface ChunkProbe {
  built(ms: number, source: ChunkBuildSource, idleRemainingMs: number | null): void
  evicted(count: number): void
  released(count: number): void
}

export interface SheetProbe {
  requested(url: string, cached: boolean): void
  settled(url: string, ok: boolean): void
}

export const perfHooks: { chunks: ChunkProbe | null; sheets: SheetProbe | null } = { chunks: null, sheets: null }
