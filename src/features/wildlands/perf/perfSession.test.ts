import { describe, expect, it } from 'vitest'
import { createActor } from '../engine/actors'
import type { Area } from '../engine/area'
import { PerfSession } from './perfSession'

function fakeGame() {
  const npc = createActor({ id: 'town:n0', kind: 'npc', habitat: 'land', tx: 3, ty: 3 })
  return {
    populace: { actors: [npc], update() {} } as { actors: unknown[]; update(): void },
    setFrameProbe() {}, setVirtualDir() {}, setVirtualSprint() {},
  }
}

describe('perf session NPC experiment', () => {
  it('empties the population the engine runs, and again after an area change builds a new one', () => {
    const session = new PerfSession()
    const game = fakeGame()
    session.install(game)
    session.setPopulationEnabled(false)
    expect(game.populace.actors).toHaveLength(0)

    // enterArea() replaces the population; the next frame swaps it out again.
    game.populace = fakeGame().populace
    const player = createActor({ id: 'player', kind: 'player', habitat: 'any', tx: 0, ty: 0 })
    session.frameProbe.frame(0, 0, 0, 0, 0, player, 0, 0, { id: 'pradera' } as Area, [], 0)
    expect(game.populace.actors).toHaveLength(0)
    session.uninstall()
  })

  it('leaves the population alone by default', () => {
    const session = new PerfSession()
    const game = fakeGame()
    session.install(game)
    expect(game.populace.actors).toHaveLength(1)
    session.uninstall()
  })
})
