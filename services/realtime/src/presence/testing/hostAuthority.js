import { randomUUID } from 'node:crypto'
import { HostLifecycle } from '../hostLifecycle.js'

// TESTS ONLY (WORLD LOCATION-4, reviews N1, N5, N6). An in-memory authority with the semantics
// of the SQL functions of 20261003120000_world_location_ordering.sql, on a controlled clock
// (sleep advances it, nothing waits in real time):
//   - world_presence_*: leases on the authority's clock, idempotent acquire/activate,
//     newer_active, host_expired, unknown_host, renew reviving an expired active host only
//     without a newer one;
//   - world_location_claim_keyed / world_location_save_keyed: the host gate (identity, state,
//     lease), the owner key (generation, seq, session), the epoch + owner CAS, newerActive.
// `hold(op)` applies the NEXT call of `op` in the authority at once and keeps its answer until
// the test releases it: a response that arrives after the caller moved on. `hold(op, { late: true })`
// applies it only on release: a request that reaches the database after the caller moved on.

export function world() {
  const clock = { t: 0 }
  const hosts = new Map() // hostId → { generation, state, lease }
  const rows = new Map() // userId → { epoch, seq, ownerGeneration, ownerSeq, ownerSession, location }
  let next = 0
  const calls = []
  const authority = { down: false, loseNext: null, failing: new Set() }
  const held = new Map() // op → [{ release, answer }]
  const live = h => h.lease > clock.t
  const newerActive = generation => [...hosts.values()].some(h => h.generation > generation && h.state === 'active' && live(h))
  const byKey = (generation, hostId) => { const h = hosts.get(hostId); return h && h.generation === generation ? h : null }

  /** The next call of `op` is applied at once; its answer waits for `release()`. */
  function hold(op, { late = false } = {}) {
    let release
    const gate = new Promise(resolve => { release = resolve })
    const entry = { gate, late, sent: false, release: () => release(), applied: false, answer: undefined }
    held.set(op, [...(held.get(op) ?? []), entry])
    return entry
  }

  async function call(op, fn) {
    calls.push(op)
    if (authority.down || authority.failing.has(op)) throw new Error('authority unreachable')
    if (held.get(op)?.[0]?.late) {
      const entry = held.get(op).shift()
      entry.sent = true
      await entry.gate
      entry.applied = true
      entry.answer = fn()
      return entry.answer
    }
    const answer = fn()
    if (authority.loseNext === op) { authority.loseNext = null; throw new Error('answer lost') } // applied, answer lost
    const queue = held.get(op)
    if (queue?.length) {
      const entry = queue.shift()
      entry.applied = true
      entry.answer = answer
      await entry.gate
    }
    return answer
  }

  /** The host gate of claim_keyed / save_keyed: null when the host may act, else the refusal. */
  function hostGate(generation, hostId, { claim }) {
    const h = byKey(generation, hostId)
    if (!h) return { status: 'unknown_host' }
    if (claim ? h.state !== 'active' : h.state === 'starting' || h.state === 'stopped') return { status: 'host_inactive', state: h.state }
    if (!live(h)) return { status: 'host_expired', state: h.state }
    return null
  }

  const store = {
    presenceAcquire: (hostId, leaseMs) => call('acquire', () => {
      let h = hosts.get(hostId)
      if (!h) { h = { generation: ++next, state: 'starting', lease: clock.t + leaseMs }; hosts.set(hostId, h) }
      return { generation: h.generation, state: h.state }
    }),
    presenceActivate: (generation, hostId, leaseMs) => call('activate', () => {
      const h = byKey(generation, hostId)
      if (!h) return { status: 'unknown_host' }
      if (h.state === 'active') return { status: 'active' }
      if (h.state !== 'starting') return { status: 'host_inactive', state: h.state }
      if (!live(h)) return { status: 'host_expired' }
      if (newerActive(generation)) return { status: 'newer_active' }
      h.state = 'active'
      h.lease = clock.t + leaseMs
      return { status: 'active' }
    }),
    presenceRenew: (generation, hostId, leaseMs) => call('renew', () => {
      const h = byKey(generation, hostId)
      if (!h) return { status: 'unknown_host' }
      if (h.state === 'stopped') return { status: 'host_inactive', state: 'stopped' }
      if (h.state === 'starting' && !live(h)) return { status: 'host_expired', state: 'starting' }
      const newer = newerActive(generation)
      if (h.state === 'active' && !live(h) && newer) return { status: 'ok', state: 'active', newerActive: true, leaseLive: false }
      if (h.state !== 'draining') h.lease = clock.t + leaseMs
      return { status: 'ok', state: h.state, newerActive: newer, leaseLive: true }
    }),
    presenceDrain: (generation, hostId) => call('drain', () => { const h = byKey(generation, hostId); if (h) h.state = 'draining'; return { status: 'ok', state: 'draining' } }),
    presenceStop: (generation, hostId) => call('stop', () => { const h = byKey(generation, hostId); if (h) h.state = 'stopped'; return { status: 'ok', state: 'stopped' } }),

    locationClaim: (userId, key) => call('claim', () => {
      const refused = hostGate(key.generation, key.hostId, { claim: true })
      if (refused) return refused
      const row = rows.get(userId)
      const greater = !row || key.generation > row.ownerGeneration || (key.generation === row.ownerGeneration && key.seq > row.ownerSeq)
      if (greater) {
        const taken = { epoch: (row?.epoch ?? 0) + 1, seq: 0, ownerGeneration: key.generation, ownerSeq: key.seq, ownerSession: key.sessionId, location: row?.location ?? null }
        rows.set(userId, taken)
        return { status: 'claimed', epoch: taken.epoch, location: taken.location, newerActive: newerActive(key.generation) }
      }
      if (row.ownerGeneration === key.generation && row.ownerSeq === key.seq) {
        if (row.ownerSession !== key.sessionId) throw new Error('key_reused')
        return { status: 'claimed', epoch: row.epoch, location: row.location, newerActive: newerActive(key.generation) }
      }
      return { status: 'superseded', newerActive: newerActive(key.generation) }
    }),
    locationSave: (batch, host) => call('save', () => {
      const refused = hostGate(host.generation, host.hostId, { claim: false })
      if (refused) return refused
      const results = new Map()
      for (const r of batch) {
        const row = rows.get(r.userId)
        if (row && row.epoch === r.epoch && row.seq < r.seq && row.ownerGeneration === host.generation) {
          row.seq = r.seq
          row.location = { areaId: r.areaId, tx: r.tx, ty: r.ty, layoutVersion: r.layoutVersion }
          row.writtenBy = host.generation
          results.set(r.userId.toLowerCase(), 'applied')
        } else {
          results.set(r.userId.toLowerCase(), !row || row.epoch !== r.epoch || row.ownerGeneration !== host.generation ? 'stale' : 'duplicate')
        }
      }
      return { status: 'ok', results, newerActive: newerActive(host.generation) }
    }),
  }
  /** Another process, newer, activated directly in the authority. */
  const newerHost = () => { const id = randomUUID(); hosts.set(id, { generation: ++next, state: 'active', lease: clock.t + 15_000 }); return id }
  /** The database loses a host row (a reset, a manual prune): every answer about it is unknown_host. */
  const forget = hostId => hosts.delete(hostId)
  const sleep = ms => { clock.t += ms; return new Promise(resolve => setImmediate(resolve)) }
  const host = (options = {}) => new HostLifecycle({ store, renewMs: 3_600_000, log: () => {}, sleep, now: () => clock.t, ...options })
  const until = async (condition, steps = 400) => { for (let i = 0; i < steps && !condition(); i++) await new Promise(resolve => setImmediate(resolve)) }
  return { clock, hosts, rows, calls, authority, store, hold, newerHost, forget, sleep, host, until }
}
