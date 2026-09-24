import { describe, expect, it } from 'vitest'
import { createActor, RUN_SPEED, tryStep, WALK_SPEED, type Actor, type MoveRules } from './actors'
import { WildlandsGame } from './game'
import { PresenceDiagnostics } from '../multiplayer/domain/presenceDiagnostics'

type Sent = { dir: string; running: boolean; sequence: number }
type Harness = { startStep(player: Actor): void; keys: { sprinting: boolean }; nextMoveSequence: number }

const open: MoveRules = { blocked: () => false, occupied: () => false }

function game(water: (tx: number, ty: number) => boolean = () => false) {
  const sent: Sent[] = []
  const g = Object.create(WildlandsGame.prototype) as Harness
  Object.assign(g, {
    keys: { sprinting: false }, nextMoveSequence: 4, area: { isWater: water },
    presenceDiagnostics: new PresenceDiagnostics(),
    presence: { move: (dir: string, running: boolean, sequence: number) => sent.push({ dir, running, sequence }) },
  })
  const player = createActor({ id: 'player', kind: 'player', habitat: 'any', tx: 0, ty: 0 })
  // As driveWalker does: the step is taken, then announced before any of it is walked.
  const step = (dir: 'right' | 'down') => { player.progress = 1; tryStep(player, dir, open); g.startStep(player) }
  return { g, sent, player, step }
}

describe('step announcement', () => {
  it('announces each step as it starts, with the gait it is walked at', () => {
    const { g, sent, player, step } = game()
    step('right')
    expect(sent).toEqual([{ dir: 'right', running: false, sequence: 5 }])
    expect([player.speed, player.running]).toEqual([WALK_SPEED, false])

    g.keys.sprinting = true
    step('down')
    expect(sent[1]).toEqual({ dir: 'down', running: true, sequence: 6 })
    expect([player.speed, player.running]).toEqual([RUN_SPEED, true])
    expect(g.nextMoveSequence).toBe(6)
  })

  it('slows a step by the tile it starts from, not the one it enters', () => {
    const { sent, player, step } = game((tx) => tx === 0)
    step('right')
    expect(player.speed).toBeCloseTo(WALK_SPEED * 0.7)
    step('right')
    expect(player.speed).toBe(WALK_SPEED)
    // The gait sent is the nominal one either way: the server does not model water.
    expect(sent.map(s => s.running)).toEqual([false, false])
  })
})
