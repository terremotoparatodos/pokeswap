// Terrain textures — WildLands prototype
//
// Every ground texture is generated in code as a seamless 64×64 pixel tile,
// sampled by absolute world pixel so repetition is hard to spot. Palettes are
// limited on purpose (4–6 tones per material) to keep the handheld look.

import { hash2, valueNoise } from './noise'
import { packColor } from './pixels'
import { T } from './world'

export const TEX = 64
const MASK = TEX - 1

/** Seamless noise over the 64px texture; `scale` must divide 64. */
function tileNoise(x: number, y: number, scale: number, seed: number): number {
  return valueNoise(x / scale, y / scale, seed, TEX / scale)
}

function build(fn: (x: number, y: number) => number): Uint32Array {
  const out = new Uint32Array(TEX * TEX)
  for (let y = 0; y < TEX; y++) for (let x = 0; x < TEX; x++) out[y * TEX + x] = fn(x, y)
  return out
}

function rippledSand(
  tones: { base: string; light: string; dark: string; rippleDark: string; rippleLight: string; speck: string },
  seed: number,
  direction: 1 | -1,
): Uint32Array {
  const c = Object.fromEntries(Object.entries(tones).map(([k, v]) => [k, packColor(v)])) as Record<keyof typeof tones, number>
  return build((x, y) => {
    const n = tileNoise(x, y, 8, seed)
    const bend = Math.floor(tileNoise(x, y, 16, seed + 1) * 8)
    const wave = (((x * direction + 2 * y + bend) % 16) + 16) % 16
    const showRipple = tileNoise(x, y, 16, seed + 2) > 0.42
    if (showRipple && wave === 0) return c.rippleDark
    if (showRipple && wave === 1) return c.rippleLight
    if (hash2(x, y, seed + 3) < 0.012) return c.speck
    return n > 0.68 ? c.light : n < 0.3 ? c.dark : c.base
  })
}

const TALL_TEMPLATE = [
  '....L...',
  '...LGL.L',
  '.L.GGdLG',
  'LGLGdGGd',
  'GGdGdGdd',
  'GddddGd.',
  'd.dd.dd.',
  '........',
]

function grass(): Uint32Array {
  const base = packColor('#74c24f')
  const dark = packColor('#65b046')
  const light = packColor('#86d05c')
  const tuft = packColor('#4b9138')
  const tuftTip = packColor('#9ade6c')
  const petals = [packColor('#ffffff'), packColor('#f68fb4'), packColor('#f5d34a')]
  const heart = packColor('#f0a02a')
  return build((x, y) => {
    // Flowers on a 16px lattice
    const fx = x >> 4, fy = y >> 4
    const fh = hash2(fx & 3, fy & 3, 13)
    if (fh < 0.16) {
      const lx = (x & 15) - 7, ly = (y & 15) - 7
      if (lx === 0 && ly === 0) return heart
      if (Math.abs(lx) + Math.abs(ly) === 1) return petals[Math.floor(fh * 100) % 3]
    }
    // Grass tufts on an 8px lattice
    const th = hash2((x >> 3) & 7, (y >> 3) & 7, 12)
    if (th < 0.55) {
      const ox = 2 + (Math.floor(th * 97) % 4), oy = 3 + (Math.floor(th * 53) % 3)
      const lx = x & 7, ly = y & 7
      if (lx === ox && ly === oy) return tuftTip
      if (ly === oy + 1 && (lx === ox - 1 || lx === ox + 1)) return tuft
    }
    const n = tileNoise(x, y, 8, 11)
    return n > 0.7 ? light : n < 0.32 ? dark : base
  })
}

function tallGrass(): Uint32Array {
  const tones: Record<string, number> = {
    '.': packColor('#3b8c41'),
    L: packColor('#8fd86a'),
    G: packColor('#5cb24c'),
    d: packColor('#2a6e33'),
  }
  return build((x, y) => {
    const row = y >> 3
    const lx = (x + (row & 1) * 4) & 7
    return tones[TALL_TEMPLATE[y & 7][lx]]
  })
}

function snow(): Uint32Array {
  const base = packColor('#eaf1fa')
  const light = packColor('#ffffff')
  const shade = packColor('#d2dfee')
  const speck = packColor('#b9cbe2')
  return build((x, y) => {
    if (hash2(x, y, 41) < 0.018) return speck
    const n = tileNoise(x, y, 16, 40) * 0.7 + tileNoise(x, y, 4, 42) * 0.3
    return n > 0.66 ? light : n < 0.36 ? shade : base
  })
}

export interface TerrainArt {
  /** Texture per terrain id; water ids are empty (drawn by the animated water layer). */
  textures: Uint32Array[]
  /** Autotile jitter in [-0.25, 0.25], seamless over 64px. */
  jitter: Float32Array
}

let cached: TerrainArt | null = null

export function terrainArt(): TerrainArt {
  if (cached) return cached
  const textures: Uint32Array[] = []
  textures[T.DEEP] = new Uint32Array(TEX * TEX)
  textures[T.WATER] = new Uint32Array(TEX * TEX)
  textures[T.SAND] = rippledSand(
    { base: '#ecd49a', light: '#f3e0b0', dark: '#e2c78a', rippleDark: '#d6b977', rippleLight: '#f8ebc6', speck: '#c9ab6c' },
    1, 1,
  )
  textures[T.DUNE] = rippledSand(
    { base: '#e3a444', light: '#eeb65a', dark: '#d9983b', rippleDark: '#c6832d', rippleLight: '#f4c46c', speck: '#b3722a' },
    21, -1,
  )
  textures[T.GRASS] = grass()
  textures[T.TALL] = tallGrass()
  textures[T.SNOW] = snow()

  const jitter = new Float32Array(TEX * TEX)
  for (let y = 0; y < TEX; y++) {
    for (let x = 0; x < TEX; x++) jitter[y * TEX + x] = (tileNoise(x, y, 4, 77) - 0.5) * 0.5
  }
  cached = { textures, jitter }
  return cached
}

export function sampleTexture(tex: Uint32Array, wx: number, wy: number): number {
  return tex[(wy & MASK) * TEX + (wx & MASK)]
}

export const WATER_TEX = 128

/** Animated water frames (seamless 128×128), cycled by the renderer. */
export function waterFramePixels(frame: number, frameCount: number): Uint32Array {
  const size = WATER_TEX
  const mask = size - 1
  const base = packColor('#4d93e3')
  const dark = packColor('#468ad9')
  const light = packColor('#5a9feb')
  const wave = packColor('#8cc2f5')
  const crest = packColor('#e0f1ff')
  const phase = (frame / frameCount) * Math.PI * 2
  // Low-contrast body; the offset travels one full texture width per cycle so it loops.
  const shift = Math.round((frame * size) / frameCount)
  const out = new Uint32Array(size * size)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n =
        valueNoise(((x + shift) & mask) / 32, y / 32, 90, size / 32) * 0.65 +
        valueNoise(x / 16, ((y + shift) & mask) / 16, 91, size / 16) * 0.35
      out[y * size + x] = n > 0.66 ? light : n < 0.32 ? dark : base
    }
  }
  // Scattered "~" wave marks that sway and glint.
  const mark = [[0, 1], [1, 0], [2, 0], [3, 1], [4, 1], [5, 0]]
  for (let cy = 0; cy < 8; cy++) {
    for (let cx = 0; cx < 8; cx++) {
      const h = hash2(cx, cy, 95)
      if (h > 0.6) continue
      const sway = Math.round(Math.sin(phase + h * 40) * 1.2)
      const ox = cx * 16 + 2 + Math.floor(h * 14) + sway
      const oy = cy * 16 + 3 + Math.floor(hash2(cx, cy, 96) * 10)
      const glint = Math.sin(phase * 2 + h * 17) > 0.6
      mark.forEach(([mx, my], i) => {
        out[((oy + my) & mask) * size + ((ox + mx) & mask)] = glint && (i === 1 || i === 2) ? crest : wave
      })
    }
  }
  return out
}
