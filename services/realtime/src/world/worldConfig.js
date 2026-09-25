import { createDemoSkillPolicy } from './demoSkillPolicy.js'
import { createEdgePlayerData } from './persistence/playerData.js'
import { noOwnership, ownershipFromPlayerData } from './pokemonOwnership.js'
import { createSkillsWorldPolicy } from './skills/skills.generated.js'
import { unavailableSkillPolicy } from './skillPolicy.js'
import { createSupabaseWildCatalog, syntheticWildCatalog } from './wildService.js'

const BENCHMARK_PLAYER = /^benchmark-[a-z0-9][a-z0-9-]{0,39}$/

/**
 * Chooses the world's adapters for this process (INTEGRATION-1).
 *
 * production   WORLD_AUTHORITY_URL + WORLD_AUTHORITY_SECRET set: the real
 *              SKILLS rules (bundled) settle through the `world-authority`
 *              Edge Function. Either missing: SKILLS is `unavailable`, nobody
 *              owns anything, nothing can be worked (fail closed) — the world
 *              still shows shared nodes, wilds and players.
 * local stack  WORLD_PLAYERDATA=pglite (never in production): the same rules
 *              on an embedded Postgres running the real migration, at
 *              WORLD_DB_DIR (in memory when unset). WORLD_FARM_TIME_SCALE
 *              shortens crop growth for physical tests only.
 * transport    WORLD_DEMO_SKILLS=on (never in production): the fake policy,
 *              no database — for measuring the room alone.
 */
export function worldDependencies(env = process.env) {
  const production = env.NODE_ENV === 'production'
  const catalog = env.WORLD_WILD_CATALOG === 'synthetic' && !production ? syntheticWildCatalog() : createSupabaseWildCatalog(env)

  if (!production && env.WORLD_PLAYERDATA === 'pglite') {
    const playerData = lazyDevPlayerData(env.WORLD_DB_DIR || null)
    const scale = Number(env.WORLD_FARM_TIME_SCALE)
    return {
      skills: createSkillsWorldPolicy({ store: playerData, growScale: Number.isFinite(scale) && scale > 0 && scale <= 1 ? scale : 1 }),
      ownership: ownershipFromPlayerData(playerData), playerData, catalog, mode: 'local-db',
    }
  }
  if (!production && env.WORLD_DEMO_SKILLS === 'on') {
    return {
      skills: createDemoSkillPolicy({ durationMs: Number(env.WORLD_DEMO_ACTION_MS) || 3_000 }),
      ownership: {
        async verify(playerId, instanceId) {
          return BENCHMARK_PLAYER.test(playerId) && Number.isInteger(instanceId) && instanceId >= 1 && instanceId <= 1_000 ? { instanceId, speciesId: instanceId } : null
        },
      },
      playerData: null, catalog, mode: 'demo',
    }
  }
  if (env.WORLD_AUTHORITY_URL && env.WORLD_AUTHORITY_SECRET && env.SUPABASE_PUBLISHABLE_KEY) {
    const playerData = createEdgePlayerData({ url: env.WORLD_AUTHORITY_URL, secret: env.WORLD_AUTHORITY_SECRET, publishableKey: env.SUPABASE_PUBLISHABLE_KEY })
    return { skills: createSkillsWorldPolicy({ store: playerData }), ownership: ownershipFromPlayerData(playerData), playerData, catalog, mode: 'authority' }
  }
  return { skills: unavailableSkillPolicy, ownership: noOwnership, playerData: null, catalog, mode: 'unavailable' }
}

/** The dev database opens asynchronously; the world is built synchronously. */
function lazyDevPlayerData(dataDir) {
  let opened = null
  const data = () => {
    // A failed open is not cached: the next call (the world's restore retry) tries again.
    opened ??= import('./persistence/dev/devPlayerData.js').then(module => module.createDevPlayerData({ dataDir }))
      .catch(error => { opened = null; throw error })
    return opened
  }
  return {
    playerState: async userId => (await data()).playerState(userId),
    ownsPokemon: async (userId, instanceId) => (await data()).ownsPokemon(userId, instanceId),
    commitWork: async commit => (await data()).commitWork(commit),
    loadNodes: async () => (await data()).loadNodes(),
  }
}
