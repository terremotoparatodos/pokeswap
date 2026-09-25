import { biomeAt, hash2, isSolidTile, isWaterTile } from './terrain.js'

/**
 * Wild Pokémon — identity, species, home and lifecycle decided once, by the
 * server, for everyone (WORLD-1D).
 *
 * Before: every browser rolled its own pool of 25 with `Math.random()` each
 * hour and then handed species to spawn tiles in whatever order its chunks
 * loaded, so two players never met the same wild Pokémon. Each PokeSwap
 * Pokémon is unique (one id, at most one owner), so a wild one is one entity
 * in one place — not a copy per viewer.
 *
 * Now: the pool is rolled with the same rule (`rollWildPool`, moved here from
 * the browser) from a seed of the hour's epoch, and each member gets one home
 * among the same per-chunk spawn tiles the browser used, nearest the area's
 * spawn first. Movement around the home is a shared patrol (patrol.js).
 */

export const WILD_POOL_SIZE = 25
export const WILD_ROTATE_MS = 60 * 60 * 1000
/** Chunk size of the browser's historic population grid; the spawn-tile formula depends on it. */
export const WILD_CHUNK_TILES = 32
/** Homes are chosen within this many 32-tile chunks of the area spawn. */
export const WILD_HOME_RADIUS_CHUNKS = 3
export const WILD_SPEED = 3
export const NPC_SPEED = 3.2
export const SHINY_ODDS = 1 / 64

export function wildEpoch(now) {
  return Math.floor(now / WILD_ROTATE_MS)
}

/** mulberry32: small and deterministic. */
export function seededRandom(seed) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function categoryFor(random) {
  if (random < 0.02) return 'legendary'
  if (random < 0.14) return 'highAura'
  return 'other'
}

function matches(category, pokemon) {
  if (category === 'legendary') return pokemon.is_legendary === true
  if (category === 'highAura') return pokemon.is_legendary !== true && (pokemon.base_aura ?? 0) >= 250
  return pokemon.is_legendary !== true && (pokemon.base_aura ?? 0) < 250
}

/**
 * A unique, unowned pool. A missing weighted category falls back to every
 * remaining candidate, preserving the legacy map behaviour. Moved verbatim
 * from `pokemon/domain/wildPool.ts`, which now delegates here.
 */
export function rollWildPool(pokemon, ownedIds, random, size = WILD_POOL_SIZE) {
  const available = pokemon.filter(entry => !ownedIds.has(entry.id))
  const pool = []
  while (pool.length < size && available.length) {
    const category = categoryFor(random())
    const candidates = available.filter(entry => matches(category, entry))
    const source = candidates.length ? candidates : available
    const index = Math.min(source.length - 1, Math.floor(random() * source.length))
    const picked = source[index]
    pool.push(picked.id)
    available.splice(available.findIndex(entry => entry.id === picked.id), 1)
  }
  return pool
}

const TYPE_ALIASES = {
  planta: 'grass', fuego: 'fire', agua: 'water', normal: 'normal', bicho: 'bug', veneno: 'poison',
  'eléctrico': 'electric', electrico: 'electric', 'psíquico': 'psychic', psiquico: 'psychic', roca: 'rock',
  siniestro: 'dark', fantasma: 'ghost', tierra: 'ground', acero: 'steel', hielo: 'ice', lucha: 'fighting',
  'dragón': 'dragon', dragon: 'dragon', hada: 'fairy', volador: 'flying',
}

export function normaliseType(type) {
  if (!type) return null
  const key = type.trim().toLowerCase()
  return TYPE_ALIASES[key] ?? key
}

export const BIOME_TYPES = Object.freeze({
  desert: ['ground', 'rock', 'fire', 'steel'],
  beach: ['water', 'normal', 'flying'],
  grassland: ['normal', 'grass', 'bug', 'electric', 'fairy'],
  forest: ['bug', 'grass', 'poison', 'ghost', 'dark'],
  tundra: ['ice', 'steel', 'psychic'],
  ocean: ['water', 'dragon'],
  deep: ['water', 'dragon'],
})

export function fitsBiome(biome, entry) {
  const types = BIOME_TYPES[biome]
  return types.includes(normaliseType(entry.type1)) || types.includes(normaliseType(entry.type2) ?? '')
}

/** The browser's historic spawn tiles of one 32-tile chunk (`Population.populate`). */
export function wildSpawnTiles(seed, cx, cy) {
  const tiles = []
  const count = 4 + Math.floor(hash2(cx, cy, seed + 900) * 4)
  for (let i = 0; i < count; i++) {
    const tx = cx * WILD_CHUNK_TILES + Math.floor(hash2(cx * 31 + i, cy, seed + 901) * WILD_CHUNK_TILES)
    const ty = cy * WILD_CHUNK_TILES + Math.floor(hash2(cx, cy * 31 + i, seed + 902) * WILD_CHUNK_TILES)
    if (isSolidTile(seed, tx, ty)) continue
    const water = isWaterTile(seed, tx, ty)
    tiles.push({ tx, ty, water, biome: water ? 'ocean' : biomeAt(seed, tx + 0.5, ty + 0.5) })
  }
  return tiles
}

/** Chunks around a spawn, nearest first (ties in a fixed order). */
function chunksBySpawnDistance(spawn, radius) {
  const scx = Math.floor(spawn.tx / WILD_CHUNK_TILES)
  const scy = Math.floor(spawn.ty / WILD_CHUNK_TILES)
  const chunks = []
  for (let cy = scy - radius; cy <= scy + radius; cy++) for (let cx = scx - radius; cx <= scx + radius; cx++) chunks.push({ cx, cy, d: Math.max(Math.abs(cx - scx), Math.abs(cy - scy)) })
  return chunks.sort((a, b) => a.d - b.d || a.cy - b.cy || a.cx - b.cx)
}

/**
 * The hour's wild roster for an area. `catalog`: rows with id, type1, type2,
 * is_legendary, base_aura. `ownedIds`: Pokémon that have an owner right now.
 */
export function wildRoster({ areaId, seed, spawn, epoch, catalog, ownedIds }) {
  const pool = rollWildPool(catalog, ownedIds, seededRandom(Math.imul(epoch, 0x9e3779b1) ^ seed))
  const byId = new Map(catalog.map(entry => [entry.id, entry]))
  const tiles = chunksBySpawnDistance(spawn, WILD_HOME_RADIUS_CHUNKS).flatMap(({ cx, cy }) => wildSpawnTiles(seed, cx, cy))
  const used = new Set()
  const entities = []
  for (const pokemonId of pool) {
    const entry = byId.get(pokemonId)
    const index = tiles.findIndex((tile, i) => !used.has(i) && fitsBiome(tile.biome, entry))
    if (index < 0) continue
    used.add(index)
    const { tx, ty, water } = tiles[index]
    entities.push({
      id: `wild:${areaId}:${epoch}:${pokemonId}`, pokemonId, tx, ty, habitat: water ? 'water' : 'land',
      shiny: hash2(pokemonId, epoch, seed + 904) < SHINY_ODDS,
    })
  }
  return { areaId, epoch, entities }
}
