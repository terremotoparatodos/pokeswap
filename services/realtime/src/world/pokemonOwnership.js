/**
 * Pokémon ownership for world actions (WORLD-1C).
 *
 * A worker Pokémon is named by the client, so WORLD checks it before anything
 * is reserved or SKILLS is asked. Production reads `slots` with the player's
 * own token (read-only, RLS applies), exactly like the companion check at join
 * (`auth/supabaseAuth.js`). A Pokémon listed on the market (`is_locked`) cannot
 * work.
 *
 * Instance model: production still has the legacy one — one `slots` row per
 * unique Pokémon, whose id is also its species (POKEMON_SPECIES_INSTANCE_MODEL
 * §legacy). The port returns both ids so the R32 instance model can replace
 * this adapter without touching the world.
 *
 * Positive answers are cached briefly per player, so a player chopping tree
 * after tree does not cost one HTTP read per swing. A sale reaches the world at
 * most OWNERSHIP_CACHE_MS late; SKILLS re-checks at settlement anyway if it
 * needs stronger guarantees for the reward.
 */
export const OWNERSHIP_CACHE_MS = 60_000

export function createSupabaseOwnership(env, fetcher = fetch, now = Date.now) {
  const cache = new Map()
  return {
    async verify(playerId, instanceId, credentials) {
      if (!Number.isInteger(instanceId) || instanceId < 1) return null
      const key = `${playerId}:${instanceId}`
      const hit = cache.get(key)
      if (hit && hit.until > now()) return hit.pokemon
      const token = credentials?.token
      if (!token || !env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY) return null
      const query = `/rest/v1/slots?select=pokemon_id&owner_id=eq.${encodeURIComponent(playerId)}&pokemon_id=eq.${instanceId}&is_locked=eq.false&limit=1`
      const response = await fetcher(`${env.SUPABASE_URL}${query}`, { headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, authorization: `Bearer ${token}` } })
      if (!response.ok) return null
      const rows = await response.json()
      if (rows[0]?.pokemon_id !== instanceId) { cache.delete(key); return null }
      const pokemon = Object.freeze({ instanceId, speciesId: instanceId })
      cache.set(key, { pokemon, until: now() + OWNERSHIP_CACHE_MS })
      if (cache.size > 5_000) cache.delete(cache.keys().next().value)
      return pokemon
    },
  }
}

/** Test/benchmark ownership: `owned` maps player id → owned instance ids. */
export function createStaticOwnership(owned) {
  return {
    async verify(playerId, instanceId) {
      return owned[playerId]?.includes(instanceId) ? Object.freeze({ instanceId, speciesId: instanceId }) : null
    },
  }
}
