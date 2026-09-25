/**
 * World wire contract (WORLD-1). Dependency-free: the browser imports it too.
 *
 * Clients send intents and nothing else: which node, which of their Pokémon,
 * a correlation id. Duration, reward, resulting state, respawn time and node
 * position are never read from a client — there is no field for them.
 */
export const WORLD_PROTOCOL = 1

export const WORLD_MESSAGE = Object.freeze({
  // client → server
  WORK: 'world:work',
  CANCEL: 'world:cancel',
  // server → client
  SNAPSHOT: 'world:snapshot',
  BATCH: 'world:batch',
  WORK_RESULT: 'world:work:result',
  WORK_DONE: 'world:work:done',
})

const NODE_ID = /^[a-z][a-z0-9-]{0,31}:-?\d{1,6}:-?\d{1,6}:[a-z]{1,16}$/
const ACTION_ID = /^[0-9a-f-]{8,64}$/

/** `{ nodeId, pokemonInstanceId, requestId }` or null. */
export function workIntent(value) {
  if (!value || typeof value !== 'object') return null
  const { nodeId, pokemonInstanceId, requestId } = value
  if (typeof nodeId !== 'string' || !NODE_ID.test(nodeId)) return null
  if (!Number.isSafeInteger(pokemonInstanceId) || pokemonInstanceId < 1) return null
  if (!Number.isSafeInteger(requestId) || requestId < 1) return null
  return { nodeId, pokemonInstanceId, requestId }
}

export function cancelIntent(value) {
  if (!value || typeof value !== 'object' || typeof value.actionId !== 'string' || !ACTION_ID.test(value.actionId)) return null
  return { actionId: value.actionId }
}

/**
 * What every viewer of a node is told. Base fields (kind, variant, tile) are
 * derivable from the id, so they do not travel. The worker is public on
 * purpose — the product is that others *see* who works the node — but only
 * as ids that are already public (presence actor id, companion-style Pokémon
 * id). Rewards and summaries never enter this projection.
 */
export function publicNode(record) {
  const node = { id: record.id, state: record.state, version: record.version }
  if (record.base) node.base = true
  if (record.actionId) {
    node.actionId = record.actionId
    node.workKind = record.workKind
    node.worker = { playerId: record.worker.playerId, pokemonInstanceId: record.worker.pokemonInstanceId, speciesId: record.worker.speciesId }
    node.startedAt = record.actionStartedAt
    node.endsAt = record.actionEndsAt
  }
  if (record.respawnAt !== null) node.respawnAt = record.respawnAt
  return node
}
