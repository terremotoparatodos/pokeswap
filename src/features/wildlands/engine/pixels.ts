// Pixel buffer helpers — WildLands prototype
//
// Colours are packed as little-endian RGBA into a Uint32 so buffers can be
// written straight into ImageData without per-channel work.

export function packColor(hex: string, alpha = 255): number {
  const n = parseInt(hex.slice(1), 16)
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  return ((alpha << 24) | (b << 16) | (g << 8) | r) >>> 0
}

export const TRANSPARENT = 0

/** 4×4 ordered-dither thresholds in [0, 1). */
export const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(v => v / 16)

export function bayer(x: number, y: number): number {
  return BAYER4[(y & 3) * 4 + (x & 3)]
}

export function pixelsToCanvas(width: number, height: number, pixels: Uint32Array): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!
  const image = ctx.createImageData(width, height)
  new Uint32Array(image.data.buffer).set(pixels)
  ctx.putImageData(image, 0, 0)
  return canvas
}
