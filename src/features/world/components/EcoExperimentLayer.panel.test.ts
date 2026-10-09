// ECO-BATTLE-PANEL-1: the compact battle panel, anchored beside its battle.
//   - beside the scene on screen, following the camera, never over the combatants or their bars;
//   - one side for the whole battle: server updates, Info or the trainer walking never flip it;
//   - four moves in a column, with name, selection and availability; «Info» opens and closes the
//     life and recharge details inside the same panel (no other dialog, never on its own).
// Presentation only: a move or «Huir» is still just a request to the server.

import { afterEach, describe, expect, it } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import type { EcoArea, EcoBattleInfo } from '../../../../services/realtime/src/world/worldProtocol.js'
import { WORLD_MESSAGE } from '../../../../services/realtime/src/world/worldProtocol.js'
import type { ClientBattleSnapshot } from '../../battle/authority'
import { DEFAULT_BATTLE_RULES_CONFIG } from '../../battle/rules/config'
import type { PokemonInfo } from '../../wildlands/engine/actors'
import { SharedWorld } from '../state/sharedWorld'
import { PANEL_GAP } from '../domain/ecoBattlePanelPlacement'
import EcoExperimentLayer from './EcoExperimentLayer.vue'

const ID = 'eco-n:pradera:soto:1:0'
const area: EcoArea = { protocol: 1, areaId: 'pradera', status: 'active', encounters: [{ id: ID, groupId: 'g', speciesId: 13, tx: 2, ty: 0, busy: false }] }
const MOVES = [84, 98, 104, 86] // Thunder Shock, Quick Attack, Double Team, Thunder Wave
const combatant = (id: string, speciesId: number, selected: number | null) => ({
  combatantId: id, sideId: id.split('-')[0], level: id === 'player-0' ? 12 : 8, wild: id === 'wild-0', stats: { hp: 30, atk: 20, def: 20, spa: 20, spd: 20, spe: 60 },
  condition: { currentHp: 22, pp: { 86: 0 }, majorStatus: 'none' },
  instance: { speciesId, moves: MOVES.map(moveId => ({ moveId, ppUps: 0 })) },
  runtime: { selected: selected === null ? null : { kind: 'move', moveId: selected }, actionElapsedMs: 600, cooldownMultiplier: 1, stages: {}, confusionRemainingMs: 0 },
})
const snapshot = (revision: number, selected: number | null = null) => ({
  battleId: 'b', revision, timeMs: 0, catalogVersion: 'c', battleRulesVersion: 'r', config: DEFAULT_BATTLE_RULES_CONFIG, outcome: { kind: 'ongoing' },
  combatants: { 'player-0': combatant('player-0', 25, selected), 'wild-0': combatant('wild-0', 13, null) },
}) as unknown as ClientBattleSnapshot
const battle: EcoBattleInfo = {
  battleId: 'b', speciesId: 13, fixture: true, fixtureLabel: 'fixture de prueba', expiresInMs: 120_000, snapshot: snapshot(1),
  joinAck: { battleId: 'b', controllerId: 'p', currentRevision: 1, nextActionSequence: 1, catalogVersion: 'c', battleRulesVersion: 'r', controlledCombatantIds: ['player-0'] },
  stage: { owner: { tx: 0, ty: 0 }, wild: { tx: 2, ty: 0 }, pokemon: { tx: 1, ty: 0 }, pokemonFacing: 'right', wildFacing: 'left' },
}

/** A camera at (camX, camY) on screen, 2 CSS px per world px: the scene box is left 8+camX … right 120+camX, top camY−68 … bottom camY+28. */
const camera = { x: 300, y: 300 }
const project = (wx: number, wy: number) => ({ x: wx * 2 + camera.x, y: wy * 2 + camera.y, scale: 2 })
const scene = () => ({ left: 8 + camera.x, right: 120 + camera.x, top: camera.y - 68, bottom: camera.y + 28 })
const frames = () => new Promise(resolve => setTimeout(resolve, 60)) // a few animation frames

let wrapper: VueWrapper | null = null
afterEach(() => { wrapper?.unmount(); wrapper = null; document.body.replaceChildren(); camera.x = 300; camera.y = 300 })

async function fighting(trainer = { tx: 0, ty: 0 }) {
  const canvas = document.createElement('canvas')
  Object.defineProperty(canvas, 'clientWidth', { value: 800 })
  Object.defineProperty(canvas, 'clientHeight', { value: 600 })
  document.body.append(canvas)
  const world = new SharedWorld(async () => null, id => ({ id, name: String(id), shiny: false, frames: {} }) as unknown as PokemonInfo)
  const sent: [string, unknown][] = []
  world.attach((type, payload) => sent.push([type, payload]))
  world.snapshot({ now: 1, areaId: 'pradera', chunks: [], nodes: [], eco: area })
  wrapper = mount(EcoExperimentLayer, { props: { world, areaId: 'pradera', ...trainer, project, mapFocus: () => canvas }, attachTo: document.body })
  ;(wrapper.vm as unknown as { select(id: string): boolean }).select(ID); await flushPromises()
  await wrapper.find('.eco-card__fight').trigger('click')
  world.ecoBattleMessage(WORLD_MESSAGE.ECO_ENGAGE_RESULT, { requestId: 1, encounterId: ID, ok: true, battle }); await flushPromises()
  await new Promise(resolve => setTimeout(resolve, 300)) // the battle catalog (move names) loads
  const panel = () => wrapper!.find('.ebp')
  Object.defineProperty(panel().element, 'offsetWidth', { value: 184 })
  Object.defineProperty(panel().element, 'offsetHeight', { value: 160 })
  await frames(); await flushPromises()
  const at = () => ({ x: parseFloat((panel().element as HTMLElement).style.left), y: parseFloat((panel().element as HTMLElement).style.top) })
  return { world, sent, panel, at }
}

describe('the compact battle panel (ECO-BATTLE-PANEL-1)', () => {
  it('stands beside its battle, clear of the combatants and their bars', async () => {
    const { at } = await fighting()
    expect(at()).toEqual({ x: scene().right + PANEL_GAP, y: scene().top })
  })

  it('anchored to the battle: it follows the camera and never flips on its own (updates, Info, the trainer walking)', async () => {
    const { world, panel, at } = await fighting()
    const first = at()
    // the camera follows the trainer: the panel moves with the scene, by the same amount
    camera.x -= 50; camera.y += 20
    await frames(); await flushPromises()
    expect(at()).toEqual({ x: first.x - 50, y: first.y + 20 })
    const placed = at()
    // the server's updates, Info opening and the trainer walking past the wild one change nothing
    world.ecoBattleMessage(WORLD_MESSAGE.ECO_BATTLE, { battleId: 'b', events: [], snapshot: snapshot(2, 84) }); await flushPromises()
    await panel().find('.ebp-info').trigger('click')
    await wrapper!.setProps({ tx: 5, ty: 2 }) // the old corner rule flipped sides here
    await frames(); await flushPromises()
    expect(at()).toEqual(placed)
  })

  it('starts on the side away from the trainer and stays there while the trainer walks around', async () => {
    const { at } = await fighting({ tx: 5, ty: 0 }) // the trainer right of the wild one
    expect(at()).toEqual({ x: scene().left - PANEL_GAP - 184, y: scene().top })
    await wrapper!.setProps({ tx: -3, ty: 1 }) // now on the left: the panel does not follow it over
    await frames(); await flushPromises()
    expect(at()).toEqual({ x: scene().left - PANEL_GAP - 184, y: scene().top })
  })

  it('at the edge of the screen it moves only as needed, below the scene instead of over it', async () => {
    const { at } = await fighting()
    camera.x = 600 // the scene near the right edge; the side stays the right one
    await frames(); await flushPromises()
    expect(at()).toEqual({ x: 800 - 184 - 8, y: scene().bottom + PANEL_GAP })
  })

  it('four moves in one column, each with its name, the one in use marked and the empty one unavailable', async () => {
    const { world, panel, sent } = await fighting()
    world.ecoBattleMessage(WORLD_MESSAGE.ECO_BATTLE, { battleId: 'b', events: [], snapshot: snapshot(2, 98) }); await flushPromises()
    const moves = panel().findAll('.ebp-moves .ebp-move')
    expect(moves.map(m => m.find('.ebp-move-name').text())).toEqual(['Thunder Shock', 'Quick Attack', 'Double Team', 'Thunder Wave'])
    expect(moves.map(m => m.attributes('aria-pressed'))).toEqual(['false', 'true', 'false', 'false'])
    expect(moves.map(m => m.attributes('disabled') !== undefined)).toEqual([false, false, false, true])
    expect(moves[3].text()).toContain('Sin PP')
    expect(moves[0].text()).toMatch(/PP \d+/)
    await moves[2].trigger('click')
    expect(sent[sent.length - 1]?.[0]).toBe(WORLD_MESSAGE.ECO_BATTLE_ACTION) // only a request
  })

  it('«Info» opens life, recharge and the rest inside the same panel, and closes it; never on its own', async () => {
    const { world, panel } = await fighting()
    const info = () => panel().find('.ebp-info')
    expect(panel().find('.ebp-details').exists()).toBe(false)
    world.ecoBattleMessage(WORLD_MESSAGE.ECO_BATTLE, { battleId: 'b', events: [], snapshot: snapshot(2) }); await flushPromises()
    expect(panel().find('.ebp-details').exists(), 'an update does not open it').toBe(false)
    await info().trigger('click')
    expect(info().attributes('aria-expanded')).toBe('true')
    const details = panel().find('#ebp-details')
    expect(details.text()).toContain('Nv. 12 · 22/30 PS')
    expect(details.text()).toContain('Nv. 8 · 22/30 PS')
    expect(details.findAll('[aria-label^="Recarga de"]')).toHaveLength(2)
    expect(details.text()).toContain('Tiempo restante')
    expect(document.querySelectorAll('.ebp')).toHaveLength(1)
    expect(document.querySelector('[role="dialog"]')).toBeNull() // no other modal
    await info().trigger('click')
    expect(info().attributes('aria-expanded')).toBe('false')
    expect(panel().find('.ebp-details').exists()).toBe(false)
  })
})
