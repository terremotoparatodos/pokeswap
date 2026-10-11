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
  it('owned presentation is explicit, pending stays focused, late ACK respects voluntary departure', async () => {
    const s = await setup(route)
    const own = (id: number | null, requestId: number | null = null) => ({ requestId, ok: true, mode: 'owned' as const,
      attributeSource: 'legacy-m1-derived' as const, speciesId: id, selectedSlotPokemonId: id, level: id ? 12 : null,
      options: [{ slotPokemonId: 25, speciesId: 25, level: 12, eligible: true }, { slotPokemonId: 19, speciesId: 19, level: 12, eligible: true },
        { slotPokemonId: 43, speciesId: 43, level: null, eligible: false, reason: 'missing-moves' }] })
    try {
      s.world.ecoBattleMessage(M.ECO_COMBATANT_STATE, own(25)); await flushPromises()
      expect(s.wrapper.find(route).text()).toContain('IVs, naturaleza y habilidad derivados')
      expect(s.element.getAttribute('aria-label')).toBe('Pokémon propio')
      expect(s.element.querySelector('option[value="43"]')?.hasAttribute('disabled')).toBe(true)
      s.element.value = '19'; s.element.dispatchEvent(new Event('change', { bubbles: true })); await flushPromises()
      expect(s.sent[s.sent.length - 1]?.[1]).toEqual({ requestId: 1, slotPokemonId: 19 })
      expect(document.activeElement).toBe(s.element)
      expect(s.element.disabled).toBe(false)
      const event = key('keydown', 'ArrowUp'); s.element.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(false); expect(s.keyboard.direction).toBeNull()
      const chat = document.createElement('input'); document.body.append(chat); chat.focus()
      s.world.ecoBattleMessage(M.ECO_COMBATANT_STATE, own(19, 1)); await flushPromises()
      expect(document.activeElement).toBe(chat)
      expect(s.element.value).toBe('19'); chat.remove()
    } finally { s.dispose() }
  })
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
      expect(s.element.disabled).toBe(false)
      expect(s.element.getAttribute('aria-disabled')).toBe('true')
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

  it('keeps one focus through successive pending choices and acknowledgements', async () => {
    const s = await setup(route) // Focus once. jsdom changes are explicit; native probe uses arrows.
    try {
      let confirmed = 25
      for (const [index, speciesId] of [19, 25, 19, 43, 19, 25].entries()) {
        expect(document.activeElement).toBe(s.element)
        const arrow = speciesId === 25 ? 'ArrowUp' : 'ArrowDown'
        const event = key('keydown', arrow)
        document.activeElement!.dispatchEvent(event)
        expect(event.defaultPrevented).toBe(false)
        await s.select.setValue(String(speciesId))
        expect(s.element.disabled).toBe(false) // Native disabled would blur in Chrome.
        expect(s.element.getAttribute('aria-disabled')).toBe('true')
        expect(s.element.value).toBe(String(confirmed))
        expect(document.activeElement).toBe(s.element)
        expect(
          s.wrapper
            .findAll('.eco-card__fight,.eco-dev__actions button:first-child')
            .every((button) => (button.element as HTMLButtonElement).disabled),
        ).toBe(true)
        // A further change while pending never sends another intent or activates the map.
        document.activeElement!.dispatchEvent(key('keydown', 'ArrowUp'))
        await s.select.setValue('10')
        expect(s.sent).toHaveLength(index + 1)
        expect(s.element.value).toBe(String(confirmed))
        expect(s.keyboard.direction).toBeNull()
        expect(s.interactions()).toBe(0)
        s.world.ecoBattleMessage(M.ECO_COMBATANT_STATE, state(speciesId, index + 1))
        await flushPromises()
        expect(document.activeElement).toBe(s.element)
        expect(s.element.value).toBe(String(speciesId))
        expect(s.element.getAttribute('aria-disabled')).toBeNull()
        confirmed = speciesId
      }
      expect(s.sent.map(([, payload]) => payload)).toEqual(
        [19, 25, 19, 43, 19, 25].map((speciesId, index) => ({ requestId: index + 1, speciesId })),
      )
    } finally {
      s.dispose()
    }
  })

  it.each(['input', 'canvas', 'button'])(
    'late acknowledgement never takes focus back from %s',
    async (tag) => {
      const s = await setup(route)
      const destination = document.createElement(tag)
      destination.tabIndex = 0
      document.body.append(destination)
      try {
        await s.select.setValue('19')
        destination.focus() // User deliberately leaves while the answer is pending.
        s.world.ecoBattleMessage(M.ECO_COMBATANT_STATE, state(19, 1))
        await flushPromises()
        expect(document.activeElement).toBe(destination)
        expect(s.element.value).toBe('19')
        const arrow = key('keydown', 'ArrowUp')
        destination.dispatchEvent(arrow)
        expect(s.keyboard.direction).toBe(tag === 'input' ? null : 'up')
        destination.dispatchEvent(key('keyup', 'ArrowUp'))
      } finally {
        destination.remove()
        s.dispose()
      }
    },
  )
})
