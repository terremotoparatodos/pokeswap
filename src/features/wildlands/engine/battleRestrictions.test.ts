// ECO-BATTLE-SCENE-1: during a test battle the trainer keeps walking and chatting, but takes no
// portal and starts no other activity (the server refuses both too; this is the courtesy that
// tells the player why). Lifted with the end. The engine's real methods, on a bare game.

import { describe, expect, it, vi, type Mock } from 'vitest'
import { KeyboardInput } from './keyboard'
import { WildlandsGame } from './game'

/** The engine's real methods on an object carrying only the fields they read (private ones included). */
interface BareGame {
  [field: string]: unknown
  nav: { cancel: Mock; goTo: Mock; route: () => { target: null } }
  travel: { active: boolean; begin: Mock }
  player: { tx: number; ty: number; dir: string }
  say: Mock
  onWorldObject: Mock
  inputLocked: boolean
  setBattleRestricted(restricted: boolean): void
  travelTo(to: string): void
  interact(): void
  tap(cssX: number, cssY: number): void
  worldObjectBeside(tile: { tx: number; ty: number }): boolean
}

function bareGame(): BareGame {
  const game = Object.create(WildlandsGame.prototype) as BareGame
  game.nav = { cancel: vi.fn(), goTo: vi.fn(), route: () => ({ target: null }) }
  game.travel = { active: false, begin: vi.fn(() => true) }
  game.presence = null
  game.spectator = false; game.sceneHeld = false; game.paused = false; game.inputLocked = false
  game.area = { id: 'pradera', kind: 'wild' }
  game.player = { tx: 0, ty: 0, dir: 'right' }
  game.populace = { actors: [] }
  game.say = vi.fn()
  game.isWorldObject = ({ tx, ty }: { tx: number; ty: number }) => tx === 1 && ty === 0 // a tree to the right
  game.onWorldObject = vi.fn(() => true)
  game.renderer = { pick: () => ({ tile: { tx: 5, ty: 5 } }) }
  game.placedObjects = { at: () => null }
  game.entrances = { retarget: (_area: unknown, pick: { tile: unknown }) => ({ tile: pick.tile, actor: null }) }
  return game
}

describe('the battle restrictions (ECO-BATTLE-SCENE-1)', () => {
  it('no portal: a crossing is not started, and the player is told why', () => {
    const game = bareGame()
    game.setBattleRestricted(true)
    game.travelTo('cueva-inicial')
    expect(game.travel.begin).not.toHaveBeenCalled()
    expect(game.nav.cancel).toHaveBeenCalled()
    expect(game.say).toHaveBeenCalledWith('No podés salir del área durante un combate.')
  })

  it('no other activity: facing a world object, nothing starts (Space or a tap beside it); other tiles are untouched', () => {
    const game = bareGame()
    game.setBattleRestricted(true)
    game.interact() // facing right: the tree
    expect(game.onWorldObject).not.toHaveBeenCalled()
    expect(game.say).toHaveBeenCalledWith('Terminá o huí del combate para hacer otra actividad.')
    expect(game.worldObjectBeside({ tx: 1, ty: 0 })).toBe(true)
    expect(game.onWorldObject).not.toHaveBeenCalled()
    game.player.dir = 'down' // facing plain ground: not an activity, the usual path
    game.interact()
    expect(game.onWorldObject).toHaveBeenCalledTimes(1)
  })

  it('walking stays: a tap on the ground still walks there; nothing holds the input', () => {
    const game = bareGame()
    game.setBattleRestricted(true)
    game.tap(10, 10)
    expect(game.nav.goTo).toHaveBeenCalledOnce()
    expect(game.inputLocked).toBe(false)
  })

  it('lifted with the end: the same crossing and the same activity go through', () => {
    const game = bareGame()
    game.setBattleRestricted(true)
    game.setBattleRestricted(false)
    game.travelTo('cueva-inicial')
    expect(game.travel.begin).toHaveBeenCalledOnce()
    game.interact()
    expect(game.onWorldObject).toHaveBeenCalledOnce()
  })
})

describe('chat during a battle (ECO-BATTLE-SCENE-1)', () => {
  it('typing in a text field neither moves the trainer nor triggers the map (Space, Enter, arrows)', () => {
    let interactions = 0
    const keys = new KeyboardInput({ cycleLens: () => {}, toggleGrid: () => {}, skipTime: () => {}, interact: () => { interactions++ } })
    keys.attach()
    const input = document.createElement('input')
    document.body.append(input)
    try {
      input.focus()
      for (const [key, code] of [[' ', 'Space'], ['Enter', 'Enter'], ['ArrowUp', 'ArrowUp'], ['a', 'KeyA']]) {
        input.dispatchEvent(new KeyboardEvent('keydown', { key, code, bubbles: true, cancelable: true }))
      }
      expect(interactions).toBe(0)
      expect(keys.direction).toBeNull()
      input.blur()
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', code: 'ArrowUp' }))
      expect(keys.direction, 'outside the field the map keys work').toBe('up')
      window.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowUp', code: 'ArrowUp' }))
    } finally {
      keys.detach()
      input.remove()
    }
  })
})
