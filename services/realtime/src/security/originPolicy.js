const LOCAL_ORIGINS = new Set(['http://localhost:5173', 'http://127.0.0.1:5173'])
const PRODUCTION_ORIGINS = new Set(['https://pokeswap.lol', 'https://www.pokeswap.lol'])

function configuredOrigin(value) {
  const candidate = value.trim().replace(/^[\["']+|[\]"']+$/g, '')
  try {
    return new URL(candidate).origin
  } catch {
    return null
  }
}

export function allowedOrigins(env) {
  const configured = (env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map(configuredOrigin)
    .filter(Boolean)
  if (configured.length) return new Set([...PRODUCTION_ORIGINS, ...configured])
  return env.NODE_ENV === 'development' ? LOCAL_ORIGINS : PRODUCTION_ORIGINS
}

/** Reject browser upgrades from an origin not explicitly trusted by this deployment. */
export function originPolicy(env) {
  const allowed = allowedOrigins(env)
  return request => {
    const origin = request.headers.get('origin')
    if (!origin || !allowed.has(origin)) return new Response(null, { status: 403 })
  }
}
