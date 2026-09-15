import { describe, expect, it } from 'vitest'
import { keepsPredictedStep } from './movementReconciliation'

describe('movement reconciliation', () => {
  it('keeps an in-progress next click-path step when its prior step is acknowledged', () => {
    expect(keepsPredictedStep(true, 8, 8)).toBe(true)
  })

  it('reconciles a newer authoritative position and never protects a resting player', () => {
    expect(keepsPredictedStep(true, 9, 8)).toBe(false)
    expect(keepsPredictedStep(false, 8, 8)).toBe(false)
  })
})
