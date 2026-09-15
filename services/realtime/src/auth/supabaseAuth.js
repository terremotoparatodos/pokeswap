const USER_PATH = '/auth/v1/user'

/** One join-time verification/read; never poll and never log bearer credentials. */
export async function authenticateSupabase(token, env, fetcher = fetch) {
  if (!token) return { kind: 'guest' }
  if (!env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY) throw new Error('realtime auth is not configured')
  const response = await fetcher(`${env.SUPABASE_URL}${USER_PATH}`, {
    headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, authorization: `Bearer ${token}` },
  })
  if (!response.ok) return { kind: 'guest' }
  const user = await response.json()
  if (typeof user.id !== 'string') return { kind: 'guest' }
  let username = typeof user.user_metadata?.username === 'string' ? user.user_metadata.username : null
  if (!username) {
    const profile = await fetcher(`${env.SUPABASE_URL}/rest/v1/profiles?select=username&id=eq.${encodeURIComponent(user.id)}`, {
      headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, authorization: `Bearer ${token}` },
    })
    if (profile.ok) {
      const rows = await profile.json()
      username = typeof rows[0]?.username === 'string' ? rows[0].username : null
    }
  }
  if (!username) return { kind: 'guest' }
  return { kind: 'player', userId: user.id, username: username.slice(0, 40) }
}

/** Validates the only remote companion identifier against the player's read-only slots. */
export async function authorizedCompanion(userId, pokemonId, token, env, fetcher = fetch) {
  if (!Number.isInteger(pokemonId) || pokemonId < 1) return null
  const query = `/rest/v1/slots?select=pokemon_id&owner_id=eq.${encodeURIComponent(userId)}&pokemon_id=eq.${pokemonId}&is_locked=eq.false&limit=1`
  const response = await fetcher(`${env.SUPABASE_URL}${query}`, { headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, authorization: `Bearer ${token}` } })
  if (!response.ok) return null
  const rows = await response.json()
  return rows[0]?.pokemon_id === pokemonId ? pokemonId : null
}
