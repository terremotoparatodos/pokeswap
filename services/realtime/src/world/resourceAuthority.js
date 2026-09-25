import { randomUUID } from 'node:crypto'
import { DueQueue } from './dueQueue.js'
import { RESPAWN_MS, WORK_KIND, resourceById } from './resourceLayout.js'
import { WORKING, afterTimer, afterWork, canStartWork, lifecycleFor } from './resourceLifecycle.js'
import { ResourceStore } from './resourceStore.js'
import { readAuthorization, readSettlement } from './skillPolicy.js'

/** A worker stands orthogonally beside the node, as the client's `isBeside` requires. */
export const WORK_REACH = 1
/** Ownership and authorization together; past this the attempt is refused and the claim released. */
export const AUTHORIZE_TIMEOUT_MS = 4_000
/** Settlement retries after the first try (same actionId every time: SKILLS dedupes). */
export const SETTLE_RETRY_DELAYS_MS = Object.freeze([1_000, 3_000, 9_000])
const RECENT_REQUESTS = 32

const beside = (actor, node) => Math.abs(actor.tx - node.tx) + Math.abs(actor.ty - node.ty) === WORK_REACH

/**
 * The server authority over resource nodes and the work actions on them
 * (WORLD-1B/1C). Transport-free: the room feeds it actors and intents and
 * forwards what it emits.
 *
 * Atomicity. Node.js runs one handler at a time, so every check-and-write
 * below is atomic *until the first await*. The only awaits are the ownership
 * read and the SKILLS authorization, and before them the attempt takes a
 * synchronous **claim** on the node, the player and the Pokémon. A second
 * attempt on the same node — a second tab, another player one packet later —
 * is refused with `busy` without ever reaching SKILLS. After the awaits the
 * physical checks run again against the live actor before the node is
 * written. Exactly one attempt can win a node.
 *
 * Exactly-once. A completion runs only for an action in phase `running` and
 * moves it to `settling` before its first await, so a duplicated timer entry,
 * a reconnect or a second callback finds it already taken. Settlement is
 * retried only with the same actionId, which SKILLS must dedupe. The node is
 * depleted only after SKILLS confirms; a settlement that finally fails puts
 * the node back as it was, so nothing is ever consumed without its reward.
 */
export class ResourceAuthority {
  constructor({
    skills, ownership, lookupActor,
    now = Date.now, newActionId = randomUUID, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
    store = new ResourceStore(), queue = new DueQueue(),
    onNode = () => {}, onResult = () => {}, onDone = () => {},
  }) {
    Object.assign(this, { skills, ownership, lookupActor, now, newActionId, sleep, store, queue, onNode, onResult, onDone })
    this.actions = new Map()
    this.claims = new Map()
    this.byPlayer = new Map()
    this.byPokemon = new Map()
    this.recent = new Map()
    this.metrics = { requested: 0, started: 0, rejected: {}, completed: 0, settleRetries: 0, settleFailed: 0, cancelled: 0, respawned: 0, staleCompletions: 0 }
  }

  /** A work intent from `actor`. Resolves with the reply sent to that player. */
  async requestWork(actor, credentials, intent) {
    this.metrics.requested++
    const recent = this.#recentFor(actor.id)
    if (recent.has(intent.requestId)) return this.#reject(actor.id, intent, 'duplicate-request')
    recent.set(intent.requestId, true)
    if (recent.size > RECENT_REQUESTS) recent.delete(recent.keys().next().value)

    const check = this.#physicalCheck(actor, intent, null)
    if (check.reason) return this.#reject(actor.id, intent, check.reason)
    const { node } = check

    const actionId = this.newActionId()
    const action = { actionId, playerId: actor.id, node, pokemon: null, workKind: WORK_KIND[node.resourceKind], workedFrom: check.state, phase: 'claimed', authorized: false, startedAt: null, endsAt: null }
    this.actions.set(actionId, action)
    this.claims.set(node.id, actionId)
    this.byPlayer.set(actor.id, actionId)
    this.byPokemon.set(intent.pokemonInstanceId, actionId)

    let reason = null
    try {
      const pokemon = await this.#withTimeout(this.ownership.verify(actor.id, intent.pokemonInstanceId, credentials))
      if (!pokemon) reason = 'not-owner'
      else {
        action.pokemon = pokemon
        const answer = readAuthorization(await this.#withTimeout(this.skills.authorizeWorkAttempt({
          actionId, playerId: actor.id, pokemon, node: publicNodeFacts(node), workKind: action.workKind, requestedAt: this.now(),
        })))
        if (!answer.ok) reason = answer.reason
        else {
          action.authorized = true
          const live = this.lookupActor(actor.id)
          if (action.phase !== 'claimed') reason = 'cancelled'
          else if (!live) reason = 'left'
          else reason = this.#physicalCheck(live, intent, actionId).reason ?? null
          if (!reason) return this.#start(action, answer.durationMs, intent.requestId)
        }
      }
    } catch {
      reason = 'unavailable'
    }
    this.#release(action)
    if (action.authorized) this.#notifyCancel(action, reason)
    return this.#reject(actor.id, intent, reason)
  }

  /** Cancels the player's own action. False when there is nothing (left) to cancel. */
  cancel(playerId, actionId, reason = 'cancelled') {
    const action = this.actions.get(actionId)
    if (!action || action.playerId !== playerId) return false
    if (action.phase === 'claimed') { action.phase = 'cancelled'; return true }
    if (action.phase !== 'running') return false
    const record = this.store.write(action.node, { state: action.workedFrom })
    this.#release(action)
    this.metrics.cancelled++
    this.onNode(record)
    this.#notifyCancel(action, reason)
    this.onDone(playerId, { actionId, ok: false, reason })
    return true
  }

  /** Physical consistency after the actor moved, changed area or rejoined. */
  reconcileActor(actor) {
    const actionId = this.byPlayer.get(actor.id)
    const action = actionId ? this.actions.get(actionId) : null
    if (action?.phase !== 'running') return
    if (actor.areaId !== action.node.areaId || !beside(actor, action.node)) this.cancel(actor.id, actionId, 'moved')
  }

  /** Runs everything due. Called from the room's fixed tick. */
  tick(now = this.now()) {
    for (const task of this.queue.drain(now)) {
      if (task.type === 'complete') void this.complete(task.actionId)
      else if (task.type === 'timer') this.#timer(task.nodeId, task.version)
    }
  }

  /** Completes a running action. Safe to call any number of times: only the first does anything. */
  async complete(actionId) {
    const action = this.actions.get(actionId)
    if (!action || action.phase !== 'running' || this.store.get(action.node.id)?.actionId !== actionId) {
      this.metrics.staleCompletions++
      return false
    }
    if (this.now() < action.endsAt) {
      this.queue.push(action.endsAt, { type: 'complete', actionId })
      return false
    }
    action.phase = 'settling'
    const completedAt = this.now()
    const settlement = {
      actionId, playerId: action.playerId, pokemon: action.pokemon, node: publicNodeFacts(action.node),
      workKind: action.workKind, startedAt: action.startedAt, endsAt: action.endsAt, completedAt,
    }
    let result = null
    for (let attempt = 0; attempt <= SETTLE_RETRY_DELAYS_MS.length; attempt++) {
      if (attempt > 0) { this.metrics.settleRetries++; await this.sleep(SETTLE_RETRY_DELAYS_MS[attempt - 1]) }
      try { result = readSettlement(await this.skills.settleWork(settlement)) } catch { result = { ok: false, retryable: true, reason: 'skills-error' } }
      if (result.ok || !result.retryable) break
    }

    const lifecycle = lifecycleFor(action.node.resourceKind)
    let record
    if (result.ok) {
      const state = afterWork(lifecycle, action.workedFrom)
      const timerMs = timerDuration(action.node, lifecycle, state)
      record = this.store.write(action.node, { state, respawnAt: timerMs === null ? null : completedAt + timerMs })
      if (record.respawnAt !== null) this.queue.push(record.respawnAt, { type: 'timer', nodeId: record.id, version: record.version })
      this.metrics.completed++
    } else {
      // No depletion without a confirmed settlement.
      record = this.store.write(action.node, { state: action.workedFrom })
      this.metrics.settleFailed++
    }
    this.#release(action)
    this.onNode(record)
    this.onDone(action.playerId, result.ok
      ? { actionId, ok: true, status: result.status, ...(result.summary === undefined ? {} : { summary: result.summary }) }
      : { actionId, ok: false, reason: result.reason })
    return true
  }

  /** The player's running action, for a client that reconnects mid-action. */
  actionOf(playerId) {
    const action = this.actions.get(this.byPlayer.get(playerId))
    return action?.phase === 'running' || action?.phase === 'settling' ? action : null
  }

  #timer(nodeId, version) {
    const record = this.store.get(nodeId)
    if (!record || record.version !== version) return
    const node = resourceById(nodeId)
    const lifecycle = lifecycleFor(node.resourceKind)
    const state = afterTimer(lifecycle, record.state)
    if (state === null) return
    const timerMs = timerDuration(node, lifecycle, state)
    const next = this.store.write(node, { state, respawnAt: timerMs === null ? null : this.now() + timerMs })
    if (next.respawnAt !== null) this.queue.push(next.respawnAt, { type: 'timer', nodeId, version: next.version })
    this.metrics.respawned++
    this.onNode(next)
  }

  #start(action, durationMs, requestId) {
    const startedAt = this.now()
    action.phase = 'running'
    action.startedAt = startedAt
    action.endsAt = startedAt + durationMs
    this.claims.delete(action.node.id)
    const record = this.store.write(action.node, {
      state: WORKING, workedFrom: action.workedFrom, actionId: action.actionId, workKind: action.workKind,
      worker: { playerId: action.playerId, pokemonInstanceId: action.pokemon.instanceId, speciesId: action.pokemon.speciesId },
      actionStartedAt: startedAt, actionEndsAt: action.endsAt,
    })
    this.queue.push(action.endsAt, { type: 'complete', actionId: action.actionId })
    this.metrics.started++
    this.onNode(record)
    return this.#reply(action.playerId, { requestId, ok: true, actionId: action.actionId, nodeId: action.node.id, startedAt, endsAt: action.endsAt })
  }

  #physicalCheck(actor, intent, ownActionId) {
    const node = resourceById(intent.nodeId)
    if (!node) return { reason: 'unknown-node' }
    if (actor.areaId !== node.areaId) return { reason: 'wrong-area' }
    if (!beside(actor, node)) return { reason: 'too-far' }
    const heldBy = (map, key) => { const id = map.get(key); return id !== undefined && id !== ownActionId }
    if (heldBy(this.claims, node.id)) return { reason: 'busy' }
    const lifecycle = lifecycleFor(node.resourceKind)
    const record = this.store.get(node.id)
    const state = record?.state ?? lifecycle.initial
    if (ownActionId === null || record?.actionId !== ownActionId) {
      if (state === WORKING) return { reason: 'busy' }
      if (!canStartWork(lifecycle, state)) return { reason: state }
    }
    if (heldBy(this.byPlayer, actor.id)) return { reason: 'actor-busy' }
    if (heldBy(this.byPokemon, intent.pokemonInstanceId)) return { reason: 'pokemon-busy' }
    return { node, state }
  }

  #release(action) {
    action.phase = 'done'
    this.actions.delete(action.actionId)
    if (this.claims.get(action.node.id) === action.actionId) this.claims.delete(action.node.id)
    if (this.byPlayer.get(action.playerId) === action.actionId) this.byPlayer.delete(action.playerId)
    for (const [instanceId, actionId] of this.byPokemon) if (actionId === action.actionId) this.byPokemon.delete(instanceId)
  }

  #notifyCancel(action, reason) {
    try { void Promise.resolve(this.skills.cancelWork?.({ actionId: action.actionId, playerId: action.playerId, reason })).catch(() => undefined) } catch { /* a failing optional hook must not break the world */ }
  }

  #reject(playerId, intent, reason) {
    this.metrics.rejected[reason] = (this.metrics.rejected[reason] ?? 0) + 1
    return this.#reply(playerId, { requestId: intent.requestId, ok: false, reason })
  }

  #reply(playerId, result) {
    this.onResult(playerId, result)
    return result
  }

  #recentFor(playerId) {
    let recent = this.recent.get(playerId)
    if (!recent) { recent = new Map(); this.recent.set(playerId, recent) }
    return recent
  }

  #withTimeout(promise) {
    let timer
    return Promise.race([
      Promise.resolve(promise).finally(() => clearTimeout(timer)),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), AUTHORIZE_TIMEOUT_MS); timer.unref?.() }),
    ])
  }
}

/** The physical facts SKILLS receives about a node. */
function publicNodeFacts(node) {
  return { id: node.id, resourceKind: node.resourceKind, variantId: node.variantId, areaId: node.areaId, tx: node.tx, ty: node.ty, zone: node.zone, biome: node.biome }
}

/** How long a timed state lasts. Only depletion is timed for trees and rocks. */
function timerDuration(node, lifecycle, state) {
  if (afterTimer(lifecycle, state) === null) return null
  return state === 'depleted' ? RESPAWN_MS[node.resourceKind] : null
}
