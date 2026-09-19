// The server's clock (R32.4).
//
// R32.3 has no clock at all: `ADVANCE_TIME` carries whole milliseconds and the
// rules trust whoever sends them. That is correct for a pure engine and
// catastrophic on a socket — a client that says "10 000 ms elapsed" would fill
// its Action Bar, tick the other side's poison and walk away with the fight.
//
// So the authority never reads a delta off the wire. It reads **its own**
// clock, subtracts the moment the battle started, and hands the rules the
// difference. A client timestamp is diagnostics; it is never an argument.
//
// There is exactly one wall clock in this feature and it is `systemClock`
// below. Everything else takes an `AuthorityClock`, which is how a test moves
// three minutes without sleeping three minutes.

/** Monotonic-enough source of server milliseconds. The only time authority trusts. */
export interface AuthorityClock {
  /** Milliseconds. Whole numbers: a battle's time is integer ms by contract. */
  nowMs(): number
}

/** A clock a test drives by hand. Nothing here sleeps, and nothing is scheduled. */
export interface ManualClock extends AuthorityClock {
  /** Moves forward. Rejects a negative step: a server clock never goes back. */
  advance(deltaMs: number): number
  /** Jumps to an absolute reading, forward only. */
  setTo(atMs: number): number
}

/**
 * Real server time.
 *
 * `Date.now()` is a wall clock and can step when the host syncs, so the
 * authority clamps: the reading it keeps never decreases (`createBattle`
 * onwards), and a battle whose host jumps backwards simply does not advance
 * until real time catches up. A frozen battle is recoverable; a battle that
 * rewinds its Action Bars is not.
 */
export function createSystemClock(now: () => number = Date.now): AuthorityClock {
  let last = 0
  return {
    nowMs() {
      const reading = Math.floor(now())
      if (reading > last) last = reading
      return last
    },
  }
}

export function createManualClock(startMs = 0): ManualClock {
  let current = Math.floor(startMs)
  return {
    nowMs: () => current,
    advance(deltaMs) {
      if (!Number.isFinite(deltaMs) || deltaMs < 0) throw new Error('a server clock cannot go back')
      current += Math.floor(deltaMs)
      return current
    },
    setTo(atMs) {
      const target = Math.floor(atMs)
      if (!Number.isFinite(target) || target < current) throw new Error('a server clock cannot go back')
      current = target
      return current
    },
  }
}
