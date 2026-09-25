/**
 * Procedural terrain — the one generator both sides run (WORLD-1).
 *
 * Moved verbatim from the browser's `wildlands/engine/world.ts` and `noise.ts`
 * so the realtime service can answer "is there a tree at (x, y)?" and "can a
 * wild Pokémon stand here?" with exactly the tiles every client draws. The
 * browser keeps its `World` class as a thin wrapper over these functions.
 *
 * Dependency-free on purpose: Vite bundles it into the client and Node runs it
 * as is (see `protocol/arrival.js` for the same arrangement). A frozen
 * fingerprint guards the output (`worldFingerprint.test.ts`): any edit here
 * that changes a single tile is a different world, not a refactor.
 */

/** Integer hash of a 2D lattice point, returned in [0, 1). */
export function hash2(x, y, seed) {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b9)
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

function smooth(t) {
  return t * t * (3 - 2 * t)
}

/** Smooth value noise in [0, 1]. `period` (optional) makes it tile seamlessly. */
export function valueNoise(x, y, seed, period = 0) {
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const fx = smooth(x - x0)
  const fy = smooth(y - y0)
  const wrap = v => (period > 0 ? ((v % period) + period) % period : v)
  const a = hash2(wrap(x0), wrap(y0), seed)
  const b = hash2(wrap(x0 + 1), wrap(y0), seed)
  const c = hash2(wrap(x0), wrap(y0 + 1), seed)
  const d = hash2(wrap(x0 + 1), wrap(y0 + 1), seed)
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy
}

/** Fractal value noise, stretched so the output covers most of [0, 1]. */
export function fbm(x, y, seed, octaves = 4) {
  let sum = 0
  let amp = 0.5
  let freq = 1
  let norm = 0
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise(x * freq, y * freq, seed + i * 1013)
    norm += amp
    amp *= 0.5
    freq *= 2
  }
  const v = (sum / norm - 0.5) * 2.2 + 0.5
  return v < 0 ? 0 : v > 1 ? 1 : v
}

/** Terrain ids, ordered by draw priority (higher overlays lower). */
export const T = Object.freeze({ DEEP: 0, WATER: 1, SAND: 2, GRASS: 3, DUNE: 4, TALL: 5, SNOW: 6 })

const SOLID_DECOR = new Set(['cactus', 'rock', 'boulder', 'drybush', 'tree', 'pine', 'snowpine', 'bush', 'palm', 'icerock', 'searock'])

export function isSolidDecor(kind) {
  return kind !== null && SOLID_DECOR.has(kind)
}

export function isWaterTerrain(t) {
  return t === T.DEEP || t === T.WATER
}

/** Biome at a (fractional) vertex coordinate. */
export function biomeAt(seed, vx, vy) {
  const elev = fbm(vx / 70, vy / 70, seed, 5)
  if (elev < 0.25) return 'deep'
  if (elev < 0.37) return 'ocean'
  if (elev < 0.395) return 'beach'
  const temp = fbm(vx / 220, vy / 220, seed + 7, 3)
  const moist = fbm(vx / 160, vy / 160, seed + 13, 3)
  if (temp > 0.5 && moist < 0.6) return 'desert'
  if (temp < 0.28) return 'tundra'
  if (moist > 0.64) return 'forest'
  return 'grassland'
}

export function vertexTerrain(seed, vx, vy) {
  switch (biomeAt(seed, vx, vy)) {
    case 'deep': return T.DEEP
    case 'ocean': return T.WATER
    case 'beach': return T.SAND
    case 'tundra': return T.SNOW
    case 'desert':
      return fbm(vx / 11, vy / 11, seed + 29, 3) > 0.62 ? T.DUNE : T.SAND
    default:
      return fbm(vx / 9, vy / 9, seed + 31, 3) > 0.64 ? T.TALL : T.GRASS
  }
}

/** Terrain under the centre of a tile (the majority corner wins ties by priority). */
export function tileTerrain(seed, tx, ty) {
  return vertexTerrain(seed, tx + 0.5, ty + 0.5)
}

/**
 * Decoration for a tile. Only placed on tiles whose four corners agree, so
 * props never float over an autotile edge.
 */
export function decorAt(seed, tx, ty, corners) {
  const c = corners ?? [
    vertexTerrain(seed, tx, ty), vertexTerrain(seed, tx + 1, ty),
    vertexTerrain(seed, tx + 1, ty + 1), vertexTerrain(seed, tx, ty + 1),
  ]
  const t = c[0]
  if (c[1] !== t || c[2] !== t || c[3] !== t) return null
  const r = hash2(tx, ty, seed + 101)
  const pick = hash2(tx, ty, seed + 202)
  const biome = biomeAt(seed, tx + 0.5, ty + 0.5)

  if (t === T.DEEP) return r < 0.004 ? 'searock' : null
  if (t === T.WATER) return r < 0.014 ? 'coral' : r < 0.018 ? 'searock' : null
  if (t === T.DUNE) return r < 0.012 ? 'rock' : null
  if (t === T.TALL) return null
  if (t === T.SNOW) {
    if (r < 0.07) return 'snowpine'
    if (r < 0.09) return 'icerock'
    return r < 0.093 ? 'crystal' : null
  }
  if (t === T.SAND && biome === 'beach') {
    if (r < 0.025) return 'palm'
    return r < 0.045 ? 'shell' : null
  }
  if (t === T.SAND) {
    if (r < 0.022) return 'cactus'
    if (r < 0.034) return 'rock'
    if (r < 0.04) return 'boulder'
    if (r < 0.048) return 'drybush'
    return r < 0.0495 ? 'crystal' : null
  }
  // Grass
  if (biome === 'forest') {
    if (r < 0.26) return pick < 0.5 ? 'pine' : 'tree'
    return r < 0.31 ? 'bush' : null
  }
  if (r < 0.03) return 'tree'
  if (r < 0.06) return 'bush'
  if (r < 0.075) return 'rock'
  return r < 0.078 ? 'crystal' : null
}

export function isSolidTile(seed, tx, ty) {
  return isSolidDecor(decorAt(seed, tx, ty))
}

export function isWaterTile(seed, tx, ty) {
  return isWaterTerrain(tileTerrain(seed, tx, ty))
}

/**
 * Nearest open tile (spiralling out from the origin) in one of the preferred
 * biomes, whose northern neighbour is open too so a return pad fits there.
 * Falls back to any open land.
 */
export function findSpawn(seed, prefer = ['desert']) {
  const isOpenLand = (tx, ty) => !isWaterTile(seed, tx, ty) && !isSolidTile(seed, tx, ty)
  let fallback = null
  for (let radius = 0; radius < 400; radius += 3) {
    const steps = Math.max(1, Math.ceil((radius * 2 * Math.PI) / 3))
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2
      const tx = Math.round(Math.cos(a) * radius)
      const ty = Math.round(Math.sin(a) * radius)
      if (!isOpenLand(tx, ty) || !isOpenLand(tx, ty - 1)) continue
      const biome = biomeAt(seed, tx + 0.5, ty + 0.5)
      if (prefer.includes(biome) && tileTerrain(seed, tx, ty) !== T.TALL) return { tx, ty }
      if (!fallback && biome !== 'beach') fallback = { tx, ty }
    }
    if (fallback && radius > 200) return fallback
  }
  return fallback ?? { tx: 0, ty: 0 }
}
