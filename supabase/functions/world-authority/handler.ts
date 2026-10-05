// world-authority — the server-only door between the realtime service and the
// WORLD × SKILLS tables (INTEGRATION-1). Deployed in the RC-0.3 dark launch.
//
//   Colyseus (realtime) ──HTTPS + x-world-authority-secret──▶ this function
//                                                             └─ service role ─▶ RPC (one transaction)
//
// Who can call it: only a holder of WORLD_AUTHORITY_SECRET, a server-side
// secret set in the function's env and in the realtime process's env. It is
// never in a frontend build. A browser that finds this URL gets 401.
// What it can do: a fixed list of operations, each one SQL function that is
// executable by service_role only. No generic table access, no user-chosen SQL.
// WORLD LOCATION-2 adds location_claim / location_save: a player's last shared
// area and tile, fenced by a session epoch and a server sequence. They are not
// behind the WORLD x SKILLS gate (a location is not a game value).
// WORLD LOCATION-4 (additive) adds the host lifecycle (presence_acquire,
// presence_activate, presence_renew, presence_drain, presence_stop) and the
// keyed shapes of location_claim / location_save, which name the realtime host
// (generation + host id) and, for a claim, the session's key. The v1 shapes stay
// for the realtime builds that still use them; a body never mixes both.
// CLOUD READINESS-3 (additive v6) adds 'capabilities' and three recovery ops (location_claim_v2,
// presence_activate_exclusive, presence_any_active). Every v5 op answers exactly as before. The
// capability is read from the SQL that is really there (a marker function), never assumed from
// this function's version; a recovery op whose SQL function is missing answers 501 'unsupported'.
// CLOUD JOIN-ORDER-2 (additive v7) adds location_claim_v3 (the keyed claim plus the page and attempt
// of the join, ordered by world_location_claim_keyed_v3) and a 'joinOrder' entry in 'capabilities',
// read from its own SQL marker. Every v5 and v6 op answers exactly as before.
// Feature gate (RC-0.3 dark launch): world_skills_access() decides per user.
// A 'closed' user has no workable Pokemon and cannot settle completed work,
// whatever the realtime server asks; a missing or odd answer counts as closed.
// The service role key never leaves the function.
//
// Pure module (no Deno globals, no remote imports) so it is unit-tested in the
// repo's test runner; index.ts wires it to Deno.serve and supabase-js.

export interface RpcResult {
  data: unknown
  /** `code`: PostgREST's or Postgres's error code when known (PGRST202 / 42883: no such function). */
  error: { message: string; code?: string } | null
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
/** WORLD LOCATION-2 shapes: the same bounds the table's CHECKs enforce. */
const AREA_ID = /^[a-z][a-z0-9-]{2,47}$/
const LAYOUT_VERSION = /^[a-z0-9.-]{1,32}$/
const MAX_LOCATION_ROWS = 200
const TILE_MIN = -4096
const TILE_MAX = 4095
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

const tile = (value: unknown) => Number.isInteger(value) && (value as number) >= TILE_MIN && (value as number) <= TILE_MAX
const counter = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 1

/**
 * A location batch, rebuilt field by field (anything else in a row is dropped).
 * Null when ANY row is malformed or a player appears twice: a healthy realtime
 * never sends that, so the whole batch is refused before the database.
 */
export function locationRows(rows: unknown): Record<string, unknown>[] | null {
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > MAX_LOCATION_ROWS) return null
  const seen = new Set<string>()
  const out: Record<string, unknown>[] = []
  for (const raw of rows) {
    if (!raw || typeof raw !== 'object') return null
    const r = raw as Record<string, unknown>
    if (typeof r.userId !== 'string' || !UUID.test(r.userId)) return null
    const key = r.userId.toLowerCase()
    if (seen.has(key)) return null
    seen.add(key)
    if (!counter(r.epoch) || !counter(r.seq) || !tile(r.tx) || !tile(r.ty)) return null
    if (typeof r.areaId !== 'string' || !AREA_ID.test(r.areaId)) return null
    if (typeof r.layoutVersion !== 'string' || !LAYOUT_VERSION.test(r.layoutVersion)) return null
    out.push({ userId: r.userId, epoch: r.epoch, seq: r.seq, areaId: r.areaId, tx: r.tx, ty: r.ty, layoutVersion: r.layoutVersion })
  }
  return out
}

// ── WORLD LOCATION-4: host lifecycle and keyed location operations ──────────

const LEASE_MIN_MS = 1_000
const LEASE_MAX_MS = 120_000
const DRAIN_MAX_MS = 60_000
/** Fields only the keyed claim has; one of them in a body selects (and requires) the keyed shape. */
const KEYED_CLAIM_FIELDS = ['generation', 'seq', 'sessionId', 'hostId']
const uuid = (value: unknown): value is string => typeof value === 'string' && UUID.test(value)
const within = (value: unknown, min: number, max: number) => Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max

/** The realtime host a keyed call speaks for: its generation and host id, or null if malformed. */
function hostArgs(body: Record<string, unknown>): { p_generation: number; p_host_id: string } | null {
  if (!counter(body.generation) || !uuid(body.hostId)) return null
  return { p_generation: body.generation as number, p_host_id: body.hostId }
}

type Call = (fn: string, args: Record<string, unknown>) => Promise<unknown>

/** presence_*: one SQL function each; the answer is the function's own object. */
async function presenceOp(op: string, body: Record<string, unknown>, call: Call): Promise<Response> {
  if (op === 'presence_acquire') {
    if (!uuid(body.hostId) || !within(body.leaseMs, LEASE_MIN_MS, LEASE_MAX_MS)) return json(400, { error: 'invalid_host' })
    return json(200, await call('world_presence_acquire', { p_host_id: body.hostId, p_lease_ms: body.leaseMs }))
  }
  const host = hostArgs(body)
  if (!host) return json(400, { error: 'invalid_host' })
  if (op === 'presence_stop') return json(200, await call('world_presence_stop', host))
  if (op === 'presence_drain') {
    if (!within(body.drainMs, LEASE_MIN_MS, DRAIN_MAX_MS)) return json(400, { error: 'invalid_host' })
    return json(200, await call('world_presence_drain', { ...host, p_drain_ms: body.drainMs }))
  }
  if (!within(body.leaseMs, LEASE_MIN_MS, LEASE_MAX_MS)) return json(400, { error: 'invalid_host' })
  return json(200, await call(op === 'presence_activate' ? 'world_presence_activate' : 'world_presence_renew', { ...host, p_lease_ms: body.leaseMs }))
}

/** The keyed claim: the session's key (generation, seq, session id) and its host. Never mixed with v1's expectedEpoch. */
async function keyedClaim(body: Record<string, unknown>, call: Call): Promise<Response> {
  if (!uuid(body.userId)) return json(400, { error: 'invalid_user' })
  if ('expectedEpoch' in body) return json(400, { error: 'mixed_claim' })
  const host = hostArgs(body)
  if (!host || !counter(body.seq) || !uuid(body.sessionId)) return json(400, { error: 'invalid_key' })
  return json(200, {
    claim: await call('world_location_claim_keyed', {
      p_user_id: body.userId, p_generation: host.p_generation, p_seq: body.seq, p_session: body.sessionId, p_host_id: host.p_host_id,
    }),
  })
}

/** The keyed save: the v1 rows plus the writing host. Answer: { status, results?, newerActive? }. */
async function keyedSave(body: Record<string, unknown>, call: Call): Promise<Response> {
  const host = hostArgs(body)
  if (!host) return json(400, { error: 'invalid_host' })
  const rows = locationRows(body.rows)
  if (!rows) return json(400, { error: 'invalid_rows' })
  return json(200, await call('world_location_save_keyed', { p_rows: rows, ...host }))
}

const PRESENCE_OPS = new Set(['presence_acquire', 'presence_activate', 'presence_renew', 'presence_drain', 'presence_stop'])

// ── CLOUD READINESS-3 (additive v6): capabilities and the presence-recovery operations ──

/** The function is not there (PostgREST's schema cache, or Postgres itself): this SQL is not deployed. */
const MISSING_FUNCTION = new Set(['PGRST202', '42883'])
class MissingFunction extends Error {}
const RECOVERY_OPS = new Set(['location_claim_v2', 'presence_activate_exclusive', 'presence_any_active'])

/** One SQL marker: { version: 1 } when it answers 1, null when it answers anything else or does not exist. */
async function marker(call: Call, fn: string): Promise<{ version: 1 } | null> {
  try {
    return (await call(fn, {})) === 1 ? { version: 1 } : null
  } catch (error) {
    if (error instanceof MissingFunction) return null
    throw error
  }
}

/**
 * 'capabilities': { recovery, joinOrder }, each { version: 1 } only if its SQL answers its own marker, null
 * when the marker function does not exist (each independent of the other). Any other failure is a 500.
 */
async function capabilities(call: Call): Promise<Response> {
  const recovery = await marker(call, 'world_presence_recovery_version')
  const joinOrder = await marker(call, 'world_location_join_order_version')
  return json(200, { recovery, joinOrder })
}

/** The recovery ops. Malformed input never reaches SQL; a missing SQL function is 501 'unsupported'. */
async function recoveryOp(op: string, body: Record<string, unknown>, call: Call): Promise<Response> {
  try {
    if (op === 'presence_any_active') return json(200, { active: (await call('world_presence_any_active', {})) === true })
    const host = hostArgs(body)
    if (op === 'presence_activate_exclusive') {
      if (!host || !within(body.leaseMs, LEASE_MIN_MS, LEASE_MAX_MS)) return json(400, { error: 'invalid_host' })
      return json(200, await call('world_presence_activate_exclusive', { ...host, p_lease_ms: body.leaseMs }))
    }
    // location_claim_v2: the keyed claim only (never the v1 shape) plus an explicit boolean takeover.
    if (!uuid(body.userId)) return json(400, { error: 'invalid_user' })
    if ('expectedEpoch' in body) return json(400, { error: 'mixed_claim' })
    if (!host || !counter(body.seq) || !uuid(body.sessionId)) return json(400, { error: 'invalid_key' })
    if (typeof body.takeover !== 'boolean') return json(400, { error: 'invalid_takeover' })
    return json(200, {
      claim: await call('world_location_claim_keyed_v2', {
        p_user_id: body.userId, p_generation: host.p_generation, p_seq: body.seq, p_session: body.sessionId, p_host_id: host.p_host_id, p_takeover: body.takeover,
      }),
    })
  } catch (error) {
    if (error instanceof MissingFunction) return json(501, { error: 'unsupported' })
    throw error
  }
}

// ── CLOUD JOIN-ORDER-2 (additive v7): the join-ordered claim ──

/** The client's per-page-load id and its join attempt: the same bounds the table's CHECKs enforce. */
const PAGE = /^[A-Za-z0-9_-]{8,64}$/
const ATTEMPT_MAX = 2147483647

/**
 * location_claim_v3: the keyed claim (never the v1 shape), explicit booleans takeover and recovery (a takeover
 * only with the recovery rules), and the join's page and attempt. Malformed input never reaches SQL; a missing
 * SQL function is 501 'unsupported' (the realtime then falls back to its v1/v2 claim with the same key).
 */
async function joinOrderClaim(body: Record<string, unknown>, call: Call): Promise<Response> {
  try {
    if (!uuid(body.userId)) return json(400, { error: 'invalid_user' })
    if ('expectedEpoch' in body) return json(400, { error: 'mixed_claim' })
    const host = hostArgs(body)
    if (!host || !counter(body.seq) || !uuid(body.sessionId)) return json(400, { error: 'invalid_key' })
    if (typeof body.takeover !== 'boolean' || typeof body.recovery !== 'boolean' || (body.takeover && !body.recovery)) return json(400, { error: 'invalid_takeover' })
    if (typeof body.page !== 'string' || !PAGE.test(body.page) || !within(body.attempt, 1, ATTEMPT_MAX)) return json(400, { error: 'invalid_attempt' })
    return json(200, {
      claim: await call('world_location_claim_keyed_v3', {
        p_user_id: body.userId, p_generation: host.p_generation, p_seq: body.seq, p_session: body.sessionId, p_host_id: host.p_host_id,
        p_takeover: body.takeover, p_recovery: body.recovery, p_page: body.page, p_attempt: body.attempt,
      }),
    })
  } catch (error) {
    if (error instanceof MissingFunction) return json(501, { error: 'unsupported' })
    throw error
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
    if (error) throw MISSING_FUNCTION.has(error.code ?? '') ? new MissingFunction(error.message) : new Error(error.message)
    return data
  }

  const accessOf = async (userId: string): Promise<Access> => {
    const access = await call('world_skills_access', { p_user_id: userId })
    return typeof access === 'string' && ACCESS.has(access) ? access as Access : 'closed'
  }

  try {
    if (typeof body.op === 'string' && PRESENCE_OPS.has(body.op)) return await presenceOp(body.op, body, call)
    if (body.op === 'capabilities') return await capabilities(call)
    if (typeof body.op === 'string' && RECOVERY_OPS.has(body.op)) return await recoveryOp(body.op, body, call)
    if (body.op === 'location_claim_v3') return await joinOrderClaim(body, call)
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
      case 'location_claim': {
        // WORLD LOCATION-4: any keyed field selects the keyed shape (validated as a whole there).
        if (KEYED_CLAIM_FIELDS.some(field => field in body)) return await keyedClaim(body, call)
        if (typeof body.userId !== 'string' || !UUID.test(body.userId)) return json(400, { error: 'invalid_user' })
        // The epoch the realtime last read (0 = no row): the claim writes only if it is still current.
        if (!Number.isSafeInteger(body.expectedEpoch) || (body.expectedEpoch as number) < 0) return json(400, { error: 'invalid_epoch' })
        return json(200, { claim: await call('world_location_claim', { p_user_id: body.userId, p_expected_epoch: body.expectedEpoch }) })
      }
      case 'location_save': {
        if ('generation' in body || 'hostId' in body) return await keyedSave(body, call)
        const rows = locationRows(body.rows)
        if (!rows) return json(400, { error: 'invalid_rows' })
        // One answer per row ('applied' | 'duplicate' | 'stale' | 'invalid'); the realtime reads each on its own.
        return json(200, { results: await call('world_location_save', { p_rows: rows }) })
      }
      default:
        return json(400, { error: 'unknown_op' })
    }
  } catch {
    return json(500, { error: 'authority_failed' })
  }
}
