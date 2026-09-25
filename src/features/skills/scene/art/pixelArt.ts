// Pixel art buffers for the R31-C1 mining asset kit.
//
// Art is built as plain RGBA buffers with the same primitives WildLands uses
// for its props (shade, layer, packColor), so builders are pure and testable.
// Canvases are created only when the renderer or the UI asks for them.

import { packColor, pixelsToCanvas, TRANSPARENT } from '../../../wildlands/engine/pixels'
import { silhouette, type Sprite } from '../../../wildlands/engine/sprite'

export interface PixelArt {
  readonly w: number
  readonly h: number
  readonly pixels: Uint32Array
  /** Anchor (feet or pivot) in art pixels. */
  readonly ax: number
  readonly ay: number
}

export function pixelArt(w: number, h: number, pixels: Uint32Array = new Uint32Array(w * h), ax = Math.floor(w / 2), ay = h - 1): PixelArt {
  return { w, h, pixels, ax, ay }
}

export const color = (hex: string, alpha = 255): number => packColor(hex, alpha)

export function channels(value: number): [number, number, number, number] {
  return [value & 255, (value >>> 8) & 255, (value >>> 16) & 255, value >>> 24]
}

export function fromChannels(r: number, g: number, b: number, a: number): number {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)))
  return ((clamp(a) << 24) | (clamp(b) << 16) | (clamp(g) << 8) | clamp(r)) >>> 0
}

export function mapColors(art: PixelArt, fn: (r: number, g: number, b: number, a: number) => [number, number, number, number]): PixelArt {
  const pixels = new Uint32Array(art.pixels.length)
  art.pixels.forEach((value, i) => {
    pixels[i] = value === TRANSPARENT ? TRANSPARENT : fromChannels(...fn(...channels(value)))
  })
  return { ...art, pixels }
}

/** Mix every opaque pixel toward white by `amount` (hit flash). */
export function brighten(art: PixelArt, amount: number): PixelArt {
  return mapColors(art, (r, g, b, a) => [r + (255 - r) * amount, g + (255 - g) * amount, b + (255 - b) * amount, a])
}

/** Mix toward grey (locked or retired variants). */
export function desaturate(art: PixelArt, amount: number, darken = 0): PixelArt {
  return mapColors(art, (r, g, b, a) => {
    const grey = r * 0.3 + g * 0.59 + b * 0.11
    const k = 1 - darken
    return [(r + (grey - r) * amount) * k, (g + (grey - g) * amount) * k, (b + (grey - b) * amount) * k, a]
  })
}

export function mirror(art: PixelArt): PixelArt {
  const pixels = new Uint32Array(art.pixels.length)
  for (let y = 0; y < art.h; y++) {
    for (let x = 0; x < art.w; x++) pixels[y * art.w + (art.w - 1 - x)] = art.pixels[y * art.w + x]
  }
  return { ...art, pixels, ax: art.w - 1 - art.ax }
}

/** Copies opaque pixels of `source` onto `target` (size tw × th) at (x, y). */
export function stamp(target: Uint32Array, tw: number, th: number, source: PixelArt, x: number, y: number): void {
  for (let sy = 0; sy < source.h; sy++) {
    for (let sx = 0; sx < source.w; sx++) {
      const value = source.pixels[sy * source.w + sx]
      const tx = x + sx
      const ty = y + sy
      if (value === TRANSPARENT || tx < 0 || ty < 0 || tx >= tw || ty >= th) continue
      target[ty * tw + tx] = value
    }
  }
}

/** Rebuilds a 1px outline after pixels were carved away or added. */
export function reoutline(pixels: Uint32Array, w: number, h: number, outline: number): void {
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && pixels[y * w + x] !== TRANSPARENT && pixels[y * w + x] !== outline
  const next = new Uint32Array(pixels)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (pixels[i] !== TRANSPARENT && pixels[i] !== outline) continue
      const touching = inside(x - 1, y) || inside(x + 1, y) || inside(x, y - 1) || inside(x, y + 1)
      next[i] = touching ? outline : TRANSPARENT
    }
  }
  pixels.set(next)
}

export function upscale(art: PixelArt, scale: number): PixelArt {
  const s = Math.max(1, Math.floor(scale))
  if (s === 1) return art
  const w = art.w * s
  const h = art.h * s
  const pixels = new Uint32Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) pixels[y * w + x] = art.pixels[Math.floor(y / s) * art.w + Math.floor(x / s)]
  }
  return { w, h, pixels, ax: art.ax * s, ay: art.ay * s }
}

export function opaqueCount(art: PixelArt): number {
  let count = 0
  for (const value of art.pixels) if (value !== TRANSPARENT) count++
  return count
}

export function hasColor(art: PixelArt, value: number): boolean {
  return art.pixels.includes(value)
}

// ── Canvas bridges (browser only) ───────────────────────────────────────────

const sprites = new WeakMap<PixelArt, Sprite>()

/** Engine sprite for this art; cached so every node of a kind shares one canvas. */
export function toSprite(art: PixelArt, castShadow = true): Sprite {
  let sprite = sprites.get(art)
  if (!sprite) {
    const canvas = pixelsToCanvas(art.w, art.h, art.pixels)
    sprite = { canvas, shadow: silhouette(canvas, art.w, art.h), w: art.w, h: art.h, ax: art.ax, ay: art.ay, castShadow }
    sprites.set(art, sprite)
  }
  return sprite
}

const urls = new WeakMap<PixelArt, Map<number, string>>()

/** PNG data URL of the art scaled by an integer factor, for pixel-perfect UI icons. */
export function toDataUrl(art: PixelArt, scale = 1): string {
  let byScale = urls.get(art)
  if (!byScale) urls.set(art, (byScale = new Map()))
  let url = byScale.get(scale)
  if (!url) {
    const big = upscale(art, scale)
    url = pixelsToCanvas(big.w, big.h, big.pixels).toDataURL('image/png')
    byScale.set(scale, url)
  }
  return url
}
