// world-authority — the server-only door between the realtime service and the
// WORLD × SKILLS tables (INTEGRATION-1). Deployed in the RC-0.3 dark launch.
//
//   Colyseus (realtime) ──HTTPS + x-world-authority-secret──▶ this function
//                                                             └─ service role ─▶ RPC (one transaction)
//
// Who can call it: only a holder of WORLD_AUTHORITY_SECRET, a server-side
// secret set in the function's env and in the realtime process's env. It is
// never in a frontend build. A browser that finds this URL gets 401.
// What it can do: exactly five operations, each one SQL function that is
// executable by service_role only. No generic table access, no user-chosen SQL.
// Feature gate (RC-0.3 dark launch): world_skills_access() decides per user.
// A 'closed' user has no workable Pokemon and cannot settle completed work,
// whatever the realtime server asks; a missing or odd answer counts as closed.
// The service role key never leaves the function.
//
// Pure module (no Deno globals, no remote imports) so it is unit-tested in the
// repo's test runner; index.ts wires it to Deno.serve and supabase-js.

export interface RpcResult {
  data: unknown
  error: { message: string } | null
}

export interface AuthorityDeps {
  /** WORLD_AUTHORITY_SECRET from the function's environment. */
  readonly secret: string | undefined
  rpc(fn: string, args: Record<string, unknown>): Promise<RpcResult>
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ACTION_ID = /^[0-9a-f-]{8,64}$/
const SKILL = new Set(['woodcutting', 'mining', 'farming'])
const MIN_SECRET_LENGTH = 32
const ACCESS = new Set(['open', 'tester', 'closed'])
type Access = 'open' | 'tester' | 'closed'

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })

/** Constant-time comparison: the time taken does not depend on where the strings differ. */
export function sameSecret(given: string | null, expected: string | undefined): boolean {
  if (!expected || expected.length < MIN_SECRET_LENGTH || typeof given !== 'string') return false
  const a = new TextEncoder().encode(given)
  const b = new TextEncoder().encode(expected)
  let diff = a.length ^ b.length
  for (let i = 0; i < b.length; i++) diff |= (a[i] ?? 0) ^ b[i]
  return diff === 0
}

function commitArgs(commit: unknown): Record<string, unknown> | null {
  if (!commit || typeof commit !== 'object') return null
  const c = commit as Record<string, unknown>
  if (typeof c.actionId !== 'string' || !ACTION_ID.test(c.actionId)) return null
  if (typeof c.userId !== 'string' || !UUID.test(c.userId)) return null
  if (typeof c.skillId !== 'string' || !SKILL.has(c.skillId)) return null
  if (c.outcome !== 'completed' && c.outcome !== 'cancelled') return null
  if (!Number.isInteger(c.xpGained) || !Number.isInteger(c.levelBefore) || !Number.isInteger(c.levelAfter)) return null
  if (!Array.isArray(c.rewards) || typeof c.rulesVersion !== 'string') return null
  if (c.node !== null && c.node !== undefined && typeof c.node !== 'object') return null
  return {
    p_action_id: c.actionId, p_user_id: c.userId, p_skill_id: c.skillId, p_outcome: c.outcome,
    p_xp_gained: c.xpGained, p_rewards: c.rewards, p_level_before: c.levelBefore, p_level_after: c.levelAfter,
    p_rules_version: c.rulesVersion, p_node: c.node ?? null,
  }
}

export async function handleWorldAuthority(req: Request, deps: AuthorityDeps): Promise<Response> {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })
  if (!sameSecret(req.headers.get('x-world-authority-secret'), deps.secret)) return json(401, { error: 'unauthorized' })

  let body: Record<string, unknown>
  try {
    const parsed = await req.json()
    if (!parsed || typeof parsed !== 'object') return json(400, { error: 'invalid_body' })
    body = parsed as Record<string, unknown>
  } catch {
    return json(400, { error: 'invalid_body' })
  }

  const call = async (fn: string, args: Record<string, unknown>) => {
    const { data, error } = await deps.rpc(fn, args)
    // The database's own message stays in the function's logs, not in the reply.
    if (error) throw new Error(error.message)
    return data
  }

  const accessOf = async (userId: string): Promise<Access> => {
    const access = await call('world_skills_access', { p_user_id: userId })
    return typeof access === 'string' && ACCESS.has(access) ? access as Access : 'closed'
  }

  try {
    switch (body.op) {
      case 'access': {
        if (typeof body.userId !== 'string' || !UUID.test(body.userId)) return json(400, { error: 'invalid_user' })
        return json(200, { access: await accessOf(body.userId) })
      }
      case 'player_state': {
        if (typeof body.userId !== 'string' || !UUID.test(body.userId)) return json(400, { error: 'invalid_user' })
        const [state, access] = await Promise.all([call('world_player_state', { p_user_id: body.userId }), accessOf(body.userId)])
        // Closed: progress stays visible, but no Pokemon can be put to work.
        const shown = access === 'closed' && state && typeof state === 'object' ? { ...(state as Record<string, unknown>), pokemon: [] } : state
        return json(200, { state: shown, access })
      }
      case 'owns_pokemon': {
        if (typeof body.userId !== 'string' || !UUID.test(body.userId)) return json(400, { error: 'invalid_user' })
        if (!Number.isInteger(body.instanceId) || (body.instanceId as number) < 1) return json(400, { error: 'invalid_pokemon' })
        const [owns, access] = await Promise.all([
          call('world_owns_pokemon', { p_user_id: body.userId, p_pokemon_id: body.instanceId }), accessOf(body.userId),
        ])
        return json(200, { owns: owns === true && access !== 'closed' })
      }
      case 'commit_work': {
        const args = commitArgs(body.commit)
        if (!args) return json(400, { error: 'invalid_commit' })
        // A cancellation pays nothing and always settles; completed work needs an open gate.
        if (args.p_outcome === 'completed' && await accessOf(args.p_user_id as string) === 'closed') return json(403, { error: 'world_skills_closed' })
        return json(200, { result: await call('world_commit_work', args) })
      }
      case 'load_nodes':
        return json(200, { nodes: await call('world_load_nodes', {}) })
      default:
        return json(400, { error: 'unknown_op' })
    }
  } catch {
    return json(500, { error: 'authority_failed' })
  }
}
