// The living ranch — Rancho
//
// Owns the canvas, the clock and everything on the map: it builds the world
// once, keeps the inhabitants ticking, decides what is on screen and hands a
// frame to the renderer. The Vue layer talks to it through a small surface
// (focus, pick, select) and never touches actors or the camera directly.
//
// Three things keep it cheap with two thousand inhabitants: only what the
// viewport can see is simulated or drawn, the visible list is a reused buffer
// kept nearly sorted, and a frame is skipped outright when nothing moved.

import { advance, actorPosition, type Actor, type MoveRules } from '../../wildlands/engine/actors'
import { pokeballInfo } from '../../wildlands/engine/pokeball'
import { TILE } from '../../wildlands/engine/world'
import type { RanchResident, RanchSnapshot } from '../domain/membership'
import { speciesName } from '../domain/species'
import {
  caretakerRoutes, caretakerRules, createCaretakers, loadCaretakerArt, tickCaretaker, type Caretaker,
} from '../world/caretakers'
import { RanchMap } from '../world/ranchMap'
import {
  createInhabitants, inhabitantRules, SpeciesArt, thinkInhabitant, type Inhabitant,
} from '../world/residents'
import { ZONE_LABELS } from '../world/ranchLayout'
import { buildSlots, slotCapacity, type ZoneSlots } from '../world/slots'
import { ZONE_IDS, ZONES, type ZoneId } from '../domain/zones'
import { RanchCamera } from './camera'
import { NameplateCache } from './nameplates'
import { buildRanchArt, type RanchArt } from './ranchArt'
import { RanchGround } from './ranchGround'
import { drawFrame, type DrawableActor, type MapLabel } from './renderer'
import { buildScenery, type SceneryItem } from './scenery'

/** Grid cell used to find who is near a tap, in world pixels. */
const CELL = 64
/** Comfortable tap radius on a phone, in world pixels. */
const TAP_SLACK = 10
/** Screen pixels a pointer may travel and still count as a tap. */
const TAP_MOVE = 8
const TAP_MS = 500
/** Retina beyond this buys nothing and costs a lot of fill rate on phones. */
const MAX_DPR = 2
/** Longest simulated step, so a backgrounded tab does not jump on return. */
const MAX_DT = 0.1
/** Milliseconds between animated-scenery frames. */
const ANIM_MS = 160

export interface RanchStats {
  residents: number
  visible: number
  fps: number
  chunks: number
  species: number
}

export interface SceneOptions {
  onSelect?: (resident: RanchResident | null) => void
  initialZoom?: number
}

export class RanchScene {
  readonly map: RanchMap
  readonly slots: ZoneSlots
  readonly camera: RanchCamera
  readonly capacity: Record<ZoneId, number>

  private readonly canvas: HTMLCanvasElement
  private readonly ctx: CanvasRenderingContext2D
  private readonly art: RanchArt
  private readonly ground: RanchGround
  private readonly scenery: readonly SceneryItem[]
  private readonly nameplates = new NameplateCache()
  private readonly labels: MapLabel[] = ZONE_IDS.map(zone => ({
    text: ZONES[zone].name,
    x: ZONE_LABELS[zone].x * TILE,
    y: ZONE_LABELS[zone].y * TILE,
  }))
  private readonly speciesArt = new SpeciesArt()

  private readonly inhabitantRules: MoveRules
  private readonly caretakerRules: MoveRules
  /** Inhabitant index + 1 per tile, so two Pokemon never share a square. */
  private occupancy: Int32Array
  private inhabitants: Inhabitant[] = []
  private caretakers: Caretaker[] = []
  private readonly byId = new Map<string, Inhabitant>()
  /** Home cell -> indices into `inhabitants`; homes never move, so this is built once. */
  private readonly grid = new Map<number, number[]>()

  /** Reused every frame; never reallocated. */
  private readonly drawables: DrawableActor[] = []
  private visibleCount = 0

  private readonly onSelect: (resident: RanchResident | null) => void
  private highlighted: string | null = null
  private running = false
  private raf = 0
  private last = 0
  private clock = 0
  private fps = 60
  private detachCamera: (() => void) | null = null
  private observer: ResizeObserver | null = null
  private pointerStart: { x: number; y: number; t: number } | null = null
  private needsFrame = true
  private animationFrame = -1

  constructor(canvas: HTMLCanvasElement, options: SceneOptions = {}) {
    this.canvas = canvas
    const ctx = canvas.getContext('2d', { alpha: false })
    if (!ctx) throw new Error('El Rancho necesita un canvas 2D')
    this.ctx = ctx
    this.onSelect = options.onSelect ?? (() => {})

    this.map = new RanchMap()
    this.slots = buildSlots(this.map)
    this.capacity = slotCapacity(this.slots)
    this.art = buildRanchArt()
    this.ground = new RanchGround(this.map)
    this.scenery = buildScenery(this.map, this.art)
    this.camera = new RanchCamera(
      { width: this.map.pixelWidth, height: this.map.pixelHeight },
      { initialZoom: options.initialZoom },
    )
    this.occupancy = new Int32Array(this.map.w * this.map.h)
    this.inhabitantRules = inhabitantRules(this.map, (tx, ty, self) => {
      const taken = this.occupancy[ty * this.map.w + tx]
      return taken !== 0 && this.inhabitants[taken - 1]?.actor !== self
    })
    this.caretakerRules = caretakerRules(this.map)
  }

  /** Replaces who lives here. Called once on load with the mock snapshot. */
  setSnapshot(snapshot: RanchSnapshot): void {
    this.inhabitants = createInhabitants(snapshot.residents, this.slots, this.clock)
    // Pre-sorted by home depth: the per-frame sort then has almost nothing to do.
    this.inhabitants.sort((a, b) => a.actor.homeTy - b.actor.homeTy || a.actor.homeTx - b.actor.homeTx)
    this.byId.clear()
    this.grid.clear()
    this.occupancy = new Int32Array(this.map.w * this.map.h)
    this.inhabitants.forEach((life, index) => {
      this.byId.set(life.resident.id, life)
      this.occupancy[life.actor.ty * this.map.w + life.actor.tx] = index + 1
      const key = this.cellKey(life.actor.homeTx * 16, life.actor.homeTy * 16)
      const cell = this.grid.get(key)
      if (cell) cell.push(index)
      else this.grid.set(key, [index])
    })
    this.caretakers = createCaretakers(caretakerRoutes(), this.map, this.clock)
    loadCaretakerArt(this.caretakers)
    this.needsFrame = true
  }

  private cellKey(x: number, y: number): number {
    return Math.floor(y / CELL) * 4096 + Math.floor(x / CELL)
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.resize()
    this.observer = new ResizeObserver(() => this.resize())
    this.observer.observe(this.canvas)
    this.detachCamera = this.camera.attach(this.canvas)
    this.canvas.addEventListener('pointerdown', this.onPointerDown)
    this.canvas.addEventListener('pointerup', this.onPointerUp)
    document.addEventListener('visibilitychange', this.onVisibility)
    this.last = performance.now()
    this.raf = requestAnimationFrame(this.tick)
  }

  destroy(): void {
    this.running = false
    cancelAnimationFrame(this.raf)
    this.observer?.disconnect()
    this.observer = null
    this.detachCamera?.()
    this.detachCamera = null
    this.canvas.removeEventListener('pointerdown', this.onPointerDown)
    this.canvas.removeEventListener('pointerup', this.onPointerUp)
    document.removeEventListener('visibilitychange', this.onVisibility)
  }

  resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR)
    const rect = this.canvas.getBoundingClientRect()
    const width = Math.max(1, Math.round(rect.width))
    const height = Math.max(1, Math.round(rect.height))
    this.canvas.width = Math.round(width * dpr)
    this.canvas.height = Math.round(height * dpr)
    this.camera.resize(width, height, dpr)
    this.nameplates.setDpr(dpr)
    this.needsFrame = true
  }

  private readonly onVisibility = (): void => {
    if (document.hidden) {
      cancelAnimationFrame(this.raf)
      return
    }
    this.last = performance.now()
    this.needsFrame = true
    this.raf = requestAnimationFrame(this.tick)
  }

  private readonly tick = (now: number): void => {
    if (!this.running) return
    this.raf = requestAnimationFrame(this.tick)
    if (document.hidden) return
    const dt = Math.min(MAX_DT, Math.max(0, (now - this.last) / 1000))
    this.last = now
    this.clock += dt
    this.fps += (1 / Math.max(dt, 0.001) - this.fps) * 0.1

    const cameraMoved = this.camera.update(dt)
    const worldMoved = this.simulate(dt)
    const animation = Math.floor(now / ANIM_MS)
    const flickered = animation !== this.animationFrame
    this.animationFrame = animation
    if (!cameraMoved && !worldMoved && !flickered && !this.needsFrame) return
    this.needsFrame = false

    this.collect()
    this.ground.tick()
    drawFrame(this.ctx, {
      camera: this.camera,
      ground: this.ground,
      scenery: this.scenery,
      nameplates: this.nameplates,
      actors: this.drawables,
      actorCount: this.visibleCount,
      labels: this.labels,
      animationFrame: animation,
    })
  }

  /** Advances only what the viewport can see, plus the two caretakers. */
  private simulate(dt: number): boolean {
    let moved = false
    const width = this.map.w
    this.forEachVisible((life, index) => {
      const { actor } = life
      const wasTx = actor.tx
      const wasTy = actor.ty
      advance(actor, dt)
      thinkInhabitant(life, this.clock, this.inhabitantRules)
      if (actor.tx !== wasTx || actor.ty !== wasTy) {
        if (this.occupancy[wasTy * width + wasTx] === index + 1) this.occupancy[wasTy * width + wasTx] = 0
        this.occupancy[actor.ty * width + actor.tx] = index + 1
      }
      if (actor.progress < 1) moved = true
    })
    for (const caretaker of this.caretakers) {
      tickCaretaker(caretaker, this.clock, dt, this.caretakerRules)
      if (caretaker.actor.progress < 1) moved = true
    }
    return moved
  }

  private readonly bounds = { x0: 0, y0: 0, x1: 0, y1: 0 }

  private forEachVisible(fn: (life: Inhabitant, index: number) => void): void {
    this.camera.visible(CELL, this.bounds)
    const { x0, y0, x1, y1 } = this.bounds
    const cx0 = Math.floor(x0 / CELL)
    const cy0 = Math.floor(y0 / CELL)
    const cx1 = Math.floor(x1 / CELL)
    const cy1 = Math.floor(y1 / CELL)
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const cell = this.grid.get(cy * 4096 + cx)
        if (!cell) continue
        for (const index of cell) fn(this.inhabitants[index], index)
      }
    }
  }

  /** Adds one actor to the reused drawable buffer, without allocating. */
  private push(actor: Actor, name: string | null, platform: DrawableActor['platform'], key: string): void {
    const n = this.visibleCount
    let slot = this.drawables[n]
    if (!slot) {
      slot = { actor, x: 0, y: 0, name: null, platform: null, key: '', highlighted: false }
      this.drawables[n] = slot
    }
    const t = actor.progress
    slot.actor = actor
    slot.x = Math.round((actor.fromTx + (actor.tx - actor.fromTx) * t) * TILE + TILE / 2)
    slot.y = Math.round((actor.fromTy + (actor.ty - actor.fromTy) * t) * TILE + TILE - 2)
    slot.name = name
    slot.platform = platform
    slot.key = key
    slot.highlighted = key === this.highlighted
    this.visibleCount = n + 1
  }

  /** Fills `drawables` with what is on screen, sorted by depth. */
  private collect(): void {
    this.visibleCount = 0
    this.forEachVisible(life => {
      const { resident, actor } = life
      const frames = this.speciesArt.request(resident.speciesId)
      if (frames) {
        if (actor.pokemon?.frames !== frames) {
          actor.pokemon = { id: resident.speciesId, name: speciesName(resident.speciesId), shiny: false, frames }
        }
      } else if (!actor.pokemon) {
        // A Poké Ball stands in until the overworld sheet lands.
        actor.pokemon = pokeballInfo({ id: resident.speciesId, name_es: speciesName(resident.speciesId) })
      }
      this.push(actor, resident.displayName, resident.platform, resident.id)
    })
    for (const caretaker of this.caretakers) this.push(caretaker.actor, null, null, caretaker.id)
    const n = this.visibleCount

    // Insertion sort: the list starts nearly ordered, so this is linear in practice.
    for (let i = 1; i < n; i++) {
      const item = this.drawables[i]
      let j = i - 1
      while (j >= 0 && this.drawables[j].y > item.y) {
        this.drawables[j + 1] = this.drawables[j]
        j--
      }
      this.drawables[j + 1] = item
    }
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    this.pointerStart = { x: event.clientX, y: event.clientY, t: event.timeStamp }
  }

  private readonly onPointerUp = (event: PointerEvent): void => {
    const start = this.pointerStart
    this.pointerStart = null
    if (!start) return
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > TAP_MOVE) return
    if (event.timeStamp - start.t > TAP_MS) return
    const rect = this.canvas.getBoundingClientRect()
    const hit = this.pick(event.clientX - rect.left, event.clientY - rect.top)
    this.highlighted = hit?.id ?? null
    this.needsFrame = true
    this.onSelect(hit)
  }

  /** Inhabitant under a point given in CSS pixels relative to the canvas. */
  pick(sx: number, sy: number): RanchResident | null {
    const point = this.camera.screenToWorld(sx, sy)
    const wx = point.x
    const wy = point.y
    // A tap should be forgiving on a phone, where a finger covers several tiles.
    const slack = TAP_SLACK + TAP_SLACK / Math.max(0.5, this.camera.zoom)
    let best: RanchResident | null = null
    let bestDepth = -Infinity
    const cx = Math.floor(wx / CELL)
    const cy = Math.floor(wy / CELL)
    for (let y = cy - 1; y <= cy + 1; y++) {
      for (let x = cx - 1; x <= cx + 1; x++) {
        const cell = this.grid.get(y * 4096 + x)
        if (!cell) continue
        for (const index of cell) {
          const life = this.inhabitants[index]
          const at = actorPosition(life.actor)
          const sprite = life.actor.pokemon?.frames[life.actor.dir][0]
          const halfW = (sprite ? sprite.w / 2 : 8) + slack
          const height = (sprite ? sprite.ay : 12) + slack
          if (Math.abs(wx - at.x) > halfW) continue
          if (wy > at.y + slack || wy < at.y - height) continue
          // Whoever is drawn last (lowest on screen) wins an overlap.
          if (at.y > bestDepth) {
            bestDepth = at.y
            best = life.resident
          }
        }
      }
    }
    return best
  }

  /** Centres on an inhabitant and highlights it. */
  focus(residentId: string | null, options: { instant?: boolean } = {}): boolean {
    this.highlighted = residentId
    this.needsFrame = true
    if (!residentId) return false
    const life = this.byId.get(residentId)
    if (!life) return false
    const at = actorPosition(life.actor)
    if (options.instant) this.camera.jumpTo(at.x, at.y, Math.max(this.camera.zoom, 2.5))
    else this.camera.flyTo(at.x, at.y, Math.max(this.camera.zoom, 2.5))
    return true
  }

  get residents(): RanchResident[] {
    return this.inhabitants.map(life => life.resident)
  }

  stats(): RanchStats {
    return {
      residents: this.inhabitants.length,
      visible: this.visibleCount,
      fps: Math.round(this.fps),
      chunks: this.ground.size,
      species: this.speciesArt.loaded,
    }
  }
}
