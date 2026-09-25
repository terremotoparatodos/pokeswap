import { createHash } from 'node:crypto'
import { createSqlPlayerData } from '../playerData.js'
import { openLocalDatabase, serviceQuery } from './localDatabase.js'

/**
 * LOCAL/TEST ONLY: PlayerDataAuthority over the embedded database, for the
 * LAN test stack and load benchmarks. Never selected in production
 * (worldConfig.js checks NODE_ENV).
 *
 * Synthetic players (benchmark ids such as `benchmark-pc`) get a stable UUID
 * and, the first time they are seen, a small roster of real species picked to
 * exercise aptitudes: a Talar specialist, a Minería specialist, an
 * Agricultura specialist, a poor worker and an early-game Pokémon. Each
 * Pokémon has one owner, as in production, so later players get the next
 * free species of each kind.
 */
const ROSTER = [
  [123, 127, 83, 400, 68], // Talar: Scyther, Pinsir, Farfetch'd, Bibarel, Machamp
  [50, 51, 27, 232, 74], // Minería: Diglett, Dugtrio, Sandshrew, Donphan, Geodude
  [241, 182, 192, 1, 43], // Agricultura: Miltank, Bellossom, Sunflora, Bulbasaur, Oddish
  [129, 10, 13, 265], // poor at everything: Magikarp, Caterpie, Weedle, Wurmple
  [25, 4, 7, 152, 155], // early game: Pikachu, Charmander, Squirtle, Chikorita, Cyndaquil
]
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** A stable UUID for a non-UUID dev identity. */
export function devUserId(playerId) {
  if (UUID.test(playerId)) return playerId
  const hex = createHash('sha256').update(`pokeswap-dev:${playerId}`).digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

export async function createDevPlayerData({ dataDir = null } = {}) {
  const db = await openLocalDatabase(dataDir)
  const sql = createSqlPlayerData(serviceQuery(db))
  const provisioned = new Set()

  async function provision(playerId) {
    const userId = devUserId(playerId)
    if (provisioned.has(userId)) return userId
    const known = await db.query('SELECT 1 FROM auth.users WHERE id = $1', [userId])
    if (!known.rows.length) {
      await db.query('INSERT INTO auth.users (id) VALUES ($1)', [userId])
      for (const kind of ROSTER) {
        const free = await db.query('SELECT id FROM unnest($1::int[]) AS id WHERE id NOT IN (SELECT pokemon_id FROM public.slots WHERE owner_id IS NOT NULL) LIMIT 1', [kind])
        const id = free.rows[0]?.id ?? (await db.query('SELECT g AS id FROM generate_series(1, 493) g WHERE g NOT IN (SELECT pokemon_id FROM public.slots) LIMIT 1')).rows[0]?.id
        if (id) await db.query('INSERT INTO public.slots (pokemon_id, owner_id, is_locked) VALUES ($1, $2, false) ON CONFLICT (pokemon_id) DO UPDATE SET owner_id = EXCLUDED.owner_id', [id, userId])
      }
    }
    provisioned.add(userId)
    return userId
  }

  return {
    db,
    async playerState(playerId) { return sql.playerState(await provision(playerId)) },
    async ownsPokemon(playerId, instanceId) { return sql.ownsPokemon(await provision(playerId), instanceId) },
    async commitWork(commit) { return sql.commitWork({ ...commit, userId: await provision(commit.userId) }) },
    loadNodes: () => sql.loadNodes(),
    close: () => db.close(),
  }
}
