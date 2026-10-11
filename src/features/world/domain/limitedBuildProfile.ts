import { assertPublicSupabaseKey } from '../../../../services/realtime/src/security/publicSupabaseKey.js'

type BuildEnvironment = Readonly<Record<string, string | undefined>>

/** Build validation only; every VITE variable is public and grants no server permission. */
export function validateLimitedBuild(env: BuildEnvironment): void {
  assertPublicSupabaseKey(env.VITE_SUPABASE_ANON_KEY, 'VITE_SUPABASE_ANON_KEY')
  if (!env.VITE_ECO_RELEASE) return
  const invalid = (name: string): never => { throw new Error(`invalid limited build: ${name}`) }
  if (env.VITE_ECO_RELEASE !== 'limited') invalid('VITE_ECO_RELEASE')
  for (const [name, expected] of [['NODE_ENV', 'production'], ['VITE_ECO_EXPERIMENT', 'on'], ['VITE_PLAYTEST', 'on']]) {
    if (env[name] !== expected) invalid(name)
  }
  for (const name of ['VITE_PERF', 'VITE_PRESENCE_BENCHMARK']) {
    if (env[name] && env[name] !== 'off') invalid(name)
  }
  for (const [name, protocol] of [['VITE_REALTIME_URL', 'wss:'], ['VITE_SUPABASE_URL', 'https:']]) {
    try {
      const url = new URL(env[name] ?? '')
      if (url.protocol !== protocol || url.username || url.password || url.hash || url.search) invalid(name)
    } catch { invalid(name) }
  }
  if (!env.VITE_SUPABASE_ANON_KEY?.trim()) invalid('VITE_SUPABASE_ANON_KEY')
}
