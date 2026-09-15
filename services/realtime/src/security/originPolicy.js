const LOCAL_ORIGINS = new Set(['http://localhost:5173', 'http://127.0.0.1:5173'])

export function allowedOrigins(env) {
  const configured = (env.ALLOWED_ORIGINS ?? '').split(',').map(value => value.trim()).filter(Boolean)
  return new Set(configured.length ? configured : env.NODE_ENV === 'production' ? [] : LOCAL_ORIGINS)
}

/** Reject browser upgrades from an origin not explicitly trusted by this deployment. */
export function originPolicy(env) {
  const allowed = allowedOrigins(env)
  return request => {
    const origin = request.headers.get('origin')
    if (!origin || !allowed.has(origin)) return new Response(null, { status: 403 })
  }
}
