import { describe, expect, it } from 'vitest'
import { reconcilePresenceArea } from './areaReconciliation'

describe('reconcilePresenceArea', () => {
  it('does not let a final old-area acknowledgement undo a portal transition', () => {
    expect(reconcilePresenceArea('pradera', 'ciudad-corazon')).toEqual({ accept: false, pendingArea: 'pradera' })
  })

  it('accepts the requested area and clears the transition barrier', () => {
    expect(reconcilePresenceArea('pradera', 'pradera')).toEqual({ accept: true, pendingArea: null })
  })

  it('accepts a normal acknowledgement when no portal change is pending', () => {
    expect(reconcilePresenceArea(null, 'ciudad-corazon')).toEqual({ accept: true, pendingArea: null })
  })
})
