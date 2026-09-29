import { randomUUID } from 'node:crypto'
import { DueQueue } from './dueQueue.js'
import { MAX_UNITS, cryptoRandom, drawStock, generationAt, isPartial, settlementIdOf, stockedUnit } from './nodeStock.js'
import { farmActionFor, nextPlotChange, plotAfterWork, plotStageAt, PLOT_KIND } from './plots.js'
import { RESPAWN_MS, WORK_KIND, nodeById } from './resourceLayout.js'
import { WORKING, afterTimer, afterWork, canStartWork, lifecycleFor } from './resourceLifecycle.js'
import { ResourceStore } from './resourceStore.js'
import { readAuthorization, readSettlement } from './skillPolicy.js'
import { standableTile, workPlacement } from './workPlacement.js'
import { WorkRateLimiter } from './workRateLimit.js'
import { WORK_TICK_MS } from './worldProtocol.js'

/** A trainer asks for work orthogonally beside the node, as the client's `isBeside` requires. */
export const WORK_REACH = 1
/** Ownership and authorization each; past this the attempt is refused (nothing was held). */
export const AUTHORIZE_TIMEOUT_MS = 4_000
/** Settlement retries after the first try (same settlement id every time: the database dedupes). */
export const SETTLE_RETRY_DELAYS_MS = Object.freeze([1_000, 3_000, 9_000])
const RECENT_REQUESTS = 32
/** At most one rate-limit log line per this window, with totals (bounded log). */
export const RATE_LOG_WINDOW_MS = 60_000
/**
 * Resynchronization of a node whose last commit was ambiguous or stale (YIELD-2
 * recovery): the first step runs at once, then after each delay here (the last
 * one repeats until the database answers). The node never takes work meanwhile.
 */
export const RESYNC_DELAYS_MS = Object.freeze([1_000, 3_000, 9_000, 30_000])
/** Steps the owner's worker waits for; after them the player and Pokémon are freed and only the node stays held. */
export const RESYNC_HOLD_STEPS = 4

const beside = (actor, node) => Math.abs(actor.tx - node.tx) + Math.abs(actor.ty - node.ty) === WORK_REACH
/** While working, the trainer's reference tile is its waiting tile; older actions without one keep the reach rule. */
const atAnchor = (actor, action) => (action.anchor ? actor.tx === action.anchor.tx && actor.ty === action.anchor.ty : beside(actor, action.node))
const STAGE = { empty: 'EMPTY', planted: 'PLANTED', growing: 'GROWING', ready: 'READY' }

/**
 * The server authority over resource nodes, farm plots and the work on them
 * (WORLD-1B/1C, INTEGRATION-1). Transport-free: the room feeds it actors and
 * intents and forwards what it emits.
 *
 * Validate first, acquire last. An attempt runs every check that mutates
 * nothing — the physical ones, then the Pokémon's ownership, then SKILLS'
 * authorization — while holding nothing, so a request that is going to fail
 * can never make a node look `busy` to a legitimate player. Only then,
 * synchronously and with no await in between, it re-checks the live actor and
 * the node and acquires the node, the player and the Pokémon in one step.
 *
 * Sequences (RESOURCE YIELD-2). One reservation of a node is a SEQUENCE with a
 * private base `actionId`. A tree or rock yields units until its hidden stock
 * runs out (a farm plot is a sequence of one): each unit has its own SKILLS
 * authorization and secret attempt draw, and its own exactly-once settlement
 * under `settlementId = <actionId>-<hex2 index>`, which also carries the node's
 * next stock and the CAS the database checks (nodeStock.js).
 *
 * Pipeline. When unit i's attempts end it enters `settling` and unit i+1's
 * attempts start at once, on the same tick grid, so hosted commit latency never
 * pauses the worker. Commits run strictly in order on a per-sequence chain;
 * `onYield` for a unit fires only after its commit is confirmed; a unit whose
 * commit fails for good (or is `stale_node`) aborts every later unit, unpaid.
 *
 * Stopping. Walking away or cancelling drops the unit still attempting (never
 * paid) and lets the units already settling finish. A disconnect lets the unit
 * in progress finish and settle (`stopAfterCurrent`); a disconnected player
 * never starts another unit, and a reconnection at the waiting tile before that
 * unit ends continues the sequence. The node stays reserved until every
 * pending commit resolves, then `onDone` reports the reason and the total.
 *
 * Secret end (SKILLS PROB-2). A unit's end lives only here and in the due
 * queue: the node record, every reply and every broadcast carry the
 * sequence's start alone. Losing the process loses the unit in progress,
 * never pays twice; settled units and the partial stock are in the database.
 *
 * Resynchronization (YIELD-2 recovery). A unit whose commit ends without a
 * definitive answer (every retry failed: the database may have applied it) or
 * with `stale_node` (the database's node is not what this memory thinks) leaves
 * the memory untrustworthy. The sequence then does not write its node from
 * memory: it enters `resyncing` and the node refuses work (`busy`). Each step
 * first asks the database about the doubtful unit again, with the SAME
 * settlement (dedupe is authoritative: applied, duplicate — its stored
 * original — or stale), and only then reads the node back through the private
 * `loadNodes` (world_load_nodes: the database's rows and clock), filtered here
 * by node id. The node is written from that row: full, partial, depleted or
 * expired as the database says. `onYield` still fires only for a confirmed
 * unit. Without `loadNodes` (no database) memory stays the only record.
 *
 * Authorizations (M-5). Every unit that ends unpaid for good — dropped,
 * aborted, refused, `stale_node` — is closed with `cancelWork` (idempotent),
 * never left to its TTL. A unit whose commit may still be confirmed by dedupe
 * is NOT closed until the database has answered for it.
 *
 * Placement (WORLD VISUAL-2). On acquisition the worker Pokémon takes the
 * trainer's validated tile and the trainer is moved, by the server, to a
 * waiting tile (`workPlacement`). That tile becomes the sequence's anchor:
 * the anchor is set before the move, so the server's own move never reads as
 * the trainer walking away; leaving the anchor afterwards still cancels.
 */
export class ResourceAuthority {
  constructor({
    skills, ownership, lookupActor,
    now = Date.now, newActionId = randomUUID, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
    store = new ResourceStore(), queue = new DueQueue(),
    onNode = () => {}, onResult = () => {}, onDone = () => {},
    /** One confirmed unit of a sequence, for its owner (YIELD-2). */
    onYield = () => {},
    /** Moves a trainer authoritatively (presence publishes it). Default: the looked-up actor object only. */
    placeActor = (playerId, place) => { const actor = lookupActor(playerId); if (actor) Object.assign(actor, place) },
    /** Per-player pacing of work intents (workRateLimit.js). */
    rateLimit = new WorkRateLimiter(),
    /** Draws new generations' stock. Server randomness; tests inject a script. */
    random = cryptoRandom,
    /** The database's node overrides (PlayerDataAuthority.loadNodes, private): the resync source. Null: no database. */
    loadNodes = null,
    log = () => {},
  }) {
    Object.assign(this, { skills, ownership, lookupActor, now, newActionId, sleep, store, queue, onNode, onResult, onDone, onYield, placeActor, rateLimit, random, loadNodes, log })
    this.rateLog = { lastLogAt: null, intents: 0, players: new Set() }
    this.actions = new Map()
    /** Nodes being resynchronized from the database, by node id: they take no work. */
    this.syncing = new Map()
    /** One database read at a time, shared by every node resyncing. */
    this.loading = null
    /** Players with an attempt between its first check and its acquisition. */
    this.attempting = new Set()
    this.byPlayer = new Map()
    this.byPokemon = new Map()
    this.recent = new Map()
    this.metrics = {
      requested: 0, rateLimited: 0, started: 0, rejected: {}, completed: 0, duplicateSettlements: 0, settleRetries: 0, settleFailed: 0,
      cancelled: 0, respawned: 0, staleCompletions: 0, authorizedNotStarted: 0, restored: 0,
      units: 0, staleNodes: 0, refilled: 0, disconnectedStops: 0,
      // YIELD-2 recovery.
      commitAttempts: 0, ambiguousCommits: 0, resyncs: 0, resyncSteps: 0, resyncFailures: 0, resynced: 0, recoveredUnits: 0, lateConfirmations: 0, heldReleases: 0,
    }
  }

  /**
   * Puts persisted node state back after a restart. Trees and rocks still
   * depleted stay depleted until their respawn instant; partial nodes keep
   * their stock and token until their refill instant (expired ones are full
   * again: they are skipped); plots resume their stage from their server
   * timestamps. Nothing here is guessed.
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
        const partial = row.state === 'available' && Number.isInteger(row.stockRemaining)
        if (row.state === 'available' && !partial) continue
        const record = this.store.write(node, partial
          ? { state: 'available', stock: row.stockRemaining, token: row.actionId, respawnAt: row.respawnAt }
          : { state: row.state, respawnAt: row.respawnAt, token: row.actionId ?? null })
        this.queue.push(row.respawnAt, { type: 'timer', nodeId: node.id, version: record.version })
      }
      this.metrics.restored++
    }
  }

  /** A work intent from `actor`. Resolves with the reply sent to that player. */
  async requestWork(actor, intent) {
    this.metrics.requested++
    // 0 · Pacing, before anything is read or held (a refused intent costs nothing).
    if (!this.rateLimit.take(actor.id, this.now())) {
      this.#noteRateLimited(actor.id)
      return this.#reject(actor.id, intent, 'rate-limited')
    }
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
    const settlementId = settlementIdOf(actionId, 0)
    const workKind = WORK_KIND[node.resourceKind]

    this.attempting.add(actor.id)
    let authorized = false
    let reason = null
    let message
    try {
      // 2 · Ownership, then 3 · SKILLS (unit 0 is authorized under its settlement id). Still nothing held.
      const pokemon = await this.#withTimeout(this.ownership.verify(actor.id, intent.pokemonInstanceId))
      if (!pokemon) reason = 'not-owner'
      else {
        const answer = readAuthorization(await this.#withTimeout(this.skills.authorizeWorkAttempt({
          actionId: settlementId, playerId: actor.id, pokemon, node: publicNodeFacts(node), workKind, requestedAt: this.now(), attemptMs: WORK_TICK_MS,
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
            const gather = node.resourceKind !== PLOT_KIND
            const reservedAt = this.now()
            // The node's generation at the reservation instant (rule B): a live partial's
            // token and stock, or a new generation whose hidden stock is drawn now.
            const before = gather ? this.store.get(node.id) : null
            const generation = gather ? generationAt(before, reservedAt) : null
            const action = {
              actionId, playerId: actor.id, node, pokemon, workKind, workedFrom: recheck.state, plotBefore: recheck.plot ?? null,
              farmAction: recheck.farm?.action ?? null, plotGrant: answer.plot ?? null, phase: 'running', startedAt: null, endsAt: null,
              // Decided once, from the live validated tile: the Pokémon takes it, the trainer waits at `anchor`.
              stand: recheck.placement.stand, anchor: recheck.placement.wait,
              // The sequence (YIELD-2).
              gather, reservedAt, index: 0, settlementId, unitStartedAt: null, authorizing: false,
              expectedToken: generation?.expectedToken ?? null,
              stockBefore: gather ? (generation.fresh ? drawStock(answer.stock ?? null, this.random) : generation.stockBefore) : null,
              restingBefore: gather && !generation.fresh ? { stock: before.stock, token: before.token, respawnAt: before.respawnAt } : null,
              committed: null, pending: 0, chain: Promise.resolve(), abortCommits: false,
              stop: null, stopAfterCurrent: false, disconnected: false, refusal: null,
              total: { units: 0, xpGained: 0, rewards: new Map() },
              working: null,
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
      this.#notifyCancel(settlementId, actor.id, reason)
    }
    return this.#reject(actor.id, intent, reason, message)
  }

  /**
   * Stops the player's own sequence: the unit still attempting is dropped
   * (never paid); units already settling finish, then the node is released.
   * False when there is nothing (left) to stop.
   */
  cancel(playerId, actionId, reason = 'cancelled') {
    const action = this.actions.get(actionId)
    if (!action || action.playerId !== playerId || action.phase !== 'running') return false
    this.#dropCurrent(action, reason)
    action.stop ??= reason
    this.metrics.cancelled++
    this.#maybeFinish(action)
    return true
  }

  /**
   * The owner's socket is gone: the unit in progress may finish and settle,
   * then the worker retires. A disconnected player never starts another unit.
   */
  ownerLeft(playerId) {
    const action = this.actions.get(this.byPlayer.get(playerId))
    if (!action || action.phase === 'done') return
    action.stopAfterCurrent = true
    action.disconnected = true
    this.metrics.disconnectedStops++
  }

  /**
   * A new connection for this player: request ids are per connection (a
   * reloaded page counts from 1 again), so the previous connection's ids are
   * forgotten. Their effects are not: every physical check still applies.
   */
  newConnection(playerId) {
    this.recent.delete(playerId)
  }

  /**
   * Physical consistency after the actor moved, changed area or rejoined.
   * Back at the waiting tile after a disconnect, before the unit in progress
   * ends: the sequence continues.
   */
  reconcileActor(actor) {
    const actionId = this.byPlayer.get(actor.id)
    const action = actionId ? this.actions.get(actionId) : null
    if (action?.phase !== 'running') return
    const inPlace = actor.areaId === action.node.areaId && atAnchor(actor, action)
    if (!inPlace) { this.cancel(actor.id, actionId, 'moved'); return }
    if (action.disconnected && !action.stop) {
      action.disconnected = false
      action.stopAfterCurrent = false
    }
  }

  /** Runs everything due. Called from the room's fixed tick. */
  tick(now = this.now()) {
    for (const task of this.queue.drain(now)) {
      if (task.type === 'complete') void this.complete(task.actionId)
      else if (task.type === 'timer') this.#timer(task.nodeId, task.version)
      else if (task.type === 'resync') { const job = this.syncing.get(task.nodeId); if (job) void this.#resyncStep(job) }
    }
  }

  /**
   * Ends the attempts of the sequence's current unit: it enters `settling`, its
   * commit joins the ordered chain, and — stock, stop flags and the unit guard
   * permitting — the next unit's attempts start right away. Resolves once this
   * unit's commit is done. Safe to call any number of times: only the first
   * call for a unit does anything.
   */
  async complete(actionId) {
    const action = this.actions.get(actionId)
    if (!action || action.phase !== 'running' || action.authorizing || this.store.get(action.node.id)?.actionId !== actionId) {
      this.metrics.staleCompletions++
      return false
    }
    if (this.now() < action.endsAt) {
      this.queue.push(action.endsAt, { type: 'complete', actionId })
      return false
    }
    action.phase = 'settling'
    const completedAt = this.now()
    const unit = { index: action.index, settlementId: action.settlementId, startedAt: action.unitStartedAt, endsAt: action.endsAt }
    // WORLD decides the node's next physical state before anything is paid,
    // and the settlement writes both together.
    let next
    let world
    if (action.gather) {
      ({ next, world } = stockedUnit(action.node, {
        settlementId: unit.settlementId, before: action.stockBefore, expectedToken: action.expectedToken, reservedAt: action.reservedAt, endsAt: unit.endsAt,
      }))
      // What the next unit's commit will expect, if this one is confirmed.
      action.expectedToken = unit.settlementId
      action.stockBefore = next.stock ?? 0
    } else {
      next = this.#nextState(action, completedAt)
      world = persistedNode(action.node, next)
    }
    const settlement = {
      actionId: unit.settlementId, playerId: action.playerId, pokemon: action.pokemon, node: publicNodeFacts(action.node),
      workKind: action.workKind, startedAt: unit.startedAt, endsAt: unit.endsAt, completedAt, world,
    }
    action.pending++
    const committed = action.chain.then(() => this.#commitUnit(action, unit, settlement, next))
    action.chain = committed

    // Pipeline: the next unit starts now, on the tick grid, while this one settles.
    const more = action.gather && action.stockBefore > 0 && action.index + 1 < MAX_UNITS
    if (more && !action.stop && !action.stopAfterCurrent) void this.#nextUnit(action, unit.endsAt)
    else if (more && action.stopAfterCurrent && action.disconnected) action.stop ??= 'disconnected'
    else if (action.gather && action.stockBefore > 0 && !more) action.stop ??= 'limit'
    await committed
    return true
  }

  /** The player's sequence, for a client that reconnects mid-sequence. */
  actionOf(playerId) {
    const action = this.actions.get(this.byPlayer.get(playerId))
    return action && action.phase !== 'done' ? action : null
  }

  /** Authorizes and starts unit `index + 1`, its attempts counted from `startAt` (the previous unit's end). */
  async #nextUnit(action, startAt) {
    action.index++
    const settlementId = settlementIdOf(action.actionId, action.index)
    Object.assign(action, { phase: 'running', authorizing: true, settlementId, unitStartedAt: startAt, endsAt: null })
    let answer
    try {
      answer = readAuthorization(await this.#withTimeout(this.skills.authorizeWorkAttempt({
        actionId: settlementId, playerId: action.playerId, pokemon: action.pokemon, node: publicNodeFacts(action.node),
        workKind: action.workKind, requestedAt: this.now(), attemptMs: WORK_TICK_MS,
      })))
    } catch {
      answer = { ok: false, reason: 'unavailable' }
    }
    if (action.settlementId !== settlementId || action.phase !== 'running') {
      // Dropped while SKILLS answered (walked away, cancelled, an earlier commit failed).
      if (answer.ok) this.#notifyCancel(settlementId, action.playerId, 'dropped')
      return
    }
    action.authorizing = false
    if (!answer.ok) {
      action.stop ??= 'refused'
      action.refusal = answer.message ?? null
      action.phase = 'settling'
      this.#maybeFinish(action)
      return
    }
    action.endsAt = startAt + answer.durationMs
    this.queue.push(action.endsAt, { type: 'complete', actionId: action.actionId })
  }

  /** One unit's settlement, strictly after the previous unit's. */
  async #commitUnit(action, unit, settlement, next) {
    if (action.abortCommits) {
      // An earlier unit failed for good: this one is never paid.
      this.#notifyCancel(unit.settlementId, action.playerId, 'aborted')
      action.pending--
      this.#maybeFinish(action)
      return
    }
    let result = null
    for (let attempt = 0; attempt <= SETTLE_RETRY_DELAYS_MS.length; attempt++) {
      if (attempt > 0) { this.metrics.settleRetries++; await this.sleep(SETTLE_RETRY_DELAYS_MS[attempt - 1]) }
      result = await this.#settleOnce(settlement)
      if (result.ok || !result.retryable) break
    }
    // Classified by the FINAL answer alone: an earlier non-answer does not make a later definitive one ambiguous.
    if (result.ok) {
      this.#confirmUnit(action, unit, next, result)
    } else {
      // Not paid (as far as WORLD knows), and nothing after it will be.
      action.abortCommits = true
      action.stop = 'error'
      action.errorReason = result.reason
      this.metrics.settleFailed++
      if (result.reason === 'stale-node') {
        // Definitive: the database checks dedupe before the CAS, so no settlement
        // with this id exists — and memory is wrong about the node.
        this.metrics.staleNodes++
        action.resync = true
        this.#notifyCancel(unit.settlementId, action.playerId, 'stale-node')
      } else if (result.retryable) {
        // Every attempt went unanswered: the database may have applied it. Ambiguous —
        // never closed here (dedupe may still confirm it), never paid here.
        this.metrics.ambiguousCommits++
        action.resync = true
        action.doubt = { unit, settlement, next }
      } else {
        // Refused for good before the database was reached (expired, invalid…): memory still holds.
        this.#notifyCancel(unit.settlementId, action.playerId, 'failed')
      }
      if (action.phase === 'running') this.#dropCurrent(action, 'aborted')
    }
    action.pending--
    this.#maybeFinish(action)
  }

  /** One settle call. A throw is a retryable non-answer. */
  async #settleOnce(settlement) {
    this.metrics.commitAttempts++
    try { return readSettlement(await this.skills.settleWork(settlement)) } catch { return { ok: false, retryable: true, reason: 'skills-error' } }
  }

  /** A unit the database confirmed (applied, or its stored duplicate): counted, flashed and yielded once. */
  #confirmUnit(action, unit, next, result) {
    action.committed = next
    this.metrics.completed++
    this.metrics.units++
    if (result.status === 'duplicate') this.metrics.duplicateSettlements++
    this.#addToTotal(action, result.summary)
    if (action.gather && next.state === 'depleted') action.stop ??= 'depleted'
    // A flash for everyone watching (the worker is still on the node).
    if (action.working && this.store.get(action.node.id)?.actionId === action.actionId) {
      this.onNode(this.store.write(action.node, { ...action.working, lastYieldAt: this.now() }))
    }
    this.onYield(action.playerId, { actionId: action.actionId, index: unit.index, ...(result.summary === undefined ? {} : { summary: result.summary }) })
  }

  /**
   * The node's memory can no longer be trusted: hold it and ask the database.
   * The owner's worker stays (phase `resyncing`) for RESYNC_HOLD_STEPS steps.
   */
  #beginResync(action) {
    action.phase = 'resyncing'
    const job = { node: action.node, action, doubt: action.doubt ?? null, step: 0, busy: false }
    this.syncing.set(action.node.id, job)
    this.metrics.resyncs++
    void this.#resyncStep(job)
  }

  /**
   * One resync step: (1) the doubtful unit, if any, is settled again with the
   * same settlement — dedupe answers for it; (2) once nothing is in doubt, the
   * node is read back from the database and written as it is there. Any
   * failure schedules the next step on the room's clock.
   */
  async #resyncStep(job) {
    if (job.busy || this.syncing.get(job.node.id) !== job) return
    job.busy = true
    this.metrics.resyncSteps++
    try {
      if (job.doubt) {
        const { unit, settlement, next } = job.doubt
        const result = await this.#settleOnce(settlement)
        if (result.ok) {
          job.doubt = null
          this.metrics.recoveredUnits++
          if (job.action) this.#confirmUnit(job.action, unit, next, result)
          else this.metrics.lateConfirmations++ // paid in the database; the sequence was already reported
        } else if (!result.retryable) {
          // The database (or SKILLS) answered: not paid, and it never will be.
          job.doubt = null
          if (result.reason === 'stale-node') this.metrics.staleNodes++
          this.#notifyCancel(unit.settlementId, job.action?.playerId ?? settlement.playerId, result.reason === 'stale-node' ? 'stale-node' : 'failed')
        }
      }
      if (!job.doubt) {
        const rows = await this.#loadPersisted()
        const row = rows.find(candidate => candidate?.nodeId === job.node.id) ?? null
        this.#resolveSync(job, row)
        return
      }
    } catch {
      // The database did not answer: try again later.
    } finally {
      job.busy = false
    }
    this.metrics.resyncFailures++
    job.step++
    if (job.action && job.step >= RESYNC_HOLD_STEPS) this.#releaseHeld(job)
    this.queue.push(this.now() + RESYNC_DELAYS_MS[Math.min(job.step, RESYNC_DELAYS_MS.length) - 1], { type: 'resync', nodeId: job.node.id })
  }

  /** The database's node overrides; concurrent resyncs share one read. */
  #loadPersisted() {
    this.loading ??= Promise.resolve().then(() => this.loadNodes()).finally(() => { this.loading = null })
    return this.loading
  }

  /** The database answered for the node: memory becomes exactly that. */
  #resolveSync(job, row) {
    this.syncing.delete(job.node.id)
    this.metrics.resynced++
    const persisted = this.#persistedState(job.node, row)
    if (job.action) { this.#finish(job.action, persisted); return }
    const record = this.store.write(job.node, persisted)
    if (record.respawnAt !== null && !record.base) this.queue.push(record.respawnAt, { type: 'timer', nodeId: record.id, version: record.version })
    this.onNode(record)
  }

  /**
   * The database has not answered for a while: the player and the Pokémon are
   * freed and told how the sequence ended (confirmed units only); the node
   * stays held — refusing work, publicly as it last rested — until it does.
   */
  #releaseHeld(job) {
    const action = job.action
    job.action = null
    this.metrics.heldReleases++
    const record = this.store.write(action.node, { ...this.#restingFromMemory(action, this.now()), syncing: true })
    this.#release(action)
    this.onNode(record)
    this.#reportDone(action)
  }

  /**
   * A node as the database holds it (one world_load_nodes row, or none). The
   * database's clock already dropped expired rows; no row is the base state.
   */
  #persistedState(node, row) {
    const initial = lifecycleFor(node.resourceKind).initial
    if (node.resourceKind === PLOT_KIND) {
      if (!row?.plot) return { state: initial }
      const now = this.now()
      return { state: plotStageAt(row.plot, now), plot: row.plot, respawnAt: nextPlotChange(row.plot, now) }
    }
    if (!row || row.respawnAt === null) return { state: initial }
    if (row.state === 'available') {
      return Number.isInteger(row.stockRemaining) ? { state: 'available', stock: row.stockRemaining, token: row.actionId, respawnAt: row.respawnAt } : { state: initial }
    }
    return { state: row.state, respawnAt: row.respawnAt, token: row.actionId ?? null }
  }

  /** Drops the unit still attempting (or being authorized): never paid. */
  #dropCurrent(action, reason) {
    if (action.phase !== 'running') return
    // A unit still being authorized is closed by #nextUnit when SKILLS answers (once).
    if (!action.authorizing) this.#notifyCancel(action.settlementId, action.playerId, reason)
    action.phase = 'settling'
    action.authorizing = false
  }

  /** Ends the sequence once nothing is attempting and no commit is pending. */
  #maybeFinish(action) {
    if (action.phase === 'running' || action.phase === 'done' || action.phase === 'resyncing' || action.pending > 0) return
    // Memory may be wrong about the node: the database decides (when there is one).
    if (action.resync && this.loadNodes) { this.#beginResync(action); return }
    this.#finish(action)
  }

  /** Releases the sequence. `persisted`: the node as the database holds it (after a resync); otherwise memory's. */
  #finish(action, persisted = undefined) {
    const record = this.store.write(action.node, persisted ?? this.#restingFromMemory(action, this.now()))
    if (record.respawnAt !== null && !record.base) this.queue.push(record.respawnAt, { type: 'timer', nodeId: record.id, version: record.version })
    this.#release(action)
    this.onNode(record)
    this.#reportDone(action)
  }

  /** Where the node rests after the sequence, as far as WORLD's own memory knows. */
  #restingFromMemory(action, now) {
    if (!action.gather) return action.committed ?? this.#restingState(action)
    const settled = action.committed
    const resting = settled ?? action.restingBefore
    if (settled?.state === 'depleted') return { state: 'depleted', respawnAt: settled.respawnAt, token: settled.token }
    // Partial: private stock and token, refill 90 s after its last settled unit.
    // A cancellation writes the partial back as it was: no timestamp moves.
    if (resting && resting.respawnAt > now) return { state: 'available', stock: resting.stock, token: resting.token, respawnAt: resting.respawnAt }
    // Nothing settled on a fresh node, or the partial expired while reserved: full again.
    return { state: action.workedFrom }
  }

  #reportDone(action) {
    const reason = action.stop ?? (action.gather ? 'depleted' : 'completed')
    this.onDone(action.playerId, {
      actionId: action.actionId, ok: action.total.units > 0, reason,
      total: { units: action.total.units, xpGained: action.total.xpGained, rewards: [...action.total.rewards].map(([itemId, quantity]) => ({ itemId, quantity })) },
      ...(action.refusal ? { message: action.refusal } : {}),
    })
  }

  #addToTotal(action, summary) {
    const total = action.total
    total.units++
    if (!summary || typeof summary !== 'object') return
    if (Number.isFinite(summary.xpGained)) total.xpGained += summary.xpGained
    for (const reward of Array.isArray(summary.rewards) ? summary.rewards : []) {
      if (typeof reward?.itemId === 'string' && Number.isInteger(reward.quantity)) total.rewards.set(reward.itemId, (total.rewards.get(reward.itemId) ?? 0) + reward.quantity)
    }
  }

  /** A plot's state after a completed action: WORLD's decision, handed to the settlement. */
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

  /** Where a plot action that did not complete leaves the plot: as it was. */
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
    if (isPartial(record)) {
      // A partial refills silently: to every viewer it was already a full node.
      if (record.respawnAt <= now) { this.store.forget(node); this.metrics.refilled++ }
      return
    }
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
    action.unitStartedAt = startedAt
    action.endsAt = startedAt + durationMs
    this.actions.set(action.actionId, action)
    this.byPlayer.set(action.playerId, action.actionId)
    this.byPokemon.set(action.pokemon.instanceId, action.actionId)
    // The public working record. Private stock and token never go in it.
    action.working = {
      state: WORKING, workedFrom: action.workedFrom, actionId: action.actionId, workKind: action.workKind,
      worker: { playerId: action.playerId, pokemonInstanceId: action.pokemon.instanceId, speciesId: action.pokemon.speciesId, stand: action.stand },
      actionStartedAt: startedAt, plot: action.plotBefore,
    }
    const record = this.store.write(action.node, action.working)
    this.queue.push(action.endsAt, { type: 'complete', actionId: action.actionId })
    this.metrics.started++
    this.onNode(record)
    // After the anchor exists: the move this triggers is reconciled against it and keeps the sequence.
    this.placeActor(action.playerId, { ...action.anchor })
    return this.#reply(action.playerId, {
      requestId, ok: true, actionId: action.actionId, nodeId: action.node.id, startedAt,
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
    // Resyncing (YIELD-2 recovery): what the node holds is unknown until the database answers.
    if (state === WORKING || this.syncing.has(node.id)) return { reason: 'busy' }
    if (!canStartWork(lifecycle, state)) return { reason: state }
    if (this.byPlayer.has(actor.id)) return { reason: 'actor-busy' }
    if (this.byPokemon.has(intent.pokemonInstanceId)) return { reason: 'pokemon-busy' }
    const placement = this.#placement(actor, node)
    if (!placement) return { reason: 'no-room' }
    if (node.resourceKind !== PLOT_KIND) return { node, state, placement }
    const plot = record?.plot ?? null
    const farm = farmActionFor(state, plot, actor.id)
    if (farm.reason) return { reason: farm.reason }
    if (farm.action === 'plant' && !intent.cropId) return { reason: 'choose-crop' }
    return {
      node, state, plot, placement,
      farm: { action: farm.action, plotKind: node.plotKind, stage: STAGE[state], cropId: plot?.cropId ?? null, tended: plot?.tended ?? false, requestedCropId: intent.cropId ?? null },
    }
  }

  /** Where the worker and the trainer would stand: free terrain, not taken by another running sequence. */
  #placement(actor, node) {
    const terrain = standableTile(node.areaId)
    const taken = new Set()
    for (const other of this.actions.values()) {
      if (other.node.areaId !== node.areaId) continue
      for (const tile of [other.stand, other.anchor]) if (tile) taken.add(`${tile.tx},${tile.ty}`)
    }
    return workPlacement(node, actor, (tx, ty) => terrain(tx, ty) && !taken.has(`${tx},${ty}`))
  }

  #release(action) {
    action.phase = 'done'
    this.actions.delete(action.actionId)
    if (this.byPlayer.get(action.playerId) === action.actionId) this.byPlayer.delete(action.playerId)
    for (const [instanceId, actionId] of this.byPokemon) if (actionId === action.actionId) this.byPokemon.delete(instanceId)
  }

  /** Closes a unit's SKILLS authorization without pay (optional hook). */
  #notifyCancel(settlementId, playerId, reason) {
    try { void Promise.resolve(this.skills.cancelWork?.({ actionId: settlementId, playerId, reason })).catch(() => undefined) } catch { /* a failing optional hook must not break the world */ }
  }

  #reject(playerId, intent, reason, message) {
    this.metrics.rejected[reason] = (this.metrics.rejected[reason] ?? 0) + 1
    return this.#reply(playerId, { requestId: intent.requestId, ok: false, reason, ...(message ? { message } : {}) })
  }

  #reply(playerId, result) {
    this.onResult(playerId, result)
    return result
  }

  /** Counts and, at most once per RATE_LOG_WINDOW_MS, logs totals only (no ids). */
  #noteRateLimited(playerId) {
    this.metrics.rateLimited++
    const now = this.now()
    const log = this.rateLog
    log.intents++
    if (log.players.size < 1_000) log.players.add(playerId)
    if (log.lastLogAt !== null && now - log.lastLogAt < RATE_LOG_WINDOW_MS) return
    this.log(`[world] rate-limited ${log.intents} work intent(s) from ${log.players.size} player(s)${log.lastLogAt === null ? '' : ' in the last minute'}`)
    this.rateLog = { lastLogAt: now, intents: 0, players: new Set() }
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

/** A plot's state the settlement persists with the reward (world_commit_work's p_node, previous contract). */
function persistedNode(node, next) {
  const initial = lifecycleFor(node.resourceKind).initial
  const base = next.state === initial && !next.plot
  return {
    nodeId: node.id, areaId: node.areaId, chunkId: node.chunkId, state: next.state,
    respawnAt: next.respawnAt ?? null, plot: next.plot ?? null, base,
  }
}
