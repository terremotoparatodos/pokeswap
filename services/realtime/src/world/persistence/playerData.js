/**
 * PlayerDataAuthority — the realtime service's only door to persistent player
 * and world data (INTEGRATION-1).
 *
 * ```ts
 * interface PlayerDataAuthority {
 *   // Everything a session needs, for a user id the ROOM authenticated.
 *   playerState(userId): Promise<{ xp: Record<SkillId, number>, materials: Record<MaterialId, number>,
 *                                  pokemon: { instanceId: number, speciesId: number }[] }>
 *   // Ownership of one Pokémon right now. No player token involved.
 *   ownsPokemon(userId, instanceId): Promise<{ instanceId, speciesId } | null>
 *   // ONE transaction: settlement (unique per action) + XP + materials + node state.
 *   commitWork(commit): Promise<{ applied: boolean, settlement }>
 *   // Node overrides still in force, for a restart.
 *   loadNodes(): Promise<NodeOverride[]>
 *   // WORLD LOCATION-4: a session's claim by its KEY { generation, seq, sessionId, hostId }
 *   // (fixed at acceptance, the same on every retry). A strictly greater key takes the row
 *   // (new epoch, the stored location as restore source); the same key adopts it (a lost
 *   // answer retried); a smaller one is 'superseded' for good. Only from an active host with
 *   // a live lease: otherwise host_inactive / host_expired / unknown_host, nothing written.
 *   locationClaim(userId, key): Promise<{ status: 'claimed', epoch, location: StoredLocation | null, newerActive }
 *     | { status: 'superseded', newerActive } | { status: 'host_inactive', state } | { status: 'host_expired' }
 *     | { status: 'unknown_host' } | { status: 'unknown_user' }>
 *   // A batch (1–200) of { userId, epoch, seq, areaId, tx, ty, layoutVersion } written by
 *   // `host` { generation, hostId }: one result per user, or a refusal for the whole batch.
 *   locationSave(rows, host): Promise<{ status: 'ok', results: Map<userId, 'applied' | 'duplicate' | 'stale'
 *     | 'invalid' | 'unknown'>, newerActive } | { status: 'host_inactive' | 'host_expired', state } | { status: 'unknown_host' }>
 *   // WORLD LOCATION-4: this process as a presence host (world_presence_* in the ordering
 *   // migration). Each resolves to the SQL function's own object (see hostLifecycle.js).
 *   presenceAcquire(hostId, leaseMs): Promise<{ generation, state }>
 *   presenceActivate(generation, hostId, leaseMs): Promise<{ status, state? }>
 *   presenceRenew(generation, hostId, leaseMs): Promise<{ status, state?, newerActive?, leaseLive? }>
 *   presenceDrain(generation, hostId, drainMs): Promise<{ status, state }>
 *   presenceStop(generation, hostId): Promise<{ status }>
 * }
 * ```
 *
 * Identity. `userId` always comes from the room's authenticated session
 * (Supabase Auth, verified once at join); no payload field can name it. After
 * join, nothing here depends on the player's access token, so a session that
 * outlives its one-hour JWT keeps working, and a stolen or expired token sent
 * later changes nothing.
 *
 * Production adapter: `createEdgePlayerData`, a server-to-server call to the
 * `world-authority` Edge Function, authenticated by a secret only the realtime
 * process and the function hold. The service role never leaves the function.
 * Local/test adapter: `createSqlPlayerData`, the same SQL functions called
 * directly as `service_role` on an embedded database.
 */

const ACTION_ID = /^[0-9a-f-]{8,64}$/

/** Normalizes one override row from either adapter. */
export function nodeOverride(row) {
  const respawn = row.respawn_at ?? row.respawnAt ?? null
  return {
    nodeId: row.node_id ?? row.nodeId,
    areaId: row.area_id ?? row.areaId,
    chunkId: row.chunk_id ?? row.chunkId,
    state: row.state,
    respawnAt: respawn === null ? null : typeof respawn === 'number' ? respawn : new Date(respawn).getTime(),
    plot: row.plot ?? null,
    actionId: row.action_id ?? row.actionId ?? null,
    // YIELD-2: units left on a partial node (1–3), null otherwise. `actionId` is its generation token.
    stockRemaining: Number.isInteger(row.stock_remaining ?? row.stockRemaining) ? (row.stock_remaining ?? row.stockRemaining) : null,
  }
}

function readState(raw) {
  const state = typeof raw === 'string' ? JSON.parse(raw) : raw
  const pokemon = Array.isArray(state?.pokemon) ? state.pokemon.filter(Number.isInteger) : []
  return {
    xp: { woodcutting: 0, mining: 0, farming: 0, ...(state?.xp ?? {}) },
    materials: { ...(state?.materials ?? {}) },
    // Legacy instance model: one slot = one Pokémon, whose id is also its species.
    pokemon: pokemon.map(id => ({ instanceId: id, speciesId: id })),
  }
}

function commitArgs(commit) {
  if (!ACTION_ID.test(commit.actionId)) throw new Error('invalid action id')
  return [
    commit.actionId, commit.userId, commit.skillId, commit.outcome, commit.xpGained,
    JSON.stringify(commit.rewards ?? []), commit.levelBefore, commit.levelAfter, commit.rulesVersion,
    commit.node === null || commit.node === undefined ? null : JSON.stringify(commit.node),
  ]
}

/** `rejected` (YIELD-2): 'stale_node' when the node's token or stock no longer matches. Nothing was written. */
function readCommit(raw) {
  const result = typeof raw === 'string' ? JSON.parse(raw) : raw
  return {
    applied: result?.applied === true, settlement: result?.settlement ?? null,
    ...(typeof result?.rejected === 'string' ? { rejected: result.rejected } : {}),
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SAVE_RESULTS = new Set(['applied', 'duplicate', 'stale', 'invalid'])
const HOST_STATES = new Set(['starting', 'active', 'draining', 'stopped'])
const positive = value => Number.isSafeInteger(value) && value >= 1

/** A session key { generation, seq, sessionId, hostId }: anything else is a caller bug. */
export function checkKey(key) {
  if (!key || !positive(key.generation) || !positive(key.seq) || !UUID.test(key.sessionId ?? '') || !UUID.test(key.hostId ?? '')) throw new Error('invalid session key')
  return key
}
/** A writing host { generation, hostId }. */
export function checkHost(host) {
  if (!host || !positive(host.generation) || !UUID.test(host.hostId ?? '')) throw new Error('invalid writing host')
  return host
}

/** A host refusal (claim or save): its status, and the host's state when the database gave one. */
function refusal(answer) {
  if (answer.status === 'unknown_host' || answer.status === 'unknown_user') return { status: answer.status }
  if (answer.status === 'host_expired') return { status: 'host_expired', ...(HOST_STATES.has(answer.state) ? { state: answer.state } : {}) }
  if (answer.status === 'host_inactive' && HOST_STATES.has(answer.state)) return { status: 'host_inactive', state: answer.state }
  return null
}

/**
 * A keyed claim answer from either adapter. Anything that is not exactly one of the
 * documented answers is an error (the session retries with the SAME key); a stored location
 * of the wrong shape is dropped (restores as "no location") rather than trusted.
 */
export function readClaim(raw) {
  const claim = typeof raw === 'string' ? JSON.parse(raw) : raw
  if (!claim || typeof claim !== 'object') throw new Error('malformed location claim')
  const refused = refusal(claim)
  if (refused) return refused
  const newerActive = claim.newerActive === true
  if (claim.status === 'superseded') return { status: 'superseded', newerActive }
  if (claim.status !== 'claimed' || !positive(claim.epoch)) throw new Error('malformed location claim')
  const l = claim.location
  const location = l && typeof l.areaId === 'string' && Number.isInteger(l.tx) && Number.isInteger(l.ty) && typeof l.layoutVersion === 'string'
    ? { areaId: l.areaId, tx: l.tx, ty: l.ty, layoutVersion: l.layoutVersion } : null
  return { status: 'claimed', epoch: claim.epoch, location, newerActive }
}

/** A keyed save answer: per-row results, or one refusal for the whole batch. */
export function readSaveAnswer(rows, raw) {
  const answer = typeof raw === 'string' ? JSON.parse(raw) : raw
  if (!answer || typeof answer !== 'object') throw new Error('malformed location save')
  if (answer.status !== 'ok') {
    const refused = refusal(answer)
    if (!refused || refused.status === 'unknown_user') throw new Error('malformed location save')
    return refused
  }
  return { status: 'ok', results: readSaveResults(rows, answer.results), newerActive: answer.newerActive === true }
}

/**
 * The result of each SENT row, by user id (lower case). A row the answer does
 * not mention, or mentions with anything unexpected, is 'unknown': the journal
 * retries that user only. One row's answer never stands for another's.
 */
export function readSaveResults(rows, raw) {
  const answer = typeof raw === 'string' ? JSON.parse(raw) : raw
  const given = new Map()
  for (const entry of Array.isArray(answer) ? answer : []) {
    if (typeof entry?.userId === 'string' && SAVE_RESULTS.has(entry.result)) given.set(entry.userId.toLowerCase(), entry.result)
  }
  return new Map(rows.map(row => [row.userId.toLowerCase(), given.get(row.userId.toLowerCase()) ?? 'unknown']))
}

/** A host-lifecycle answer from either adapter: an object, never a string; anything else is an error. */
export function readHostAnswer(raw) {
  const answer = typeof raw === 'string' ? JSON.parse(raw) : raw
  if (!answer || typeof answer !== 'object' || Array.isArray(answer)) throw new Error('malformed host answer')
  return answer
}

/** `query(sql, params)` runs as service_role and resolves to `{ rows }`. */
export function createSqlPlayerData(query) {
  const host = async (sql, params) => readHostAnswer((await query(sql, params)).rows[0]?.r)
  return {
    presenceAcquire: (hostId, leaseMs) => host('SELECT public.world_presence_acquire($1::uuid, $2::int) AS r', [hostId, leaseMs]),
    presenceActivate: (generation, hostId, leaseMs) => host('SELECT public.world_presence_activate($1::bigint, $2::uuid, $3::int) AS r', [generation, hostId, leaseMs]),
    presenceRenew: (generation, hostId, leaseMs) => host('SELECT public.world_presence_renew($1::bigint, $2::uuid, $3::int) AS r', [generation, hostId, leaseMs]),
    presenceDrain: (generation, hostId, drainMs) => host('SELECT public.world_presence_drain($1::bigint, $2::uuid, $3::int) AS r', [generation, hostId, drainMs]),
    presenceStop: (generation, hostId) => host('SELECT public.world_presence_stop($1::bigint, $2::uuid) AS r', [generation, hostId]),
    async playerState(userId) {
      const { rows } = await query('SELECT public.world_player_state($1::uuid) AS state', [userId])
      return readState(rows[0]?.state)
    },
    async ownsPokemon(userId, instanceId) {
      if (!Number.isInteger(instanceId) || instanceId < 1) return null
      const { rows } = await query('SELECT public.world_owns_pokemon($1::uuid, $2::integer) AS owns', [userId, instanceId])
      return rows[0]?.owns === true ? { instanceId, speciesId: instanceId } : null
    },
    async commitWork(commit) {
      const { rows } = await query(
        'SELECT public.world_commit_work($1, $2::uuid, $3, $4, $5::integer, $6::jsonb, $7::smallint, $8::smallint, $9, $10::jsonb) AS result',
        commitArgs(commit),
      )
      return readCommit(rows[0]?.result)
    },
    async loadNodes() {
      const { rows } = await query('SELECT * FROM public.world_load_nodes()', [])
      return rows.map(nodeOverride)
    },
    async locationClaim(userId, key) {
      if (!UUID.test(userId)) throw new Error('invalid user id')
      const { generation, seq, sessionId, hostId } = checkKey(key)
      const { rows } = await query('SELECT public.world_location_claim_keyed($1::uuid, $2::bigint, $3::bigint, $4::uuid, $5::uuid) AS claim', [userId, generation, seq, sessionId, hostId])
      return readClaim(rows[0]?.claim)
    },
    async locationSave(batch, host) {
      const { generation, hostId } = checkHost(host)
      const { rows } = await query('SELECT public.world_location_save_keyed($1::jsonb, $2::bigint, $3::uuid) AS answer', [JSON.stringify(batch), generation, hostId])
      return readSaveAnswer(batch, rows[0]?.answer)
    },
  }
}

export const EDGE_TIMEOUT_MS = 6_000
/**
 * WORLD LOCATION-4: the claim's request budget is separate from the 1.5 s the room
 * waits before placing the player with a safe fallback (HYDRATION_TIMEOUT_MS). Measured
 * hosted p99 ≈ 1.45 s (LOCATION-3B), so 4 s ≈ 2.7 × p99. This only makes abandoned
 * claims rarer; it is not what orders sessions (the key is). A save batch is off any
 * player's path.
 */
export const LOCATION_CLAIM_TIMEOUT_MS = 4_000
export const LOCATION_SAVE_TIMEOUT_MS = 5_000

/**
 * The production adapter. `secret` is WORLD_AUTHORITY_SECRET: server-held,
 * never in a frontend build, compared in constant time by the function.
 */
export function createEdgePlayerData({
  url, secret, publishableKey, fetcher = fetch, timeoutMs = EDGE_TIMEOUT_MS,
  claimTimeoutMs = LOCATION_CLAIM_TIMEOUT_MS, saveTimeoutMs = LOCATION_SAVE_TIMEOUT_MS,
}) {
  async function call(op, body, budgetMs = timeoutMs) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), budgetMs)
    timer.unref?.()
    try {
      const response = await fetcher(url, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          // The gateway accepts the publishable key; the function checks the secret.
          apikey: publishableKey, authorization: `Bearer ${publishableKey}`,
          'x-world-authority-secret': secret,
        },
        body: JSON.stringify({ op, ...body }),
      })
      if (!response.ok) throw new Error(`world-authority ${op} ${response.status}`)
      return await response.json()
    } finally {
      clearTimeout(timer)
    }
  }
  return {
    async playerState(userId) { return readState((await call('player_state', { userId })).state) },
    async ownsPokemon(userId, instanceId) {
      if (!Number.isInteger(instanceId) || instanceId < 1) return null
      return (await call('owns_pokemon', { userId, instanceId })).owns === true ? { instanceId, speciesId: instanceId } : null
    },
    async commitWork(commit) {
      commitArgs(commit)
      return readCommit((await call('commit_work', { commit })).result)
    },
    async loadNodes() { return ((await call('load_nodes', {})).nodes ?? []).map(nodeOverride) },
    async locationClaim(userId, key) {
      if (!UUID.test(userId)) throw new Error('invalid user id')
      const { generation, seq, sessionId, hostId } = checkKey(key)
      // Aborting at the budget only stops waiting: the call may still land later. That is
      // safe: a late claim carries the same key, so it can only adopt or be superseded.
      return readClaim((await call('location_claim', { userId, generation, seq, sessionId, hostId }, claimTimeoutMs)).claim)
    },
    async locationSave(rows, host) {
      const { generation, hostId } = checkHost(host)
      return readSaveAnswer(rows, await call('location_save', { rows, generation, hostId }, saveTimeoutMs))
    },
    presenceAcquire: async (hostId, leaseMs) => readHostAnswer(await call('presence_acquire', { hostId, leaseMs })),
    presenceActivate: async (generation, hostId, leaseMs) => readHostAnswer(await call('presence_activate', { generation, hostId, leaseMs })),
    presenceRenew: async (generation, hostId, leaseMs) => readHostAnswer(await call('presence_renew', { generation, hostId, leaseMs })),
    presenceDrain: async (generation, hostId, drainMs) => readHostAnswer(await call('presence_drain', { generation, hostId, drainMs })),
    presenceStop: async (generation, hostId) => readHostAnswer(await call('presence_stop', { generation, hostId })),
  }
}
