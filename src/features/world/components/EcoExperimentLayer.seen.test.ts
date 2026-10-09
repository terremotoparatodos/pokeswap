// SC-R1 (review of 89785e0): the card and the debug panel measure the start range from where the
// individual is SEEN — its shared patrol pose at the shared world clock, the tile the server measures
// from (ecoBattles.js `wildPoseAt`) — not from its home tile, and follow it while it patrols. The
// 3-tile range and the server's validation are unchanged; a busy individual still cannot be fought.
//
// The individual, its home and the instant are the review's real fixture (range-fixture.json): a
// Pradera encounter whose pose at 1 007 100 ms is (16,-95), 3 tiles from its home (13,-93).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import type { EcoArea, EcoEncounter } from '../../../../services/realtime/src/world/worldProtocol.js'
import { ECO_ENGAGE_RANGE, WORLD_MESSAGE } from '../../../../services/realtime/src/world/worldProtocol.js'
import { wildPoseAt } from '../../../../services/realtime/src/world/ecoScene.js'
import type { PokemonInfo } from '../../wildlands/engine/actors'
import { SharedWorld } from '../state/sharedWorld'
import { tileDistance } from '../domain/ecoSeenTile'

vi.mock('../../dungeonPrototype/render/dungeonSprites', () => ({ speciesSprite: (id: number) => ({ id }) }))
vi.mock('../../wildlands/engine/pokeball', () => ({ pokeballInfo: () => ({ frames: { down: [{ ball: true }] } }) }))

const { default: EcoExperimentLayer } = await import('./EcoExperimentLayer.vue')

const NOW = 1_007_100
const HOME = { tx: 13, ty: -93 }
const POSE = { tx: 16, ty: -95 }
const free: EcoEncounter = { id: 'eco-lfls-a9868f50:pradera:pradera-pastizal-noreste:1:0', groupId: 'eco-lfls-a9868f50:pradera:pradera-pastizal-noreste:1', speciesId: 29, ...HOME, busy: false }
const areaWith = (encounter: EcoEncounter): EcoArea => ({ protocol: 1, areaId: 'pradera', status: 'active', encounters: [encounter] })
const poseAt = (now: number) => wildPoseAt({ id: free.id, areaId: 'pradera', ...HOME }, now)

describe('the start range from where the individual is seen (SC-R1)', () => {
  let wrapper: VueWrapper | null = null
  let sent: [string, unknown][] = []

  beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance'] }) })
  afterEach(() => { wrapper?.unmount(); wrapper = null; vi.useRealTimers() })

  async function layer(trainer: { tx: number; ty: number }, encounter: EcoEncounter = free) {
    sent = []
    const world = new SharedWorld(async () => null, id => ({ id, name: String(id), shiny: false, frames: {} }) as unknown as PokemonInfo)
    world.attach((type, payload) => { sent.push([type, payload]) })
    world.snapshot({ now: NOW, areaId: 'pradera', chunks: [], nodes: [], eco: areaWith(encounter) })
    wrapper = mount(EcoExperimentLayer, { props: { world, areaId: 'pradera', ...trainer }, attachTo: document.body })
    ;(wrapper.vm as unknown as { select(id: string): boolean }).select(encounter.id)
    await flushPromises()
    await wrapper.find('.eco-dev__toggle').trigger('click')
    const card = () => ({ text: wrapper!.find('.eco-card__state').text(), enabled: wrapper!.find('.eco-card__fight').attributes('disabled') === undefined })
    const debug = () => {
      const row = wrapper!.find('.eco-dev li')
      const button = row.find('button')
      return { where: row.find('.eco-dev__where').text(), text: button.text(), enabled: button.attributes('disabled') === undefined }
    }
    return { world, card, debug }
  }

  it('the fixture is the review’s: the seen pose is 3 tiles from home, stable around the instant', () => {
    expect(poseAt(NOW)).toEqual(POSE)
    expect(poseAt(NOW - 100)).toEqual(POSE)
    expect(poseAt(NOW + 100)).toEqual(POSE)
  })

  it('3 tiles from the pose and 5 from home: both the card and the debug panel let you ask for the battle', async () => {
    const { card, debug } = await layer({ tx: 13, ty: -98 })
    expect(tileDistance(POSE, { tx: 13, ty: -98 })).toBe(3)
    expect(tileDistance(HOME, { tx: 13, ty: -98 })).toBe(5)
    expect(card()).toEqual({ text: 'Libre: podés combatirlo.', enabled: true })
    expect(debug()).toMatchObject({ where: '(16, -95) · 3 t', text: 'Combatir', enabled: true })
    await wrapper!.find('.eco-card__fight').trigger('click')
    expect(sent.filter(([type]) => type === WORLD_MESSAGE.ECO_ENGAGE)).toHaveLength(1) // the server still decides
  })

  it('close to home but out of the pose’s range: «Lejos» in both, with the distance to the pose', async () => {
    const { card, debug } = await layer({ tx: 10, ty: -96 })
    expect(tileDistance(HOME, { tx: 10, ty: -96 })).toBe(3)
    expect(card()).toEqual({ text: `Lejos: estás a 6 casillas. Acercate a ${ECO_ENGAGE_RANGE} o menos.`, enabled: false })
    expect(debug()).toMatchObject({ where: '(16, -95) · 6 t', text: 'Lejos', enabled: false })
  })

  it('the distance follows the patrol, and the card and the debug panel agree at every beat', async () => {
    const trainer = { tx: 13, ty: -98 }
    const { card, debug } = await layer(trainer)
    // Walk the clock in the panel's own beats until the patrol has taken the individual elsewhere.
    const seen = new Set<string>()
    for (let elapsed = 200; elapsed <= 60_000 && seen.size < 3; elapsed += 200) {
      await vi.advanceTimersByTimeAsync(200)
      const pose = poseAt(NOW + elapsed)
      const distance = tileDistance(pose, trainer)
      const inRange = distance <= ECO_ENGAGE_RANGE
      expect(debug(), `t+${elapsed}`).toMatchObject({ where: `(${pose.tx}, ${pose.ty}) · ${distance} t`, text: inRange ? 'Combatir' : 'Lejos', enabled: inRange })
      expect(card(), `t+${elapsed}`).toEqual(inRange
        ? { text: 'Libre: podés combatirlo.', enabled: true }
        : { text: `Lejos: estás a ${distance} casillas. Acercate a ${ECO_ENGAGE_RANGE} o menos.`, enabled: false })
      seen.add(`${pose.tx},${pose.ty}`)
    }
    expect(seen.size, 'the patrol moved it during the walk').toBeGreaterThanOrEqual(3)
  })

  it('a busy individual still cannot be fought, even within range of where it stands frozen', async () => {
    const busy: EcoEncounter = { ...free, busy: true, stand: { ...POSE, dir: 'up' } }
    const { card, debug } = await layer({ tx: 13, ty: -98 }, busy)
    expect(card()).toEqual({ text: 'Ocupado: otro entrenador lo está combatiendo.', enabled: false })
    expect(debug()).toMatchObject({ where: '(16, -95) · 3 t · ocupado', text: 'Ocupado', enabled: false })
    await vi.advanceTimersByTimeAsync(5_000) // frozen where the server put it, whatever the patrol says
    expect(debug()).toMatchObject({ where: '(16, -95) · 3 t · ocupado', enabled: false })
  })
})
