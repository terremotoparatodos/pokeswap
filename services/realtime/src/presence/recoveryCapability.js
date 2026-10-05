import { RecoveryUnsupported } from '../world/persistence/playerData.js'

/**
 * CLOUD READINESS-3 — whether this process uses presence recovery (docs/design/CLOUD_READINESS_3_REPORT.md).
 *
 * Kill switch: WORLD_PRESENCE_RECOVERY=on enables it; anything else (unset included) is OFF, so
 * no existing environment changes behaviour. It is read once, when the realtime's modules load
 * (after CLOUD ENV-1 loaded the Cloud environment): changing it needs a process restart.
 *
 * States: 'off' (kill switch) | 'unknown' (not probed yet, or the probe failed transiently) |
 * 'enabled' | 'disabled' (with a reason). Rules (contract validated in CLOUD READINESS-2):
 *   - one probe per process ('capabilities'), retried at most every `retryMs` while 'unknown';
 *     enabled only if the authority reports the recovery SQL;
 *   - RecoveryUnsupported from ANY recovery operation (400 unknown_op from a v5 Edge Function,
 *     501 unsupported, a missing SQL function) disables it for the rest of the process: never
 *     re-enabled without a restart, so it never flaps;
 *   - a transient failure (timeout, 5xx) never changes the state.
 * While not 'enabled' the process behaves exactly as before: v1 claims, no standby, the close
 * codes of WORLD LOCATION-4.
 */
export const RECOVERY_ENV = 'WORLD_PRESENCE_RECOVERY'
export const CAPABILITY_RETRY_MS = 60_000

export const recoveryRequested = env => env?.[RECOVERY_ENV] === 'on'
export const isRecoveryUnsupported = error => error instanceof RecoveryUnsupported

export class RecoveryCapability {
  constructor({ store = null, requested = false, log = message => console.warn(message), now = () => performance.now(), retryMs = CAPABILITY_RETRY_MS } = {}) {
    this.store = store
    this.log = log
    this.now = now
    this.retryMs = retryMs
    this.state = requested ? 'unknown' : 'off'
    this.reason = requested ? null : 'kill-switch'
    this.lastProbeAt = null
    this.probing = null
    this.counters = { probes: 0, probeFailures: 0, fallbacks: 0 }
  }

  get enabled() { return this.state === 'enabled' }

  /** Probes once (single-flight); never throws. Resolves with the state. */
  probe() {
    if (this.state !== 'unknown') return Promise.resolve(this.state)
    if (this.probing) return this.probing
    if (this.lastProbeAt !== null && this.now() - this.lastProbeAt < this.retryMs) return Promise.resolve(this.state)
    if (typeof this.store?.capabilities !== 'function') { this.disable('store'); return Promise.resolve(this.state) }
    this.probing = (async () => {
      this.lastProbeAt = this.now()
      this.counters.probes++
      try {
        const answer = await this.store.capabilities()
        if (this.state !== 'unknown') return this.state
        if (answer?.recovery?.version === 1) {
          this.state = 'enabled'
          this.log('[recovery] enabled: the authority has the presence-recovery operations')
        } else this.disable(answer?.reason ?? 'sql-missing')
      } catch {
        this.counters.probeFailures++ // transient: stays 'unknown', probed again later
      } finally {
        this.probing = null
      }
      return this.state
    })()
    return this.probing
  }

  /** For the rest of the process. Only 'unknown' or 'enabled' can become 'disabled'. */
  disable(reason) {
    if (this.state !== 'unknown' && this.state !== 'enabled') return
    this.state = 'disabled'
    this.reason = reason
    this.log(`[recovery] disabled for this process (${reason}): v1 claims, no standby`)
  }

  /** `error` came from a recovery operation: disables on RecoveryUnsupported; returns whether it did. */
  unsupported(error) {
    if (!isRecoveryUnsupported(error)) return false
    this.disable(error.reason ?? 'unsupported')
    return true
  }

  stats() { return { state: this.state, reason: this.reason, ...this.counters } }
}

/**
 * The location store the journal uses: v1 unchanged, except locationClaim, which goes through
 * claim v2 while recovery is enabled. A v2 call refused as unsupported disables recovery and is
 * retried ONCE through v1 with the SAME key (the v2 call did not run, so nothing is claimed twice).
 * Any other failure is returned to the journal as it is (it retries with the same key, as today).
 */
export function withRecovery(store, capabilityOf) {
  if (!store) return store
  const current = typeof capabilityOf === 'function' ? capabilityOf : () => capabilityOf
  return new Proxy(store, {
    get(target, property, receiver) {
      if (property !== 'locationClaim') return Reflect.get(target, property, receiver)
      return async (userId, key, options) => {
        const capability = current()
        if (capability?.enabled && typeof target.locationClaimV2 === 'function') {
          try {
            return await target.locationClaimV2(userId, key, options)
          } catch (error) {
            if (!capability.unsupported(error)) throw error
            capability.counters.fallbacks++
          }
        }
        return target.locationClaim(userId, key)
      }
    },
  })
}
