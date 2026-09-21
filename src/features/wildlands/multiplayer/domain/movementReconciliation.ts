/**
 * The tile currently being animated is an optimistic local step. An
 * acknowledgement for the prior completed step must not snap the player back
 * and discard the rest of a tap route.
 */
export function keepsPredictedStep(moving: boolean, acknowledgedSequence: number, localSequence: number): boolean {
  return moving && acknowledgedSequence === localSequence
}

export interface AuthoritativePosition {
  tx: number
  ty: number
  dir: 'up' | 'down' | 'left' | 'right'
}

/**
 * A stale or divergent presence position must never put the playable avatar
 * inside current world collision. Falling back to the area's arrival also
 * gives the caller a signal to reset the ephemeral server position.
 */
export function safeAuthoritativePosition(
  position: AuthoritativePosition,
  fallback: AuthoritativePosition,
  blocked: (tx: number, ty: number) => boolean,
): { position: AuthoritativePosition; recovered: boolean } {
  return blocked(position.tx, position.ty)
    ? { position: fallback, recovered: true }
    : { position, recovered: false }
}
