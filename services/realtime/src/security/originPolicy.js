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
  if (env.NODE_ENV === 'production') return new Set([...PRODUCTION_ORIGINS, ...configured])
  return new Set(configured.length ? configured : LOCAL_ORIGINS)
}

/** Reject browser upgrades from an origin not explicitly trusted by this deployment. */
export function originPolicy(env) {
  const allowed = allowedOrigins(env)
  return request => {
    const origin = request.headers.get('origin')
    const originKind = origin === 'https://pokeswap.lol'
      ? 'canonical'
      : origin === 'https://www.pokeswap.lol'
        ? 'www'
        : origin ? 'other' : 'missing'
    if (!origin || !allowed.has(origin)) return new Response(null, {
      status: 403,
      headers: {
        'x-pokeswap-upgrade-policy': origin ? 'origin-untrusted' : 'origin-missing',
        'x-pokeswap-allowed-origin-count': String(allowed.size),
        'x-pokeswap-origin-kind': originKind,
      },
    })
  }
}
