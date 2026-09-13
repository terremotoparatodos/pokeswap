// Sprite primitives — WildLands prototype
//
// Props are not hand-drawn: they are shaded volumes (ellipses and capsules lit
// from the top-left), quantised to a short palette with ordered dithering and
// finished with a 1px outline. That recipe is what gives the handheld look.

import { bayer, packColor, pixelsToCanvas, TRANSPARENT } from './pixels'

export interface Sprite {
  canvas: HTMLCanvasElement
  /** Black silhouette used for projected ground shadows. */
  shadow: HTMLCanvasElement
  w: number
  h: number
  /** Anchor (feet) inside the sprite, in sprite pixels. */
  ax: number
  ay: number
  /** First opaque row, when the art does not start at the top of its cell. */
  top?: number
  /**
   * Rows from the top that depict a horizontal surface (a roof seen from
   * above). The renderer squashes them with the camera tilt, like the ground,
   * while the rows below (the façade) stay upright.
   */
  flatTop?: number
  /** Set false for sprites too large for a projected silhouette shadow. */
  castShadow?: boolean
}

export function silhouette(source: CanvasImageSource, w: number, h: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(source, 0, 0, w, h)
  ctx.globalCompositeOperation = 'source-in'
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, w, h)
  return canvas
}

/**
 * Sprite from a PNG drawn in the handheld oblique view (roof on top, façade
 * below). `flatTop` is the row where the roof ends, so the renderer can
 * squash the roof with the camera tilt and keep the façade upright.
 */
export interface ImageSpriteOptions {
  /** Roof rows, or 'all' for pieces drawn fully from above (benches, gate houses). */
  flatTop?: number | 'all'
  castShadow?: boolean
}

const imageSprites = new Map<string, Promise<Sprite>>()

/** Cached per source and options, so repeated props share one canvas. */
export function loadImageSprite(src: string, options: ImageSpriteOptions = {}): Promise<Sprite> {
  const key = `${src}|${options.flatTop ?? ''}|${options.castShadow ?? ''}`
  let pending = imageSprites.get(key)
  if (!pending) {
    pending = new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => {
        const canvas = document.createElement('canvas')
        canvas.width = img.width
        canvas.height = img.height
        canvas.getContext('2d')!.drawImage(img, 0, 0)
        resolve({
          canvas, shadow: silhouette(canvas, img.width, img.height), w: img.width, h: img.height,
          ax: img.width / 2, ay: img.height - 1,
          flatTop: options.flatTop === 'all' ? img.height : options.flatTop,
          castShadow: options.castShadow,
        })
      }
      img.onerror = () => reject(new Error(`sprite ${src}`))
      img.src = src
    })
    imageSprites.set(key, pending)
  }
  return pending
}

export function spriteFromPixels(w: number, h: number, pixels: Uint32Array, ax: number, ay: number): Sprite {
  const canvas = pixelsToCanvas(w, h, pixels)
  return { canvas, shadow: silhouette(canvas, w, h), w, h, ax, ay }
}

/** A lit volume: returns brightness in [0, 1] for covered pixels, or null. */
export type ShadeFn = (x: number, y: number) => number | null

const LIGHT = { x: -0.55, y: -0.62, z: 0.56 }

function lit(nx: number, ny: number): number {
  const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny))
  const b = nx * LIGHT.x + ny * LIGHT.y + nz * LIGHT.z
  return Math.min(1, Math.max(0, (b + 0.25) / 1.2))
}

/** Union of ellipses [cx, cy, rx, ry]; the ellipse a pixel is deepest inside decides its normal. */
export function ellipses(list: readonly (readonly [number, number, number, number])[]): ShadeFn {
  return (x, y) => {
    let best = -1
    let brightness = 0
    for (const [cx, cy, rx, ry] of list) {
      const nx = (x + 0.5 - cx) / rx
      const ny = (y + 0.5 - cy) / ry
      const depth = 1 - (nx * nx + ny * ny)
      if (depth >= 0 && depth > best) {
        best = depth
        brightness = lit(nx, ny)
      }
    }
    return best >= 0 ? brightness : null
  }
}

/** Union of capsules [x0, y0, x1, y1, radius] — cylinders for cacti, coral, trunks. */
export function capsules(list: readonly (readonly [number, number, number, number, number])[]): ShadeFn {
  return (x, y) => {
    let best = -1
    let brightness = 0
    const px = x + 0.5
    const py = y + 0.5
    for (const [x0, y0, x1, y1, r] of list) {
      const dx = x1 - x0
      const dy = y1 - y0
      const len2 = dx * dx + dy * dy || 1
      const t = Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / len2))
      const nx = (px - (x0 + dx * t)) / r
      const ny = (py - (y0 + dy * t)) / r
      const depth = 1 - (nx * nx + ny * ny)
      if (depth >= 0 && depth > best) {
        best = depth
        brightness = lit(nx, ny * 0.6)
      }
    }
    return best >= 0 ? brightness : null
  }
}

export interface ShadeOptions {
  tones: readonly string[]
  outline: string
  /** Dither strength; 0 gives hard bands. */
  dither?: number
}

/** Rasterises a shade function into a pixel buffer with palette quantisation and outline. */
export function shade(w: number, h: number, fn: ShadeFn, options: ShadeOptions): Uint32Array {
  const tones = options.tones.map(t => packColor(t))
  const outline = packColor(options.outline)
  const dither = options.dither ?? 0.8
  const inside = new Float32Array(w * h).fill(-1)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const b = fn(x, y)
      if (b !== null) inside[y * w + x] = b
    }
  }
  const out = new Uint32Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const b = inside[y * w + x]
      if (b >= 0) {
        const level = Math.round(b * (tones.length - 1) + (bayer(x, y) - 0.5) * dither)
        out[y * w + x] = tones[Math.max(0, Math.min(tones.length - 1, level))]
        continue
      }
      const near =
        (x > 0 && inside[y * w + x - 1] >= 0) || (x < w - 1 && inside[y * w + x + 1] >= 0) ||
        (y > 0 && inside[(y - 1) * w + x] >= 0) || (y < h - 1 && inside[(y + 1) * w + x] >= 0)
      out[y * w + x] = near ? outline : TRANSPARENT
    }
  }
  return out
}

/** Paints `top` over `base` (same size), skipping transparent pixels. */
export function layer(base: Uint32Array, top: Uint32Array): Uint32Array {
  for (let i = 0; i < base.length; i++) if (top[i] !== TRANSPARENT) base[i] = top[i]
  return base
}

/** Parses an ASCII pixel grid; '.' is transparent, other characters index `palette`. */
export function fromAscii(rows: readonly string[], palette: Record<string, string>, mirror = false): {
  w: number; h: number; pixels: Uint32Array
} {
  const w = Math.max(...rows.map(r => r.length))
  const h = rows.length
  const packed: Record<string, number> = {}
  for (const [k, v] of Object.entries(palette)) packed[k] = packColor(v)
  const pixels = new Uint32Array(w * h)
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x]
      if (ch === '.' || !(ch in packed)) continue
      pixels[y * w + (mirror ? w - 1 - x : x)] = packed[ch]
    }
  })
  return { w, h, pixels }
}
