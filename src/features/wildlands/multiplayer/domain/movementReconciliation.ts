/**
 * The tile currently being animated is an optimistic local step. An
 * acknowledgement for the prior completed step must not snap the player back
 * and discard the rest of a tap route.
 */
export function keepsPredictedStep(moving: boolean, acknowledgedSequence: number, localSequence: number): boolean {
  return moving && acknowledgedSequence === localSequence
}
