import { describe, expect, it } from 'vitest'
import { visibleWorldHints, type WorldHint } from './worldHints'

const dungeon: WorldHint = { id: 'dungeon', badge: 'Dungeon', tone: 'dungeon', text: 'Hay cuevas cerca.' }
const skills: WorldHint = { id: 'skills', badge: 'Skills', tone: 'skills', text: 'Acercate a una roca.' }
const clear = { chatOpen: false, actionOpen: false }

describe('visibleWorldHints', () => {
  it('stacks every present hint in the order the features are listed', () => {
    expect(visibleWorldHints([dungeon, null, skills, undefined], clear)).toEqual([dungeon, skills])
  })

  it('hides the tray while the chat panel owns the bottom corner', () => {
    expect(visibleWorldHints([dungeon, skills], { ...clear, chatOpen: true })).toEqual([])
  })

  it('hides the tray while a profession action card is open', () => {
    expect(visibleWorldHints([dungeon], { ...clear, actionOpen: true })).toEqual([])
  })
})
