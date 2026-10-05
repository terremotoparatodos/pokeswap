// CLOUD READINESS-2 — PROTOTYPE of a world-authority "v6" (never deployed, not product code).
// It wraps the REAL handler of this checkout (supabase/functions/world-authority/handler.ts = v5):
// every v5 op is passed through untouched, so a v1/v5 realtime sees byte-identical answers.
//
// Contract modelled here (docs/design/CLOUD_READINESS_2_VALIDATION.md, "capabilities"):
//   op 'capabilities'               200 { recovery: { version: 1 } } when the recovery SQL is present,
//                                   200 { recovery: null } when it is not (checked through a cheap
//                                   marker function, never assumed from the Edge version alone).
//   ops of the recovery set         501 { error: 'unsupported' } when their SQL function is missing
//                                   (PostgREST PGRST202 or Postgres 42883); 500 authority_failed for
//                                   any other error, exactly like v5.
// A v5 Edge answers 400 { error: 'unknown_op' } to all of these (FACT, handler.ts default branch).

const RECOVERY_OPS = {
  location_claim_v2: 'world_location_claim_keyed_v2',
  presence_activate_exclusive: 'world_presence_activate_exclusive',
  presence_any_active: 'world_presence_any_active',
}
const MISSING = new Set(['PGRST202', '42883'])
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })

export async function createV6(handlerModuleUrl) {
  const { handleWorldAuthority, sameSecret } = await import(handlerModuleUrl)
  return async function handleV6(req, deps) {
    const op = await req.clone().json().then(b => b?.op, () => null)
    if (op !== 'capabilities' && !(op in RECOVERY_OPS)) return handleWorldAuthority(req, deps)
    // Same door as v5: method and secret first.
    if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })
    if (!sameSecret(req.headers.get('x-world-authority-secret'), deps.secret)) return json(401, { error: 'unauthorized' })
    const fn = op === 'capabilities' ? 'world_presence_recovery_version' : RECOVERY_OPS[op]
    const { data, error } = await deps.rpc(fn, {})
    if (error) {
      if (MISSING.has(error.code)) return op === 'capabilities' ? json(200, { recovery: null }) : json(501, { error: 'unsupported' })
      return json(500, { error: 'authority_failed' })
    }
    if (op === 'capabilities') return json(200, { recovery: data === 1 ? { version: 1 } : null })
    return json(200, { result: data })
  }
}
