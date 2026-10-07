import { randomBytes, randomInt } from 'node:crypto'
import { ECO_ADMISSION_AREAS, admitEcoPopulation } from './ecosystem/admission.generated.js'
import { layoutVersion } from './layoutVersion.js'
import { ECO_PROTOCOL } from './worldProtocol.js'

/**
 * The shared encounter population, as the server's authority (ECO-GAMEPLAY-1, EXPERIMENTAL).
 *
 * One admitted population per process (docs/design/ECO_GAMEPLAY_1_CONTRACT.md). It never runs the
 * bare engine: the admission bundle hands out an admitted population or nothing. This adapter only
 * supplies what an authority must — the namespace, the CURRENT layout versions of the world, the
 * server clock and the server's randomness — and tells the world which areas changed.
 *
 * Fail closed: without admission every area is `unavailable` (no encounters, never a local
 * fallback). In memory and single-host: a restart starts empty with a new namespace, so ids are
 * never reused. Nothing here grants a capture, drop, token or any persistent value.
 */

export { ECO_PROTOCOL }
/** The population is advanced at most this often, inside the world's 50 ms tick. */
export const ECO_TICK_MS = 250

/** Server randomness in [0, 1): node:crypto.randomInt over its full 48-bit range ([0, 2^48 − 1)). Never the client's. */
const RANDOM_RANGE = 2 ** 48 - 1
export const serverRandom = () => randomInt(RANDOM_RANGE) / RANDOM_RANGE

/** A fresh namespace per process: encounter ids of a restarted server can never collide with older ones. */
export function newEcoNamespace(now) {
  return `eco-${Math.floor(now).toString(36)}-${randomBytes(4).toString('hex')}`
}

export class EcoPopulation {
  /**
   * `now`: the world's clock. `onChange(areaId)`: the public view of an area changed.
   * `devRetire`: test retirements accepted (development only; the world config decides).
   */
  constructor({ now, onChange = () => {}, devRetire = false, random = serverRandom, namespace = newEcoNamespace(now()), layouts = areaId => layoutVersion(areaId), log = message => console.warn(message) }) {
    this.now = now
    this.onChange = onChange
    this.devRetireAllowed = devRetire
    this.random = random
    this.namespace = namespace
    this.log = log
    this.lastTickAt = null
    this.metrics = { ticks: 0, rejectedTicks: 0, changes: 0, retired: 0, refusedRetire: 0 }
    // The scope is the build's; every value comes from the authoritative world, not from the snapshot.
    const admitted = admitEcoPopulation({ namespace, currentLayouts: Object.fromEntries(ECO_ADMISSION_AREAS.map(areaId => [areaId, layouts(areaId)])) })
    this.population = admitted.ok ? admitted.population : null
    this.issues = admitted.ok ? [] : admitted.issues.map(issue => issue.code)
    // Codes only: no geometry, layout value or anything else of the inputs.
    if (!admitted.ok) this.log(`[world] ECO population not admitted (${[...new Set(this.issues)].join(', ')}); no encounters are shown`)
  }

  get status() {
    return this.population ? 'ready' : 'unavailable'
  }

  covers(areaId) {
    return this.population?.areaIds.includes(areaId) ?? false
  }

  /** Advances the population. `activeAreas`: areas with at least one world viewer right now. */
  tick(now, activeAreas) {
    if (!this.population || (this.lastTickAt !== null && now - this.lastTickAt < ECO_TICK_MS)) return
    this.lastTickAt = now
    const result = this.population.tick({ now, random: this.random, activeAreas })
    if (!result.ok) { this.metrics.rejectedTicks++; return }
    this.metrics.ticks++
    for (const areaId of result.changedAreas) { this.metrics.changes++; this.onChange(areaId) }
  }

  /** What every viewer of `areaId` is shown: the same list for everyone. */
  view(areaId) {
    if (!this.population) return { protocol: ECO_PROTOCOL, areaId, status: 'unavailable', encounters: [] }
    if (!this.covers(areaId)) return { protocol: ECO_PROTOCOL, areaId, status: 'not-simulated', encounters: [] }
    const area = this.population.view(areaId)
    return {
      protocol: ECO_PROTOCOL, areaId, status: area.simulated ? 'active' : 'not-simulated',
      encounters: area.encounters.map(({ id, groupId, speciesId, tile }) => ({ id, groupId, speciesId, tx: tile.tx, ty: tile.ty })),
    }
  }

  /**
   * A TEST retirement (development only): a player standing in the encounter's area removes it with
   * the simulated cause `fled`. No capture, no drop, no token, nothing persistent.
   * `actor`: the requesting player's live actor, or null for a guest.
   */
  devRetire(actor, encounterId, now = this.now()) {
    const refuse = reason => { this.metrics.refusedRetire++; return { ok: false, reason } }
    if (!this.devRetireAllowed) return refuse('disabled')
    if (!this.population) return refuse('unavailable')
    if (!actor) return refuse('not-player')
    if (typeof encounterId !== 'string' || encounterId.length > 160) return refuse('invalid')
    const areaId = this.population.areaOf(encounterId)
    if (areaId === null) return refuse('not-alive')
    if (actor.areaId !== areaId) return refuse('other-area')
    const result = this.population.retire({ encounterId, now, random: this.random })
    if (!result.ok) return refuse(result.reason === 'not-alive' ? 'not-alive' : 'invalid')
    this.metrics.retired++
    this.onChange(result.areaId)
    return { ok: true }
  }
}
