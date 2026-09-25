/**
 * A fake SkillPolicyPort for tests and local benchmarks (WORLD-1C).
 *
 * It demonstrates the contract, not a game: every attempt takes the same time
 * and every settlement "grants" one counter tick in memory. It exists so the
 * world can be exercised end to end before SKILLS delivers the real adapter,
 * and so the exactly-once boundary is tested against something that counts.
 *
 * Never wired in production: `index.js` only selects it outside production and
 * behind WORLD_DEMO_SKILLS=on.
 */
export function createDemoSkillPolicy({ durationMs = 3_000, refuse = () => null, failSettlements = 0 } = {}) {
  const settled = new Map()
  const cancelled = []
  const authorized = []
  let failures = failSettlements
  return {
    settled,
    cancelled,
    authorized,
    /** How many settlements actually granted something (the exactly-once counter). */
    get grants() { return settled.size },
    async authorizeWorkAttempt(attempt) {
      authorized.push(attempt.actionId)
      const reason = refuse(attempt)
      return reason ? { ok: false, reason } : { ok: true, durationMs }
    },
    async settleWork(settlement) {
      if (failures > 0) { failures--; return { ok: false, retryable: true, reason: 'transient' } }
      if (settled.has(settlement.actionId)) return { ok: true, status: 'duplicate' }
      settled.set(settlement.actionId, { playerId: settlement.playerId, nodeId: settlement.node.id })
      return { ok: true, status: 'applied', summary: { demo: true } }
    },
    cancelWork(cancellation) { cancelled.push(cancellation) },
  }
}
