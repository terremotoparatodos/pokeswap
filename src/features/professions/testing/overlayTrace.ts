// R31-Z / T-S1 — utilities to freeze the observable output of the profession
// overlays before the gathering/processing refactor.
//
// What a trace is: a scripted action run on a fixed scene clock, sampling what
// the overlay would hand the renderer — the decor style of the node's tile, the
// calls its `ground()` makes on the 2D context, the sprites it emits and the
// labels it draws — plus the demo session state at the end. Nothing here judges
// behaviour: it records it, so a later refactor can prove it changed nothing.
//
// Two constraints shaped this file:
//
//  1. It must not import the WildLands engine. `professionsIsolation.test.ts`
//     only lets this layer reach `engine/world` and `engine/noise`, so the
//     engine's ports are mirrored here as *structural* types. TypeScript's
//     method bivariance makes the real overlays assignable to them.
//  2. It must not touch a canvas. The art hash comes from the `PixelArt` the
//     overlay asked to draw, captured by wrapping `toSprite` (see the test's
//     `vi.mock`), so no pixel ever needs rasterising.

import { demoCounts, demoTool, inspectDemoNode, type DemoNodeTarget, type DemoState } from '../demo/demoSession'
import type { ProfessionId, ToolKind } from '../domain/types'

// ── Structural mirrors of the engine's overlay port ────────────────────────

export interface TracePixelArt {
  readonly w: number
  readonly h: number
  readonly ax: number
  readonly ay: number
  readonly pixels: Uint32Array
}

export interface TraceSprite {
  canvas: unknown
  shadow: unknown
  w: number
  h: number
  ax: number
  ay: number
  castShadow?: boolean
}

export interface TraceDecorStyle {
  sprite?: unknown
  dx?: number
  dy?: number
}

export interface TraceOverlaySprite {
  wx: number
  wy: number
  sprite: unknown
  lift?: number
  alpha?: number
  scale?: number
  depthBias?: number
}

export interface TraceOverlayLabel {
  wx: number
  wy: number
  lift: number
  text: string
  color: string
  alpha?: number
}

/** The four hooks the renderer calls, as the overlays implement them. */
export interface TraceOverlay {
  decor?(decor: never, area: never, seconds: number): TraceDecorStyle | null
  ground?(g: never, area: never, x0: number, y0: number, seconds: number): void
  sprites?(area: never, seconds: number): readonly TraceOverlaySprite[]
  labels?(area: never, seconds: number): readonly TraceOverlayLabel[]
}

/** What the renderer passes to `decor()`: one prop of the visible chunk. */
export interface TraceDecor {
  kind: string | null
  tx: number
  ty: number
  x: number
  y: number
}

// ── Art hashing (FNV-1a, 32 bits) ──────────────────────────────────────────

export function artHash(art: TracePixelArt): string {
  let hash = 0x811c9dc5
  const mix = (byte: number): void => {
    hash ^= byte & 0xff
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  for (const value of [art.w, art.h, art.ax, art.ay]) {
    mix(value)
    mix(value >>> 8)
    mix(value >>> 16)
    mix(value >>> 24)
  }
  const bytes = new Uint8Array(art.pixels.buffer, art.pixels.byteOffset, art.pixels.byteLength)
  for (const byte of bytes) mix(byte)
  return hash.toString(16).padStart(8, '0')
}

// ── The `toSprite` wrapper and its registry ────────────────────────────────

const artOfSprite = new WeakMap<object, TracePixelArt>()
const spriteOfArt = new WeakMap<object, TraceSprite>()
/** A canvas handed to `drawImage` belongs to a sprite we minted; this finds it. */
const canvasOwners = new WeakMap<object, string>()
let interceptions = 0

/** A canvas-shaped object: overlays only ever hand it to `drawImage`. */
const stubCanvas = (w: number, h: number): unknown => ({ width: w, height: h })

/**
 * Stands in for `art/pixelArt.toSprite`. Keeps the production caching shape
 * (one sprite per art) and remembers which art each sprite came from.
 */
export function traceSprite(art: TracePixelArt, castShadow = true): TraceSprite {
  const cached = spriteOfArt.get(art as unknown as object)
  if (cached) {
    interceptions++
    return cached
  }
  const canvas = stubCanvas(art.w, art.h)
  const sprite: TraceSprite = {
    canvas,
    shadow: stubCanvas(art.w, art.h),
    w: art.w, h: art.h, ax: art.ax, ay: art.ay, castShadow,
  }
  artOfSprite.set(sprite as unknown as object, art)
  spriteOfArt.set(art as unknown as object, sprite)
  canvasOwners.set(canvas as object, artHash(art))
  interceptions++
  return sprite
}

/** How many times the wrapper ran; the test asserts it is not zero. */
export const spriteInterceptions = (): number => interceptions
export const resetSpriteInterceptions = (): void => { interceptions = 0 }

export function hashOfSprite(sprite: unknown): string | null {
  if (!sprite || typeof sprite !== 'object') return null
  const art = artOfSprite.get(sprite as object)
  return art ? artHash(art) : null
}

// ── Recording 2D context ───────────────────────────────────────────────────

/** One member per `op`, so the serialiser narrows on the discriminant alone. */
export type ContextCall =
  | { op: 'ellipse'; args: number[] }
  | { op: 'arc'; args: number[] }
  | { op: 'fillRect'; args: number[] }
  | { op: 'drawImage'; artHash: string | null; args: number[] }
  | { op: 'fillStyle'; value: string }
  | { op: 'strokeStyle'; value: string }
  | { op: 'lineWidth'; value: number }
  | { op: 'globalAlpha'; value: number }

const round2 = (value: number): number => (Number.isFinite(value) ? Math.round(value * 100) / 100 : 0)

export interface RecordingContext {
  /** Passed to `ground()`; every relevant call lands in `calls`. */
  readonly ctx: unknown
  calls: ContextCall[]
  clear(): void
}

/**
 * A 2D context that answers every call `ground()` makes and writes down the
 * ones that describe what the player sees: the ground rings, their colours and
 * widths, and any sprite painted straight into the ground buffer.
 */
export function recordingContext(): RecordingContext {
  const calls: ContextCall[] = []
  const noop = (): undefined => undefined
  const target = {
    save: noop, restore: noop, beginPath: noop, closePath: noop,
    moveTo: noop, lineTo: noop, fill: noop, stroke: noop, clip: noop,
    clearRect: noop, setLineDash: noop, translate: noop, rotate: noop, scale: noop,
    createLinearGradient: () => ({ addColorStop: noop }),
    createRadialGradient: () => ({ addColorStop: noop }),
    createImageData: (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    putImageData: noop,
    getImageData: (_x: number, _y: number, w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    ellipse: (...args: number[]) => { calls.push({ op: 'ellipse', args: args.map(round2) }) },
    arc: (...args: number[]) => { calls.push({ op: 'arc', args: args.map(round2) }) },
    fillRect: (...args: number[]) => { calls.push({ op: 'fillRect', args: args.map(round2) }) },
    drawImage: (image: unknown, ...args: number[]) => {
      calls.push({ op: 'drawImage', artHash: hashOfSprite(image) ?? hashOfCanvas(image), args: args.map(round2) })
    },
  } as Record<string, unknown>

  const define = (name: 'fillStyle' | 'strokeStyle' | 'lineWidth' | 'globalAlpha'): void => {
    let stored: unknown = name === 'lineWidth' ? 1 : name === 'globalAlpha' ? 1 : ''
    Object.defineProperty(target, name, {
      get: () => stored,
      set: (value: unknown) => {
        stored = value
        if (name === 'fillStyle' || name === 'strokeStyle') calls.push({ op: name, value: String(value) })
        else calls.push({ op: name, value: round2(Number(value)) })
      },
      enumerable: true,
      configurable: true,
    })
  }
  define('fillStyle')
  define('strokeStyle')
  define('lineWidth')
  define('globalAlpha')

  return { ctx: target, calls, clear() { calls.length = 0 } }
}

function hashOfCanvas(image: unknown): string | null {
  if (!image || typeof image !== 'object') return null
  return canvasOwners.get(image as object) ?? null
}

// ── Scene clock and sampling ───────────────────────────────────────────────

/** Fixed render step, as the task requires: 30 frames of scene clock a second. */
export const STEP_SECONDS = 1 / 30
/** One sample every 50 ms of scene clock. */
export const SAMPLE_MS = 50

export interface DecorProbe {
  readonly decor: TraceDecor
  readonly label: string
}

export interface TraceFrame {
  readonly atMs: number
  readonly phase: string
  readonly locked: boolean
  /** Only present when the hook produced something. */
  readonly decor?: string
  readonly ground?: string[]
  readonly sprites?: string[]
  readonly labels?: string[]
}

export type TraceEntry =
  | TraceFrame
  /** The frame before it, unchanged; keeps a still scene from filling the file. */
  | { readonly repeat: number }
  /** A stretch that ran without sampling (see `SceneTrace.run`). */
  | { readonly skippedMs: number; readonly note: string }

export interface TraceHost {
  readonly overlay: TraceOverlay
  readonly area: unknown
  /** Decor props the renderer would hand this overlay (the node's tile). */
  readonly probes: readonly DecorProbe[]
  phase(): string
  locked(): boolean
}

/**
 * Every record is one line on purpose. An object per sprite would be eight
 * lines each, and a busy frame carries a dozen sprites: at that size the
 * snapshot stops being something a human can diff. One line still shows what
 * changed — a lift, a position, a hash — on the line that changed.
 */
function serialiseDecor(style: TraceDecorStyle | null, probe: DecorProbe): string | null {
  if (!style) return null
  return `${probe.label} dx=${round2(style.dx ?? 0)} dy=${round2(style.dy ?? 0)} art=${hashOfSprite(style.sprite) ?? 'none'}`
}

function serialiseSprite(sprite: TraceOverlaySprite): string {
  return `${round2(sprite.wx)},${round2(sprite.wy)} lift=${round2(sprite.lift ?? 0)}`
    + ` a=${round2(sprite.alpha ?? 1)} s=${round2(sprite.scale ?? 1)} z=${round2(sprite.depthBias ?? 0)}`
    + ` art=${hashOfSprite(sprite.sprite) ?? 'none'}`
}

function serialiseLabel(label: TraceOverlayLabel): string {
  return `${round2(label.wx)},${round2(label.wy)} lift=${round2(label.lift)}`
    + ` a=${round2(label.alpha ?? 1)} ${label.color} ${JSON.stringify(label.text)}`
}

export function serialiseCall(call: ContextCall): string {
  if (call.op === 'drawImage') return `drawImage art=${call.artHash ?? 'none'} [${call.args.join(' ')}]`
  if (call.op === 'fillStyle' || call.op === 'strokeStyle') return `${call.op}=${call.value}`
  if (call.op === 'lineWidth' || call.op === 'globalAlpha') return `${call.op}=${call.value}`
  return `${call.op} [${call.args.join(' ')}]`
}

/**
 * Runs the scene clock forward, recording one frame every `SAMPLE_MS`.
 *
 * `ground()` is called on **every** step, because it is what advances the
 * overlay's own clock — exactly as the renderer does. Only the sampled step is
 * written down, and in the renderer's order: ground → decor → sprites → labels.
 */
export class SceneTrace {
  private secondsValue = 0
  private nextSampleMs = 0
  private readonly recorder = recordingContext()
  private readonly frames: TraceEntry[] = []
  private last: string | null = null

  constructor(private readonly host: TraceHost) {}

  get seconds(): number {
    return this.secondsValue
  }

  /**
   * Advances `seconds` of scene clock in fixed steps.
   *
   * `sample: false` still ticks every step — the overlay clock must never skip
   * — but records nothing. Long scenarios use it for stretches whose shape is
   * already covered by an equivalent sampled stretch (the middle chops of a
   * tree, say), so the baseline keeps its meaning without growing into
   * something nobody will read.
   */
  run(seconds: number, options: { sample?: boolean; note?: string } = {}): void {
    const sample = options.sample !== false
    const from = this.secondsValue
    const until = this.secondsValue + seconds
    while (this.secondsValue < until - 1e-9) this.step(sample, until)
    if (!sample && seconds > 0) this.noteSkip(from, options.note)
  }

  /** Runs until `done()` says so, or `maxSeconds` elapse. Returns the ms spent. */
  runUntil(done: () => boolean, maxSeconds: number, options: { sample?: boolean; note?: string } = {}): number {
    const sample = options.sample !== false
    const from = this.secondsValue
    while (this.secondsValue - from < maxSeconds && !done()) this.step(sample)
    if (!sample) this.noteSkip(from, options.note)
    return Math.round((this.secondsValue - from) * 1000)
  }

  /** One rendered frame: ground always, the rest only when this one is sampled. */
  private step(sample: boolean, until = Number.POSITIVE_INFINITY): void {
    this.secondsValue = Math.min(until, this.secondsValue + STEP_SECONDS)
    const atMs = Math.round(this.secondsValue * 1000)
    const sampling = sample && atMs >= this.nextSampleMs
    this.recorder.clear()
    this.host.overlay.ground?.(this.recorder.ctx as never, this.host.area as never, 0, 0, this.secondsValue)
    if (!sampling) return
    this.nextSampleMs += SAMPLE_MS

    let decor: string | null = null
    for (const probe of this.host.probes) {
      const style = this.host.overlay.decor?.(probe.decor as never, this.host.area as never, this.secondsValue) ?? null
      const serialised = serialiseDecor(style, probe)
      if (serialised) decor = serialised
    }
    const sprites = (this.host.overlay.sprites?.(this.host.area as never, this.secondsValue) ?? []).map(serialiseSprite)
    const labels = (this.host.overlay.labels?.(this.host.area as never, this.secondsValue) ?? []).map(serialiseLabel)
    const ground = this.recorder.calls.map(serialiseCall)
    // Empty hooks are left out: a frame that grows a `labels` key is a frame
    // where a label appeared, and that is exactly what a diff should show.
    this.push({
      atMs, phase: this.host.phase(), locked: this.host.locked(),
      ...(decor ? { decor } : {}),
      ...(ground.length ? { ground } : {}),
      ...(sprites.length ? { sprites } : {}),
      ...(labels.length ? { labels } : {}),
    })
  }

  /** One line standing for a stretch that ran without being written down. */
  private noteSkip(fromSeconds: number, note?: string): void {
    this.nextSampleMs = Math.ceil((this.secondsValue * 1000) / SAMPLE_MS) * SAMPLE_MS
    this.frames.push({ skippedMs: Math.round((this.secondsValue - fromSeconds) * 1000), note: note ?? 'not sampled' })
    this.last = null
  }

  /** Collapses a frame that is identical to the one before it. */
  private push(frame: TraceFrame): void {
    const key = JSON.stringify({ ...frame, atMs: 0 })
    if (key === this.last) {
      const previous = this.frames[this.frames.length - 1]
      if (previous && 'repeat' in previous) {
        this.frames[this.frames.length - 1] = { repeat: previous.repeat + 1 }
        return
      }
      this.frames.push({ repeat: 1 })
      return
    }
    this.last = key
    this.frames.push(frame)
  }

  /** A marker in the timeline, so a diff says *where* things changed. */
  mark(note: string): void {
    this.frames.push({ atMs: Math.round(this.secondsValue * 1000), phase: `— ${note} —`, locked: this.host.locked() })
    this.last = null
  }

  get trace(): readonly TraceEntry[] {
    return this.frames
  }
}

// ── Demo session state at the end of a scenario ────────────────────────────

const TOOL_KINDS: readonly ToolKind[] = ['pickaxe', 'axe', 'rod', 'sickle']
const PROFESSIONS: readonly ProfessionId[] = ['mining', 'woodcutting', 'fishing', 'alchemy']

export function finalState(state: DemoState, targets: readonly DemoNodeTarget[] = []): Record<string, unknown> {
  const tools: Record<string, unknown> = {}
  for (const kind of TOOL_KINDS) {
    const instance = state.tools[kind]
    tools[kind] = instance
      ? { itemId: instance.itemId, durability: instance.durability, maxDurability: instance.maxDurability, repairs: instance.repairs }
      : null
  }
  const charges: Record<string, unknown> = {}
  for (const target of targets) {
    const inspection = inspectDemoNode(state, target)
    charges[target.node.id] = {
      remainingCharges: inspection.remainingCharges,
      respawnInSeconds: round2(inspection.respawnInSeconds),
    }
  }
  return {
    inventory: Object.fromEntries(Object.entries(demoCounts(state)).filter(([, count]) => count > 0).sort(([a], [b]) => a.localeCompare(b))),
    pending: state.pending.map(stack => ({ itemId: stack.itemId, quantity: stack.quantity })),
    xp: Object.fromEntries(PROFESSIONS.map(id => [id, state.xp[id]])),
    energy: { current: round2(state.energy.current), rested: round2(state.energy.rested) },
    tools,
    charges,
  }
}

/** The equipped tool of a profession, for scenarios that assert on it. */
export const equippedTool = (state: DemoState, profession: ProfessionId): string | null =>
  demoTool(state, profession)?.definition.itemId ?? null
