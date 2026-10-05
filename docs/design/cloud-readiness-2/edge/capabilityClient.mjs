// CLOUD READINESS-2 — MODEL of the realtime side of the capability contract (not product code).
//
// States: 'off' (kill switch: never probes) | 'unknown' | 'enabled' | 'disabled' (with a reason).
//   - probe once per process: 'capabilities' → enabled only on { recovery: { version: 1 } };
//     400 unknown_op (a v5 Edge) or { recovery: null } (SQL missing) → disabled.
//   - a recovery op answered 400 unknown_op or 501 unsupported → disabled FOR THE REST OF THE
//     PROCESS (no flapping); the same claim is retried once on the v1 op with the SAME key (the
//     v2 call had no effect: the op or its function did not run).
//   - any other failure (500, timeout) leaves the capability as it is: the caller retries as today.
//   - re-enabling only happens in a new process (a deploy or restart).
//   - the standby is available only while 'enabled'; a promotion interrupted by 'unsupported'
//     stops the identity it acquired.

export class CapabilityClient {
  constructor({ call, killSwitch = 'on' }) {
    this.call = call // async (op, body) => { status, body }
    this.state = killSwitch === 'off' ? 'off' : 'unknown'
    this.reason = killSwitch === 'off' ? 'kill-switch' : null
    this.calls = []
  }

  async #send(op, body = {}) { this.calls.push(op); return this.call(op, body) }
  #disable(reason) { if (this.state === 'enabled' || this.state === 'unknown') { this.state = 'disabled'; this.reason = reason } }
  get recovery() { return this.state === 'enabled' }

  async probe() {
    if (this.state !== 'unknown') return this.state
    const r = await this.#send('capabilities')
    if (r.status === 200 && r.body?.recovery?.version === 1) this.state = 'enabled'
    else if (r.status === 400 && r.body?.error === 'unknown_op') this.#disable('edge-v5')
    else if (r.status === 200 && r.body?.recovery === null) this.#disable('sql-missing')
    // anything else (500, timeout): stays 'unknown', probed again later
    return this.state
  }

  #unsupported(r) { return (r.status === 400 && r.body?.error === 'unknown_op') || (r.status === 501 && r.body?.error === 'unsupported') }

  /** A claim: v2 when enabled, v1 otherwise; a v2 'unsupported' disables and falls back once. */
  async claim(key) {
    if (this.recovery) {
      const r = await this.#send('location_claim_v2', key)
      if (!this.#unsupported(r)) return { via: 'v2', ...r }
      this.#disable(r.status === 501 ? 'sql-missing' : 'edge-v5')
    }
    return { via: 'v1', ...(await this.#send('location_claim', key)) }
  }

  /** Standby promotion: acquire (a v5 op) then exclusive activation; unsupported → stop the identity. */
  async promote(identity) {
    if (!this.recovery) return { promoted: false, reason: this.reason ?? this.state }
    await this.#send('presence_acquire', identity)
    const r = await this.#send('presence_activate_exclusive', identity)
    if (this.#unsupported(r)) { this.#disable(r.status === 501 ? 'sql-missing' : 'edge-v5'); await this.#send('presence_stop', identity); return { promoted: false, reason: this.reason } }
    return { promoted: r.status === 200 && r.body?.result?.status === 'active', answer: r.body }
  }
}
