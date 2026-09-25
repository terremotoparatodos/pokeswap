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

function readCommit(raw) {
  const result = typeof raw === 'string' ? JSON.parse(raw) : raw
  return { applied: result?.applied === true, settlement: result?.settlement ?? null }
}

/** `query(sql, params)` runs as service_role and resolves to `{ rows }`. */
export function createSqlPlayerData(query) {
  return {
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
  }
}

export const EDGE_TIMEOUT_MS = 6_000

/**
 * The production adapter. `secret` is WORLD_AUTHORITY_SECRET: server-held,
 * never in a frontend build, compared in constant time by the function.
 */
export function createEdgePlayerData({ url, secret, publishableKey, fetcher = fetch, timeoutMs = EDGE_TIMEOUT_MS }) {
  async function call(op, body) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
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
  }
}
