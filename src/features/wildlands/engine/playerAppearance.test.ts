import { describe, expect, it } from 'vitest'
import { createActor } from './actors'
import type { TrainerSheet, TrainerSprites } from './characters'
import { PlayerAppearance } from './playerAppearance'
import type { PlayerCharacter } from '../identity/playerCharacters'

const sprites = (name: string) => ({ name }) as unknown as TrainerSprites
const character = (id: string, sheetUrl: string): PlayerCharacter => ({ id, label: id, sheetUrl, columns: 4 }) as PlayerCharacter
const flush = () => new Promise(resolve => setTimeout(resolve, 0))

describe('PlayerAppearance', () => {
  it('keeps fallback art when a selected sheet is missing', async () => {
    const fallback = sprites('fallback')
    const player = createActor({ id: 'player', kind: 'player', habitat: 'any', tx: 0, ty: 0, trainer: fallback })
    const appearance = new PlayerAppearance(player, fallback, () => Promise.reject(new Error('missing')))
    appearance.set(character('dawn-pink', '/missing.png'))
    await flush()
    expect(player.trainer).toBe(fallback)
  })

  it('does not let an older sheet load replace the latest choice', async () => {
    const fallback = sprites('fallback')
    const latest = sprites('latest')
    let releaseOld!: (sheet: TrainerSheet) => void
    const player = createActor({ id: 'player', kind: 'player', habitat: 'any', tx: 0, ty: 0, trainer: fallback })
    const appearance = new PlayerAppearance(player, fallback, url => url === '/old.png'
      ? new Promise(resolve => { releaseOld = resolve })
      : Promise.resolve({ walk: latest }))
    appearance.set(character('dawn-pink', '/old.png'))
    appearance.set(character('dawn-yellow', '/latest.png'))
    releaseOld({ walk: sprites('old') })
    await flush()
    expect(player.trainer).toBe(latest)
  })
})
