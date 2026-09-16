// R31-Z / T-S1 — utilities to freeze the observable output of the profession
// overlays before the gathering/processing refactor. Revised in T-S1.1 after
// the main station's audit (see docs/economy/R31Z_OVERLAY_TRACE.md §11).
//
// What a trace is: a scripted action run on a fixed scene clock, recording what
// the overlay would hand the renderer — the decor style of the node's tile, the
// drawing its `ground()` performs, the sprites it emits and the labels it
// draws — plus the demo session state at the end. Nothing here judges
// behaviour: it records it, so a later refactor can prove it changed nothing.
//
// Four constraints shaped this file:
//
//  1. It must not import the WildLands engine. `professionsIsolation.test.ts`
//     only lets this layer reach `engine/world` and `engine/noise`, so the
//     engine's ports are mirrored here as *structural* types. TypeScript's
//     method bivariance makes the real overlays assignable to them.
//  2. It must not touch a canvas. The art hash comes from the `PixelArt` the
//     overlay asked to draw, captured by wrapping `toSprite` (see the test's
//     `vi.mock`), so no pixel ever needs rasterising.
//  3. Execution cadence and serialisation cadence are separate (T-S1.1). Every
//     hook runs on every simulated frame, exactly as the renderer calls them,
//     because several of them carry state across frames; only some frames are
//     written down.
//  4. Nothing internal to a controller reaches the snapshot. Phases are
//     normalised to observable states here, so renaming a phase during the
//     refactor cannot produce a diff.

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
 *
 * The worker fixtures in the test are minted here too, so a Pokémon frame is
 * identifiable by its hash exactly like any other sprite.
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

function hashOfCanvas(image: unknown): string | null {
  if (!image || typeof image !== 'object') return null
  return canvasOwners.get(image as object) ?? null
}

// ── Recording 2D context ───────────────────────────────────────────────────
//
// T-S1.1: the recorder writes down *drawing*, not the assignments that led to
// it. `fillStyle = a; fillStyle = b; fill()` and `fillStyle = b; fill()` paint
// the same pixels, so they must produce the same line. Style assignments are
// therefore folded into the context state and only surface attached to the
// operation that actually used them.

const round2 = (value: number): number => (Number.isFinite(value) ? Math.round(value * 100) / 100 : 0)

/** Only these paint. Everything else builds a path or changes state. */
type VisibleOp = 'fill' | 'stroke' | 'fillRect' | 'strokeRect' | 'clearRect' | 'drawImage'

type Matrix = readonly [number, number, number, number, number, number]
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0]

/** Canvas `transform(...)` semantics: `next` applies before `m`. */
function multiply(m: Matrix, next: Matrix): Matrix {
  return [
    m[0] * next[0] + m[2] * next[1],
    m[1] * next[0] + m[3] * next[1],
    m[0] * next[2] + m[2] * next[3],
    m[1] * next[2] + m[3] * next[3],
    m[0] * next[4] + m[2] * next[5] + m[4],
    m[1] * next[4] + m[3] * next[5] + m[5],
  ]
}

const isIdentity = (m: Matrix): boolean => m.every((value, i) => Math.abs(value - IDENTITY[i]) < 1e-9)

interface ContextState {
  fillStyle: string
  strokeStyle: string
  lineWidth: number
  globalAlpha: number
  lineCap: string
  lineJoin: string
  globalCompositeOperation: string
  transform: Matrix
}

const initialState = (): ContextState => ({
  fillStyle: '#000000', strokeStyle: '#000000', lineWidth: 1, globalAlpha: 1,
  lineCap: 'butt', lineJoin: 'miter', globalCompositeOperation: 'source-over',
  transform: IDENTITY,
})

export interface RecordingContext {
  /** Passed to `ground()`; every visible operation lands in `calls`. */
  readonly ctx: unknown
  /** One line per operation that actually painted something. */
  readonly calls: string[]
  clear(): void
}

/**
 * A 2D context that answers every call `ground()` makes and writes down the
 * ones the player would see: a fill, a stroke, a rectangle, an image — each
 * with the path it painted and the style in force at that moment.
 */
export function recordingContext(): RecordingContext {
  const calls: string[] = []
  let path: string[] = []
  let state = initialState()
  const stack: ContextState[] = []

  const nums = (args: number[]): string => args.map(round2).join(' ')
  const addPath = (op: string, args: number[]): void => { path.push(`${op}(${nums(args)})`) }
  const pathText = (): string => (path.length ? ` [${path.join(' ')}]` : '')
  const alphaText = (): string => ` alpha=${round2(state.globalAlpha)}`
  const extras = (): string => {
    const parts: string[] = []
    if (!isIdentity(state.transform)) parts.push(`xf=[${state.transform.map(round2).join(' ')}]`)
    if (state.globalCompositeOperation !== 'source-over') parts.push(`op=${state.globalCompositeOperation}`)
    return parts.length ? ` ${parts.join(' ')}` : ''
  }
  const strokeText = (): string => {
    let text = ` stroke=${state.strokeStyle} lw=${round2(state.lineWidth)}`
    if (state.lineCap !== 'butt') text += ` cap=${state.lineCap}`
    if (state.lineJoin !== 'miter') text += ` join=${state.lineJoin}`
    return text
  }
  const emit = (op: VisibleOp, body: string, style: string): void => {
    calls.push(`${op}${body}${style}${alphaText()}${extras()}`)
  }

  const target = {
    save: (): void => { stack.push({ ...state }) },
    restore: (): void => { state = stack.pop() ?? state },
    beginPath: (): void => { path = [] },
    closePath: (): void => { path.push('close') },
    moveTo: (...args: number[]): void => addPath('move', args),
    lineTo: (...args: number[]): void => addPath('line', args),
    rect: (...args: number[]): void => addPath('rect', args),
    ellipse: (...args: number[]): void => addPath('ellipse', args),
    arc: (...args: number[]): void => addPath('arc', args),
    arcTo: (...args: number[]): void => addPath('arcTo', args),
    quadraticCurveTo: (...args: number[]): void => addPath('quad', args),
    bezierCurveTo: (...args: number[]): void => addPath('bezier', args),

    fill: (): void => emit('fill', pathText(), ` fill=${state.fillStyle}`),
    stroke: (): void => emit('stroke', pathText(), strokeText()),
    fillRect: (...args: number[]): void => emit('fillRect', ` [${nums(args)}]`, ` fill=${state.fillStyle}`),
    strokeRect: (...args: number[]): void => emit('strokeRect', ` [${nums(args)}]`, strokeText()),
    clearRect: (...args: number[]): void => emit('clearRect', ` [${nums(args)}]`, ''),
    drawImage: (image: unknown, ...args: number[]): void => {
      emit('drawImage', ` art=${hashOfSprite(image) ?? hashOfCanvas(image) ?? 'none'} [${nums(args)}]`, '')
    },
    fillText: (text: string, ...args: number[]): void =>
      emit('fillRect', ` text=${JSON.stringify(text)} [${nums(args)}]`, ` fill=${state.fillStyle}`),

    // State or path only: none of these paint, so none of them emit a line.
    clip: (): void => undefined,
    setLineDash: (): void => undefined,
    getLineDash: (): number[] => [],
    translate: (x: number, y: number): void => { state.transform = multiply(state.transform, [1, 0, 0, 1, x, y]) },
    scale: (x: number, y: number): void => { state.transform = multiply(state.transform, [x, 0, 0, y, 0, 0]) },
    rotate: (angle: number): void => {
      const cos = Math.cos(angle)
      const sin = Math.sin(angle)
      state.transform = multiply(state.transform, [cos, sin, -sin, cos, 0, 0])
    },
    transform: (...m: number[]): void => { state.transform = multiply(state.transform, m as unknown as Matrix) },
    setTransform: (...m: number[]): void => { state.transform = (m.length === 6 ? m : IDENTITY) as unknown as Matrix },
    resetTransform: (): void => { state.transform = IDENTITY },

    createLinearGradient: (...args: number[]) => makeGradient('linear', args),
    createRadialGradient: (...args: number[]) => makeGradient('radial', args),
    createPattern: () => ({ setTransform: (): void => undefined, toString: () => 'pattern' }),
    createImageData: (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    putImageData: (): void => undefined,
    getImageData: (_x: number, _y: number, w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    measureText: (text: string) => ({ width: text.length * 6 }),
  } as Record<string, unknown>

  // Styles are *state*, not events: assigning one records nothing by itself.
  const define = (name: keyof ContextState, coerce: (value: unknown) => unknown): void => {
    Object.defineProperty(target, name, {
      get: () => state[name],
      set: (value: unknown) => { (state as unknown as Record<string, unknown>)[name] = coerce(value) },
      enumerable: true,
      configurable: true,
    })
  }
  define('fillStyle', String)
  define('strokeStyle', String)
  define('lineWidth', value => round2(Number(value)))
  define('globalAlpha', value => round2(Number(value)))
  define('lineCap', String)
  define('lineJoin', String)
  define('globalCompositeOperation', String)

  return {
    ctx: target,
    calls,
    clear() { calls.length = 0 },
  }
}

/** A gradient that serialises to its own definition, so a diff can read it. */
function makeGradient(kind: string, args: number[]) {
  const stops: string[] = []
  return {
    addColorStop(offset: number, color: string): void { stops.push(`${round2(offset)}:${color}`) },
    toString(): string { return `${kind}-gradient(${args.map(round2).join(' ')}; ${stops.join(' ')})` },
  }
}

// ── Observable state (T-S1.1) ──────────────────────────────────────────────
//
// The controllers name their phases after their implementation — `mining`,
// `chopping`, `gathering`, `casting`, `brewing`. The refactor is free to rename
// them without changing a pixel, so the snapshot stores the *observable* state
// instead and those names never reach it.

export type ObservableState = 'idle' | 'active' | 'window' | 'resolved'

/** Nothing running: the node may be selected, but the player is not working. */
const IDLE_PHASES = new Set(['idle', 'none', 'closed'])
/** The action finished and its outcome is on screen. */
const RESOLVED_PHASES = new Set(['result', 'resolved', 'reward', 'done'])

/**
 * `inWindow` is the timed window the player has to hit — fishing's bite. Every
 * other profession leaves it false and its busy phase reads as `active`.
 */
export function observableState(phase: string, inWindow = false): ObservableState {
  if (IDLE_PHASES.has(phase)) return 'idle'
  if (RESOLVED_PHASES.has(phase)) return 'resolved'
  return inWindow ? 'window' : 'active'
}

// ── Scene clock and sampling ───────────────────────────────────────────────

/** Fixed render step, as the task requires: 30 frames of scene clock a second. */
export const STEP_SECONDS = 1 / 30
/** One *serialised* sample every 50 ms; the hooks run on every frame regardless. */
export const SAMPLE_MS = 50

export interface DecorProbe {
  readonly decor: TraceDecor
  readonly label: string
}

export interface TraceFrame {
  readonly atMs: number
  readonly state: ObservableState
  readonly locked: boolean
  /** Only present when the hook produced something. */
  readonly decor?: string
  readonly ground?: string[]
  readonly sprites?: string[]
  readonly labels?: string[]
}

export type TraceEntry =
  | TraceFrame
  /** A line of the script, so a diff says *where* things changed. */
  | { readonly atMs: number; readonly mark: string }
  /** The frame before it, unchanged; keeps a still scene from filling the file. */
  | { readonly repeat: number }
  /** A stretch whose hooks ran but which was not written down (see `run`). */
  | { readonly skippedMs: number; readonly note: string }

export interface TraceHost {
  readonly overlay: TraceOverlay
  readonly area: unknown
  /** Decor props the renderer would hand this overlay (the node's tile). */
  readonly probes: readonly DecorProbe[]
  /** Names the scenario; never serialised, used to scope a local perturbation. */
  readonly label?: string
  /** The controller's internal phase; normalised before it is written down. */
  phase(): string
  /** True while a timed window is open (fishing's bite). */
  window?(): boolean
  locked(): boolean
}

/** How often each hook actually ran, which is what T-S1.1 is about. */
export interface HookRuns {
  readonly frames: number
  readonly ground: number
  readonly decor: number
  readonly sprites: number
  readonly labels: number
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

/**
 * Runs the scene clock forward one fixed step at a time.
 *
 * **Cadence (T-S1.1).** Every hook runs on every step, in the renderer's order
 * — `ground` → `decor` (once per visible prop) → `sprites` → `labels` — because
 * they carry state between frames: `ground()` draws the selection ring from
 * what `decor()` registered on the *previous* frame, `sprites()` is what
 * rescans the terrain for herb patches and what summons the worker. Calling
 * them only when a frame was going to be written down produced a scene that
 * never happens in the game. Serialisation is the only thing that samples.
 */
export class SceneTrace {
  private secondsValue = 0
  private nextSampleMs = 0
  private readonly recorder = recordingContext()
  private readonly frames: TraceEntry[] = []
  private last: string | null = null
  private readonly runs = { frames: 0, ground: 0, decor: 0, sprites: 0, labels: 0 }
  /** Scene ms at which `sprites()` ran; evidence that it ran between samples. */
  private readonly spriteRunsAtMs: number[] = []

  constructor(private readonly host: TraceHost) {}

  get seconds(): number {
    return this.secondsValue
  }

  get hookRuns(): HookRuns {
    return { ...this.runs }
  }

  get spriteRunTimes(): readonly number[] {
    return this.spriteRunsAtMs
  }

  /**
   * Advances `seconds` of scene clock in fixed steps.
   *
   * `sample: false` runs every hook exactly the same way but records nothing.
   * Long scenarios use it for stretches whose shape is already covered by an
   * equivalent sampled stretch (the middle chops of a tree, say), so the
   * baseline keeps its meaning without growing into something nobody will read.
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

  /** One rendered frame: every hook, always; writing it down is what samples. */
  private step(sample: boolean, until = Number.POSITIVE_INFINITY): void {
    this.secondsValue = Math.min(until, this.secondsValue + STEP_SECONDS)
    const atMs = Math.round(this.secondsValue * 1000)
    this.runs.frames++
    this.recorder.clear()

    if (this.host.overlay.ground) {
      this.runs.ground++
      this.host.overlay.ground(this.recorder.ctx as never, this.host.area as never, 0, 0, this.secondsValue)
    }
    let decor: string | null = null
    if (this.host.overlay.decor) {
      for (const probe of this.host.probes) {
        this.runs.decor++
        const style = this.host.overlay.decor(probe.decor as never, this.host.area as never, this.secondsValue) ?? null
        const serialised = serialiseDecor(style, probe)
        if (serialised) decor = serialised
      }
    }
    let sprites: readonly TraceOverlaySprite[] = []
    if (this.host.overlay.sprites) {
      this.runs.sprites++
      this.spriteRunsAtMs.push(atMs)
      sprites = this.host.overlay.sprites(this.host.area as never, this.secondsValue)
    }
    let labels: readonly TraceOverlayLabel[] = []
    if (this.host.overlay.labels) {
      this.runs.labels++
      labels = this.host.overlay.labels(this.host.area as never, this.secondsValue)
    }

    if (!(sample && atMs >= this.nextSampleMs)) return
    this.nextSampleMs += SAMPLE_MS

    const ground = [...this.recorder.calls]
    // Empty hooks are left out: a frame that grows a `labels` key is a frame
    // where a label appeared, and that is exactly what a diff should show.
    this.push({
      atMs,
      state: observableState(this.host.phase(), this.host.window?.() ?? false),
      locked: this.host.locked(),
      ...(decor ? { decor } : {}),
      ...(ground.length ? { ground } : {}),
      ...(sprites.length ? { sprites: sprites.map(serialiseSprite) } : {}),
      ...(labels.length ? { labels: labels.map(serialiseLabel) } : {}),
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

  /** A line of the script. It describes the test, not the implementation. */
  mark(note: string): void {
    this.frames.push({ atMs: Math.round(this.secondsValue * 1000), mark: note })
    this.last = null
  }

  get trace(): readonly TraceEntry[] {
    return this.frames
  }
}

// ── Promises (T-S1.1) ──────────────────────────────────────────────────────

/**
 * The worker's sheet is assigned inside a `.then`, so even an already-resolved
 * loader needs the microtask queue drained before the companion has frames.
 * The scene runner is synchronous; scenarios with a worker await this once
 * after the frame that summons it. Four rounds covers `load().catch().then()`.
 */
export const flushPromises = async (rounds = 4): Promise<void> => {
  for (let i = 0; i < rounds; i++) await Promise.resolve()
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
