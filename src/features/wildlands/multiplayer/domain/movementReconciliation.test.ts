import { describe, expect, it } from 'vitest'
import { keepsPredictedStep, safeAuthoritativePosition } from './movementReconciliation'

describe('movement reconciliation', () => {
  it('keeps an in-progress next click-path step when its prior step is acknowledged', () => {
    expect(keepsPredictedStep(true, 8, 8)).toBe(true)
  })

  it('reconciles a newer authoritative position and never protects a resting player', () => {
    expect(keepsPredictedStep(true, 9, 8)).toBe(false)
    expect(keepsPredictedStep(false, 8, 8)).toBe(false)
  })

  it('falls back instead of reconciling a player inside world collision', () => {
    const authoritative = { tx: 22, ty: 17, dir: 'right' as const }
    const spawn = { tx: 31, ty: 20, dir: 'down' as const }

    expect(safeAuthoritativePosition(authoritative, spawn, (tx, ty) => tx === 22 && ty === 17)).toEqual({
      position: spawn,
      recovered: true,
    })
    expect(safeAuthoritativePosition(authoritative, spawn, () => false)).toEqual({
      position: authoritative,
      recovered: false,
    })
  })
})
