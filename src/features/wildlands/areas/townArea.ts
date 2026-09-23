// Town area — WildLands prototype
//
// A hand-laid map built entirely with the engine's own art: a terrain grid
// baked into ground, buildings sized to their footprints, street furniture,
// forest trees, standing residents with lines, a few wanderers, plazas for the
// owned Pokémon (townPopulace.ts) and gates to the worlds.

import type { Arrival, Area, AreaId, Populace, PopulaceContext, Portal } from '../engine/area'
import { buildingSprite, type BuildingSpec } from '../engine/buildings'
import type { Dir } from '../engine/characters'
import type { DecorInstance } from '../engine/chunks'
import { buildingDoors, doorAt, type BuildingDoor } from '../engine/doors'
import type { Tile } from '../engine/pathfinding'
import { packColor, pixelsToCanvas } from '../engine/pixels'
import type { LensName } from '../engine/projection'
import { buildPropSprites } from '../engine/props'
import { bakeTownGround, type TileRect } from '../engine/townGround'
import { buildTownProps, fencePiece, fencePosts, fenceTileArt, townPropFeet, townPropTiles, type TownPropKind } from '../engine/townProps'
import { TILE } from '../engine/world'
import { loadImageSprite } from '../engine/sprite'
import { devWarn } from '../../../shared/utils/devTools'
import type { LobbyFeature } from '../lobby/features'
import { TownPopulace } from './townPopulace'

export interface TownGate extends Portal {
  /** Where the player stands when coming back through this gate. */
  arrival: Arrival
}

export interface TownBuilding extends BuildingSpec {
  id: string
  name: string
  /** Top-left tile of the footprint. */
  x: number
  y: number
  /** Footprint tiles that stay walkable (e.g. entrance stairs). */
  open?: readonly Tile[]
  /** Shown when the player faces the building. */
  blurb?: string
  /** Hand-drawn sprite; replaces the code-painted building once loaded. */
  image?: ArtImage
  /** Walkable threshold on the bottom row of the footprint; stepping on it enters. */
  door?: Tile
  /** PokeSwap function opened by entering (requires `door`). */
  feature?: LobbyFeature
}

/** A hand-drawn PNG and where its roof (seen from above) ends. */
export interface ArtImage {
  src: string
  flatTop?: number | 'all'
  /** Source-model metadata retained for art tooling; runtime uses the 2D façade. */
  model?: string
}

/** Autotiled fence art (engine/townProps.ts → fencePiece, fenceTileArt, fencePosts). */
export interface FenceArt {
  h?: ArtImage
  /** A run's end picket, with no rail past it. */
  cornerLeft?: ArtImage
  cornerRight?: ArtImage
  /** One upright post; vertical runs stand one every 8 px. */
  post?: ArtImage
}

/**
 * Hand-drawn art for a town. Anything listed here replaces the code-painted
 * fallback once its image loads; variants are picked per tile so rows of the
 * same prop don't look stamped.
 */
export interface TownArtSet {
  trees?: readonly string[]
  fountains?: readonly ArtImage[]
  props?: Partial<Record<TownPropKind, readonly ArtImage[]>>
  /** Autotiled fences; without them, `props.fenceH/fenceV` art (or the code-painted pieces) is used per tile. */
  fences?: FenceArt
  /** Source-model metadata retained for art tooling; runtime uses pre-rendered sprites. */
  models?: Partial<Record<TownPropKind, string>>
}

export interface TownProp extends Tile {
  /** `tx, ty` is the top-left tile of the prop's footprint (benches cover two tiles). */
  kind: TownPropKind
  /** What a sign says. */
  text?: string
  /** This sign is the activity board: facing or tapping it opens the board. */
  board?: boolean
}

export interface TownResident extends Tile {
  dir: Dir
  lines: readonly string[]
}

export interface TownDef {
  id: AreaId
  name: string
  lens?: LensName
  /** Rows of s (street), g (grass), p (plaza), t (forest). */
  terrain: readonly string[]
  buildings: readonly TownBuilding[]
  fountains: readonly TileRect[]
  props: readonly TownProp[]
  gates: readonly TownGate[]
  spawn: Arrival
  residents: readonly TownResident[]
  wanderers: readonly Tile[]
  /** Where owned Pokémon get their home tiles (R26). */
  plazaZones?: readonly TileRect[]
  art?: TownArtSet
  /** Raised city blocks (visual only): sidewalk paving with a curb around their union. */
  plots?: readonly TileRect[]
}

const SOLID_PROPS = new Set<TownPropKind>(['lamp', 'sign', 'hedge', 'fenceH', 'fenceV', 'bench', 'benchLeft'])
interface TownArt {
  ground: HTMLCanvasElement
  decor: DecorInstance[]
}

export class TownArea implements Area {
  readonly kind = 'town' as const
  readonly id: AreaId
  readonly name: string
  readonly lens: LensName
  readonly portals: readonly TownGate[]
  readonly doors: readonly BuildingDoor[]
  readonly def: TownDef
  readonly width: number
  readonly height: number
  private readonly solid: Uint8Array
  private art: TownArt | null = null
  private reachable: Uint8Array | null = null

  constructor(def: TownDef) {
    this.def = def
    this.id = def.id
    this.name = def.name
    this.lens = def.lens ?? 'handheld'
    this.portals = def.gates
    this.doors = buildingDoors(def.buildings)
    this.width = def.terrain[0].length
    this.height = def.terrain.length
    this.solid = this.buildCollision()
  }

  private buildCollision(): Uint8Array {
    const { def, width, height } = this
    const solid = new Uint8Array(width * height)
    const mark = (tx: number, ty: number, value: number) => {
      if (tx >= 0 && ty >= 0 && tx < width && ty < height) solid[ty * width + tx] = value
    }
    for (let ty = 0; ty < height; ty++) {
      for (let tx = 0; tx < width; tx++) if (def.terrain[ty][tx] === 't') mark(tx, ty, 1)
    }
    for (const b of def.buildings) {
      for (let ty = b.y; ty < b.y + b.d; ty++) for (let tx = b.x; tx < b.x + b.w; tx++) mark(tx, ty, 1)
      for (const t of b.open ?? []) mark(t.tx, t.ty, 0)
      if (b.door) mark(b.door.tx, b.door.ty, 0)
    }
    for (const f of def.fountains) {
      for (let ty = f.y0; ty <= f.y1; ty++) for (let tx = f.x0; tx <= f.x1; tx++) mark(tx, ty, 1)
    }
    for (const p of def.props) if (SOLID_PROPS.has(p.kind)) for (const t of townPropTiles(p)) mark(t.tx, t.ty, 1)
    for (const gate of def.gates) for (const t of gate.tiles) mark(t.tx, t.ty, 0)
    return solid
  }

  /** Bakes ground and builds sprites on first use (needs a DOM canvas). */
  private ensureArt(): TownArt {
    if (this.art) return this.art
    const { def, width, height } = this
    const art = def.art ?? {}
    const decor: DecorInstance[] = []
    const add = (d: Omit<DecorInstance, 'seed'>) => decor.push({ seed: 0, ...d })
    /** Adds a decor entry drawn in code now and swapped for `image` when it loads. */
    const addWithArt = (d: Omit<DecorInstance, 'seed'>, image: ArtImage | undefined, castShadow?: boolean): Promise<void> => {
      add(d)
      if (!image) return Promise.resolve()
      const entry = decor[decor.length - 1]
      return loadImageSprite(image.src, { flatTop: image.flatTop, castShadow })
        .then(sprite => { entry.sprite = sprite })
        .catch(error => devWarn(`[wildlands] art ${image.src} unavailable`, error))
    }
    const variant = <V>(list: readonly V[] | undefined, a: number, b: number): V | undefined =>
      list?.length ? list[Math.abs(a * 7 + b * 13) % list.length] : undefined

    // Forest: a full tree on 2×2 blocks that are (almost) all forest; ragged edges
    // get bushes so canopies never spill over walkable tiles.
    const { tree, bush } = buildPropSprites()
    const forest = (tx: number, ty: number) => def.terrain[ty]?.[tx] === 't'
    for (let by = 0; by < height; by += 2) {
      for (let bx = 0; bx < width; bx += 2) {
        const cells = [[bx, by], [bx + 1, by], [bx, by + 1], [bx + 1, by + 1]].filter(([x, y]) => forest(x, y))
        if (cells.length >= 3) {
          const jitter = ((bx * 7 + by * 13) % 5) - 2
          const image = variant(art.trees, bx, by)
          addWithArt(
            { kind: null, sprite: tree, tx: bx, ty: by + 1, x: (bx + 1) * TILE + jitter, y: (by + 2) * TILE - 2 },
            image ? { src: image } : undefined,
          )
        } else {
          for (const [x, y] of cells) {
            addWithArt(
              { kind: null, sprite: bush, tx: x, ty: y, x: x * TILE + TILE / 2, y: y * TILE + 14 },
              variant(art.props?.hedge, x, y),
            )
          }
        }
      }
    }
    const town = buildTownProps()
    const fences = new Map<string, 'h' | 'v'>()
    for (const p of def.props) if (p.kind === 'fenceH' || p.kind === 'fenceV') fences.set(`${p.tx},${p.ty}`, p.kind === 'fenceH' ? 'h' : 'v')
    const fenceAt = (tx: number, ty: number) => fences.get(`${tx},${ty}`) ?? null
    for (const p of def.props) {
      const at = { kind: null, tx: p.tx, ty: p.ty, x: p.tx * TILE + TILE / 2, y: p.ty * TILE + 14, light: p.kind === 'lamp' }
      if ((p.kind === 'fenceH' || p.kind === 'fenceV') && art.fences) {
        const piece = fencePiece(fenceAt, p.tx, p.ty)
        const tileArt = fenceTileArt(piece)
        if (tileArt) addWithArt({ ...at, sprite: town.fenceH }, art.fences[tileArt])
        for (const post of fencePosts(piece, p.tx, p.ty)) addWithArt({ ...at, sprite: town.fenceV, ...post }, art.fences.post)
        continue
      }
      const feet = townPropFeet(p)
      addWithArt({ ...at, sprite: town[p.kind], ty: feet.ty, x: feet.x, y: feet.y }, variant(art.props?.[p.kind], p.tx, p.ty))
    }
    def.fountains.forEach((f, i) => {
      const at = { tx: f.x0, ty: f.y0, x: ((f.x0 + f.x1 + 1) / 2) * TILE }
      const image = art.fountains?.[i % art.fountains.length]
      if (image) addWithArt({ kind: null, sprite: town.spray, ...at, y: (f.y1 + 1) * TILE - 1 }, image, false)
      else add({ kind: null, sprite: town.spray, ...at, y: ((f.y0 + f.y1 + 1) / 2) * TILE + 2 })
    })
    const buildingEntries: { entry: DecorInstance; depth: number }[] = []
    const buildingArt = def.buildings.map(b => {
      const loaded = addWithArt(
        { kind: null, sprite: buildingSprite(b), tx: b.x, ty: b.y + b.d - 1, x: (b.x + b.w / 2) * TILE, y: (b.y + b.d) * TILE - 1 },
        b.image,
        false,
      )
      const entry = decor[decor.length - 1]
      buildingEntries.push({ entry, depth: b.d * TILE })
      return loaded
    })

    // Ground dressing follows the sprites actually drawn, so bake now with the
    // code-painted fallbacks and again once the hand-drawn buildings arrive.
    // Hand-drawn fountains bring their own basin, so the baked one is skipped.
    const bakedFountains = art.fountains?.length ? [] : def.fountains
    const plotTiles: Tile[] = []
    for (const r of def.plots ?? []) {
      for (let ty = r.y0; ty <= r.y1; ty++) for (let tx = r.x0; tx <= r.x1; tx++) plotTiles.push({ tx, ty })
    }
    const plotSet = new Set(plotTiles.map(t => `${t.tx},${t.ty}`))
    const bake = () => pixelsToCanvas(width * TILE, height * TILE, bakeTownGround(def.terrain, bakedFountains, {
      plots: plotTiles,
      buildings: buildingEntries.map(({ entry, depth }) => {
        const s = entry.sprite!
        const x0 = Math.round(entry.x - s.ax)
        const y1 = entry.y + 1
        // Buildings standing on a plot already have a sidewalk; the rest get an apron.
        const apron = !plotSet.has(`${entry.tx},${entry.ty}`)
        return { x0, x1: x0 + s.w, y0: y1 - depth, y1, apron }
      }),
      beds: def.props.filter(p => p.kind === 'hedge'),
      posts: def.props.filter(p => p.kind === 'lamp' || p.kind === 'sign').map(p => ({ x: p.tx * TILE + TILE / 2, y: p.ty * TILE + 14 })),
    }))
    this.art = { ground: bake(), decor }
    void Promise.all(buildingArt).then(() => {
      if (this.art) this.art.ground = bake()
    })
    return this.art
  }

  isSolid(tx: number, ty: number): boolean {
    if (tx < 0 || ty < 0 || tx >= this.width || ty >= this.height) return true
    return this.solid[ty * this.width + tx] === 1
  }

  isReachable(tx: number, ty: number): boolean {
    if (this.isSolid(tx, ty)) return false
    return this.reachableTiles()[ty * this.width + tx] === 1
  }

  /** Orthogonal flood fill from the spawn over the static collision map, computed once. */
  private reachableTiles(): Uint8Array {
    if (this.reachable) return this.reachable
    const { width } = this
    const seen = new Uint8Array(width * this.height)
    const start = this.def.spawn
    const queue = [start.ty * width + start.tx]
    seen[queue[0]] = 1
    for (let i = 0; i < queue.length; i++) {
      const tx = queue[i] % width
      const ty = (queue[i] - tx) / width
      for (const [nx, ny] of [[tx + 1, ty], [tx - 1, ty], [tx, ty + 1], [tx, ty - 1]]) {
        if (this.isSolid(nx, ny) || seen[ny * width + nx]) continue
        seen[ny * width + nx] = 1
        queue.push(ny * width + nx)
      }
    }
    this.reachable = seen
    return seen
  }

  isWater(): boolean {
    return false
  }

  placeName(): string {
    return this.name
  }

  arrival(from: AreaId | null): Arrival {
    return this.portals.find(g => g.to === from)?.arrival ?? this.def.spawn
  }

  drawGround(g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number): void {
    g.fillStyle = '#3a6634'
    g.fillRect(0, 0, x1 - x0, y1 - y0)
    g.drawImage(this.ensureArt().ground, -x0, -y0)
  }

  decorIn(x0: number, y0: number, x1: number, y1: number): readonly DecorInstance[] {
    // Tall buildings standing below the view can still reach into it.
    return this.ensureArt().decor.filter(d => d.x > x0 - 96 && d.x < x1 + 96 && d.y > y0 && d.y < y1 + 180)
  }

  createPopulace(context: PopulaceContext): Populace {
    return new TownPopulace(this, context)
  }

  weather() {
    return { kind: 'clear' as const, intensity: 0 }
  }

  /** Signs read their text; buildings introduce themselves. */
  talkAt(tx: number, ty: number): string | null {
    const sign = this.def.props.find(p => p.kind === 'sign' && p.tx === tx && p.ty === ty)
    if (sign) return sign.text ?? 'Ciudad Corazón · Donde los corazones se encuentran'
    const building = this.def.buildings.find(b => tx >= b.x && tx < b.x + b.w && ty >= b.y && ty < b.y + b.d)
    if (building) return building.blurb ? `${building.name} · ${building.blurb}` : building.name
    return null
  }

  noticeBoardAt(tx: number, ty: number): boolean {
    return this.def.props.some(p => p.board && p.tx === tx && p.ty === ty)
  }

  collect(): boolean {
    return false
  }

  paintMinimap(canvas: HTMLCanvasElement, tx: number, ty: number): void {
    const size = 64
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')!
    const image = ctx.createImageData(size, size)
    const out = new Uint32Array(image.data.buffer)
    const colors: Record<string, number> = {
      s: packColor('#d4b886'), g: packColor('#74c24f'), p: packColor('#b8c0d8'), t: packColor('#2f6a36'),
    }
    const oy = Math.floor((size - this.height) / 2)
    out.fill(colors.t)
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width && x < size; x++) out[(y + oy) * size + x] = colors[this.def.terrain[y][x]]
    }
    const roof = packColor('#c05a3a')
    for (const b of this.def.buildings) {
      for (let y = b.y; y < b.y + b.d; y++) for (let x = b.x; x < b.x + b.w; x++) out[(y + oy) * size + x] = roof
    }
    ctx.putImageData(image, 0, 0)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(tx - 1, ty + oy - 1, 3, 3)
    ctx.fillStyle = '#e03c3c'
    ctx.fillRect(tx, ty + oy, 1, 1)
  }

  tick(): void {}

  /** Nearest walkable tile to `tile` within a small radius, off gates and doors. */
  nearestOpen(tile: Tile): Tile {
    const portal = (tx: number, ty: number) => this.portals.some(g => g.tiles.some(t => t.tx === tx && t.ty === ty))
    for (let r = 0; r < 8; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue
          const tx = tile.tx + dx
          const ty = tile.ty + dy
          if (!this.isSolid(tx, ty) && !portal(tx, ty) && !doorAt(this.doors, tx, ty)) return { tx, ty }
        }
      }
    }
    return tile
  }
}
