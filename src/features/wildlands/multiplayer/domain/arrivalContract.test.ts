import { describe, expect, it } from 'vitest'
import { Atlas } from '../../areas/atlas'
import { arrivalFor } from '../../../../../services/realtime/src/protocol/arrival.js'

// The client predicts from its own arrival while the presence service applies
// the same direction intents from its own. Any difference is a permanent
// offset; in Pradera it put the authoritative actor on solid terrain and made
// every entry trigger the safe-spawn recovery in a loop.
describe('presence arrival contract', () => {
  const atlas = new Atlas()
  const town = atlas.get('ciudad-corazon')
  const pradera = atlas.get('pradera')

  it('matches the client arrival for every presence transition', () => {
    expect(arrivalFor('ciudad-corazon', 'pradera')).toEqual(town.arrival('pradera'))
    expect(arrivalFor('ciudad-corazon', 'ciudad-corazon')).toEqual(town.arrival(null))
    expect(arrivalFor('pradera', 'ciudad-corazon')).toEqual(pradera.arrival('ciudad-corazon'))
    expect(arrivalFor('pradera', 'pradera')).toEqual(pradera.arrival(null))
  })

  it('never places the authoritative actor on solid terrain', () => {
    for (const [to, from] of [['ciudad-corazon', 'pradera'], ['ciudad-corazon', 'ciudad-corazon'], ['pradera', 'ciudad-corazon'], ['pradera', 'pradera']] as const) {
      const at = arrivalFor(to, from)!
      expect(atlas.get(to).isSolid(at.tx, at.ty)).toBe(false)
      expect(atlas.get(to).isReachable?.(at.tx, at.ty) ?? true).toBe(true)
    }
  })
})
