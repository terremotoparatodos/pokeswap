// Pixel painter — WildLands prototype
//
// Small immediate-mode helpers for authoring larger pixel-art sprites
// (buildings, street furniture) in code: rects, lines, shapes by predicate,
// ordered dithering and an automatic 1px outline.

import { bayer, packColor, TRANSPARENT } from './pixels'
import { silhouette, type Sprite } from './sprite'
import { pixelsToCanvas } from './pixels'

export class Painter {
  readonly w: number
  readonly h: number
  readonly px: Uint32Array
  private readonly colors = new Map<string, number>()

  constructor(w: number, h: number) {
    this.w = w
    this.h = h
    this.px = new Uint32Array(w * h)
  }

  private c(hex: string): number {
    let v = this.colors.get(hex)
    if (v === undefined) {
      v = packColor(hex)
      this.colors.set(hex, v)
    }
    return v
  }

  set(x: number, y: number, hex: string): void {
    x = Math.round(x)
    y = Math.round(y)
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return
    this.px[y * this.w + x] = this.c(hex)
  }

  rect(x: number, y: number, w: number, h: number, hex: string): void {
    for (let yy = Math.max(0, Math.round(y)); yy < Math.min(this.h, Math.round(y + h)); yy++) {
      for (let xx = Math.max(0, Math.round(x)); xx < Math.min(this.w, Math.round(x + w)); xx++) {
        this.px[yy * this.w + xx] = this.c(hex)
      }
    }
  }

  hline(x: number, y: number, len: number, hex: string): void {
    this.rect(x, y, len, 1, hex)
  }

  vline(x: number, y: number, len: number, hex: string): void {
    this.rect(x, y, 1, len, hex)
  }

  frame(x: number, y: number, w: number, h: number, hex: string): void {
    this.hline(x, y, w, hex)
    this.hline(x, y + h - 1, w, hex)
    this.vline(x, y, h, hex)
    this.vline(x + w - 1, y, h, hex)
  }

  /** Two-tone ordered dither over a rect; `mix` 0..1 is the share of `b`. */
  dither(x: number, y: number, w: number, h: number, a: string, b: string, mix = 0.5): void {
    for (let yy = y; yy < y + h; yy++) {
      for (let xx = x; xx < x + w; xx++) this.set(xx, yy, bayer(xx, yy) < mix ? b : a)
    }
  }

  /** Paints every pixel where `color` returns a colour (null leaves it untouched). */
  shape(color: (x: number, y: number) => string | null, x0 = 0, y0 = 0, x1 = this.w, y1 = this.h): void {
    for (let y = Math.max(0, y0); y < Math.min(this.h, y1); y++) {
      for (let x = Math.max(0, x0); x < Math.min(this.w, x1); x++) {
        const hex = color(x, y)
        if (hex) this.px[y * this.w + x] = this.c(hex)
      }
    }
  }

  /** Adds a 1px outline on transparent pixels that touch opaque ones. */
  outline(hex: string): void {
    const { w, h, px } = this
    const edge: number[] = []
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x
        if (px[i] !== TRANSPARENT) continue
        if ((x > 0 && px[i - 1] !== TRANSPARENT) || (x < w - 1 && px[i + 1] !== TRANSPARENT) ||
          (y > 0 && px[i - w] !== TRANSPARENT) || (y < h - 1 && px[i + w] !== TRANSPARENT)) edge.push(i)
      }
    }
    const c = this.c(hex)
    for (const i of edge) px[i] = c
  }

  toSprite(options: { ax?: number; ay?: number; flatTop?: number; castShadow?: boolean } = {}): Sprite {
    const canvas = pixelsToCanvas(this.w, this.h, this.px)
    return {
      canvas,
      shadow: silhouette(canvas, this.w, this.h),
      w: this.w,
      h: this.h,
      ax: options.ax ?? this.w / 2,
      ay: options.ay ?? this.h - 1,
      flatTop: options.flatTop,
      castShadow: options.castShadow,
    }
  }
}

/** Point-in-octagon test for a box centred at (cx, cy) with corner cut `cut`. */
export function inOctagon(x: number, y: number, cx: number, cy: number, hw: number, hh: number, cut: number): boolean {
  const dx = Math.abs(x + 0.5 - cx)
  const dy = Math.abs(y + 0.5 - cy)
  return dx <= hw && dy <= hh && dx + dy <= hw + hh - cut
}
