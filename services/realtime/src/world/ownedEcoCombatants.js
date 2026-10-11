import { WORLD_MESSAGE } from './worldProtocol.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SOURCE = 'legacy-m1-derived'
const READ_TIMEOUT_MS = 6_000

/** Owned mode only. Metadata/choice survives reconnect; every selection/start reads fresh rows. */
export class OwnedEcoCombatants {
  constructor({ battles, inBattle, read, isCurrent }) {
    Object.assign(this, { battles, inBattle, read, isCurrent })
    this.choices = new Map()
    this.options = new Map()
    this.operations = new Map()
  }

  current(actor, client) { return Boolean(actor && UUID.test(actor.id) && this.isCurrent(actor, client)) }

  state(playerId, requestId = null, reason = null) {
    const choice = this.choices.get(playerId)
    return { requestId, ok: reason === null, ...(reason ? { reason } : {}), mode: 'owned', attributeSource: SOURCE,
      selectedSlotPokemonId: choice?.slotPokemonId ?? null, speciesId: choice?.speciesId ?? null,
      level: choice?.level ?? null, options: this.options.get(playerId) ?? [] }
  }

  reply(actor, client, requestId, reason = null) {
    if (!this.current(actor, client)) {
      const result = { requestId, ok: false, reason: 'not-player', mode: 'owned', speciesId: null, options: [] }
      client?.send(WORLD_MESSAGE.ECO_COMBATANT_STATE, result)
      return result
    }
    const result = this.state(actor.id, requestId, reason)
    client.send(WORLD_MESSAGE.ECO_COMBATANT_STATE, result)
    return result
  }

  begin(actor, client) {
    if (!this.current(actor, client)) return 'not-player'
    if (this.inBattle(actor.id)) return 'in-battle'
    const pending = this.operations.get(actor.id)
    if (pending?.client === client) return 'selection-pending'
    const operation = { client, choice: this.choices.get(actor.id) }
    this.operations.set(actor.id, operation)
    return operation
  }

  live(actor, client, operation) {
    return this.current(actor, client) && this.operations.get(actor.id) === operation
      && this.choices.get(actor.id) === operation.choice && !this.inBattle(actor.id)
  }

  end(actor, operation) {
    if (this.operations.get(actor.id) === operation) this.operations.delete(actor.id)
  }

  async rows(actor, id) {
    if (!this.read || !this.battles()?.ownedCombatant) throw new Error('read-unavailable')
    let timer
    try {
      const rows = await Promise.race([
        this.read(actor.id, id),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('read-timeout')), READ_TIMEOUT_MS); timer.unref?.() }),
      ])
      if (!Array.isArray(rows)) throw new Error('invalid-read')
      // Never retain a caller-owned object as a battle snapshot.
      return structuredClone(rows)
    } finally { clearTimeout(timer) }
  }

  describe(row, playerId) {
    const built = this.battles().ownedCombatant(row, playerId)
    return { slotPokemonId: row?.slot?.pokemon_id, speciesId: row?.slot?.pokemon_id,
      level: built.ok ? built.level : null, eligible: built.ok, ...(built.ok ? {} : { reason: built.reason }),
      ...(built.ok && built.ignoredStoredLevel !== null ? { ignoredStoredLevel: built.ignoredStoredLevel } : {}) }
  }

  async refresh(actor, client, requestId = null) {
    if (this.current(actor, client) && this.inBattle(actor.id)) return this.reply(actor, client, requestId)
    const operation = this.begin(actor, client)
    if (typeof operation === 'string') return this.reply(actor, client, requestId, operation)
    try {
      const rows = await this.rows(actor, null)
      if (!this.live(actor, client, operation)) return this.reply(actor, client, requestId, 'selection-stale')
      const options = rows.filter(row => row?.slot?.owner_id === actor.id && Number.isSafeInteger(row?.slot?.pokemon_id))
        .map(row => this.describe(row, actor.id))
      this.options.set(actor.id, options)
      if (operation.choice) {
        const current = options.find(option => option.eligible && option.slotPokemonId === operation.choice.slotPokemonId)
        if (current) this.choices.set(actor.id, current)
        else this.choices.delete(actor.id)
      }
      return this.reply(actor, client, requestId)
    } catch {
      if (this.live(actor, client, operation)) this.options.set(actor.id, [])
      return this.reply(actor, client, requestId, 'read-unavailable')
    } finally { this.end(actor, operation) }
  }

  async select(actor, payload, client) {
    const requestId = Number.isSafeInteger(payload?.requestId) ? payload.requestId : null
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)
      || Object.keys(payload).some(key => !['requestId', 'slotPokemonId'].includes(key))
      || requestId === null || requestId < 1 || !Number.isSafeInteger(payload.slotPokemonId) || payload.slotPokemonId < 1) {
      return this.reply(actor, client, requestId, 'invalid')
    }
    const operation = this.begin(actor, client)
    if (typeof operation === 'string') return this.reply(actor, client, requestId, operation)
    try {
      const rows = await this.rows(actor, payload.slotPokemonId)
      if (!this.live(actor, client, operation)) return this.reply(actor, client, requestId, 'selection-stale')
      const row = rows.find(row => row?.slot?.pokemon_id === payload.slotPokemonId && row?.slot?.owner_id === actor.id)
      if (!row) return this.reply(actor, client, requestId, 'not-owner')
      const description = this.describe(row, actor.id)
      if (!description.eligible) return this.reply(actor, client, requestId, description.reason)
      this.choices.set(actor.id, description)
      const options = this.options.get(actor.id) ?? []
      this.options.set(actor.id, options.some(option => option.slotPokemonId === description.slotPokemonId)
        ? options.map(option => option.slotPokemonId === description.slotPokemonId ? description : option) : [...options, description])
      return this.reply(actor, client, requestId)
    } catch { return this.reply(actor, client, requestId, 'read-unavailable') }
    finally { this.end(actor, operation) }
  }

  async withBattle(actor, client, run, refuse) {
    const operation = this.begin(actor, client)
    if (typeof operation === 'string') return refuse(operation)
    try {
      if (!operation.choice) return refuse('no-combatant')
      const rows = await this.rows(actor, operation.choice.slotPokemonId)
      if (!this.live(actor, client, operation)) return refuse('selection-stale')
      const row = rows.find(row => row?.slot?.pokemon_id === operation.choice.slotPokemonId && row?.slot?.owner_id === actor.id)
      if (!row) return refuse('not-owner')
      const built = this.battles().ownedCombatant(row, actor.id)
      if (!built.ok) return refuse(built.reason)
      // run rechecks range/area/encounter and inserts synchronously while this operation holds the choice.
      return run(row)
    } catch { return refuse('read-unavailable') }
    finally { this.end(actor, operation) }
  }
}
