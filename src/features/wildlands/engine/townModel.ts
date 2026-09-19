// Town models — WildLands prototype
//
// Some town pieces are the handheld games' own 3D models (converted by
// scripts/build_town_models.py) instead of flat sprites. They are drawn with
// the scene projector itself, so they keep the perspective of the ground: a
// building to one side of the screen shows the wall that faces the centre,
// exactly as its model has it.
//
// Like the DS, a model is rasterized with a depth buffer (sorting triangles
// is not enough for pieces set into each other) and faces turned away from the
// camera are skipped. It is rasterized at its native resolution — one texel
// per world px, as the handheld draws it — into a small buffer, which is then
// scaled onto the screen like every other sprite: crisp pixel art, and cheap.
//
// Model space: x right, y up, z toward the viewer; one unit is one world px.

import type { Projector } from './projection'

export interface TownModelMaterial {
  readonly name: string
  readonly texture: string
  readonly alpha: number
  /** The flat translucent shadow under the model. */
  readonly shadow: boolean
}

export interface TownModelData {
  readonly id: string
  readonly bounds: { readonly x: readonly number[]; readonly y: readonly number[]; readonly z: readonly number[] }
  /** Middle of the solid part across, and its front: where the model meets its footprint. */
  readonly center: number
  readonly front: number
  readonly vertices: readonly (readonly [number, number, number])[]
  readonly materials: readonly TownModelMaterial[]
  /** [material, i0, i1, i2, u0, v0, u1, v1, u2, v2]: texture coordinates in texture pixels. */
  readonly triangles: readonly (readonly number[])[]
}

/** A texture's pixels (RGBA, row by row). */
export interface Texels {
  readonly width: number
  readonly height: number
  readonly data: Uint8ClampedArray
}

export interface TownModel {
  readonly data: TownModelData
  readonly textures: readonly Texels[]
}

/** Where a model stands: its origin in world px (x across, y in depth). */
export interface ModelPlacement {
  readonly x: number
  readonly y: number
}

/** A model standing on a footprint: centred across it, its front on the footprint's front edge. */
export function placeOnFootprint(data: Pick<TownModelData, 'center' | 'front'>, centreX: number, frontY: number): ModelPlacement {
  return { x: centreX - data.center, y: frontY - data.front }
}

/** The camera, relative to the focus: `depth` in front of it, `height` above the ground. */
export interface Eye {
  readonly depth: number
  readonly height: number
}

/**
 * Each vertex on screen: x, y and the projector's scale there (proportional
 * to 1 / depth). A vertex at height h stands above its ground point by
 * h × scale, the rule upright sprites follow. Null if any is behind the camera.
 */
export function projectVertices(
  data: TownModelData, at: ModelPlacement, proj: Projector, camX: number, camY: number,
): Float64Array | null {
  const out = new Float64Array(data.vertices.length * 3)
  for (let i = 0; i < data.vertices.length; i++) {
    const [x, y, z] = data.vertices[i]
    const p = proj.project(at.x + x - camX, at.y + z - camY)
    if (!p) return null
    out[i * 3] = p.x
    out[i * 3 + 1] = p.y - y * p.scale
    out[i * 3 + 2] = p.scale
  }
  return out
}

/** Normal of a model triangle (counter-clockwise from outside) dotted with the direction to the camera. */
export function facing(
  a: readonly number[], b: readonly number[], c: readonly number[], toCamX: number, toCamY: number, toCamZ: number,
): number {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2]
  const wx = c[0] - a[0], wy = c[1] - a[1], wz = c[2] - a[2]
  return (uy * wz - uz * wy) * toCamX + (uz * wx - ux * wz) * toCamY + (ux * wy - uy * wx) * toCamZ
}

/** Triangles the camera sees: the ground shadow always, solid faces only when turned toward it (the models are single-sided). */
export function visibleTriangles(data: TownModelData, at: ModelPlacement, camX: number, camY: number, eye: Eye): number[] {
  const out: number[] = []
  data.triangles.forEach((t, i) => {
    if (data.materials[t[0]].shadow) return out.push(i)
    const [a, b, c] = [data.vertices[t[1]], data.vertices[t[2]], data.vertices[t[3]]]
    const toX = camX - (at.x + (a[0] + b[0] + c[0]) / 3)
    const toY = eye.height - (a[1] + b[1] + c[1]) / 3
    const toZ = camY + eye.depth - (at.y + (a[2] + b[2] + c[2]) / 3)
    if (facing(a, b, c, toX, toY, toZ) > 0) out.push(i)
  })
  return out
}

export interface RasterFrame {
  /** Top-left of the buffer on screen, and screen px per buffer px. */
  readonly x: number
  readonly y: number
  readonly k: number
  readonly width: number
  readonly height: number
}

/** The buffer that holds the projected model at one buffer px per `k` screen px. */
export function rasterFrame(screen: Float64Array, k: number): RasterFrame {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (let i = 0; i < screen.length; i += 3) {
    x0 = Math.min(x0, screen[i]); x1 = Math.max(x1, screen[i])
    y0 = Math.min(y0, screen[i + 1]); y1 = Math.max(y1, screen[i + 1])
  }
  const x = Math.floor(x0 / k) * k
  const y = Math.floor(y0 / k) * k
  return { x, y, k, width: Math.ceil((x1 - x) / k) + 1, height: Math.ceil((y1 - y) / k) + 1 }
}

/**
 * Rasterizes the given triangles into RGBA pixels with a depth buffer and
 * perspective-correct texture coordinates. Solid texels under half alpha are
 * holes; the shadow only fills pixels no solid face covers, at its alpha.
 */
export function rasterize(
  model: TownModel, screen: Float64Array, triangles: readonly number[], frame: RasterFrame,
  out = new Uint8ClampedArray(frame.width * frame.height * 4),
): Uint8ClampedArray {
  const { width: W, height: H, k } = frame
  out.fill(0)
  const nearest = new Float32Array(W * H) // 1 / depth of the nearest solid texel so far (0 = none)
  const { data } = model
  for (const index of triangles) {
    const t = data.triangles[index]
    const mat = data.materials[t[0]]
    const tex = model.textures[t[0]]
    const [ia, ib, ic] = [t[1] * 3, t[2] * 3, t[3] * 3]
    const ax = (screen[ia] - frame.x) / k, ay = (screen[ia + 1] - frame.y) / k, az = screen[ia + 2]
    const bx = (screen[ib] - frame.x) / k, by = (screen[ib + 1] - frame.y) / k, bz = screen[ib + 2]
    const cx = (screen[ic] - frame.x) / k, cy = (screen[ic + 1] - frame.y) / k, cz = screen[ic + 2]
    const area = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay)
    if (Math.abs(area) < 1e-9) continue
    const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx)))
    const maxX = Math.min(W - 1, Math.ceil(Math.max(ax, bx, cx)))
    const minY = Math.max(0, Math.floor(Math.min(ay, by, cy)))
    const maxY = Math.min(H - 1, Math.ceil(Math.max(ay, by, cy)))
    for (let py = minY; py <= maxY; py++) {
      const qy = py + 0.5
      for (let px = minX; px <= maxX; px++) {
        const qx = px + 0.5
        const w0 = ((bx - qx) * (cy - qy) - (cx - qx) * (by - qy)) / area
        const w1 = ((cx - qx) * (ay - qy) - (ax - qx) * (cy - qy)) / area
        const w2 = 1 - w0 - w1
        if (w0 < -1e-4 || w1 < -1e-4 || w2 < -1e-4) continue
        const iz = w0 * az + w1 * bz + w2 * cz
        const o = py * W + px
        if (!mat.shadow && iz <= nearest[o]) continue
        if (mat.shadow && nearest[o] > 0) continue
        const u = (w0 * t[4] * az + w1 * t[6] * bz + w2 * t[8] * cz) / iz
        const v = (w0 * t[5] * az + w1 * t[7] * bz + w2 * t[9] * cz) / iz
        const tx = Math.min(tex.width - 1, Math.max(0, Math.floor(u)))
        const ty = Math.min(tex.height - 1, Math.max(0, Math.floor(v)))
        const s = (ty * tex.width + tx) * 4
        const alpha = tex.data[s + 3]
        if (mat.shadow) {
          out[o * 4] = tex.data[s]; out[o * 4 + 1] = tex.data[s + 1]; out[o * 4 + 2] = tex.data[s + 2]
          out[o * 4 + 3] = Math.round(alpha * mat.alpha)
          continue
        }
        if (alpha < 128) continue
        nearest[o] = iz
        out[o * 4] = tex.data[s]; out[o * 4 + 1] = tex.data[s + 1]; out[o * 4 + 2] = tex.data[s + 2]
        out[o * 4 + 3] = 255
      }
    }
  }
  return out
}

interface Surface {
  canvas: HTMLCanvasElement
  image: ImageData | null
}

const surfaces = new WeakMap<ModelPlacement, Surface>()

/** Draws a placed model: rasterized at native resolution (one texel per world px at its front), then scaled. */
export function drawTownModel(
  ctx: CanvasRenderingContext2D, model: TownModel, at: ModelPlacement, proj: Projector, camX: number, camY: number, eye: Eye,
): boolean {
  const screen = projectVertices(model.data, at, proj, camX, camY)
  const front = proj.project(at.x + model.data.center - camX, at.y + model.data.front - camY)
  if (!screen || !front) return false
  const frame = rasterFrame(screen, front.scale)
  if (frame.width <= 0 || frame.height <= 0 || frame.width > 1024 || frame.height > 1024) return false
  let surface = surfaces.get(at)
  if (!surface) {
    surface = { canvas: document.createElement('canvas'), image: null }
    surfaces.set(at, surface)
  }
  const g = surface.canvas.getContext('2d')
  if (!g) return false
  if (!surface.image || surface.image.width !== frame.width || surface.image.height !== frame.height) {
    surface.canvas.width = frame.width
    surface.canvas.height = frame.height
    surface.image = g.createImageData(frame.width, frame.height)
  }
  rasterize(model, screen, visibleTriangles(model.data, at, camX, camY, eye), frame, surface.image.data)
  g.putImageData(surface.image, 0, 0)
  const smoothing = ctx.imageSmoothingEnabled
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(surface.canvas, Math.round(frame.x), Math.round(frame.y), Math.round(frame.width * frame.k), Math.round(frame.height * frame.k))
  ctx.imageSmoothingEnabled = smoothing
  return true
}

const models = new Map<string, Promise<TownModel>>()

function texelsOf(img: HTMLImageElement): Texels {
  const canvas = document.createElement('canvas')
  canvas.width = img.width
  canvas.height = img.height
  const g = canvas.getContext('2d')!
  g.drawImage(img, 0, 0)
  return { width: img.width, height: img.height, data: g.getImageData(0, 0, img.width, img.height).data }
}

/** Loads a converted model and its textures once per URL. */
export function loadTownModel(src: string): Promise<TownModel> {
  let pending = models.get(src)
  if (!pending) {
    const dir = src.slice(0, src.lastIndexOf('/') + 1)
    pending = fetch(src)
      .then(r => {
        if (!r.ok) throw new Error(`model ${src}: ${r.status}`)
        return r.json() as Promise<TownModelData>
      })
      .then(async data => ({
        data,
        textures: await Promise.all(data.materials.map(m => new Promise<Texels>((resolve, reject) => {
          const img = new Image()
          img.onload = () => resolve(texelsOf(img))
          img.onerror = () => reject(new Error(`model texture ${m.texture}`))
          img.src = dir + m.texture
        }))),
      }))
    models.set(src, pending)
  }
  return pending
}
