// pokeswap-swap — RETIRED (SWAP RETIRE-1).
//
// Swap is permanently withdrawn from the product. The old flow picked the
// received Pokémon from every unlocked species without checking who owned it,
// then upserted `slots` by `pokemon_id` with the service role: it could hand
// another player's Pokémon to the caller, and it ran as separate, unchecked
// writes (release first, receive second) with no transaction.
//
// The endpoint stays deployed so old clients get an explicit answer instead of
// a missing function. It authenticates the caller and answers 410. It never
// reads or writes Pokémon, slots, profiles, history or cooldowns, rolls no
// RNG, and does not even read the request body.

export const SWAP_RETIRED_CODE = 'swap_retired'
export const SWAP_RETIRED_MESSAGE =
  'El intercambio fue retirado. Próximamente podrás obtener Pokémon mediante huevos y captura.'

export const CORS_HEADERS: Readonly<Record<string, string>> = {
  'Access-Control-Allow-Origin': '*',
  // supabase-js adds these to browser invocations; allow the full preflight.
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

export interface RetiredSwapDeps {
  /** True only for a valid signed-in user's access token. Throws if auth cannot be checked. */
  isAuthenticated(token: string): Promise<boolean>
}

const json = (body: unknown, status: number) =>
  Response.json(body, { status, headers: CORS_HEADERS })

export async function handleRetiredSwap(req: Request, deps: RetiredSwapDeps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return json({ error: 'No autorizado' }, 401)

  let authenticated: boolean
  try {
    authenticated = await deps.isAuthenticated(authHeader.replace('Bearer ', ''))
  } catch (err) {
    console.error('pokeswap-swap: auth check failed', err instanceof Error ? err.name : 'unknown')
    return json({ error: 'Error interno' }, 500)
  }
  if (!authenticated) return json({ error: 'No autorizado' }, 401)

  // `error` carries the readable message too: older clients display that field.
  return json({ code: SWAP_RETIRED_CODE, error: SWAP_RETIRED_MESSAGE, message: SWAP_RETIRED_MESSAGE }, 410)
}
