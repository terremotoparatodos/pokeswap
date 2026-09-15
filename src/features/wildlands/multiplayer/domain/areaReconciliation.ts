import type { PresenceAreaId } from './presence'

export interface AreaReconciliation {
  accept: boolean
  pendingArea: PresenceAreaId | null
}

/**
 * A reliable socket preserves message order, but the player may have already
 * swapped maps locally while it receives the final acknowledgement from the
 * prior map. That acknowledgement must not undo the portal transition.
 */
export function reconcilePresenceArea(
  pendingArea: PresenceAreaId | null,
  receivedArea: PresenceAreaId,
): AreaReconciliation {
  if (pendingArea !== null && receivedArea !== pendingArea) {
    return { accept: false, pendingArea }
  }
  return { accept: true, pendingArea: null }
}
