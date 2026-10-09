/**
 * World wire contract (WORLD-1). Dependency-free: the browser imports it too.
 *
 * Clients send intents and nothing else: which node, which of their Pokémon,
 * a correlation id. Duration, reward, resulting state, respawn time and node
 * position are never read from a client — there is no field for them.
 *
 * Protocol 2 (SKILLS PROB-2): work is a run of attempts whose number the
 * server draws in secret, so NO message tells a client when an action will
 * end — no `endsAt`, no duration, no attempt count, no chance. A running
 * action is public as who works what, where, and since when (`startedAt`, for
 * the animation phase on the shared clock and WORK_TICK_MS); its end is the
 * node change and `world:work:done`. A client that declares an older protocol
 * (or none) gets no world state and `client-outdated` for any work intent.
 *
 * Protocol 3 (RESOURCE YIELD-2): a tree or rock gives several units before it
 * depletes; its stock is hidden. One reservation is a SEQUENCE of units: each
 * confirmed unit reaches its owner as `world:work:yield { actionId, index,
 * summary }` and everyone sees `yieldAt` change on the working node (a flash);
 * the sequence ends with `world:work:done { actionId, ok, reason, total }`.
 * No message carries the stock, the stock left, the settlement id, the next
 * success, a duration, attempts, the chance, or a partial node's refill time;
 * a partially worked node looks exactly like a full one.
 */
export const WORLD_PROTOCOL = 3

/**
 * WORLD's work tick (SKILLS PROB-2): one attempt of a work action, and one
 * swing of the worker's animation. The single definition: the authority
 * passes it to SKILLS as the attempt length, and every client derives the
 * animation phase from it and the server clock (`serverNow − startedAt`).
 */
export const WORK_TICK_MS = 600

/** ECO-GAMEPLAY-1 (experimental): the ECO population protocol a client declares on join (`ecoProtocol`). */
export const ECO_PROTOCOL = 1

/**
 * ECO-GAMEPLAY-2 (experimental, PROVISIONAL): Chebyshev tiles from a player to an encounter for a
 * test-battle engage. ECO-BATTLE-ENDING-1: 3 (was 6), by the owner's decision. It limits STARTING a
 * battle only — a running battle is never cancelled by distance. The server enforces it; a client
 * only uses it to grey out a button it would refuse anyway.
 */
export const ECO_ENGAGE_RANGE = 3

export const WORLD_MESSAGE = Object.freeze({
  // client → server
  WORK: 'world:work',
  CANCEL: 'world:cancel',
  /** ECO-GAMEPLAY-1 (experimental, development only): a test retirement of one encounter. */
  ECO_DEV_RETIRE: 'world:eco-dev-retire',
  /** ECO-GAMEPLAY-2 (experimental, development only): reserve one encounter for a test battle. */
  ECO_ENGAGE: 'world:eco-engage',
  /** ECO-GAMEPLAY-2: the battle core's TransportAction (its controller is the transport's player, never the payload's). */
  ECO_BATTLE_ACTION: 'world:eco-battle-action',
  ECO_FLEE: 'world:eco-flee',
  // server → client
  SNAPSHOT: 'world:snapshot',
  BATCH: 'world:batch',
  WORK_RESULT: 'world:work:result',
  WORK_DONE: 'world:work:done',
  /** One confirmed unit of the owner's sequence (YIELD-2, owner only). */
  WORK_YIELD: 'world:work:yield',
  WILD: 'world:wild',
  /** ECO-GAMEPLAY-1 (experimental): the shared encounter population of the viewer's area, whole. */
  ECO: 'world:eco',
  ECO_DEV_RETIRE_RESULT: 'world:eco-dev-retire-result',
  /** ECO-GAMEPLAY-2, owner only: the answer to an engage, or the running battle again after a snapshot (`resumed`). */
  ECO_ENGAGE_RESULT: 'world:eco-engage-result',
  /** ECO-GAMEPLAY-2, owner only: battle snapshot and events, and the result of an action. */
  ECO_BATTLE: 'world:eco-battle',
  /** ECO-GAMEPLAY-2, owner only: the one end of a reservation, decided by the server. */
  ECO_BATTLE_END: 'world:eco-battle-end',
  /**
   * ECO-BATTLE-SPECTATORS-1, every OTHER ECO viewer of the battle's area: its public view (a
   * whitelisted projection, see ecoBattlePublic.js). Never sent to the owner, never asked for.
   */
  ECO_BATTLE_PUBLIC: 'world:eco-battle-public',
  /** The session's own XP, materials and workable Pokémon (server → that player only). */
  PLAYER_STATE: 'player:state',
})

const NODE_ID = /^[a-z][a-z0-9-]{0,31}:-?\d{1,6}:-?\d{1,6}:[a-z]{1,16}$/
const ACTION_ID = /^[0-9a-f-]{8,64}$/

const CROP_ID = /^[a-z]{2,16}$/

/**
 * `{ nodeId, pokemonInstanceId, requestId, cropId? }` or null. `cropId` is only
 * which crop the player *asks* to plant; SKILLS decides whether it may.
 * Anything else in the payload (xp, reward, quantity, userId, duration…) is
 * never read.
 */
export function workIntent(value) {
  if (!value || typeof value !== 'object') return null
  const { nodeId, pokemonInstanceId, requestId, cropId } = value
  if (typeof nodeId !== 'string' || !NODE_ID.test(nodeId)) return null
  if (!Number.isSafeInteger(pokemonInstanceId) || pokemonInstanceId < 1) return null
  if (!Number.isSafeInteger(requestId) || requestId < 1) return null
  if (cropId !== undefined && cropId !== null && (typeof cropId !== 'string' || !CROP_ID.test(cropId))) return null
  return { nodeId, pokemonInstanceId, requestId, cropId: cropId ?? null }
}

export function cancelIntent(value) {
  if (!value || typeof value !== 'object' || typeof value.actionId !== 'string' || !ACTION_ID.test(value.actionId)) return null
  return { actionId: value.actionId }
}

/** An encounter id as the server writes it: `<namespace>:<area>:<nest>:<generation>:<member>`. Opaque to clients. */
const ENCOUNTER_ID = /^[a-z0-9-]{1,64}:[a-z0-9-]{1,32}:[a-z0-9-]{1,48}:[0-9]{1,9}:[0-9]{1,3}$/

/**
 * `{ requestId, encounterId }` or null (ECO-GAMEPLAY-1 test retirement). Anything else in the
 * payload (cause, reward, area, species…) is never read: the server fixes the cause and decides.
 */
export function ecoRetireIntent(value) {
  if (!value || typeof value !== 'object') return null
  const { requestId, encounterId } = value
  if (!Number.isSafeInteger(requestId) || requestId < 1) return null
  if (typeof encounterId !== 'string' || !ENCOUNTER_ID.test(encounterId)) return null
  return { requestId, encounterId }
}

/** ECO-GAMEPLAY-2: `{ requestId, encounterId }` or null. Nothing else is read: the server decides the battle. */
export function ecoEngageIntent(value) {
  return ecoRetireIntent(value)
}

/** A battle id as the server writes it. Opaque to clients. */
const BATTLE_ID = /^eco-battle-[a-z0-9]{1,16}-[0-9a-f]{8}$/

/** ECO-GAMEPLAY-2: `{ battleId }` or null. */
export function ecoFleeIntent(value) {
  if (!value || typeof value !== 'object' || typeof value.battleId !== 'string' || !BATTLE_ID.test(value.battleId)) return null
  return { battleId: value.battleId }
}

/**
 * What every viewer of a node is told. Base fields (kind, variant, tile) are
 * derivable from the id, so they do not travel. The worker is public on
 * purpose — the product is that others *see* who works the node — but only
 * as ids that are already public (presence actor id, companion-style Pokémon
 * id). Rewards and summaries never enter this projection.
 */
export function publicNode(record) {
  // A partial node (available, stock left, not reserved) is private (YIELD-2):
  // every viewer sees a base node. No stock, no token, no refill time.
  if (record.stock !== null && record.stock !== undefined && !record.actionId) {
    return { id: record.id, state: 'available', version: record.version, base: true }
  }
  const node = { id: record.id, state: record.state, version: record.version }
  if (record.base) node.base = true
  if (record.actionId) {
    node.actionId = record.actionId
    node.workKind = record.workKind
    node.worker = { playerId: record.worker.playerId, pokemonInstanceId: record.worker.pokemonInstanceId, speciesId: record.worker.speciesId }
    // Additive and visual (WORLD VISUAL-1): a client that does not read it keeps its own placement.
    const stand = record.worker.stand
    if (stand) node.worker.stand = { tx: stand.tx, ty: stand.ty, dir: stand.dir }
    // The start only: the end is the server's secret draw (PROB-2).
    node.startedAt = record.actionStartedAt
    // When the last unit was confirmed (YIELD-2): a flash for owner and observers, never a count.
    if (record.lastYieldAt !== null && record.lastYieldAt !== undefined) node.yieldAt = record.lastYieldAt
  }
  if (record.respawnAt !== null) node.respawnAt = record.respawnAt
  // A plot's crop is public: everyone sees what grows there, whose it is and when it is ready.
  if (record.plot) {
    node.plot = { cropId: record.plot.cropId, ownerId: record.plot.ownerId, plantedAt: record.plot.plantedAt, growingAt: record.plot.growingAt, readyAt: record.plot.readyAt, tended: record.plot.tended }
  }
  return node
}
