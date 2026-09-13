// Minimap — WildLands prototype
//
// Samples biomes every few tiles around the player into a tiny bitmap.

import { packColor } from './pixels'
import type { Biome, World } from './world'

const BIOME_COLOR: Record<Biome, number> = {
  deep: packColor('#1f3f9a'),
  ocean: packColor('#3f7fd8'),
  beach: packColor('#ecd49a'),
  desert: packColor('#e0a64a'),
  grassland: packColor('#74c24f'),
  forest: packColor('#2f7a3a'),
  tundra: packColor('#e6eef8'),
}

export const MINIMAP_CELLS = 64
const STEP = 3

export function paintMinimap(canvas: HTMLCanvasElement, world: World, tx: number, ty: number): void {
  const size = MINIMAP_CELLS
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  const image = ctx.createImageData(size, size)
  const out = new Uint32Array(image.data.buffer)
  const half = (size / 2) * STEP
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      out[y * size + x] = BIOME_COLOR[world.biomeAt(tx - half + x * STEP, ty - half + y * STEP)]
    }
  }
  ctx.putImageData(image, 0, 0)
  ctx.fillStyle = '#e03c3c'
  ctx.fillRect(size / 2 - 1, size / 2 - 1, 3, 3)
}
