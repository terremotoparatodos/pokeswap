// City Mapping Lab — debug layers (DEV only).
//
// Two surfaces:
//   - `LabGroundOverlay` is a `SceneOverlay`: it paints into the renderer's
//     ground buffer before projection, so grids, solids and markers tilt with
//     the terrain exactly like the game's own route marks;
//   - `drawScreenOverlay` draws sprite bounds on a canvas stacked over the
//     renderer's, in the same device pixels (see labProjection.ts).

import type { Area } from '../../wildlands/engine/area'
import type { TrainerSprites } from '../../wildlands/engine/characters'
import type { Tile } from '../../wildlands/engine/pathfinding'
import type { OverlayLabel, OverlaySprite, SceneOverlay } from '../../wildlands/engine/sceneOverlay'
import { TILE } from '../../wildlands/engine/world'
import { WORLDS } from '../../wildlands/areas/atlas'
import { isLobbyFeature, LOBBY_FEATURES } from '../../wildlands/lobby/features'
import type { CityGrid } from '../domain/cityGrid'
import { isSolidKind } from '../domain/labCatalog'
import { sameRef, tilesOf, type EntityRef, type LabCity } from '../domain/labCity'
import { contains, spriteRect, type FrameGeometry } from './labProjection'
import type { DrawnThing } from './labThings'

export interface LayerToggles {
  grid: boolean
  coords: boolean
  solids: boolean
  walkable: boolean
  footprints: boolean
  bounds: boolean
  markers: boolean
  /** Doors to PokeSwap functions and portals to the worlds, labelled on the map. */
  accesses: boolean
  clearance: boolean
  zones: boolean
}

export const DEFAULT_LAYERS: LayerToggles = {
  grid: true, coords: false, solids: false, walkable: false, footprints: false, bounds: false, markers: true, accesses: true, clearance: false, zones: false,
}

export interface OverlayInputs {
  city: LabCity
  grid: CityGrid
  clearance: Uint8Array | null
  layers: LayerToggles
  hover: Tile | null
  selection: EntityRef | null
  ghost: { tiles: readonly Tile[]; valid: boolean } | null
  brush: readonly Tile[] | null
  highlight: readonly Tile[]
  npcLooks: () => readonly TrainerSprites[]
  spawnLook: () => TrainerSprites | undefined
}

const CLEARANCE_COLORS = ['', 'rgba(230, 40, 40, 0.55)', 'rgba(245, 150, 30, 0.5)', 'rgba(240, 220, 40, 0.4)', 'rgba(60, 200, 90, 0.22)']

export class LabGroundOverlay implements SceneOverlay {
  constructor(private readonly input: () => OverlayInputs) {}

  ground(g: CanvasRenderingContext2D, _area: Area, x0: number, y0: number, seconds: number): void {
    const s = this.input()
    const { grid, layers, city } = s
    const tx0 = Math.max(0, Math.floor(x0 / TILE))
    const ty0 = Math.max(0, Math.floor(y0 / TILE))
    const tx1 = Math.min(grid.width - 1, Math.ceil((x0 + g.canvas.width) / TILE))
    const ty1 = Math.min(grid.height - 1, Math.ceil((y0 + g.canvas.height) / TILE))
    g.save()
    g.translate(-x0, -y0)
    const fill = (t: Tile, color: string, inset = 0) => {
      g.fillStyle = color
      g.fillRect(t.tx * TILE + inset, t.ty * TILE + inset, TILE - inset * 2, TILE - inset * 2)
    }
    const outline = (tiles: readonly Tile[], color: string, width = 1) => {
      g.strokeStyle = color
      g.lineWidth = width
      for (const t of tiles) g.strokeRect(t.tx * TILE + 0.5, t.ty * TILE + 0.5, TILE - 1, TILE - 1)
    }

    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const solid = grid.solid(tx, ty)
        if (layers.solids && solid) fill({ tx, ty }, 'rgba(220, 30, 30, 0.38)')
        if (layers.walkable && !solid) fill({ tx, ty }, 'rgba(40, 200, 90, 0.28)')
        if (layers.clearance && !solid && s.clearance) fill({ tx, ty }, CLEARANCE_COLORS[s.clearance[ty * grid.width + tx]] || CLEARANCE_COLORS[4])
      }
    }

    if (layers.zones) {
      g.setLineDash([3, 2])
      g.strokeStyle = 'rgba(170, 90, 255, 0.9)'
      for (const z of grid.area.def.plazaZones ?? []) g.strokeRect(z.x0 * TILE, z.y0 * TILE, (z.x1 - z.x0 + 1) * TILE, (z.y1 - z.y0 + 1) * TILE)
      g.strokeStyle = 'rgba(255, 255, 255, 0.6)'
      for (const z of grid.area.def.plots ?? []) g.strokeRect(z.x0 * TILE + 1, z.y0 * TILE + 1, (z.x1 - z.x0 + 1) * TILE - 2, (z.y1 - z.y0 + 1) * TILE - 2)
      g.setLineDash([])
    }

    if (layers.grid) {
      g.lineWidth = 0.5
      g.strokeStyle = 'rgba(20, 20, 40, 0.28)'
      g.beginPath()
      for (let tx = tx0; tx <= tx1 + 1; tx++) { g.moveTo(tx * TILE, ty0 * TILE); g.lineTo(tx * TILE, (ty1 + 1) * TILE) }
      for (let ty = ty0; ty <= ty1 + 1; ty++) { g.moveTo(tx0 * TILE, ty * TILE); g.lineTo((tx1 + 1) * TILE, ty * TILE) }
      g.stroke()
      g.lineWidth = 1
      g.strokeStyle = 'rgba(20, 20, 60, 0.45)'
      g.beginPath()
      for (let tx = Math.ceil(tx0 / 5) * 5; tx <= tx1 + 1; tx += 5) { g.moveTo(tx * TILE, ty0 * TILE); g.lineTo(tx * TILE, (ty1 + 1) * TILE) }
      for (let ty = Math.ceil(ty0 / 5) * 5; ty <= ty1 + 1; ty += 5) { g.moveTo(tx0 * TILE, ty * TILE); g.lineTo((tx1 + 1) * TILE, ty * TILE) }
      g.stroke()
    }

    if (layers.coords) {
      g.font = '5px monospace'
      g.textBaseline = 'top'
      for (let ty = Math.ceil(ty0 / 5) * 5; ty <= ty1; ty += 5) {
        for (let tx = Math.ceil(tx0 / 5) * 5; tx <= tx1; tx += 5) {
          g.fillStyle = 'rgba(0, 0, 0, 0.55)'
          g.fillRect(tx * TILE, ty * TILE, 15, 6)
          g.fillStyle = '#fff'
          g.fillText(`${tx},${ty}`, tx * TILE + 1, ty * TILE + 0.5)
        }
      }
    }

    if (layers.footprints) {
      for (const b of city.buildings) {
        g.strokeStyle = 'rgba(40, 220, 255, 0.95)'
        g.lineWidth = 1
        g.strokeRect(b.x * TILE + 0.5, b.y * TILE + 0.5, b.w * TILE - 1, b.d * TILE - 1)
        if (b.door) {
          // The rows above the footprint still count as tapping the building (doors.ts).
          g.setLineDash([2, 2])
          g.strokeRect(b.x * TILE + 0.5, (b.y - 2) * TILE + 0.5, b.w * TILE - 1, 2 * TILE - 1)
          g.setLineDash([])
          fill(b.door, 'rgba(255, 220, 40, 0.75)', 2)
          outline([{ tx: b.door.tx, ty: b.door.ty + 1 }], 'rgba(255, 220, 40, 0.9)')
        }
        for (const t of b.open ?? []) fill(t, 'rgba(120, 255, 200, 0.5)', 3)
      }
      for (const f of city.fountains) {
        g.strokeStyle = 'rgba(80, 160, 255, 0.95)'
        g.strokeRect(f.x0 * TILE + 0.5, f.y0 * TILE + 0.5, (f.x1 - f.x0 + 1) * TILE - 1, (f.y1 - f.y0 + 1) * TILE - 1)
      }
      for (const p of city.props) {
        if (isSolidKind(p.kind)) outline([p], 'rgba(255, 70, 70, 0.95)')
        else {
          g.setLineDash([2, 2])
          outline([p], 'rgba(255, 255, 255, 0.9)')
          g.setLineDash([])
        }
      }
    }

    if (layers.accesses) {
      const pulse = 0.55 + Math.sin(seconds * 3) * 0.2
      const centre = (t: Tile) => [t.tx * TILE + TILE / 2, t.ty * TILE + TILE / 2] as const
      // EXITS: portal tiles, a dashed line to where the player comes back, and the arrival.
      for (const gate of city.gates) {
        for (const t of gate.tiles) {
          fill(t, `rgba(40, 110, 255, ${pulse})`, 1)
          outline([t], 'rgba(200, 225, 255, 1)', 1.5)
        }
        const [ax, ay] = centre(gate.arrival)
        const [px, py] = centre(gate.tiles[0])
        g.setLineDash([3, 3])
        g.strokeStyle = 'rgba(120, 170, 255, 0.9)'
        g.lineWidth = 1
        g.beginPath()
        g.moveTo(px, py)
        g.lineTo(ax, ay)
        g.stroke()
        g.setLineDash([])
        g.fillStyle = 'rgba(120, 200, 255, 0.95)'
        g.beginPath()
        g.arc(ax, ay, 4.5, 0, Math.PI * 2)
        g.fill()
      }
      // ENTRANCES: the door tile of each building, and where the player stands when leaving.
      for (const b of city.buildings) {
        if (!b.door) continue
        fill(b.door, `rgba(255, 150, 20, ${pulse + 0.1})`, 1)
        outline([b.door], 'rgba(255, 235, 180, 1)', 1.5)
        g.setLineDash([2, 2])
        outline([{ tx: b.door.tx, ty: b.door.ty + 1 }], 'rgba(255, 190, 90, 0.95)')
        g.setLineDash([])
      }
    }

    if (layers.markers) {
      for (const r of city.residents) outline([r], 'rgba(255, 80, 220, 0.95)')
      for (const w of city.wanderers) {
        g.strokeStyle = 'rgba(255, 150, 230, 0.95)'
        g.beginPath()
        g.arc(w.tx * TILE + TILE / 2, w.ty * TILE + TILE / 2, 6, 0, Math.PI * 2)
        g.stroke()
      }
      const pulse = 0.55 + Math.sin(seconds * 4) * 0.2
      fill(city.spawn, `rgba(255, 215, 0, ${pulse})`, 1)
    }

    if (s.highlight.length) {
      const pulse = 0.5 + Math.sin(seconds * 6) * 0.3
      for (const t of s.highlight) fill(t, `rgba(255, 120, 0, ${pulse})`)
    }
    if (s.brush) for (const t of s.brush) outline([t], 'rgba(255, 255, 255, 0.95)', 1.5)
    if (s.selection) outline(tilesOf(city, s.selection), 'rgba(255, 235, 60, 1)', 2)
    if (s.ghost) {
      for (const t of s.ghost.tiles) fill(t, s.ghost.valid ? 'rgba(60, 230, 110, 0.55)' : 'rgba(240, 50, 50, 0.6)')
    }
    if (s.hover) outline([s.hover], 'rgba(255, 255, 255, 0.9)')
    g.restore()
  }

  sprites(): readonly OverlaySprite[] {
    return markerSprites(this.input()).map(m => ({ wx: m.wx, wy: m.wy, sprite: m.sprite, alpha: m.alpha }))
  }

  labels(): readonly OverlayLabel[] {
    const s = this.input()
    const out: OverlayLabel[] = []
    if (s.layers.markers) out.push({ wx: s.city.spawn.tx * TILE + TILE / 2, wy: s.city.spawn.ty * TILE + TILE, lift: 30, text: 'PLAYER SPAWN', color: '#ffd84a' })
    if (s.layers.accesses) {
      for (const gate of s.city.gates) {
        const world = WORLDS.find(w => w.id === gate.to)?.name ?? gate.to
        const xs = gate.tiles.map(t => t.tx)
        const cx = ((Math.min(...xs) + Math.max(...xs) + 1) / 2) * TILE
        out.push({ wx: cx, wy: gate.tiles[0].ty * TILE + TILE, lift: 18, text: `SALIDA → ${world}`, color: '#8fc2ff' })
        out.push({ wx: gate.arrival.tx * TILE + TILE / 2, wy: gate.arrival.ty * TILE + TILE, lift: 4, text: `llegada ← ${world}`, color: '#b9dcff' })
      }
      for (const b of s.city.buildings) {
        if (!b.door) continue
        const what = b.feature && isLobbyFeature(b.feature) ? LOBBY_FEATURES[b.feature].title : 'sin función'
        out.push({ wx: b.door.tx * TILE + TILE / 2, wy: b.door.ty * TILE + TILE, lift: 18, text: `ENTRADA · ${what}`, color: '#ffc46b' })
      }
    }
    return out
  }
}

/** Residents, wanderers and the spawn drawn with their real trainer sprites. */
function markerSprites(input: OverlayInputs): (OverlaySprite & { ref: EntityRef })[] {
  if (!input.layers.markers) return []
  const looks = input.npcLooks()
  const feet = (t: Tile) => ({ wx: t.tx * TILE + TILE / 2, wy: t.ty * TILE + TILE - 2 })
  const out: (OverlaySprite & { ref: EntityRef })[] = []
  input.city.residents.forEach((r, i) => {
    // Same look the town populace gives resident i.
    const look = looks[(i + 2) % looks.length]
    if (look) out.push({ ref: { type: 'resident', id: r.id }, ...feet(r), sprite: look[r.dir][0] })
  })
  input.city.wanderers.forEach((w, i) => {
    const look = looks[i % looks.length]
    if (look) out.push({ ref: { type: 'wanderer', id: w.id }, ...feet(w), sprite: look.down[0], alpha: 0.6 })
  })
  const player = input.spawnLook()
  if (player) out.push({ ref: { type: 'spawn', id: 'spawn' }, ...feet(input.city.spawn), sprite: player[input.city.spawn.dir][0], alpha: 0.85 })
  return out
}

/** The marker sprites as pickable things. */
export function markerThings(input: OverlayInputs): DrawnThing[] {
  return markerSprites(input).map(m => ({ ref: m.ref, sprite: m.sprite, x: m.wx, y: m.wy, large: false }))
}

export interface ScreenOverlayInputs {
  things: readonly DrawnThing[]
  bounds: boolean
  selection: EntityRef | null
}

/** Sprite bounds (the art as drawn) on the stacked canvas, in device pixels. */
export function drawScreenOverlay(ctx: CanvasRenderingContext2D, f: FrameGeometry, input: ScreenOverlayInputs): void {
  ctx.clearRect(0, 0, f.width, f.height)
  if (!input.bounds && !input.selection) return
  ctx.lineWidth = Math.max(1, f.dpr)
  for (const t of input.things) {
    const selected = sameRef(t.ref, input.selection)
    if (!input.bounds && !selected) continue
    const r = spriteRect(f, t.sprite, t.x, t.y)
    if (!r || r.x1 < 0 || r.y1 < 0 || r.x0 > f.width || r.y0 > f.height) continue
    ctx.strokeStyle = selected ? '#ffeb3c' : t.ref ? 'rgba(80, 230, 255, 0.85)' : 'rgba(170, 255, 120, 0.55)'
    ctx.lineWidth = (selected ? 2 : 1) * Math.max(1, f.dpr)
    ctx.strokeRect(Math.round(r.x0) + 0.5, Math.round(r.y0) + 0.5, Math.round(r.x1 - r.x0), Math.round(r.y1 - r.y0))
  }
}

/** Frontmost drawn thing under a device-pixel point, honouring the pick order. */
export function thingAt(f: FrameGeometry, things: readonly DrawnThing[], sx: number, sy: number, large: boolean): DrawnThing | null {
  let best: DrawnThing | null = null
  for (const t of things) {
    if (!t.ref || t.large !== large) continue
    const r = spriteRect(f, t.sprite, t.x, t.y)
    if (!r || !contains(r, sx, sy)) continue
    if (!best || t.y >= best.y) best = t
  }
  return best
}
