import { WORLD_MESSAGE } from './worldProtocol.js'

/** ECO-COMBATANT-1: process-lifetime synthetic choices, separate from reservations and the core. */
export class EcoCombatants {
  constructor({ battles, inBattle }) {
    this.battles = battles
    this.inBattle = inBattle
    this.choices = new Map()
  }

  speciesOf(playerId) {
    return this.choices.get(playerId) ?? 25
  }

  state(playerId, requestId = null, reason = null) {
    const factory = this.battles()
    return {
      requestId, ok: reason === null, ...(reason ? { reason } : {}),
      speciesId: this.speciesOf(playerId),
      options: (factory?.combatants ?? []).map(c => ({ speciesId: c.speciesId, level: c.level })),
    }
  }

  select(actor, payload, client, currentClient) {
    const requestId = Number.isSafeInteger(payload?.requestId) ? payload.requestId : null
    const reply = reason => {
      // Never expose another player's state to a guest or superseded socket.
      const authorised = actor && client === currentClient
      const result = authorised ? this.state(actor.id, requestId, reason) : { requestId, ok: false, reason, speciesId: null, options: [] }
      client?.send(WORLD_MESSAGE.ECO_COMBATANT_STATE, result)
      return result
    }
    if (!actor) return reply('not-player')
    if (client !== currentClient) return reply('not-current-socket')
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)
      || Object.keys(payload).some(key => key !== 'requestId' && key !== 'speciesId')
      || !Number.isSafeInteger(requestId) || requestId < 1 || !Number.isSafeInteger(payload.speciesId)) return reply('invalid')
    const factory = this.battles()
    if (!factory) return reply('battle-unavailable')
    if (!factory.combatants.some(c => c.speciesId === payload.speciesId)) return reply('invalid-species')
    // Includes paused reservations. Selection never ends or rescues a battle.
    if (this.inBattle(actor.id)) return reply('in-battle')
    this.choices.set(actor.id, payload.speciesId)
    return reply(null)
  }
}
