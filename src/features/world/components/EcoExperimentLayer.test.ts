// ECO-PRESENTATION-1 (experimental): selecting an individual on the map opens ITS card (by encounter
// id, never by species); the card explains busy/far/gone and only offers «Combatir» when free and in
// range; the battle screen shows the server's snapshot with the bundled overworld sprites, sends
// move choices and «Huir», and shows the server's end without promising captures or rewards; the
// card clears on an area change; the debug panel is secondary and shares the same session.

import { describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import type { EcoArea, EcoBattleInfo } from '../../../../services/realtime/src/world/worldProtocol.js'
import { WORLD_MESSAGE } from '../../../../services/realtime/src/world/worldProtocol.js'
import type { ClientBattleSnapshot } from '../../battle/authority'
import type { PokemonInfo } from '../../wildlands/engine/actors'
import { KeyboardInput } from '../../wildlands/engine/keyboard'
import { SharedWorld } from '../state/sharedWorld'
import EcoExperimentLayer from './EcoExperimentLayer.vue'

const ID = (nest: string, member: number) => `eco-n:pradera:${nest}:1:${member}`
// Two individuals of the SAME species (#13), one busy, one far, one of another species.
const area: EcoArea = {
  protocol: 1, areaId: 'pradera', status: 'active',
  encounters: [
    { id: ID('soto', 0), groupId: 'g1', speciesId: 13, tx: 2, ty: 0, busy: false },
    { id: ID('soto', 1), groupId: 'g1', speciesId: 13, tx: 3, ty: 1, busy: false },
    { id: ID('claro', 0), groupId: 'g2', speciesId: 43, tx: 0, ty: 2, busy: true },
    { id: ID('lejos', 0), groupId: 'g3', speciesId: 16, tx: 9, ty: 0, busy: false },
  ],
}
const combatant = (combatantId: string, speciesId: number, hp: number, max: number) => ({
  combatantId, sideId: combatantId.split('-')[0], level: combatantId === 'player-0' ? 12 : 8, wild: combatantId === 'wild-0', stats: { hp: max },
  condition: { currentHp: hp, pp: {}, majorStatus: 'none' },
  instance: { speciesId, moves: [{ moveId: 84, ppUps: 0 }, { moveId: 104, ppUps: 0 }] },
  runtime: { selected: null },
})
const snapshot = (wildHp = 26, revision = 1) => ({
  battleId: 'eco-battle-a-0000000a', revision, timeMs: 0, catalogVersion: 'c', battleRulesVersion: 'r', outcome: { kind: 'ongoing' },
  combatants: { 'player-0': combatant('player-0', 25, 34, 34), 'wild-0': combatant('wild-0', 13, wildHp, 26) },
}) as unknown as ClientBattleSnapshot
const battle: EcoBattleInfo = {
  battleId: 'eco-battle-a-0000000a', speciesId: 13, fixture: true, fixtureLabel: 'fixture de prueba', expiresInMs: 120_000, snapshot: snapshot(),
  joinAck: { battleId: 'eco-battle-a-0000000a', controllerId: 'p', currentRevision: 1, nextActionSequence: 1, catalogVersion: 'c', battleRulesVersion: 'r', controlledCombatantIds: ['player-0'] },
}

function setup() {
  const world = new SharedWorld(async () => null, id => ({ id, name: String(id), shiny: false, frames: {} }) as unknown as PokemonInfo)
  const sent: [string, unknown][] = []
  world.attach((type, payload) => sent.push([type, payload]))
  world.snapshot({ now: 1, areaId: 'pradera', chunks: [], nodes: [], eco: area })
  const wrapper = mount(EcoExperimentLayer, { props: { world, areaId: 'pradera', tx: 0, ty: 0 }, attachTo: document.body })
  const layer = wrapper.vm as unknown as { select(id: string): boolean; dismissCard(): void }
  const card = () => wrapper.find('.eco-card')
  const screen = () => wrapper.find('.eco-battle')
  return { world, sent, wrapper, layer, card, screen }
}

describe('ECO experiment layer · map selection', () => {
  it('opens the card of the EXACT individual tapped; two of the same species stay distinct', async () => {
    const { layer, card, wrapper } = setup()
    expect(layer.select(ID('soto', 0))).toBe(true)
    await flushPromises()
    expect(card().text()).toContain('soto:1:0')
    expect(layer.select(ID('soto', 1))).toBe(true)
    await flushPromises()
    expect(card().text()).toContain('soto:1:1')
    expect(card().text()).not.toContain('soto:1:0')
    // not an ECO individual of this area: the caller handles it (the plaza's wild card)
    expect(layer.select('wild:25')).toBe(false)
    wrapper.unmount()
  })

  it('explains busy, far and gone; «Combatir» only when free and in range (the range itself unchanged)', async () => {
    const { world, layer, card, wrapper } = setup()
    const fight = () => card().find('.eco-card__fight')
    layer.select(ID('claro', 0)); await flushPromises()
    expect(card().text()).toContain('Ocupado: otro entrenador lo está combatiendo')
    expect(fight().attributes('disabled')).toBeDefined()
    layer.select(ID('lejos', 0)); await flushPromises()
    expect(card().text()).toContain('Lejos: estás a 9 casillas. Acercate a 6 o menos.')
    expect(fight().attributes('disabled')).toBeDefined()
    await wrapper.setProps({ tx: 3 }) // 6 tiles away now: in range
    expect(card().text()).toContain('Libre')
    expect(fight().attributes('disabled')).toBeUndefined()
    // retired while the card is open: it says so instead of vanishing silently
    world.eco({ now: 2, eco: { ...area, encounters: area.encounters.filter(e => e.id !== ID('lejos', 0)) } })
    await flushPromises()
    expect(card().text()).toContain('Ya no está aquí.')
    expect(fight().attributes('disabled')).toBeDefined()
    wrapper.unmount()
  })

  it('closes on ×, on Escape and on an area change', async () => {
    const { layer, card, wrapper } = setup()
    layer.select(ID('soto', 0)); await flushPromises()
    await card().find('.eco-card__close').trigger('click')
    expect(card().exists()).toBe(false)
    layer.select(ID('soto', 0)); await flushPromises()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); await flushPromises()
    expect(card().exists()).toBe(false)
    layer.select(ID('soto', 0)); await flushPromises()
    await wrapper.setProps({ areaId: 'cueva-inicial' })
    expect(card().exists()).toBe(false)
    wrapper.unmount()
  })
})

describe('ECO experiment layer · battle screen', () => {
  it('«Combatir» asks for that individual; the screen shows real sprites, names, levels, HP, moves/PP and «Huir»; the map pauses', async () => {
    const { world, sent, layer, card, screen, wrapper } = setup()
    layer.select(ID('soto', 1)); await flushPromises()
    await card().find('.eco-card__fight').trigger('click')
    expect(sent).toEqual([[WORLD_MESSAGE.ECO_ENGAGE, { requestId: 1, encounterId: ID('soto', 1) }]])
    expect(card().exists()).toBe(false)
    expect(screen().text()).toContain('Pidiendo el encuentro')
    world.ecoBattleMessage(WORLD_MESSAGE.ECO_ENGAGE_RESULT, { requestId: 1, encounterId: ID('soto', 1), ok: true, battle })
    await flushPromises()
    const sprites = screen().findAll('.eco-sprite').map(s => s.attributes('style'))
    expect(sprites.some(s => s?.includes('/assets/overworld/0013.png') && s.includes('0% 0%'))).toBe(true) // the wild one, facing the player
    expect(sprites.some(s => s?.includes('/assets/overworld/0025.png') && s.includes('33.3'))).toBe(true) // the Pikachu, from behind
    expect(screen().text()).toContain('fixture de prueba')
    expect(screen().text()).toContain('Nv. 12')
    expect(screen().text()).toContain('Nv. 8')
    expect(screen().text()).toContain('26 / 26 PS')
    expect(screen().findAll('.eco-battle__moves button')).toHaveLength(2)
    expect(screen().text()).toMatch(/30 PP/)
    expect(wrapper.emitted('battle')?.slice(-1)[0]).toEqual([true])
    // a move choice and «Huir» are requests; nothing changes until the server answers
    await screen().findAll('.eco-battle__moves button')[0].trigger('click')
    expect(sent[sent.length - 1]?.[0]).toBe(WORLD_MESSAGE.ECO_BATTLE_ACTION)
    expect((sent[sent.length - 1]?.[1] as { intent: { moveId: number } }).intent.moveId).toBe(84)
    world.ecoBattleMessage(WORLD_MESSAGE.ECO_BATTLE, { battleId: battle.battleId, events: [], snapshot: snapshot(9, 2) })
    await flushPromises()
    expect(screen().text()).toContain('9 / 26 PS')
    await screen().find('.eco-battle__flee').trigger('click')
    expect(sent[sent.length - 1]).toEqual([WORLD_MESSAGE.ECO_FLEE, { battleId: battle.battleId }])
    expect(screen().find('.eco-battle__flee').exists()).toBe(true)
    wrapper.unmount()
  })

  it.each([
    ['victory', 'Victoria', 'no hay captura ni recompensa'],
    ['defeat', 'Derrota', 'sigue en el mapa'],
    ['fled', 'Huiste', 'sigue en el mapa'],
    ['expired', 'Se acabó el tiempo', 'sigue en el mapa'],
    ['disconnected', 'Combate liberado', 'sin conexión'],
    ['left-area', 'Combate liberado', 'Saliste del área'],
  ])('shows the server\'s end %s plainly, never a capture or a reward', async (outcome, title, detail) => {
    const { world, layer, card, screen, wrapper } = setup()
    layer.select(ID('soto', 0)); await flushPromises()
    await card().find('.eco-card__fight').trigger('click')
    world.ecoBattleMessage(WORLD_MESSAGE.ECO_ENGAGE_RESULT, { requestId: 1, encounterId: ID('soto', 0), ok: true, battle })
    world.ecoBattleMessage(WORLD_MESSAGE.ECO_BATTLE_END, { battleId: battle.battleId, encounterId: ID('soto', 0), outcome, retired: outcome === 'victory', snapshot: snapshot(0) })
    await flushPromises()
    expect(screen().find('.eco-battle__result').text()).toBe(title)
    expect(screen().text()).toContain(detail)
    expect(screen().text()).not.toMatch(/capturad|atrapad|obtuviste|ganaste \d|recompensa obtenida|\+\d+ ?(xp|tokens)/i)
    expect(screen().findAll('button').map(b => b.text())).toEqual(['Volver al mapa'])
    // a click carried over from «Huir» or a move cannot dismiss a result nobody has seen yet
    expect(screen().find('.eco-battle__primary').attributes('disabled')).toBeDefined()
    await new Promise(resolve => setTimeout(resolve, 750))
    expect(screen().find('.eco-battle__primary').attributes('disabled')).toBeUndefined()
    await screen().find('.eco-battle__primary').trigger('click')
    expect(screen().exists()).toBe(false)
    expect(wrapper.emitted('battle')?.slice(-1)[0]).toEqual([false])
    wrapper.unmount()
  })

  it('reconnection: paused banner, controls disabled, then the same battle again', async () => {
    const { world, layer, card, screen, wrapper } = setup()
    layer.select(ID('soto', 0)); await flushPromises()
    await card().find('.eco-card__fight').trigger('click')
    world.ecoBattleMessage(WORLD_MESSAGE.ECO_ENGAGE_RESULT, { requestId: 1, encounterId: ID('soto', 0), ok: true, battle })
    await flushPromises()
    world.detach(); await flushPromises()
    expect(screen().text()).toContain('Reconectando… el combate está en pausa.')
    expect(screen().findAll('.eco-battle__moves button').every(b => b.attributes('disabled') !== undefined)).toBe(true)
    world.attach(() => {})
    world.snapshot({ now: 3, areaId: 'pradera', chunks: [], nodes: [], eco: area })
    world.ecoBattleMessage(WORLD_MESSAGE.ECO_ENGAGE_RESULT, { requestId: null, encounterId: ID('soto', 0), ok: true, resumed: true, battle })
    await flushPromises()
    expect(screen().text()).not.toContain('Reconectando')
    expect(screen().text()).toContain('Tiempo restante')
    wrapper.unmount()
  })

  it('a refusal is explained in words and returns to the map', async () => {
    const { world, layer, card, screen, wrapper } = setup()
    layer.select(ID('soto', 0)); await flushPromises()
    await card().find('.eco-card__fight').trigger('click')
    world.ecoBattleMessage(WORLD_MESSAGE.ECO_ENGAGE_RESULT, { requestId: 1, encounterId: ID('soto', 0), ok: false, reason: 'busy' })
    await flushPromises()
    expect(screen().text()).toContain('Otro entrenador lo está combatiendo.')
    await screen().find('.eco-battle__primary').trigger('click')
    expect(screen().exists()).toBe(false)
    wrapper.unmount()
  })
})

describe('ECO experiment layer · debug panel', () => {
  it('is collapsed by default, and its «Combatir» opens the same battle screen (one session)', async () => {
    const { sent, wrapper, screen } = setup()
    const panel = wrapper.find('.eco-dev')
    expect(panel.find('ol').exists()).toBe(false)
    await panel.find('.eco-dev__toggle').trigger('click')
    const rows = panel.findAll('li')
    // sorted by distance (ties by id): claro (busy, 2), soto:0 (2), soto:1 (3), lejos (9)
    expect(rows.map(r => r.findAll('button')[0].text())).toEqual(['Ocupado', 'Combatir', 'Combatir', 'Lejos'])
    await rows.find(r => r.text().includes('soto:1:0'))!.findAll('button')[0].trigger('click')
    expect(sent).toEqual([[WORLD_MESSAGE.ECO_ENGAGE, { requestId: 1, encounterId: ID('soto', 0) }]])
    expect(screen().exists()).toBe(true)
    wrapper.unmount()
  })
})

// ── Review of 0881332 (F1–F3): regressions ──

describe('ECO experiment layer · review F1–F3', () => {
  const engageResult = (world: SharedWorld, encounterId: string, requestId = 1) => world.ecoBattleMessage(WORLD_MESSAGE.ECO_ENGAGE_RESULT, { requestId, encounterId, ok: true, battle })
  const endBattle = (world: SharedWorld, encounterId: string) => world.ecoBattleMessage(WORLD_MESSAGE.ECO_BATTLE_END, { battleId: battle.battleId, encounterId, outcome: 'victory', retired: true, snapshot: snapshot(0, 2) })
  const settle = () => new Promise(resolve => setTimeout(resolve, 750))

  it('F1 a battle started from the debug panel clears the earlier map selection: back on the map, no old card returns', async () => {
    const { world, layer, card, screen, wrapper } = setup()
    layer.select(ID('soto', 0)); await flushPromises()
    expect(card().exists()).toBe(true)
    await wrapper.find('.eco-dev__toggle').trigger('click')
    await wrapper.findAll('.eco-dev li').find(r => r.text().includes('soto:1:1'))!.findAll('button')[0].trigger('click')
    engageResult(world, ID('soto', 1)); endBattle(world, ID('soto', 1)); await flushPromises()
    await settle()
    await screen().find('.eco-battle__primary').trigger('click')
    expect(screen().exists()).toBe(false)
    expect(card().exists()).toBe(false)
    // and by the card's own route too
    layer.select(ID('soto', 0)); await flushPromises()
    await card().find('.eco-card__fight').trigger('click')
    engageResult(world, ID('soto', 0), 2); endBattle(world, ID('soto', 0)); await flushPromises()
    await settle()
    await screen().find('.eco-battle__primary').trigger('click')
    expect(card().exists()).toBe(false)
    wrapper.unmount()
  })

  it('F2 Space on the focused «Combatir» belongs to the button, not to the map; with focus elsewhere the map keys still work', async () => {
    const { layer, card, wrapper } = setup()
    let interactions = 0
    const keys = new KeyboardInput({ cycleLens: () => {}, toggleGrid: () => {}, skipTime: () => {}, interact: () => { interactions++ } })
    keys.attach()
    try {
      layer.select(ID('soto', 0)); await flushPromises()
      const fight = card().find('.eco-card__fight').element as HTMLButtonElement
      fight.focus()
      for (const key of [' ', 'Enter']) {
        const down = new KeyboardEvent('keydown', { key, code: key === ' ' ? 'Space' : 'Enter', bubbles: true, cancelable: true })
        fight.dispatchEvent(down)
        expect(down.defaultPrevented, `${key} kept its native button activation`).toBe(false)
      }
      expect(interactions).toBe(0)
      // focus outside the card's controls: the map keyboard is untouched (walk, interact)
      fight.blur()
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown' }))
      expect(keys.direction).toBe('down')
      window.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowDown', code: 'ArrowDown' }))
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true, cancelable: true }))
      expect(interactions).toBe(1)
      expect(card().exists()).toBe(true)
    } finally {
      keys.detach()
      wrapper.unmount()
    }
  })

  it('F3 the battle dialog takes the focus, keeps Tab inside, blocks the debug panel, and gives the focus back on close', async () => {
    const canvas = document.createElement('canvas')
    canvas.tabIndex = 0
    document.body.append(canvas)
    try {
      const { world, layer, card, screen, wrapper } = setup()
      canvas.focus()
      layer.select(ID('soto', 0)); await flushPromises()
      ;(card().find('.eco-card__fight').element as HTMLButtonElement).click()
      engageResult(world, ID('soto', 0)); await flushPromises()
      const dialog = screen().element as HTMLElement
      expect(dialog.contains(document.activeElement), 'focus moved into the dialog').toBe(true)
      // the background is out of reach: inert debug panel, focus pulled back
      const toggle = wrapper.find('.eco-dev__toggle').element as HTMLButtonElement
      expect(wrapper.find('.eco-dev').attributes('inert')).toBeDefined()
      toggle.focus()
      expect(dialog.contains(document.activeElement)).toBe(true)
      // Tab and Shift+Tab cycle inside
      const buttons = [...dialog.querySelectorAll<HTMLButtonElement>('button:not([disabled])')]
      buttons[buttons.length - 1].focus()
      const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
      buttons[buttons.length - 1].dispatchEvent(tab)
      expect(tab.defaultPrevented).toBe(true)
      expect(document.activeElement).toBe(buttons[0])
      const back = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })
      buttons[0].dispatchEvent(back)
      expect(document.activeElement).toBe(buttons[buttons.length - 1])
      // the result replaces the focused control: the focus stays in the dialog
      endBattle(world, ID('soto', 0)); await flushPromises()
      expect(screen().element.contains(document.activeElement)).toBe(true)
      await settle()
      await screen().find('.eco-battle__primary').trigger('click')
      expect(screen().exists()).toBe(false)
      expect(document.activeElement, 'back to where it was').toBe(canvas)
      expect(wrapper.find('.eco-dev').attributes('inert')).toBeUndefined()
      // no listener left behind: focus goes anywhere again
      toggle.focus()
      expect(document.activeElement).toBe(toggle)
      wrapper.unmount()
    } finally {
      canvas.remove()
    }
  })
})
