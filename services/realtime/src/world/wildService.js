import { WORLD_AREAS } from './areas.js'
import { WILD_ROTATE_MS, wildEpoch, wildRoster } from './wildPopulation.js'

/** A failed catalog read is retried this often, never in a tight loop. */
export const WILD_RETRY_MS = 60_000

/**
 * Keeps the current hour's wild roster for every procedural area (WORLD-1D).
 *
 * Two reads per hour, not per player and not per frame: the catalog and the
 * owned ids, at each epoch change. Until the first roster exists, areas have
 * none, and clients keep their legacy local population (rolling deploys).
 */
export class WildService {
  constructor({ catalog, now = Date.now, onRoster = () => {} }) {
    this.catalog = catalog
    this.now = now
    this.onRoster = onRoster
    this.rosters = new Map()
    this.epoch = null
    this.loading = false
    this.retryAt = 0
    this.metrics = { loads: 0, failures: 0 }
  }

  roster(areaId) {
    return this.rosters.get(areaId) ?? null
  }

  /** Server time at which the current roster rotates. */
  get rotatesAt() {
    return this.epoch === null ? null : (this.epoch + 1) * WILD_ROTATE_MS
  }

  tick(now = this.now()) {
    if (!this.catalog || this.loading || now < this.retryAt) return
    const epoch = wildEpoch(now)
    if (epoch === this.epoch) return
    this.loading = true
    void this.#load(epoch).finally(() => { this.loading = false })
  }

  async #load(epoch) {
    try {
      const { pokemon, ownedIds } = await this.catalog.load()
      this.metrics.loads++
      this.epoch = epoch
      for (const area of Object.values(WORLD_AREAS)) {
        if (!area.procedural) continue
        const roster = wildRoster({ areaId: area.id, seed: area.seed, spawn: area.spawn, epoch, catalog: pokemon, ownedIds })
        this.rosters.set(area.id, roster)
        this.onRoster(roster)
      }
    } catch {
      this.metrics.failures++
      this.retryAt = this.now() + WILD_RETRY_MS
    }
  }
}

/** Read-only catalog with the publishable key: the same rows every browser already reads. */
export function createSupabaseWildCatalog(env, fetcher = fetch) {
  const read = async path => {
    const response = await fetcher(`${env.SUPABASE_URL}${path}`, { headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY } })
    if (!response.ok) throw new Error(`catalog ${response.status}`)
    return response.json()
  }
  return {
    async load() {
      if (!env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY) throw new Error('catalog not configured')
      const [pokemon, owned] = await Promise.all([
        read('/rest/v1/pokemon?select=id,type1,type2,is_legendary,base_aura&order=id'),
        read('/rest/v1/slots?select=pokemon_id&owner_id=not.is.null'),
      ])
      return { pokemon, ownedIds: new Set(owned.map(row => row.pokemon_id)) }
    },
  }
}

/** Tests and local benchmarks: a fixed catalog. */
export function createStaticWildCatalog(pokemon, ownedIds = []) {
  return { async load() { return { pokemon, ownedIds: new Set(ownedIds) } } }
}

/** A synthetic 151-entry catalog cycling through every type, for runs without Supabase. */
export function syntheticWildCatalog() {
  const types = ['normal', 'grass', 'bug', 'electric', 'fairy', 'water', 'ground', 'rock', 'fire', 'poison', 'ice', 'dragon', 'dark', 'ghost', 'steel', 'psychic', 'flying', 'fighting']
  return createStaticWildCatalog(Array.from({ length: 151 }, (_, i) => ({
    id: i + 1, type1: types[i % types.length], type2: null, is_legendary: i >= 143, base_aura: (i * 37) % 400,
  })))
}
