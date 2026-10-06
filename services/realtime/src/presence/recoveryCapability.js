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

/**
 * H2 containment — the standby's automatic promotion has its own switch, WORLD_PRESENCE_STANDBY=on, OFF by
 * default and only effective with recovery enabled and location persistence in `on` (never in shadow).
 * Everything else recovery brings (claim v2, the close mapping, «Jugar acá», the capability) does not depend
 * on it. With it on, H2 exists: a standby can promote while the live, routed host only lost its lease
 * (docs/design/CLOUD_H2_STANDBY_CONTAINMENT_REPORT.md) — isolated tests only, never an active environment.
 */
export const STANDBY_ENV = 'WORLD_PRESENCE_STANDBY'
export const standbyRequested = env => env?.[STANDBY_ENV] === 'on'
export const isRecoveryUnsupported = error => error instanceof RecoveryUnsupported

/**
 * The same rules for every optional authority feature, each probed and disabled on its own:
 *   'recovery'   (above; CLOUD READINESS-3)
 *   'joinOrder'  (CLOUD JOIN-ORDER-2): claim v3 orders one page's join attempts across processes. Requested
 *                only with WORLD_JOIN_ORDER=on; enabled only if the authority reports its SQL. While not
 *                enabled the process still orders attempts in its own memory (presence/joinOrder.js) and
 *                claims exactly as before (v1, or v2 while recovery is enabled).
 * An operation is never retried twice under a disabled feature: RecoveryUnsupported from it (400 unknown_op,
 * 501 unsupported, a missing SQL function) disables that feature for the rest of the process.
 */
const FEATURE_LOG = {
  recovery: {
    enabled: '[recovery] enabled: the authority has the presence-recovery operations',
    disabled: reason => `[recovery] disabled for this process (${reason}): v1 claims, no standby`,
  },
  joinOrder: {
    enabled: '[join-order] enabled across processes: the authority has claim v3',
    disabled: reason => `[join-order] cross-process order disabled for this process (${reason}): in-process order only`,
  },
}

export class AuthorityCapability {
  constructor({ store = null, requested = false, feature = 'recovery', log = message => console.warn(message), now = () => performance.now(), retryMs = CAPABILITY_RETRY_MS } = {}) {
    if (!FEATURE_LOG[feature]) throw new Error(`unknown authority feature ${feature}`)
    this.feature = feature
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
        if (answer?.[this.feature]?.version === 1) {
          this.state = 'enabled'
          this.log(FEATURE_LOG[this.feature].enabled)
        } else this.disable((this.feature === 'recovery' ? answer?.reason : answer?.[`${this.feature}Reason`]) ?? 'sql-missing')
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
    this.log(FEATURE_LOG[this.feature].disabled(reason))
  }

  /** `error` came from a recovery operation: disables on RecoveryUnsupported; returns whether it did. */
  unsupported(error) {
    if (!isRecoveryUnsupported(error)) return false
    this.disable(error.reason ?? 'unsupported')
    return true
  }

  stats() { return { state: this.state, reason: this.reason, ...this.counters } }
}

/** CLOUD READINESS-3: presence recovery (claim v2, standby, retry close codes). */
export class RecoveryCapability extends AuthorityCapability {
  constructor(options = {}) { super({ ...options, feature: 'recovery' }) }
}

/** CLOUD JOIN-ORDER-2: the cross-process join order (claim v3). Requested only with WORLD_JOIN_ORDER=on. */
export class JoinOrderCapability extends AuthorityCapability {
  constructor(options = {}) { super({ ...options, feature: 'joinOrder' }) }
}

/**
 * The location store the journal uses: v1 unchanged, except locationClaim, which goes through
 * claim v2 while recovery is enabled. A v2 call refused as unsupported disables recovery and is
 * retried ONCE through v1 with the SAME key (the v2 call did not run, so nothing is claimed twice).
 * Any other failure is returned to the journal as it is (it retries with the same key, as today).
 *
 * CLOUD JOIN-ORDER-2: a session whose join carried a page and attempt (only with WORLD_JOIN_ORDER=on)
 * claims through v3 while the join-order capability is enabled, with the rules of the claim it replaces
 * (recovery: v2's, else v1's; a takeover only with recovery). A v3 call refused as unsupported disables
 * the join order (never recovery) and the SAME key goes once through that v1/v2 claim instead.
 */
export function withRecovery(store, capabilityOf, joinOrderOf = () => null) {
  if (!store) return store
  const current = typeof capabilityOf === 'function' ? capabilityOf : () => capabilityOf
  const ordering = typeof joinOrderOf === 'function' ? joinOrderOf : () => joinOrderOf
  return new Proxy(store, {
    get(target, property, receiver) {
      if (property !== 'locationClaim') return Reflect.get(target, property, receiver)
      return async (userId, key, options) => {
        const capability = current()
        const recovery = Boolean(capability?.enabled && typeof target.locationClaimV2 === 'function')
        const order = ordering()
        if (options?.page && order?.enabled && typeof target.locationClaimV3 === 'function') {
          try {
            return await target.locationClaimV3(userId, key, { takeover: recovery && options.takeover === true, recovery, page: options.page, attempt: options.attempt })
          } catch (error) {
            if (!order.unsupported(error)) throw error
            order.counters.fallbacks++
          }
        }
        if (recovery) {
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
