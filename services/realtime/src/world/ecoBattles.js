import { randomBytes } from 'node:crypto'
import { WORLD_MESSAGE, ecoEngageIntent, ecoFleeIntent } from './worldProtocol.js'
import { serverRandom } from './ecoPopulation.js'

/**
 * ECO-GAMEPLAY-2 (EXPERIMENTAL, development sandbox only): authoritative reservations of ECO
 * encounters for test battles. docs/design/ECO_GAMEPLAY_2_CONTRACT.md is the contract; §7 fixes the
 * clocks and the order of the terminal exits.
 *
 * One reservation per encounter and one per player. The battle itself is the EXISTING battle
 * authority, reached only through the generated test-battle bundle (synthetic fixtures, server seed,
 * server clock). The client never declares a result: the rules decide it here, in the world tick.
 *
 * Exits — exactly ONE per reservation, and the reservation leaves the indexes BEFORE any effect:
 *   victory               → the exact individual is retired for everyone, once (existing respawn cycle)
 *   defeat · draw · fled · expired · disconnected · left-area · vanished → released, nothing retired
 *
 * Nothing here persists or grants anything: no capture, ownership, XP, drop or token. In memory and
 * single-host: a restart forgets every reservation (and the population starts over with new ids).
 *
 * The parameters are PROVISIONAL values of the experiment, not balance.
 */

/** Chebyshev tiles from the player to the encounter for an engage: patrol leash 4 + 2. */
export const ECO_ENGAGE_RANGE = 6
/** Battle time (only advanced while the owner is connected) after which an undecided battle is released. */
export const ECO_BATTLE_MAX_MS = 120_000
/** Server time, from the close of the owner's CURRENT socket, before a paused battle is released. */
export const ECO_DISCONNECT_GRACE_MS = 15_000

/** The test-battle bundle, loaded only inside the experiment (never by a production world). */
export async function prepareBundledBattles() {
  const bundle = await import('./ecosystem/encounterBattle.generated.js')
  return bundle.prepareEncounterBattles()
}

const newBattleId = () => `eco-battle-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`

export class EcoBattles {
  /**
   * `population`: the EcoPopulation (its `encounter`, `alive`, `retireVictory` and `status`).
   * `send(client, type, payload)`: one message to one socket.
   * `onChange(areaId)`: the busy state of an area's encounters changed.
   * `prepare()`: resolves to `{ ok, battles }` or `{ ok: false, reason }` (default: the bundle).
   */
  constructor({ population, now, send, onChange = () => {}, prepare = prepareBundledBattles, random = serverRandom, newId = newBattleId, log = message => console.warn(message) }) {
    this.population = population
    this.now = now
    this.send = send
    this.onChange = onChange
    this.random = random
    this.newId = newId
    this.log = log
    this.battles = null
    this.status = 'loading'
    /** encounterId → reservation; playerId → reservation. A closed reservation is in neither. */
    this.byEncounter = new Map()
    this.byPlayer = new Map()
    this.metrics = { engaged: 0, resumed: 0, refused: {}, ended: {}, actions: 0, refusedActions: {} }
    this.ready = Promise.resolve()
      .then(prepare)
      .then(result => {
        if (result?.ok) { this.battles = result.battles; this.status = 'ready'; return }
        this.status = 'unavailable'
        this.log(`[world] ECO test battles unavailable (${String(result?.reason ?? 'unknown').slice(0, 40)}); encounters can be seen but not fought`)
      })
      .catch(error => {
        this.status = 'unavailable'
        this.log(`[world] ECO test battles unavailable (${String(error?.message ?? error).slice(0, 60)})`)
      })
  }

  /** The encounter is reserved (also while its owner is inside the reconnection grace). */
  isBusy(encounterId) {
    return this.byEncounter.has(encounterId)
  }

  get active() {
    return this.byPlayer.size
  }

  /**
   * `world:eco-engage`. `actor`: the player's live actor (null for a guest). `client`: the socket the
   * intent came from, which must be the player's current one. Validation order: contract §3 and §7.
   */
  engage(actor, payload, client, currentClient) {
    const requestId = Number.isSafeInteger(payload?.requestId) ? payload.requestId : null
    const refuse = (reason, encounterId = null) => {
      this.metrics.refused[reason] = (this.metrics.refused[reason] ?? 0) + 1
      return this.#reply(client, { requestId, encounterId, ok: false, reason })
    }
    const intent = ecoEngageIntent(payload)
    if (!intent) return refuse('invalid')
    const { encounterId } = intent
    if (this.population?.status !== 'ready') return refuse('unavailable', encounterId)
    if (this.status !== 'ready') return refuse('battle-unavailable', encounterId)
    if (!actor) return refuse('not-player', encounterId)
    if (client !== currentClient) return refuse('not-current-socket', encounterId)
    const own = this.byPlayer.get(actor.id)
    if (own) {
      if (own.encounterId !== encounterId) return refuse('already-battling', encounterId)
      // The same encounter again: the battle that exists, never a second one.
      this.#attach(own, client)
      this.metrics.resumed++
      return this.#reply(client, { requestId, encounterId, ok: true, battle: this.#battleInfo(own) })
    }
    const encounter = this.population.encounter(encounterId)
    if (!encounter) return refuse('not-alive', encounterId)
    if (actor.areaId !== encounter.areaId) return refuse('other-area', encounterId)
    if (Math.max(Math.abs(actor.tx - encounter.tx), Math.abs(actor.ty - encounter.ty)) > ECO_ENGAGE_RANGE) return refuse('too-far', encounterId)
    if (this.byEncounter.has(encounterId)) return refuse('busy', encounterId)
    // The authority exists BEFORE the reservation: a failed creation leaves nothing reserved.
    const battleId = this.newId()
    const seed = Math.floor(this.random() * 0x7fffffff)
    let started
    try {
      started = this.battles.start({ battleId, controllerId: actor.id, speciesId: encounter.speciesId, seed })
    } catch {
      started = { ok: false }
    }
    if (!started?.ok) return refuse('battle-unavailable', encounterId)
    const now = this.now()
    const reservation = {
      battleId, encounterId, areaId: encounter.areaId, speciesId: encounter.speciesId, playerId: actor.id,
      battle: started.battle, state: 'active', client, lastAdvanceAt: now, disconnectedAt: null,
    }
    this.byEncounter.set(encounterId, reservation)
    this.byPlayer.set(actor.id, reservation)
    this.metrics.engaged++
    this.onChange(reservation.areaId)
    return this.#reply(client, { requestId, encounterId, ok: true, battle: this.#battleInfo(reservation) })
  }

  /**
   * `world:eco-battle-action`: the core's TransportAction. Before the core (its ledger answers an
   * already-accepted actionId before authorising): player, current socket, active connected
   * reservation, same battleId, actionId prefixed by the player. The controller is the transport's.
   */
  action(actor, payload, client) {
    const battleId = typeof payload?.battleId === 'string' ? payload.battleId.slice(0, 64) : null
    const actionId = typeof payload?.actionId === 'string' ? payload.actionId.slice(0, 96) : null
    const refuse = reason => {
      this.metrics.refusedActions[reason] = (this.metrics.refusedActions[reason] ?? 0) + 1
      // No snapshot: a refused sender learns nothing of any battle.
      client?.send(WORLD_MESSAGE.ECO_BATTLE, { battleId, events: [], result: { kind: 'rejected', reason, actionId } })
      return reason
    }
    if (!actor) return refuse('not-your-battle')
    const reservation = this.byPlayer.get(actor.id)
    if (!reservation) return refuse('no-battle')
    if (reservation.client === null || reservation.client !== client) return refuse('not-your-battle')
    if (payload?.battleId !== reservation.battleId) return refuse('not-your-battle')
    if (typeof payload.actionId !== 'string' || !payload.actionId.startsWith(`${actor.id}:`)) return refuse('not-your-battle')
    const result = reservation.battle.submit(actor.id, payload)
    this.metrics.actions++
    this.send(client, WORLD_MESSAGE.ECO_BATTLE, { battleId: reservation.battleId, snapshot: reservation.battle.snapshot(), events: [], result })
    return result
  }

  /** `world:eco-flee`: processed on receipt. After the end (or for another battle) it is a no-op. */
  flee(actor, payload, client) {
    const intent = ecoFleeIntent(payload)
    const reservation = actor ? this.byPlayer.get(actor.id) : undefined
    if (!intent || !reservation || reservation.battleId !== intent.battleId || reservation.client !== client) {
      client?.send(WORLD_MESSAGE.ECO_BATTLE, { battleId: intent?.battleId ?? null, events: [], result: { kind: 'rejected', reason: 'no-battle', actionId: null } })
      return false
    }
    return this.#end(reservation, 'fled')
  }

  /**
   * The world tick. Per reservation: disconnected → only the grace is checked (no battle time passes,
   * so it can neither win nor lose); connected → battle time advances up to the limit, the rules
   * decide first, and only an undecided battle at the limit expires.
   */
  tick(now = this.now()) {
    for (const reservation of [...this.byPlayer.values()]) {
      if (reservation.state !== 'active') continue
      if (reservation.client === null) {
        if (now - reservation.disconnectedAt >= ECO_DISCONNECT_GRACE_MS) this.#end(reservation, 'disconnected')
        continue
      }
      if (!this.population.alive(reservation.encounterId)) { this.#end(reservation, 'vanished'); continue }
      const { battle } = reservation
      const step = Math.min(Math.max(0, now - reservation.lastAdvanceAt), ECO_BATTLE_MAX_MS - battle.elapsedMs())
      reservation.lastAdvanceAt = now
      const result = battle.advance(step)
      if (result.events.length && reservation.client) {
        this.send(reservation.client, WORLD_MESSAGE.ECO_BATTLE, { battleId: reservation.battleId, snapshot: result.snapshot, events: result.events })
      }
      if (result.outcome !== 'ongoing') this.#end(reservation, result.outcome)
      else if (battle.elapsedMs() >= ECO_BATTLE_MAX_MS) this.#end(reservation, 'expired')
    }
  }

  /** A world socket joined. The owner's new socket takes over (the battle resumes on its snapshot). */
  socketJoined(client, playerId) {
    const reservation = playerId ? this.byPlayer.get(playerId) : undefined
    if (reservation) this.#attach(reservation, client)
  }

  /** A world socket left. Only the owner's CURRENT socket pauses the battle and starts the grace. */
  socketLeft(client, playerId) {
    const reservation = playerId ? this.byPlayer.get(playerId) : undefined
    if (!reservation || reservation.client !== client) return
    reservation.client = null
    reservation.disconnectedAt = this.now()
  }

  /** The owner was placed (area change, rejoin): another area releases the reservation. */
  actorPlaced(actor) {
    const reservation = this.byPlayer.get(actor?.id)
    if (reservation && actor.areaId !== reservation.areaId) this.#end(reservation, 'left-area')
  }

  /** After a world snapshot to the owner's current socket: the running battle, again (resume). */
  resume(client, playerId) {
    const reservation = playerId ? this.byPlayer.get(playerId) : undefined
    if (!reservation || reservation.client !== client) return
    this.#reply(client, { requestId: null, encounterId: reservation.encounterId, ok: true, resumed: true, battle: this.#battleInfo(reservation) })
  }

  stats() {
    return { status: this.status, active: this.active, ...this.metrics, refused: { ...this.metrics.refused }, ended: { ...this.metrics.ended }, refusedActions: { ...this.metrics.refusedActions } }
  }

  #attach(reservation, client) {
    if (reservation.client === client) return
    reservation.client = client
    reservation.disconnectedAt = null
    // Paused time is not battle time.
    reservation.lastAdvanceAt = this.now()
  }

  /** The one terminal transition: closed and out of the indexes first, then its effects. */
  #end(reservation, outcome) {
    if (reservation.state !== 'active' || this.byPlayer.get(reservation.playerId) !== reservation) return false
    reservation.state = 'closed'
    this.byPlayer.delete(reservation.playerId)
    if (this.byEncounter.get(reservation.encounterId) === reservation) this.byEncounter.delete(reservation.encounterId)
    this.metrics.ended[outcome] = (this.metrics.ended[outcome] ?? 0) + 1
    const retired = outcome === 'victory' ? this.population.retireVictory(reservation.encounterId, this.now()) : false
    this.onChange(reservation.areaId)
    if (reservation.client) {
      this.send(reservation.client, WORLD_MESSAGE.ECO_BATTLE_END, { battleId: reservation.battleId, encounterId: reservation.encounterId, outcome, retired, snapshot: reservation.battle.snapshot() })
    }
    return true
  }

  #battleInfo(reservation) {
    const { battle } = reservation
    return {
      battleId: reservation.battleId, speciesId: reservation.speciesId, fixture: true, fixtureLabel: this.battles.fixture?.label ?? 'fixture de prueba',
      joinAck: battle.joinAck(reservation.playerId), snapshot: battle.snapshot(), expiresInMs: Math.max(0, ECO_BATTLE_MAX_MS - battle.elapsedMs()),
    }
  }

  #reply(client, result) {
    client?.send(WORLD_MESSAGE.ECO_ENGAGE_RESULT, result)
    return result
  }
}
