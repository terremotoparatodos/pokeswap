import { assertPublicSupabaseKey } from './publicSupabaseKey.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const PUBLIC_ORIGINS = new Set(['https://pokeswap.lol', 'https://www.pokeswap.lol'])

const invalid = name => { throw new Error(`invalid limited configuration: ${name}`) }
function httpsUrl(env, name, originOnly = false) {
  try {
    const url = new URL(env[name])
    if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.search
      || (originOnly && url.pathname !== '/')) return invalid(name)
    return url
  } catch { return invalid(name) }
}

/** Explicit exception only. Normal production retains its existing ECO refusals. */
export function limitedRelease(env, now = Date.now()) {
  assertPublicSupabaseKey(env.SUPABASE_PUBLISHABLE_KEY, 'SUPABASE_PUBLISHABLE_KEY')
  if (env.WORLD_ECO_RELEASE === undefined || env.WORLD_ECO_RELEASE === '') return null
  if (env.WORLD_ECO_RELEASE !== 'limited') return invalid('WORLD_ECO_RELEASE')
  for (const [name, expected] of [['NODE_ENV', 'production'], ['WORLD_ECO_EXPERIMENT', 'on'], ['WORLD_ECO_COMBATANT_MODE', 'owned']]) {
    if (env[name] !== expected) return invalid(name)
  }
  if ((env.WORLD_LOCATION_PERSISTENCE ?? 'off') !== 'off') return invalid('WORLD_LOCATION_PERSISTENCE')
  for (const name of ['PRESENCE_BENCHMARK', 'WORLD_PLAYERDATA', 'WORLD_DEMO_SKILLS', 'WORLD_WILD_CATALOG']) {
    if (env[name] && env[name] !== 'off') return invalid(name)
  }
  httpsUrl(env, 'SUPABASE_URL')
  httpsUrl(env, 'WORLD_AUTHORITY_URL')
  for (const name of ['SUPABASE_PUBLISHABLE_KEY', 'WORLD_AUTHORITY_SECRET']) {
    if (!env[name]?.trim() || (name === 'WORLD_AUTHORITY_SECRET' && env[name].length < 48)) return invalid(name)
  }
  const testerIds = (env.WORLD_ECO_TESTER_IDS ?? '').split(',').map(id => id.trim().toLowerCase())
  if (!testerIds.length || testerIds.some(id => !UUID.test(id))) return invalid('WORLD_ECO_TESTER_IDS')
  const origins = (env.ALLOWED_ORIGINS ?? '').split(',').map(raw => httpsUrl({ ALLOWED_ORIGINS: raw.trim() }, 'ALLOWED_ORIGINS', true).origin)
  if (origins.some(origin => PUBLIC_ORIGINS.has(origin))) return invalid('ALLOWED_ORIGINS')
  const expiry = env.WORLD_ECO_EXPIRES_AT ?? ''
  const expiresAt = Date.parse(expiry)
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/.test(expiry)
    || !Number.isFinite(expiresAt) || expiresAt <= now
    || new Date(expiresAt).toISOString() !== (expiry.length === 20 ? `${expiry.slice(0, -1)}.000Z` : expiry)) return invalid('WORLD_ECO_EXPIRES_AT')
  return Object.freeze({ testerIds: Object.freeze([...new Set(testerIds)]), origins: Object.freeze([...new Set(origins)]), expiresAt })
}
