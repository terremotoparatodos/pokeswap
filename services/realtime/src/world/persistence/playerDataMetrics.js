/**
 * Counts every call through the PlayerDataAuthority port: how many, how many
 * failed, and how long they took (INTEGRATION-1). Aggregates only — never a
 * user id, node or payload — so it can be exposed on /metrics in any mode.
 *
 * In production each call is one Edge Function request (one database round
 * trip): `commitWork` is the write path, the rest are reads.
 */
const OPS = ['playerState', 'ownsPokemon', 'commitWork', 'loadNodes']
const WINDOW = 512

export function withPlayerDataMetrics(playerData) {
  const stats = Object.fromEntries(OPS.map(op => [op, { calls: 0, failures: 0, recent: [] }]))
  const wrapped = {}
  for (const op of OPS) {
    wrapped[op] = async (...args) => {
      const entry = stats[op]
      entry.calls++
      const started = performance.now()
      try {
        return await playerData[op](...args)
      } catch (error) {
        entry.failures++
        throw error
      } finally {
        entry.recent.push(performance.now() - started)
        if (entry.recent.length > WINDOW) entry.recent.shift()
      }
    }
  }
  wrapped.metrics = () => Object.fromEntries(OPS.map(op => {
    const { calls, failures, recent } = stats[op]
    return [op, { calls, failures, ms: { p50: percentile(recent, 0.5), p95: percentile(recent, 0.95), max: round(Math.max(0, ...recent)) } }]
  }))
  return wrapped
}

const round = value => Math.round(value * 10) / 10
function percentile(values, p) {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return round(sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)])
}
