/**
 * Pokémon ownership for world actions (WORLD-1C, INTEGRATION-1).
 *
 * A worker Pokémon is named by the client, so WORLD checks it before anything
 * is reserved or SKILLS is asked. The check goes to the server-side player
 * data with the user id the ROOM authenticated at join — no player token is
 * kept or sent, so a session that outlives its one-hour JWT keeps working and
 * an expired or stolen token changes nothing.
 *
 * Positive answers are cached briefly per player, so chopping tree after tree
 * does not cost one read per swing. A sale reaches the world at most
 * OWNERSHIP_CACHE_MS late; the reward goes to the player, not the Pokémon.
 */
export const OWNERSHIP_CACHE_MS = 30_000

export function ownershipFromPlayerData(playerData, now = Date.now) {
  const cache = new Map()
  return {
    async verify(playerId, instanceId) {
      if (!Number.isInteger(instanceId) || instanceId < 1) return null
      const key = `${playerId}:${instanceId}`
      const hit = cache.get(key)
      if (hit && hit.until > now()) return hit.pokemon
      const pokemon = await playerData.ownsPokemon(playerId, instanceId)
      if (!pokemon) { cache.delete(key); return null }
      cache.set(key, { pokemon, until: now() + OWNERSHIP_CACHE_MS })
      if (cache.size > 5_000) cache.delete(cache.keys().next().value)
      return pokemon
    },
  }
}

/** No player data configured: nobody owns anything (fail closed). */
export const noOwnership = Object.freeze({ async verify() { return null } })

/** Test/benchmark ownership: `owned` maps player id → owned instance ids. */
export function createStaticOwnership(owned) {
  return {
    async verify(playerId, instanceId) {
      return owned[playerId]?.includes(instanceId) ? Object.freeze({ instanceId, speciesId: instanceId }) : null
    },
  }
}
