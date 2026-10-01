// free-claim — RETIRED (SECURITY-3).
//
// The hosted free-claim (v19, never versioned) ran with the service role and
// called reset_daily_free_claim() and then claim_slot(..., p_is_free = true)
// as separate steps. Concurrent calls could exceed the daily limit, and for a
// species with no `slots` row two concurrent claims could reassign ownership
// through claim_slot's ON CONFLICT DO UPDATE.
//
// The endpoint stays deployed so old clients get an explicit answer instead of
// a missing function. It authenticates the caller and answers 410. It never
// reads the request body, creates no service-role client, calls no RPC and
// reads or writes no slot, profile, token, claim counter or history row.
// No replacement (capture, eggs) lives here.

export const FREE_CLAIM_RETIRED_CODE = 'free_claim_retired'
export const FREE_CLAIM_RETIRED_MESSAGE =
  'El reclamo gratuito fue retirado. Próximamente podrás obtener Pokémon mediante huevos y captura.'

export const CORS_HEADERS: Readonly<Record<string, string>> = {
  'Access-Control-Allow-Origin': '*',
  // supabase-js adds these to browser invocations; allow the full preflight.
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

export interface RetiredFreeClaimDeps {
  /** True only for a valid signed-in user's access token. Throws if auth cannot be checked. */
  isAuthenticated(token: string): Promise<boolean>
}

const json = (body: unknown, status: number) =>
  Response.json(body, { status, headers: CORS_HEADERS })

const unauthorized = () => json({ error: 'No autorizado' }, 401)

export async function handleRetiredFreeClaim(req: Request, deps: RetiredFreeClaimDeps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })

  const token = /^Bearer\s+(\S+)$/.exec(req.headers.get('Authorization') ?? '')?.[1]
  if (!token) return unauthorized()

  let authenticated: boolean
  try {
    authenticated = await deps.isAuthenticated(token)
  } catch (err) {
    console.error('free-claim: auth check failed', err instanceof Error ? err.name : 'unknown')
    return json({ error: 'Error interno' }, 500)
  }
  if (!authenticated) return unauthorized()

  // `error` carries the readable message too: older clients display that field.
  return json({ code: FREE_CLAIM_RETIRED_CODE, error: FREE_CLAIM_RETIRED_MESSAGE, message: FREE_CLAIM_RETIRED_MESSAGE }, 410)
}
