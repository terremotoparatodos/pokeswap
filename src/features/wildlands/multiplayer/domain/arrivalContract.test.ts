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

  const cave = atlas.get('cueva-inicial')

  it('matches the client arrival for every presence transition', () => {
    expect(arrivalFor('ciudad-corazon', 'pradera')).toEqual(town.arrival('pradera'))
    expect(arrivalFor('ciudad-corazon', 'ciudad-corazon')).toEqual(town.arrival(null))
    expect(arrivalFor('pradera', 'ciudad-corazon')).toEqual(pradera.arrival('ciudad-corazon'))
    expect(arrivalFor('pradera', 'pradera')).toEqual(pradera.arrival(null))
    // CAVES-3: in through the mouth, out to the approach, the escape hatch and a reset inside.
    expect(arrivalFor('cueva-inicial', 'pradera')).toEqual(cave.arrival('pradera'))
    expect(arrivalFor('cueva-inicial', 'cueva-inicial')).toEqual(cave.arrival(null))
    expect(arrivalFor('pradera', 'cueva-inicial')).toEqual(pradera.arrival('cueva-inicial'))
    expect(arrivalFor('ciudad-corazon', 'cueva-inicial')).toEqual(town.arrival('cueva-inicial'))
  })

  it('never places the authoritative actor on solid terrain', () => {
    for (const [to, from] of [
      ['ciudad-corazon', 'pradera'], ['ciudad-corazon', 'ciudad-corazon'], ['pradera', 'ciudad-corazon'], ['pradera', 'pradera'],
      ['cueva-inicial', 'pradera'], ['cueva-inicial', 'cueva-inicial'], ['pradera', 'cueva-inicial'], ['ciudad-corazon', 'cueva-inicial'],
    ] as const) {
      const at = arrivalFor(to, from)!
      expect(atlas.get(to).isSolid(at.tx, at.ty)).toBe(false)
      expect(atlas.get(to).isReachable?.(at.tx, at.ty) ?? true).toBe(true)
    }
  })
})
