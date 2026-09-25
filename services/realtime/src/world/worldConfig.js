import { createDemoSkillPolicy } from './demoSkillPolicy.js'
import { createSupabaseOwnership } from './pokemonOwnership.js'
import { unavailableSkillPolicy } from './skillPolicy.js'
import { createSupabaseWildCatalog, syntheticWildCatalog } from './wildService.js'

const BENCHMARK_PLAYER = /^benchmark-[a-z0-9][a-z0-9-]{0,39}$/

/**
 * Chooses the world's SKILLS and ownership adapters for this process.
 *
 * - Production: SKILLS is `unavailable` until the SKILLS station ships its
 *   adapter, so no path in a production process can grant anything; ownership
 *   is the read-only Supabase check.
 * - WORLD_DEMO_SKILLS=on outside production (local stack, benchmarks): the
 *   demo policy, and synthetic benchmark players own any Pokémon id so the
 *   load test needs no accounts. Real players still go through Supabase.
 */
export function worldDependencies(env = process.env) {
  const supabase = createSupabaseOwnership(env)
  const demo = env.WORLD_DEMO_SKILLS === 'on' && env.NODE_ENV !== 'production'
  const catalog = createSupabaseWildCatalog(env)
  if (!demo) return { skills: unavailableSkillPolicy, ownership: supabase, catalog, mode: 'production' }
  return {
    skills: createDemoSkillPolicy({ durationMs: Number(env.WORLD_DEMO_ACTION_MS) || 3_000 }),
    ownership: {
      async verify(playerId, instanceId, credentials) {
        if (BENCHMARK_PLAYER.test(playerId)) return Number.isInteger(instanceId) && instanceId >= 1 && instanceId <= 1_000 ? { instanceId, speciesId: instanceId } : null
        return supabase.verify(playerId, instanceId, credentials)
      },
    },
    // Local stacks usually have no real Supabase: a synthetic catalog keeps wild
    // Pokémon shared and measurable there.
    catalog: env.WORLD_WILD_CATALOG === 'synthetic' || !env.SUPABASE_URL ? syntheticWildCatalog() : catalog,
    mode: 'demo',
  }
}
