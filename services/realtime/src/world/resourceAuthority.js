import { randomUUID } from 'node:crypto'
import { DueQueue } from './dueQueue.js'
import { farmActionFor, nextPlotChange, plotAfterWork, plotStageAt, PLOT_KIND } from './plots.js'
import { RESPAWN_MS, WORK_KIND, nodeById } from './resourceLayout.js'
import { WORKING, afterTimer, afterWork, canStartWork, lifecycleFor } from './resourceLifecycle.js'
import { ResourceStore } from './resourceStore.js'
import { readAuthorization, readSettlement } from './skillPolicy.js'
import { hiddenBehindCanopy, standableTile, workerStand } from './workerStand.js'

/** A worker stands orthogonally beside the node, as the client's `isBeside` requires. */
export const WORK_REACH = 1
/** Ownership and authorization each; past this the attempt is refused (nothing was held). */
export const AUTHORIZE_TIMEOUT_MS = 4_000
/** Settlement retries after the first try (same actionId every time: the database dedupes). */
export const SETTLE_RETRY_DELAYS_MS = Object.freeze([1_000, 3_000, 9_000])
const RECENT_REQUESTS = 32

const beside = (actor, node) => Math.abs(actor.tx - node.tx) + Math.abs(actor.ty - node.ty) === WORK_REACH
const STAGE = { empty: 'EMPTY', planted: 'PLANTED', growing: 'GROWING', ready: 'READY' }

/**
 * The server authority over resource nodes, farm plots and the work actions on
 * them (WORLD-1B/1C, INTEGRATION-1). Transport-free: the room feeds it actors
 * and intents and forwards what it emits.
 *
 * Validate first, acquire last. An attempt runs every check that mutates
 * nothing — the physical ones, then the Pokémon's ownership, then SKILLS'
 * authorization — while holding nothing, so a request that is going to fail
 * can never make a node look `busy` to a legitimate player. Only then,
 * synchronously and with no await in between, it re-checks the live actor and
 * the node and acquires the node, the player and the Pokémon in one step.
 *
 * Exactly-once, persisted. A completion runs only for an action in phase
 * `running` and moves it to `settling` before its first await. WORLD computes
 * the node's next physical state *first* and hands it to the settlement, which
 * writes reward and node state in one database transaction (unique action_id).
 * Only a confirmed commit changes the node in memory; a failed one puts the
 * node back as it was. So there is never a reward with the tree still up, nor
 * a stump without its reward — not even across a crash between the two.
 *
 * Identity. `actor.id` is the room's authenticated user id; ownership is asked
 * of the server-side player data with that id, never with a client token.
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
    /** Players with an attempt between its first check and its acquisition. */
    this.attempting = new Set()
    this.byPlayer = new Map()
    this.byPokemon = new Map()
    this.recent = new Map()
    this.metrics = { requested: 0, started: 0, rejected: {}, completed: 0, duplicateSettlements: 0, settleRetries: 0, settleFailed: 0, cancelled: 0, respawned: 0, staleCompletions: 0, authorizedNotStarted: 0, restored: 0 }
  }

  /**
   * Puts persisted node state back after a restart. Trees and rocks still
   * depleted stay depleted until their respawn instant; plots resume their
   * stage from their server timestamps. Nothing here is guessed.
   */
  restore(overrides, now = this.now()) {
    for (const row of overrides) {
      const node = nodeById(row.nodeId)
      if (!node) continue
      if (node.resourceKind === PLOT_KIND) {
        if (!row.plot) continue
        const nextAt = nextPlotChange(row.plot, now)
        const record = this.store.write(node, { state: plotStageAt(row.plot, now), plot: row.plot, respawnAt: nextAt })
        if (nextAt !== null) this.queue.push(nextAt, { type: 'timer', nodeId: node.id, version: record.version })
      } else {
        if (row.respawnAt === null || row.respawnAt <= now) continue
        const record = this.store.write(node, { state: row.state, respawnAt: row.respawnAt })
        this.queue.push(row.respawnAt, { type: 'timer', nodeId: node.id, version: record.version })
      }
      this.metrics.restored++
    }
  }

  /** A work intent from `actor`. Resolves with the reply sent to that player. */
  async requestWork(actor, intent) {
    this.metrics.requested++
    const recent = this.#recentFor(actor.id)
    if (recent.has(intent.requestId)) return this.#reject(actor.id, intent, 'duplicate-request')
    recent.set(intent.requestId, true)
    if (recent.size > RECENT_REQUESTS) recent.delete(recent.keys().next().value)
    if (this.attempting.has(actor.id)) return this.#reject(actor.id, intent, 'in-flight')

    // 1 · Physical checks. Nothing is held yet.
    const check = this.#physicalCheck(actor, intent)
    if (check.reason) return this.#reject(actor.id, intent, check.reason)
    const { node } = check
    const actionId = this.newActionId()
    const workKind = WORK_KIND[node.resourceKind]

    this.attempting.add(actor.id)
    let authorized = false
    let reason = null
    let message
    try {
      // 2 · Ownership, then 3 · SKILLS. Still nothing held.
      const pokemon = await this.#withTimeout(this.ownership.verify(actor.id, intent.pokemonInstanceId))
      if (!pokemon) reason = 'not-owner'
      else {
        const answer = readAuthorization(await this.#withTimeout(this.skills.authorizeWorkAttempt({
          actionId, playerId: actor.id, pokemon, node: publicNodeFacts(node), workKind, requestedAt: this.now(),
          ...(check.farm ? { farm: check.farm } : {}),
        })))
        if (!answer.ok) { reason = answer.reason; message = answer.message }
        else if (check.farm?.action === 'plant' && !answer.plot) reason = 'skills-invalid'
        else {
          authorized = true
          // 4 · Re-check against the live world and acquire, with no await in between.
          const live = this.lookupActor(actor.id)
          const recheck = live ? this.#physicalCheck(live, intent) : { reason: 'left' }
          if (recheck.reason) reason = recheck.reason
          else {
            const action = {
              actionId, playerId: actor.id, node, pokemon, workKind, workedFrom: recheck.state, plotBefore: recheck.plot ?? null,
              farmAction: recheck.farm?.action ?? null, plotGrant: answer.plot ?? null, phase: 'running', startedAt: null, endsAt: null,
              // Visual only, decided once from the validated tile: never recomputed (WORLD VISUAL-1).
              stand: workerStand(node, live, standableTile(node.areaId), hiddenBehindCanopy(node.areaId)),
            }
            return this.#start(action, answer.durationMs, intent.requestId, answer.details)
          }
        }
      }
    } catch {
      reason = 'unavailable'
    } finally {
      this.attempting.delete(actor.id)
    }
    if (authorized) {
      this.metrics.authorizedNotStarted++
      this.#notifyCancel({ actionId, playerId: actor.id }, reason)
    }
    return this.#reject(actor.id, intent, reason, message)
  }

  /** Cancels the player's own action. False when there is nothing (left) to cancel. */
  cancel(playerId, actionId, reason = 'cancelled') {
    const action = this.actions.get(actionId)
    if (!action || action.playerId !== playerId || action.phase !== 'running') return false
    const record = this.store.write(action.node, this.#restingState(action))
    this.#release(action)
    this.metrics.cancelled++
    this.onNode(record)
    this.#notifyCancel(action, reason)
    this.onDone(playerId, { actionId, ok: false, reason })
    return true
  }

  /**
   * A new connection for this player: request ids are per connection (a
   * reloaded page counts from 1 again), so the previous connection's ids are
   * forgotten. Their effects are not: every physical check still applies.
   */
  newConnection(playerId) {
    this.recent.delete(playerId)
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
    // WORLD decides the node's next physical state before anything is paid,
    // and the settlement writes both together.
    const next = this.#nextState(action, completedAt)
    const settlement = {
      actionId, playerId: action.playerId, pokemon: action.pokemon, node: publicNodeFacts(action.node),
      workKind: action.workKind, startedAt: action.startedAt, endsAt: action.endsAt, completedAt,
      world: persistedNode(action.node, next),
    }
    let result = null
    for (let attempt = 0; attempt <= SETTLE_RETRY_DELAYS_MS.length; attempt++) {
      if (attempt > 0) { this.metrics.settleRetries++; await this.sleep(SETTLE_RETRY_DELAYS_MS[attempt - 1]) }
      try { result = readSettlement(await this.skills.settleWork(settlement)) } catch { result = { ok: false, retryable: true, reason: 'skills-error' } }
      if (result.ok || !result.retryable) break
    }

    let record
    if (result.ok) {
      record = this.store.write(action.node, next)
      if (record.respawnAt !== null) this.queue.push(record.respawnAt, { type: 'timer', nodeId: record.id, version: record.version })
      this.metrics.completed++
      if (result.status === 'duplicate') this.metrics.duplicateSettlements++
    } else {
      // No change without a confirmed settlement.
      record = this.store.write(action.node, this.#restingState(action))
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

  /** The node's state after a completed action: WORLD's decision, handed to the settlement. */
  #nextState(action, now) {
    if (action.node.resourceKind === PLOT_KIND) {
      const plot = plotAfterWork(action.farmAction, action.plotBefore, { now, playerId: action.playerId, cropId: action.plotGrant?.cropId, growMs: action.plotGrant?.growMs })
      if (!plot) return { state: 'empty' }
      return { state: plotStageAt(plot, now), plot, respawnAt: nextPlotChange(plot, now) }
    }
    const lifecycle = lifecycleFor(action.node.resourceKind)
    const state = afterWork(lifecycle, action.workedFrom)
    return { state, respawnAt: afterTimer(lifecycle, state) === null ? null : now + RESPAWN_MS[action.node.resourceKind] }
  }

  /** Where an action that did not complete leaves the node: as it was. */
  #restingState(action) {
    if (action.node.resourceKind !== PLOT_KIND || !action.plotBefore) return { state: action.workedFrom }
    const now = this.now()
    return { state: plotStageAt(action.plotBefore, now), plot: action.plotBefore, respawnAt: nextPlotChange(action.plotBefore, now) }
  }

  #timer(nodeId, version) {
    const record = this.store.get(nodeId)
    if (!record || record.version !== version || record.actionId) return
    const node = nodeById(nodeId)
    const now = this.now()
    let next
    if (node.resourceKind === PLOT_KIND) {
      if (!record.plot) return
      next = { state: plotStageAt(record.plot, now), plot: record.plot, respawnAt: nextPlotChange(record.plot, now) }
    } else {
      const state = afterTimer(lifecycleFor(node.resourceKind), record.state)
      if (state === null) return
      next = { state }
      this.metrics.respawned++
    }
    const written = this.store.write(node, next)
    if (written.respawnAt !== null) this.queue.push(written.respawnAt, { type: 'timer', nodeId, version: written.version })
    this.onNode(written)
  }

  /** Acquisition: node, player and Pokémon in one synchronous step. */
  #start(action, durationMs, requestId, details) {
    const startedAt = this.now()
    action.startedAt = startedAt
    action.endsAt = startedAt + durationMs
    this.actions.set(action.actionId, action)
    this.byPlayer.set(action.playerId, action.actionId)
    this.byPokemon.set(action.pokemon.instanceId, action.actionId)
    const record = this.store.write(action.node, {
      state: WORKING, workedFrom: action.workedFrom, actionId: action.actionId, workKind: action.workKind,
      worker: { playerId: action.playerId, pokemonInstanceId: action.pokemon.instanceId, speciesId: action.pokemon.speciesId, stand: action.stand },
      actionStartedAt: startedAt, actionEndsAt: action.endsAt, plot: action.plotBefore,
    })
    this.queue.push(action.endsAt, { type: 'complete', actionId: action.actionId })
    this.metrics.started++
    this.onNode(record)
    return this.#reply(action.playerId, {
      requestId, ok: true, actionId: action.actionId, nodeId: action.node.id, startedAt, endsAt: action.endsAt,
      ...(action.farmAction ? { farmAction: action.farmAction } : {}),
      ...(details === undefined ? {} : { details }),
    })
  }

  /** Checks that mutate nothing. `state` is the node state an action would start from. */
  #physicalCheck(actor, intent) {
    const node = nodeById(intent.nodeId)
    if (!node) return { reason: 'unknown-node' }
    if (actor.areaId !== node.areaId) return { reason: 'wrong-area' }
    if (!beside(actor, node)) return { reason: 'too-far' }
    const lifecycle = lifecycleFor(node.resourceKind)
    const record = this.store.get(node.id)
    const state = record?.state ?? lifecycle.initial
    if (state === WORKING) return { reason: 'busy' }
    if (!canStartWork(lifecycle, state)) return { reason: state }
    if (this.byPlayer.has(actor.id)) return { reason: 'actor-busy' }
    if (this.byPokemon.has(intent.pokemonInstanceId)) return { reason: 'pokemon-busy' }
    if (node.resourceKind !== PLOT_KIND) return { node, state }
    const plot = record?.plot ?? null
    const farm = farmActionFor(state, plot, actor.id)
    if (farm.reason) return { reason: farm.reason }
    if (farm.action === 'plant' && !intent.cropId) return { reason: 'choose-crop' }
    return {
      node, state, plot,
      farm: { action: farm.action, plotKind: node.plotKind, stage: STAGE[state], cropId: plot?.cropId ?? null, tended: plot?.tended ?? false, requestedCropId: intent.cropId ?? null },
    }
  }

  #release(action) {
    action.phase = 'done'
    this.actions.delete(action.actionId)
    if (this.byPlayer.get(action.playerId) === action.actionId) this.byPlayer.delete(action.playerId)
    for (const [instanceId, actionId] of this.byPokemon) if (actionId === action.actionId) this.byPokemon.delete(instanceId)
  }

  #notifyCancel(action, reason) {
    try { void Promise.resolve(this.skills.cancelWork?.({ actionId: action.actionId, playerId: action.playerId, reason })).catch(() => undefined) } catch { /* a failing optional hook must not break the world */ }
  }

  #reject(playerId, intent, reason, message) {
    this.metrics.rejected[reason] = (this.metrics.rejected[reason] ?? 0) + 1
    return this.#reply(playerId, { requestId: intent.requestId, ok: false, reason, ...(message ? { message } : {}) })
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

/** The node state the settlement persists with the reward (world_commit_work's p_node). */
function persistedNode(node, next) {
  const initial = lifecycleFor(node.resourceKind).initial
  const base = next.state === initial && !next.plot
  return {
    nodeId: node.id, areaId: node.areaId, chunkId: node.chunkId, state: next.state,
    respawnAt: next.respawnAt ?? null, plot: next.plot ?? null, base,
  }
}
