// ECO-GAMEPLAY-2 (experimental): the dev panel offers «Combatir» only for a free encounter in range,
// shows «Ocupado»/«Lejos» otherwise, and the battle panel only shows and forwards what the server
// says: the fixture label, a flee request, and the end the server decided.

import { describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import type { EcoArea, EcoBattleInfo } from '../../../../services/realtime/src/world/worldProtocol.js'
import { WORLD_MESSAGE } from '../../../../services/realtime/src/world/worldProtocol.js'
import type { ClientBattleSnapshot } from '../../battle/authority'
import type { PokemonInfo } from '../../wildlands/engine/actors'
import { SharedWorld } from '../state/sharedWorld'
import EcoDevPanel from './EcoDevPanel.vue'

const ID = (n: number) => `eco-n:pradera:nest-${n}:1:0`
const area: EcoArea = {
  protocol: 1, areaId: 'pradera', status: 'active',
  encounters: [
    { id: ID(1), groupId: ID(1), speciesId: 19, tx: 2, ty: 0, busy: false },
    { id: ID(2), groupId: ID(2), speciesId: 16, tx: 0, ty: 3, busy: true },
    { id: ID(3), groupId: ID(3), speciesId: 10, tx: 7, ty: 0, busy: false },
  ],
}
const combatant = (combatantId: string, speciesId: number, hp: number) => ({
  combatantId, sideId: combatantId.split('-')[0], level: 10, wild: combatantId === 'wild-0', stats: { hp: 30 },
  condition: { currentHp: hp, pp: {}, majorStatus: 'none' },
  instance: { speciesId, moves: [{ moveId: 84, ppUps: 0 }] },
  runtime: { selected: null },
})
const snapshot = { battleId: 'eco-battle-a-0000000a', revision: 1, timeMs: 0, catalogVersion: 'c', battleRulesVersion: 'r', combatants: { 'player-0': combatant('player-0', 25, 30), 'wild-0': combatant('wild-0', 19, 20) }, outcome: { kind: 'ongoing' } } as unknown as ClientBattleSnapshot
const battle: EcoBattleInfo = {
  battleId: 'eco-battle-a-0000000a', speciesId: 19, fixture: true, fixtureLabel: 'fixture de prueba', expiresInMs: 120_000, snapshot,
  joinAck: { battleId: 'eco-battle-a-0000000a', controllerId: 'p', currentRevision: 1, nextActionSequence: 1, catalogVersion: 'c', battleRulesVersion: 'r', controlledCombatantIds: ['player-0'] },
}

function setup() {
  const world = new SharedWorld(async () => null, id => ({ id, name: String(id), shiny: false, frames: {} }) as unknown as PokemonInfo)
  const sent: [string, unknown][] = []
  world.attach((type, payload) => sent.push([type, payload]))
  world.snapshot({ now: 1, areaId: 'pradera', chunks: [], nodes: [], eco: area })
  const wrapper = mount(EcoDevPanel, { props: { world, areaId: 'pradera', tx: 0, ty: 0 } })
  return { world, sent, wrapper }
}

describe('EcoDevPanel · test battles', () => {
  it('«Combatir» only for a free encounter in range; «Ocupado» and «Lejos» are disabled', () => {
    const { wrapper } = setup()
    const rows = wrapper.findAll('li')
    const button = (i: number) => rows[i].findAll('button')[0]
    expect(rows.map(r => button(rows.indexOf(r)).text())).toEqual(['Combatir', 'Ocupado', 'Lejos'])
    expect(button(0).attributes('disabled')).toBeUndefined()
    expect(button(1).attributes('disabled')).toBeDefined()
    expect(button(2).attributes('disabled')).toBeDefined()
    expect(rows[1].text()).toContain('ocupado')
    expect(rows[1].findAll('button')[1].attributes('disabled')).toBeDefined() // no test retirement of a busy one
  })

  it('engages by id, shows the labelled fixture, asks to flee, and shows the end the server decided', async () => {
    const { world, sent, wrapper } = setup()
    await wrapper.findAll('li')[0].findAll('button')[0].trigger('click')
    expect(sent).toEqual([[WORLD_MESSAGE.ECO_ENGAGE, { requestId: 1, encounterId: ID(1) }]])
    world.ecoBattleMessage(WORLD_MESSAGE.ECO_ENGAGE_RESULT, { requestId: 1, encounterId: ID(1), ok: true, battle })
    await flushPromises()
    const panel = wrapper.find('.eco-battle')
    expect(panel.text()).toContain('fixture de prueba')
    expect(panel.text()).toContain('20 / 30 PS')
    for (const b of wrapper.findAll('li button')) if (b.text() === 'Combatir') expect(b.attributes('disabled')).toBeDefined() // one battle at a time
    await panel.find('.eco-battle__flee').trigger('click')
    expect(sent[sent.length - 1]).toEqual([WORLD_MESSAGE.ECO_FLEE, { battleId: 'eco-battle-a-0000000a' }])
    expect(wrapper.find('.eco-battle__flee').exists()).toBe(true) // nothing changes until the server answers
    world.ecoBattleMessage(WORLD_MESSAGE.ECO_BATTLE_END, { battleId: 'eco-battle-a-0000000a', encounterId: ID(1), outcome: 'fled', retired: false, snapshot })
    await flushPromises()
    expect(wrapper.find('.eco-battle__result').text()).toContain('Huiste')
    expect(wrapper.findAll('button').map(b => b.text()).filter(t => /captur|objeto|ball/i.test(t))).toEqual([]) // no capture or item button exists
    wrapper.unmount()
  })

  it('a refusal is shown in words', async () => {
    const { world, wrapper } = setup()
    await wrapper.findAll('li')[0].findAll('button')[0].trigger('click')
    world.ecoBattleMessage(WORLD_MESSAGE.ECO_ENGAGE_RESULT, { requestId: 1, encounterId: ID(1), ok: false, reason: 'busy' })
    await flushPromises()
    expect(wrapper.find('.eco-battle').text()).toContain('otro jugador lo está combatiendo')
  })
})
