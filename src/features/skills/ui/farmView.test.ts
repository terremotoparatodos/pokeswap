import { describe, expect, it } from 'vitest'
import { cropOptions, farmWorkerOptions, timeLeft } from './farmView'

describe('Agricultura card view', () => {
  it('offers the huerta’s crops and says why the others are locked', () => {
    const options = cropOptions('town', 1)
    expect(options.map(option => option.crop.id)).toEqual(['oran', 'medicinal', 'leppa'])
    expect(options.map(option => option.locked)).toEqual([false, true, true])
    expect(options[1].line).toBe('Requiere Agricultura 10')
  })

  it('ranks the player’s own Pokémon by farming aptitude', () => {
    const [best, , worst] = farmWorkerOptions([{ instanceId: '129', speciesId: 129 }, { instanceId: '241', speciesId: 241 }, { instanceId: '324', speciesId: 324 }], 'plant', 'oran', 1)
    expect(best.name).toBe('Miltank')
    expect(best.aptitude).toBe(5)
    expect(worst.aptitude).toBeLessThanOrEqual(best.aptitude)
    expect(best.seconds).toBeLessThan(worst.seconds)
  })

  it('formats the time left', () => {
    expect(timeLeft(45_000)).toBe('45 s')
    expect(timeLeft(80_000)).toBe('1 min 20 s')
    expect(timeLeft(120_000)).toBe('2 min')
  })
})
