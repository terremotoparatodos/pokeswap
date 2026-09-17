// Dungeon terrain, painted the WildLands way (D1.2 §5, §6, §7).
//
// WildLands paints its ground from seamless 64×64 textures sampled by absolute
// world pixel (terrainArt.ts). A dungeon floor is painted from exactly the same
// kind of texture, at the same TILE size, so a cave floor and a beach are the
// same material system rather than two art languages.
//
// Where the engine already has the right material — snow, grass, tall grass,
// sand, and the animated water the renderer paints under every wild area — we
// use *its* texture. Rock and cave floor do not exist in the overworld yet, so
// they are generated here with the engine's own recipe: a seamless 64px tile,
// four to six tones, ordered dither, sampled by world pixel.

import { hash2, valueNoise } from '../../wildlands/engine/noise'
import { packColor, TRANSPARENT } from '../../wildlands/engine/pixels'
import { sampleTexture, terrainArt, TEX } from '../../wildlands/engine/terrainArt'
import { T, TILE, type DecorKind } from '../../wildlands/engine/world'
import type { DungeonTheme } from '../domain/tiers'
import type { TileKind } from '../domain/floorTiles'

export { TILE }

/** Seamless noise over the 64px texture, exactly as terrainArt does it. */
function tileNoise(x: number, y: number, scale: number, seed: number): number {
  return valueNoise(x / scale, y / scale, seed, TEX / scale)
}

function build(fn: (x: number, y: number) => number): Uint32Array {
  const out = new Uint32Array(TEX * TEX)
  for (let y = 0; y < TEX; y++) for (let x = 0; x < TEX; x++) out[y * TEX + x] = fn(x, y)
  return out
}

/**
 * A rock-like material: broad patches of tone with a sparse speckle and a few
 * cracks, so a wall reads as stone and not as a flat fill.
 */
function stone(tones: readonly string[], seed: number, cracks = true): Uint32Array {
  const c = tones.map(tone => packColor(tone))
  const crack = packColor(tones[0])
  return build((x, y) => {
    if (cracks) {
      const veinA = Math.abs(tileNoise(x, y, 32, seed + 5) - 0.5)
      const veinB = Math.abs(tileNoise(x, y, 16, seed + 6) - 0.5)
      if (veinA < 0.022 || veinB < 0.014) return crack
    }
    if (hash2(x, y, seed + 9) < 0.02) return c[0]
    const n = tileNoise(x, y, 8, seed) * 0.65 + tileNoise(x, y, 16, seed + 1) * 0.35
    const level = Math.min(c.length - 1, Math.max(0, Math.floor(n * c.length)))
    return c[level]
  })
}

/** A cave floor: the same stone, flatter and with grit instead of cracks. */
function ground(tones: readonly string[], seed: number): Uint32Array {
  const c = tones.map(tone => packColor(tone))
  return build((x, y) => {
    if (hash2(x, y, seed + 3) < 0.035) return c[0]
    if (hash2(x, y, seed + 4) < 0.02) return c[c.length - 1]
    const n = tileNoise(x, y, 16, seed) * 0.6 + tileNoise(x, y, 4, seed + 2) * 0.4
    const level = Math.min(c.length - 1, Math.max(0, Math.round(n * (c.length - 1))))
    return c[level]
  })
}

/** Lava crust: dark basalt cracked open over a hot glow. */
function crust(seed: number): Uint32Array {
  const rock = [packColor('#2a1a18'), packColor('#3b2522'), packColor('#4d302b')]
  const hot = [packColor('#ff9d3c'), packColor('#e8541f'), packColor('#a32c0e')]
  return build((x, y) => {
    const vein = Math.abs(tileNoise(x, y, 16, seed) - 0.5)
    if (vein < 0.05) return hot[Math.floor(vein * 40) % hot.length]
    const n = tileNoise(x, y, 8, seed + 1)
    return rock[Math.min(rock.length - 1, Math.floor(n * rock.length))]
  })
}

export interface ThemePaint {
  /** Solid wall. */
  rock: Uint32Array
  floor: Uint32Array
  rubble: Uint32Array
  accent: Uint32Array
  /** Prop kinds scattered on wall edges and on accent tiles — real WildLands props. */
  wallProps: readonly DecorKind[]
  accentProps: readonly DecorKind[]
  /** Tint of the floor rim drawn where a walkable tile meets rock. */
  rim: string
  /** Ambient darkness of the floor, 0..1: how much of the day tint survives. */
  gloom: number
  name: string
}

const PALETTES: Record<DungeonTheme, { rock: string[]; floor: string[]; rubble: string[] }> = {
  cave: {
    rock: ['#1b2333', '#2a3550', '#394669', '#4a5980'],
    floor: ['#59657f', '#6a7791', '#7a89a4', '#8b9ab6'],
    rubble: ['#4c586f', '#5c6884', '#6b7897', '#7986a6'],
  },
  mine: {
    rock: ['#2a2119', '#3d3023', '#524030', '#67533f'],
    floor: ['#6d5c46', '#7e6c53', '#8f7c61', '#a08c70'],
    rubble: ['#5f4f3c', '#6f5e49', '#806e56', '#907d63'],
  },
  glacier: {
    rock: ['#22303f', '#31455c', '#425a76', '#547091'],
    floor: ['#8fb2cc', '#a3c4dc', '#b6d4e9', '#cbe4f5'],
    rubble: ['#7fa2bc', '#93b4cd', '#a6c4dd', '#b9d4ea'],
  },
  forest: {
    rock: ['#1d2a20', '#2b3d2d', '#3a513c', '#4b654c'],
    floor: ['#4d6141', '#5c7150', '#6c815f', '#7c9170'],
    rubble: ['#455938', '#546747', '#637656', '#728565'],
  },
  volcano: {
    rock: ['#2a1714', '#3d221d', '#512f27', '#663d33'],
    floor: ['#4a332c', '#5a4036', '#6a4d41', '#7a5a4c'],
    rubble: ['#3f2a25', '#4f362f', '#5f4239', '#6f4f44'],
  },
  ruin: {
    rock: ['#2e2b23', '#423e33', '#575244', '#6d6756'],
    floor: ['#8a8067', '#9a9076', '#aaa086', '#bab096'],
    rubble: ['#7b7159', '#8b8168', '#9b9177', '#aba187'],
  },
  tower: {
    rock: ['#231f3a', '#332d53', '#443c6e', '#564d8a'],
    floor: ['#5d5486', '#6d6398', '#7d73aa', '#8e84bc'],
    rubble: ['#524a77', '#615889', '#71679b', '#8176ad'],
  },
}

const RIM: Record<DungeonTheme, string> = {
  cave: '#10151f', mine: '#171009', glacier: '#16202c', forest: '#101a12',
  volcano: '#160b09', ruin: '#1a180f', tower: '#12102a',
}

const NAME: Record<DungeonTheme, string> = {
  cave: 'Cueva', mine: 'Mina', glacier: 'Cueva helada', forest: 'Cueva viva',
  volcano: 'Cueva volcánica', ruin: 'Ruinas', tower: 'Cueva de cristal',
}

const cache = new Map<DungeonTheme, ThemePaint>()

/**
 * The materials one theme paints with. Real engine textures are used wherever
 * the overworld already has the material (snow, grass, tall grass, sand).
 */
export function themePaint(theme: DungeonTheme): ThemePaint {
  const cached = cache.get(theme)
  if (cached) return cached
  const art = terrainArt()
  const palette = PALETTES[theme]
  const seed = theme.length * 31 + 7
  const rock = stone(palette.rock, seed)
  const floor = ground(palette.floor, seed + 40)
  const rubble = ground(palette.rubble, seed + 80)

  const paint: ThemePaint = {
    rock,
    // Where WildLands already owns the material, the dungeon uses the same one.
    floor: theme === 'glacier' ? art.textures[T.SNOW]
      : theme === 'forest' ? art.textures[T.GRASS]
        : theme === 'ruin' ? art.textures[T.SAND]
          : floor,
    rubble: theme === 'ruin' ? art.textures[T.DUNE] : rubble,
    accent: theme === 'volcano' ? crust(seed + 120)
      : theme === 'forest' ? art.textures[T.TALL]
        : theme === 'glacier' ? art.textures[T.SNOW]
          : ground(palette.floor.map(shiftUp), seed + 160),
    wallProps: theme === 'glacier' ? ['icerock', 'rock']
      : theme === 'forest' ? ['rock', 'bush']
        : ['rock', 'boulder'],
    accentProps: theme === 'glacier' ? ['crystal', 'icerock']
      : theme === 'forest' ? ['pine', 'tree', 'bush']
        : theme === 'tower' ? ['crystal']
          : theme === 'volcano' ? ['boulder']
            : ['crystal', 'rock'],
    rim: RIM[theme],
    gloom: theme === 'glacier' || theme === 'ruin' ? 0.55 : 0.72,
    name: NAME[theme],
  }
  cache.set(theme, paint)
  return paint
}

/** Brightens a hex tone, for the accent variant of a floor. */
function shiftUp(tone: string): string {
  const n = parseInt(tone.slice(1), 16)
  const up = (v: number) => Math.min(255, Math.round(v * 1.18 + 12))
  return `#${[(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => up(v).toString(16).padStart(2, '0')).join('')}`
}

/** The texture one tile is painted with, or null for tiles the water layer owns. */
export function textureFor(paint: ThemePaint, kind: TileKind): Uint32Array | null {
  switch (kind) {
    case 'water': return null
    case 'rock': return paint.rock
    case 'rubble': return paint.rubble
    case 'accent': return paint.accent
    case 'bridge': return paint.rubble
    default: return paint.floor
  }
}

/** Bridge planks, drawn over the water tile they cross. */
export function plankPixels(wx: number, wy: number): number {
  const board = (wy >> 1) % 4
  const tones = ['#6b4a2c', '#7d5834', '#8e653c', '#5c3e24']
  const grain = hash2(wx, wy, 17) < 0.08 ? 3 : board
  if ((wx & 15) === 0) return packColor('#4a301b')
  return packColor(tones[grain])
}

export { sampleTexture, TRANSPARENT }
