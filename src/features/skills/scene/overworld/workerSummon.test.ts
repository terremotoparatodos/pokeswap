import { describe, expect, it } from 'vitest'
import type { WorkerCompanion } from './workerCompanion'
import { workerSpot } from './workerPresence'
import { openGround, summonWorkerOnce } from './workerSummon'

function recorder() {
  const calls: { speciesId: number; tx: number; ty: number; dir: string }[] = []
  const companion = { summon: (speciesId: number, spot: { tx: number; ty: number; dir: string }) => calls.push({ speciesId, ...spot }) }
  return { calls, companion: companion as unknown as WorkerCompanion }
}

describe('worker summon', () => {
  const player = { tx: 0, ty: 1 }
  const node = { tx: 0, ty: 0 }

  it('summons once per action, on the spot workerSpot picks', () => {
    const { calls, companion } = recorder()
    const action = { summoned: false, workerSpeciesId: 68 }
    const free = () => true
    summonWorkerOnce(companion, action, player, node, free)
    summonWorkerOnce(companion, action, player, node, free)
    expect(calls).toEqual([{ speciesId: 68, ...workerSpot(player, node, free)! }])
    expect(action.summoned).toBe(true)
  })

  it('marks the action even without a worker or a free spot, so later frames do not retry', () => {
    const { calls, companion } = recorder()
    const idle = { summoned: false, workerSpeciesId: null }
    summonWorkerOnce(companion, idle, player, node, () => true)
    const boxedIn = { summoned: false, workerSpeciesId: 68 }
    summonWorkerOnce(companion, boxedIn, player, node, () => false)
    expect(calls).toEqual([])
    expect(idle.summoned && boxedIn.summoned).toBe(true)
  })

  it('treats solid, water and claimed tiles as taken', () => {
    const area = { isSolid: (tx: number) => tx === 1, isWater: (tx: number) => tx === 2 }
    const isFree = openGround(area, tx => tx === 3)
    expect([0, 1, 2, 3].map(tx => isFree(tx, 0))).toEqual([true, false, false, false])
  })
})
