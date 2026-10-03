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
 *   // WORLD LOCATION-2: a new session's epoch and the stored location (restore source), only
 *   // if the stored epoch is still `expectedEpoch` (0 = no row yet); otherwise 'conflict' and
 *   // the current epoch, with nothing written (review B2).
 *   locationClaim(userId, expectedEpoch): Promise<{ status: 'claimed', epoch, location: StoredLocation | null }
 *     | { status: 'conflict', epoch } | { status: 'unknown_user' }>
 *   // A batch (1–200) of { userId, epoch, seq, areaId, tx, ty, layoutVersion }: one result per user.
 *   locationSave(rows): Promise<Map<userId, 'applied' | 'duplicate' | 'stale' | 'invalid' | 'unknown'>>
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
const expectation = value => Number.isSafeInteger(value) && value >= 0
const SAVE_RESULTS = new Set(['applied', 'duplicate', 'stale', 'invalid'])

/**
 * A claim answer from either adapter. Anything that is not exactly a claim is
 * an error (the session stays unclaimed and retries); a stored location of the
 * wrong shape is dropped (restores as "no location") rather than trusted.
 */
export function readClaim(raw) {
  const claim = typeof raw === 'string' ? JSON.parse(raw) : raw
  if (claim?.status === 'unknown_user') return { status: 'unknown_user' }
  if (claim?.status === 'conflict') {
    if (!Number.isSafeInteger(claim.epoch) || claim.epoch < 0) throw new Error('malformed location claim')
    return { status: 'conflict', epoch: claim.epoch }
  }
  if (claim?.status !== 'claimed' || !Number.isSafeInteger(claim.epoch) || claim.epoch < 1) throw new Error('malformed location claim')
  const l = claim.location
  const location = l && typeof l.areaId === 'string' && Number.isInteger(l.tx) && Number.isInteger(l.ty) && typeof l.layoutVersion === 'string'
    ? { areaId: l.areaId, tx: l.tx, ty: l.ty, layoutVersion: l.layoutVersion } : null
  return { status: 'claimed', epoch: claim.epoch, location }
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
    async locationClaim(userId, expectedEpoch) {
      if (!UUID.test(userId)) throw new Error('invalid user id')
      if (!expectation(expectedEpoch)) throw new Error('invalid expected epoch')
      const { rows } = await query('SELECT public.world_location_claim($1::uuid, $2::bigint) AS claim', [userId, expectedEpoch])
      return readClaim(rows[0]?.claim)
    },
    async locationSave(batch) {
      const { rows } = await query('SELECT public.world_location_save($1::jsonb) AS results', [JSON.stringify(batch)])
      return readSaveResults(batch, rows[0]?.results)
    },
  }
}

export const EDGE_TIMEOUT_MS = 6_000
/**
 * WORLD LOCATION-2: the claim sits on the join path, so it gets its own short
 * budget (the room enables the session with a safe fallback at 1.5 s anyway);
 * a save batch is off any player's path.
 */
export const LOCATION_CLAIM_TIMEOUT_MS = 1_500
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
    async locationClaim(userId, expectedEpoch) {
      if (!UUID.test(userId)) throw new Error('invalid user id')
      if (!expectation(expectedEpoch)) throw new Error('invalid expected epoch')
      // Aborting at the budget only stops waiting: the call may still land later. That is
      // safe because the claim is conditional on `expectedEpoch` (see the migration).
      return readClaim((await call('location_claim', { userId, expectedEpoch }, claimTimeoutMs)).claim)
    },
    async locationSave(rows) { return readSaveResults(rows, (await call('location_save', { rows }, saveTimeoutMs)).results) },
    presenceAcquire: async (hostId, leaseMs) => readHostAnswer(await call('presence_acquire', { hostId, leaseMs })),
    presenceActivate: async (generation, hostId, leaseMs) => readHostAnswer(await call('presence_activate', { generation, hostId, leaseMs })),
    presenceRenew: async (generation, hostId, leaseMs) => readHostAnswer(await call('presence_renew', { generation, hostId, leaseMs })),
    presenceDrain: async (generation, hostId, drainMs) => readHostAnswer(await call('presence_drain', { generation, hostId, drainMs })),
    presenceStop: async (generation, hostId) => readHostAnswer(await call('presence_stop', { generation, hostId })),
  }
}
