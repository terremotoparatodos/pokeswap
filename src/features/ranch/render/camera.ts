// Top-down camera — Rancho
//
// The Rancho is looked at from straight above, so the camera is a plain
// pan/zoom over world pixels: no WildLands tilt, no projection. It owns the
// input gestures (drag, wheel, pinch), the inertia after a flick and the
// "fly to" used by search and `?u=` links.
//
// Pixel art rules the numbers here: the renderer draws at `zoom * dpr` device
// pixels per world pixel and the translation is rounded to whole device
// pixels, so sprites never land on half a pixel. While a pinch is in flight
// the scale is continuous (it would feel sticky otherwise); when the fingers
// leave, a scale close to a whole multiple snaps to it.

/** World rectangle the camera may look at, in pixels. */
export interface WorldBounds {
  width: number
  height: number
}

export interface CameraLimits {
  min: number
  max: number
}

export interface Point {
  x: number
  y: number
}

/** Scales that keep the pixel grid exact. Anything else blurs a little. */
export const CLEAN_SCALES: readonly number[] = [0.5, 0.75, 1, 1.5, 2, 3, 4]
export const MAX_ZOOM = 4
/** How much of a tile-sized margin the view may show past the map edge. */
const EDGE_MARGIN = 32

/** Smallest zoom that still frames the whole ranch, and the hard maximum. */
export function zoomLimits(world: WorldBounds, viewW: number, viewH: number): CameraLimits {
  if (viewW <= 0 || viewH <= 0) return { min: 1, max: MAX_ZOOM }
  const fit = Math.min(viewW / (world.width + EDGE_MARGIN * 2), viewH / (world.height + EDGE_MARGIN * 2))
  return { min: Math.min(fit, MAX_ZOOM), max: MAX_ZOOM }
}

/**
 * Centre kept inside the map: when the view is wider than the map, it centres.
 * Writes into `out` because this runs every frame and must not allocate.
 */
export function clampCentre(world: WorldBounds, viewW: number, viewH: number, zoom: number, out: Point): void {
  const halfW = viewW / zoom / 2
  const halfH = viewH / zoom / 2
  out.x =
    halfW >= world.width / 2 + EDGE_MARGIN
      ? world.width / 2
      : Math.max(halfW - EDGE_MARGIN, Math.min(world.width - halfW + EDGE_MARGIN, out.x))
  out.y =
    halfH >= world.height / 2 + EDGE_MARGIN
      ? world.height / 2
      : Math.max(halfH - EDGE_MARGIN, Math.min(world.height - halfH + EDGE_MARGIN, out.y))
}

/** Nearest crisp scale, when one is close enough to snap to without a visible jump. */
export function snapZoom(zoom: number, limits: CameraLimits, tolerance = 0.12): number {
  let best = zoom
  let bestGap = Infinity
  for (const scale of CLEAN_SCALES) {
    if (scale < limits.min || scale > limits.max) continue
    const gap = Math.abs(Math.log(scale / zoom))
    if (gap < bestGap) {
      bestGap = gap
      best = scale
    }
  }
  return bestGap <= tolerance ? best : zoom
}

interface Flight {
  fromX: number
  fromY: number
  fromZoom: number
  toX: number
  toY: number
  toZoom: number
  elapsed: number
  duration: number
}

/** Cubic ease-in-out: leaves and arrives at rest. */
const ease = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

/** Velocity below this (world px per second) is not worth animating. */
const MIN_FLICK = 40
/** Fraction of the velocity kept after one second of drift. */
const FRICTION = 0.01

export interface CameraOptions {
  /** Zoom to open at, clamped to the limits. */
  initialZoom?: number
}

export class RanchCamera {
  x: number
  y: number
  zoom = 1
  /** CSS pixels of the canvas. */
  viewW = 0
  viewH = 0
  dpr = 1

  private readonly world: WorldBounds
  private readonly wanted: number
  private limits: CameraLimits = { min: 0.25, max: MAX_ZOOM }
  private vx = 0
  private vy = 0
  private flight: Flight | null = null
  /** Live pointers, so a pinch can be told from a drag. */
  private readonly pointers = new Map<number, Point>()
  private dragging = false
  private pinchDistance = 0
  private pinchZoom = 1
  private lastMove = 0
  private detach: (() => void) | null = null
  /** Reused so picking and drawing allocate nothing per call. */
  private readonly toWorld: Point = { x: 0, y: 0 }
  private readonly toScreen: Point = { x: 0, y: 0 }

  constructor(world: WorldBounds, options: CameraOptions = {}) {
    this.world = world
    this.wanted = options.initialZoom ?? 2
    this.x = world.width / 2
    this.y = world.height / 2
  }

  /** Whether anything is still animating (inertia or a flight). */
  get moving(): boolean {
    return this.flight !== null || this.vx !== 0 || this.vy !== 0
  }

  /** Whether a finger or the mouse is currently driving the camera. */
  get grabbed(): boolean {
    return this.dragging || this.pointers.size > 1
  }

  /** Device pixels per world pixel; whole numbers keep the art crisp. */
  get scale(): number {
    return this.zoom * this.dpr
  }

  resize(viewW: number, viewH: number, dpr: number): void {
    const first = this.viewW === 0
    this.viewW = viewW
    this.viewH = viewH
    this.dpr = dpr
    this.limits = zoomLimits(this.world, viewW, viewH)
    this.zoom = first ? this.clampZoom(this.wanted) : this.clampZoom(this.zoom)
    this.settle()
  }

  private clampZoom(zoom: number): number {
    return Math.max(this.limits.min, Math.min(this.limits.max, zoom))
  }

  private settle(): void {
    const wasX = this.x
    const wasY = this.y
    clampCentre(this.world, this.viewW, this.viewH, this.zoom, this)
    // Hitting an edge kills the drift, so the view does not strain against it.
    if (this.x !== wasX) this.vx = 0
    if (this.y !== wasY) this.vy = 0
  }

  /** World point under a position given in CSS pixels relative to the canvas. */
  screenToWorld(sx: number, sy: number): Point {
    this.toWorld.x = this.x + (sx - this.viewW / 2) / this.zoom
    this.toWorld.y = this.y + (sy - this.viewH / 2) / this.zoom
    return this.toWorld
  }

  /** CSS pixels relative to the canvas for a world point. */
  worldToScreen(wx: number, wy: number): Point {
    this.toScreen.x = (wx - this.x) * this.zoom + this.viewW / 2
    this.toScreen.y = (wy - this.y) * this.zoom + this.viewH / 2
    return this.toScreen
  }

  /** World rectangle currently visible, with `pad` world pixels of slack. */
  visible(pad: number, out: { x0: number; y0: number; x1: number; y1: number }): void {
    const halfW = this.viewW / this.zoom / 2
    const halfH = this.viewH / this.zoom / 2
    out.x0 = this.x - halfW - pad
    out.y0 = this.y - halfH - pad
    out.x1 = this.x + halfW + pad
    out.y1 = this.y + halfH + pad
  }

  /** Transform for the whole scene, in device pixels, snapped to the pixel grid. */
  applyTo(ctx: CanvasRenderingContext2D): void {
    const s = this.scale
    const tx = Math.round(-this.x * s + (this.viewW * this.dpr) / 2)
    const ty = Math.round(-this.y * s + (this.viewH * this.dpr) / 2)
    ctx.setTransform(s, 0, 0, s, tx, ty)
  }

  /** Zoom around a fixed point given in CSS pixels (cursor or pinch centre). */
  zoomAt(sx: number, sy: number, zoom: number): void {
    const before = this.screenToWorld(sx, sy)
    const wx = before.x
    const wy = before.y
    this.zoom = this.clampZoom(zoom)
    this.x = wx - (sx - this.viewW / 2) / this.zoom
    this.y = wy - (sy - this.viewH / 2) / this.zoom
    this.settle()
  }

  /** Centre on a world point, optionally changing zoom, with a smooth glide. */
  flyTo(wx: number, wy: number, zoom = Math.max(this.zoom, 2), duration = 0.75): void {
    this.vx = 0
    this.vy = 0
    const target = { x: wx, y: wy }
    clampCentre(this.world, this.viewW, this.viewH, this.clampZoom(zoom), target)
    this.flight = {
      fromX: this.x,
      fromY: this.y,
      fromZoom: this.zoom,
      toX: target.x,
      toY: target.y,
      toZoom: this.clampZoom(zoom),
      elapsed: 0,
      duration: Math.max(0.01, duration),
    }
  }

  /** Jump straight to a world point (used on first load for `?u=`). */
  jumpTo(wx: number, wy: number, zoom = this.zoom): void {
    this.flight = null
    this.vx = 0
    this.vy = 0
    this.zoom = this.clampZoom(zoom)
    this.x = wx
    this.y = wy
    this.settle()
  }

  stop(): void {
    this.flight = null
    this.vx = 0
    this.vy = 0
  }

  /** Advances inertia and any flight. Returns whether the view changed. */
  update(dt: number): boolean {
    if (this.flight) {
      const f = this.flight
      f.elapsed += dt
      const t = Math.min(1, f.elapsed / f.duration)
      const k = ease(t)
      this.zoom = f.fromZoom + (f.toZoom - f.fromZoom) * k
      this.x = f.fromX + (f.toX - f.fromX) * k
      this.y = f.fromY + (f.toY - f.fromY) * k
      this.settle()
      if (t >= 1) this.flight = null
      return true
    }
    if (this.vx === 0 && this.vy === 0) return false
    this.x -= this.vx * dt
    this.y -= this.vy * dt
    const decay = Math.pow(FRICTION, dt)
    this.vx *= decay
    this.vy *= decay
    if (Math.hypot(this.vx, this.vy) < MIN_FLICK) {
      this.vx = 0
      this.vy = 0
    }
    this.settle()
    return true
  }

  /**
   * Listens for drag, wheel and pinch on `element`. The element needs
   * `touch-action: none` so a one-finger pan is not stolen by page scroll.
   * Returns the call that removes every listener.
   */
  attach(element: HTMLElement): () => void {
    this.release()
    const rect = () => element.getBoundingClientRect()
    const local = (event: PointerEvent): Point => {
      const box = rect()
      return { x: event.clientX - box.left, y: event.clientY - box.top }
    }

    const onPointerDown = (event: PointerEvent): void => {
      if (event.button !== 0 && event.pointerType === 'mouse') return
      element.setPointerCapture(event.pointerId)
      this.pointers.set(event.pointerId, local(event))
      this.stop()
      if (this.pointers.size === 1) {
        this.dragging = true
        this.lastMove = 0
      } else if (this.pointers.size === 2) {
        this.dragging = false
        this.beginPinch()
      }
    }

    const onPointerMove = (event: PointerEvent): void => {
      const previous = this.pointers.get(event.pointerId)
      if (!previous) return
      const now = local(event)
      this.pointers.set(event.pointerId, now)
      if (this.pointers.size >= 2) {
        this.pinch()
        return
      }
      if (!this.dragging) return
      const dx = (now.x - previous.x) / this.zoom
      const dy = (now.y - previous.y) / this.zoom
      this.x -= dx
      this.y -= dy
      // Velocity from this move alone: a flick is the last gesture, not the average.
      const seconds = this.lastMove ? Math.max(0.008, (event.timeStamp - this.lastMove) / 1000) : 0
      this.lastMove = event.timeStamp
      if (seconds) {
        this.vx = dx / seconds
        this.vy = dy / seconds
      }
      this.settle()
    }

    const endPointer = (event: PointerEvent): void => {
      if (!this.pointers.delete(event.pointerId)) return
      if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId)
      if (this.pointers.size === 1) {
        // One finger left after a pinch: carry on panning from where it is.
        this.dragging = true
        this.lastMove = 0
        this.vx = 0
        this.vy = 0
      } else if (this.pointers.size === 0) {
        this.dragging = false
        if (Math.hypot(this.vx, this.vy) < MIN_FLICK) {
          this.vx = 0
          this.vy = 0
        }
        this.snapToCleanScale()
      }
    }

    const onWheel = (event: WheelEvent): void => {
      event.preventDefault()
      const box = rect()
      // Trackpads send pixels, mice send lines or pages; normalise to notches.
      const notches = event.deltaMode === 1 ? event.deltaY / 16 : event.deltaMode === 2 ? event.deltaY : event.deltaY / 120
      this.stop()
      this.zoomAt(event.clientX - box.left, event.clientY - box.top, this.zoom * Math.pow(0.8, notches))
      this.zoom = this.clampZoom(snapZoom(this.zoom, this.limits, 0.04))
      this.settle()
    }

    const onContextMenu = (event: Event): void => event.preventDefault()

    element.addEventListener('pointerdown', onPointerDown)
    element.addEventListener('pointermove', onPointerMove)
    element.addEventListener('pointerup', endPointer)
    element.addEventListener('pointercancel', endPointer)
    element.addEventListener('wheel', onWheel, { passive: false })
    element.addEventListener('contextmenu', onContextMenu)

    this.detach = () => {
      element.removeEventListener('pointerdown', onPointerDown)
      element.removeEventListener('pointermove', onPointerMove)
      element.removeEventListener('pointerup', endPointer)
      element.removeEventListener('pointercancel', endPointer)
      element.removeEventListener('wheel', onWheel)
      element.removeEventListener('contextmenu', onContextMenu)
      this.pointers.clear()
      this.dragging = false
    }
    return this.detach
  }

  release(): void {
    this.detach?.()
    this.detach = null
  }

  private twoPointers(): [Point, Point] {
    const it = this.pointers.values()
    return [it.next().value as Point, it.next().value as Point]
  }

  private beginPinch(): void {
    const [a, b] = this.twoPointers()
    this.pinchDistance = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y))
    this.pinchZoom = this.zoom
  }

  /** Continuous while the fingers are down; the snap happens on release. */
  private pinch(): void {
    const [a, b] = this.twoPointers()
    const distance = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y))
    this.zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, (this.pinchZoom * distance) / this.pinchDistance)
  }

  private snapToCleanScale(): void {
    const snapped = snapZoom(this.zoom, this.limits)
    if (snapped === this.zoom) return
    this.zoomAt(this.viewW / 2, this.viewH / 2, snapped)
  }
}
