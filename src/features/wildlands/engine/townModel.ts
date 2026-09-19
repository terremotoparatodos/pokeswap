// Town models — WildLands prototype
//
// Some town pieces are the handheld games' own 3D models (converted by
// scripts/build_town_models.py) instead of flat sprites. They are drawn with
// the scene projector itself, so they keep the perspective of the ground: a
// building to one side of the screen shows the wall that faces the centre,
// exactly as its model has it.
//
// The renderer is Canvas 2D, so each triangle is drawn as its texture mapped
// affinely into the triangle (clip + transform). Triangles are sorted far to
// near from the camera (painter's algorithm); the ground shadow goes first.
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

export interface TownModel {
  readonly data: TownModelData
  readonly textures: readonly CanvasImageSource[]
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

export interface ScreenTriangle {
  readonly material: number
  /** Screen corners and the texture pixels they show. */
  readonly points: readonly [number, number, number, number, number, number]
  readonly uv: readonly [number, number, number, number, number, number]
  /** Distance to the camera (larger is farther). */
  readonly distance: number
}

/**
 * The model's triangles on screen, shadow first, then far to near. A vertex
 * at height h stands above its ground point by h times the projector's scale,
 * the same rule upright sprites follow.
 */
export function projectModel(
  data: TownModelData, at: ModelPlacement, proj: Projector, camX: number, camY: number, eye: { depth: number; height: number },
): ScreenTriangle[] | null {
  const screen: ([number, number] | null)[] = data.vertices.map(([x, y, z]) => {
    const p = proj.project(at.x + x - camX, at.y + z - camY)
    return p ? [p.x, p.y - y * p.scale] : null
  })
  const out: ScreenTriangle[] = []
  for (const t of data.triangles) {
    const [m, a, b, c] = t
    const pa = screen[a], pb = screen[b], pc = screen[c]
    if (!pa || !pb || !pc) return null
    const [vx, vy, vz] = [0, 1, 2].map(k => (data.vertices[a][k] + data.vertices[b][k] + data.vertices[c][k]) / 3)
    // The camera sits `eye.depth` in front of the focus and `eye.height` above the ground.
    const dx = at.x + vx - camX
    const dz = eye.depth - (at.y + vz - camY)
    const dy = eye.height - vy
    out.push({
      material: m,
      points: [pa[0], pa[1], pb[0], pb[1], pc[0], pc[1]],
      uv: [t[4], t[5], t[6], t[7], t[8], t[9]],
      distance: data.materials[m].shadow ? Infinity : dx * dx + dy * dy + dz * dz,
    })
  }
  return out.sort((p, q) => q.distance - p.distance)
}

/**
 * The affine map taking texture pixels (u, v) of a triangle to its screen
 * corners, as canvas `setTransform(a, b, c, d, e, f)` arguments; null for a
 * degenerate texture triangle.
 */
export function textureTransform(points: ScreenTriangle['points'], uv: ScreenTriangle['uv']): [number, number, number, number, number, number] | null {
  const [x0, y0, x1, y1, x2, y2] = points
  const [u0, v0, u1, v1, u2, v2] = uv
  const du1 = u1 - u0, dv1 = v1 - v0, du2 = u2 - u0, dv2 = v2 - v0
  const det = du1 * dv2 - du2 * dv1
  if (Math.abs(det) < 1e-9) return null
  const dx1 = x1 - x0, dy1 = y1 - y0, dx2 = x2 - x0, dy2 = y2 - y0
  const a = (dx1 * dv2 - dx2 * dv1) / det
  const b = (dy1 * dv2 - dy2 * dv1) / det
  const c = (dx2 * du1 - dx1 * du2) / det
  const d = (dy2 * du1 - dy1 * du2) / det
  return [a, b, c, d, x0 - a * u0 - c * v0, y0 - b * u0 - d * v0]
}

/** Grows a screen triangle by `px` from its centre, so neighbours overlap instead of leaving hairline seams. */
function grown(points: ScreenTriangle['points'], px: number): number[] {
  const cx = (points[0] + points[2] + points[4]) / 3
  const cy = (points[1] + points[3] + points[5]) / 3
  const out: number[] = []
  for (let i = 0; i < 6; i += 2) {
    const dx = points[i] - cx, dy = points[i + 1] - cy
    const len = Math.hypot(dx, dy) || 1
    out.push(points[i] + (dx / len) * px, points[i + 1] + (dy / len) * px)
  }
  return out
}

export function drawTownModel(
  ctx: CanvasRenderingContext2D, model: TownModel, at: ModelPlacement, proj: Projector, camX: number, camY: number,
  eye: { depth: number; height: number },
): boolean {
  const tris = projectModel(model.data, at, proj, camX, camY, eye)
  if (!tris) return false
  const smoothing = ctx.imageSmoothingEnabled
  ctx.imageSmoothingEnabled = false
  for (const t of tris) {
    const m = model.data.materials[t.material]
    const tf = textureTransform(t.points, t.uv)
    if (!tf) continue
    const p = m.shadow ? [...t.points] : grown(t.points, 0.6)
    ctx.save()
    ctx.beginPath()
    ctx.moveTo(p[0], p[1])
    ctx.lineTo(p[2], p[3])
    ctx.lineTo(p[4], p[5])
    ctx.closePath()
    ctx.clip()
    ctx.globalAlpha = m.alpha
    ctx.setTransform(...tf)
    ctx.drawImage(model.textures[t.material], 0, 0)
    ctx.restore()
  }
  ctx.imageSmoothingEnabled = smoothing
  return true
}

const models = new Map<string, Promise<TownModel>>()

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
        textures: await Promise.all(data.materials.map(m => new Promise<HTMLImageElement>((resolve, reject) => {
          const img = new Image()
          img.onload = () => resolve(img)
          img.onerror = () => reject(new Error(`model texture ${m.texture}`))
          img.src = dir + m.texture
        }))),
      }))
    models.set(src, pending)
  }
  return pending
}
