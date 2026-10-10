import { describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import type { EcoArea } from '../../../../services/realtime/src/world/worldProtocol.js'
import { WORLD_MESSAGE as M } from '../../../../services/realtime/src/world/worldProtocol.js'
import type { PokemonInfo } from '../../wildlands/engine/actors'
import { KeyboardInput } from '../../wildlands/engine/keyboard'
import { SharedWorld } from '../state/sharedWorld'
import EcoExperimentLayer from './EcoExperimentLayer.vue'

const ID = 'eco-test:pradera:keyboard:1:0'
const area: EcoArea = {
  protocol: 1,
  areaId: 'pradera',
  status: 'active',
  encounters: [{ id: ID, groupId: 'g', speciesId: 13, tx: 1, ty: 0 }],
}
const state = (speciesId = 25, requestId: number | null = null) => ({
  requestId,
  ok: true,
  speciesId,
  options: [25, 19, 43, 74, 41, 10].map((id) => ({ speciesId: id, level: 12 })),
})
const key = (type: 'keydown' | 'keyup', code: string) =>
  new KeyboardEvent(type, { key: code, code, bubbles: true, cancelable: true })

async function setup(route: string) {
  const world = new SharedWorld(
    async () => null,
    (id) => ({ id, name: String(id), shiny: false, frames: {} }) as unknown as PokemonInfo,
  )
  const sent: [string, unknown][] = []
  world.attach((type, payload) => sent.push([type, payload]))
  world.snapshot({ now: 1, areaId: 'pradera', nodes: [], chunks: [], eco: area })
  world.ecoBattleMessage(M.ECO_COMBATANT_STATE, state())
  const wrapper = mount(EcoExperimentLayer, {
    props: { world, areaId: 'pradera', tx: 0, ty: 0 },
    attachTo: document.body,
  })
  if (route === '.eco-card') (wrapper.vm as unknown as { select(id: string): void }).select(ID)
  else await wrapper.find('.eco-dev__toggle').trigger('click')
  await flushPromises()
  let interactions = 0
  const keyboard = new KeyboardInput({
    cycleLens() {},
    toggleGrid() {},
    skipTime() {},
    interact: () => {
      interactions++
    },
  })
  keyboard.attach()
  const select = wrapper.find(`${route} select`)
  const element = select.element as HTMLSelectElement
  element.focus()
  return {
    wrapper,
    world,
    sent,
    keyboard,
    select,
    element,
    interactions: () => interactions,
    dispose: () => {
      keyboard.detach()
      wrapper.unmount()
    },
  }
}

describe.each(['.eco-card', '.eco-dev'])('CM-R1 keyboard ownership in %s', (route) => {
  it.each(['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'])(
    '%s stays native and never reaches map movement',
    async (arrow) => {
      const s = await setup(route)
      try {
        const event = key('keydown', arrow)
        s.element.dispatchEvent(event)
        expect(event.defaultPrevented).toBe(false)
        expect(s.keyboard.direction).toBeNull()
        expect(s.interactions()).toBe(0)
        expect(s.sent).toEqual([])
        s.element.dispatchEvent(key('keyup', arrow))
        expect(s.keyboard.direction).toBeNull()
      } finally {
        s.dispose()
      }
    },
  )

  it('Enter keeps its default and an actual change waits for the server confirmation', async () => {
    const s = await setup(route)
    try {
      const enter = key('keydown', 'Enter')
      s.element.dispatchEvent(enter)
      expect(enter.defaultPrevented).toBe(false)
      expect(s.interactions()).toBe(0)
      await s.select.setValue('19') // jsdom has no native select navigation; Chrome probe covers it.
      expect(s.sent).toEqual([[M.ECO_COMBATANT_SELECT, { requestId: 1, speciesId: 19 }]])
      expect(s.element.disabled).toBe(true)
      expect(s.element.value).toBe('25')
      s.world.ecoBattleMessage(M.ECO_COMBATANT_STATE, state(19, 1))
      await flushPromises()
      expect(s.element.value).toBe('19')
      expect(s.element.disabled).toBe(false)
    } finally {
      s.dispose()
    }
  })

  it('map listener remains attached outside the selector and keyup can release a prior held key', async () => {
    const s = await setup(route)
    const map = document.createElement('canvas')
    map.tabIndex = 0
    document.body.append(map)
    try {
      map.focus()
      const down = key('keydown', 'ArrowDown')
      map.dispatchEvent(down)
      expect(down.defaultPrevented).toBe(true)
      expect(s.keyboard.direction).toBe('down')
      s.element.focus()
      s.element.dispatchEvent(key('keyup', 'ArrowDown'))
      expect(s.keyboard.direction).toBeNull()
      map.focus()
      map.dispatchEvent(
        new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true, cancelable: true }),
      )
      expect(s.interactions()).toBe(1)
    } finally {
      map.remove()
      s.dispose()
    }
  })
})
