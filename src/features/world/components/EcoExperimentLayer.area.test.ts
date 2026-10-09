// ECO-OVERWORLD-BATTLE-1 (review of a10099e, F1): the battle's scene belongs to the area it is fought
// in. Once the player is in another area nothing of it is drawn there — no Pikachu, no bars, no
// marks, not even from events that still arrive — while the panel may keep showing the result.
// Coming back does not bring an old scene back. In its own area an ended battle is still drawn.

import { describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import type { EcoArea, EcoBattleInfo } from '../../../../services/realtime/src/world/worldProtocol.js'
import { WORLD_MESSAGE } from '../../../../services/realtime/src/world/worldProtocol.js'
import type { ClientBattleSnapshot } from '../../battle/authority'
import { DEFAULT_BATTLE_RULES_CONFIG } from '../../battle/rules/config'
import type { PokemonInfo } from '../../wildlands/engine/actors'
import type { Area } from '../../wildlands/engine/area'
import type { SceneOverlay } from '../../wildlands/engine/sceneOverlay'
import { SharedWorld } from '../state/sharedWorld'

vi.mock('../../dungeonPrototype/render/dungeonSprites', () => ({ speciesSprite: (id: number) => ({ id }) }))
// The engine's ball is drawn with a canvas (none in jsdom): a marker stands in for it.
vi.mock('../../wildlands/engine/pokeball', () => ({ pokeballInfo: () => ({ frames: { down: [{ ball: true }] } }) }))
vi.mock('../../dungeonPrototype/render/worldOverlay', async importOriginal => {
  const real = await importOriginal<typeof import('../../dungeonPrototype/render/worldOverlay')>()
  // Only the overlay's inputs matter here: what it would draw (sprites, bars, effects, texts).
  return {
    ...real,
    createWorldOverlay: (source: Parameters<typeof real.createWorldOverlay>[0]) => ({
      decor: () => null,
      ground: () => {},
      sprites: () => [...source.props(), ...source.bars().map(bar => ({ bar })), ...source.effects().map(effect => ({ effect }))] as never,
      labels: () => source.texts().map(t => ({ wx: t.wx, wy: t.wy, lift: 26, text: t.text, color: t.colour })),
    }),
  }
})

const { default: EcoExperimentLayer } = await import('./EcoExperimentLayer.vue')
const { ENDING } = await import('../render/ecoBattleOverlay')

const ID = 'eco-n:pradera:soto:1:0'
const pradera: EcoArea = { protocol: 1, areaId: 'pradera', status: 'active', encounters: [{ id: ID, groupId: 'g', speciesId: 13, tx: 3, ty: 0, busy: false }] } // within the 3-tile start limit
const cave: EcoArea = { protocol: 1, areaId: 'cueva-inicial', status: 'active', encounters: [] }
const snapshot = (revision = 1, timeMs = 0) => ({
  battleId: 'b', revision, timeMs, catalogVersion: 'c', battleRulesVersion: 'r', config: DEFAULT_BATTLE_RULES_CONFIG, outcome: { kind: 'ongoing' },
  combatants: Object.fromEntries([['player-0', 25], ['wild-0', 13]].map(([key, speciesId]) => [key, {
    combatantId: key, sideId: String(key).split('-')[0], level: 12, wild: key === 'wild-0', stats: { hp: 30, atk: 20, def: 20, spa: 20, spd: 20, spe: 60 },
    condition: { currentHp: 20, pp: {}, majorStatus: 'none' }, instance: { speciesId, moves: [{ moveId: 84, ppUps: 0 }] },
    runtime: { actionElapsedMs: 400, cooldownMultiplier: 1, stages: {}, confusionRemainingMs: 0, selected: null },
  }])),
}) as unknown as ClientBattleSnapshot
const battle: EcoBattleInfo = {
  battleId: 'b', speciesId: 13, fixture: true, fixtureLabel: 'fixture de prueba', expiresInMs: 120_000, snapshot: snapshot(),
  joinAck: { battleId: 'b', controllerId: 'p', currentRevision: 1, nextActionSequence: 1, catalogVersion: 'c', battleRulesVersion: 'r', controlledCombatantIds: ['player-0'] },
}
const CAVE_ID = 'eco-n:cueva-inicial:gruta:1:0'
const caveWithOne: EcoArea = { protocol: 1, areaId: 'cueva-inicial', status: 'active', encounters: [{ id: CAVE_ID, groupId: 'g2', speciesId: 41, tx: 21, ty: 20, busy: false }] }
const caveBattle = (): EcoBattleInfo => ({
  ...battle, battleId: 'b2', speciesId: 41, snapshot: { ...snapshot(), battleId: 'b2' } as ClientBattleSnapshot,
  joinAck: { ...battle.joinAck, battleId: 'b2' },
})
const damage = (sequence: number) => ({ battleId: 'b', sequence, revision: 2, actionId: null, serverTimeMs: 0, event: { type: 'DAMAGE', combatantId: 'wild-0', sourceId: 'player-0', amount: 3, remainingHp: 17, critical: false, effectiveness: 1, hit: 1, cause: 'move' } })
const area = {} as Area

async function fighting() {
  const world = new SharedWorld(async () => null, id => ({ id, name: String(id), shiny: false, frames: {} }) as unknown as PokemonInfo)
  world.attach(() => {})
  world.snapshot({ now: 1, areaId: 'pradera', chunks: [], nodes: [], eco: pradera })
  const wrapper = mount(EcoExperimentLayer, { props: { world, areaId: 'pradera', tx: 0, ty: 0 }, attachTo: document.body })
  ;(wrapper.vm as unknown as { select(id: string): boolean }).select(ID); await flushPromises()
  await wrapper.find('.eco-card__fight').trigger('click')
  world.ecoBattleMessage(WORLD_MESSAGE.ECO_ENGAGE_RESULT, { requestId: 1, encounterId: ID, ok: true, battle }); await flushPromises()
  const overlay = wrapper.emitted('overlay')![0][0] as SceneOverlay
  // The mocked overlay hands back its inputs: props, `{ bar }` and `{ effect }` entries.
  const drawn = () => ({ sprites: (overlay.sprites?.(area, 0) ?? []) as unknown as readonly { bar?: unknown; effect?: unknown }[], labels: overlay.labels?.(area, 0) ?? [] })
  const toArea = async (next: EcoArea, tx: number, ty: number) => {
    world.snapshot({ now: 2, areaId: next.areaId, chunks: [], nodes: [], eco: next })
    await wrapper.setProps({ areaId: next.areaId, tx, ty }); await flushPromises()
  }
  return { world, wrapper, drawn, toArea }
}

describe('ECO overworld battle · the scene stays in its area (F1)', () => {
  it('after leaving: no Pikachu, bars, marks or ending in the new area — even from late events — while the notice may stay; coming back brings nothing back', async () => {
    const { world, wrapper, drawn, toArea } = await fighting()
    try {
      expect(drawn().sprites.filter(s => s.bar)).toHaveLength(2)
      world.ecoBattleMessage(WORLD_MESSAGE.ECO_BATTLE_END, { battleId: 'b', encounterId: ID, outcome: 'left-area', retired: false, snapshot: snapshot(3, 500) })
      await toArea(cave, 20, 20)
      expect(drawn()).toEqual({ sprites: [], labels: [] })
      expect(wrapper.find('.ebt').exists(), 'the result notice may stay on screen').toBe(true)
      await toArea(pradera, 0, 0)
      expect(drawn(), 'back in the battle\'s area: the old scene does not return').toEqual({ sprites: [], labels: [] })
    } finally { wrapper.unmount() }
  })

  it('leaving while the battle still runs drops it at once; late events draw nothing anywhere', async () => {
    const { world, wrapper, drawn, toArea } = await fighting()
    try {
      world.ecoBattleMessage(WORLD_MESSAGE.ECO_BATTLE, { battleId: 'b', events: [damage(1)], snapshot: snapshot(2, 100) }); await flushPromises()
      expect(drawn().labels.length + drawn().sprites.filter(s => s.effect).length).toBeGreaterThan(0)
      await toArea(cave, 20, 20)
      expect(drawn()).toEqual({ sprites: [], labels: [] })
      world.ecoBattleMessage(WORLD_MESSAGE.ECO_BATTLE, { battleId: 'b', events: [damage(2)], snapshot: snapshot(3, 200) }); await flushPromises()
      expect(drawn()).toEqual({ sprites: [], labels: [] })
    } finally { wrapper.unmount() }
  })

  it('in its own area the end is played out briefly (ECO-BATTLE-ENDING-1): no bars, the Pikachu goes back into its ball, then nothing remains', async () => {
    const { world, wrapper, drawn } = await fighting()
    try {
      world.ecoBattleMessage(WORLD_MESSAGE.ECO_BATTLE_END, { battleId: 'b', encounterId: ID, outcome: 'fled', retired: false, snapshot: snapshot(3, 500) }); await flushPromises()
      expect(drawn().sprites.filter(s => s.bar)).toHaveLength(0)
      const ending = drawn().sprites as unknown as readonly { sprite?: { id?: number; ball?: boolean }; alpha?: number }[]
      expect(ending.filter(s => s.sprite?.id === 25), 'the Pikachu, recalled').toHaveLength(1)
      expect(ending.filter(s => s.sprite?.ball), 'its ball').toHaveLength(1)
      await new Promise(resolve => setTimeout(resolve, (ENDING.ball + 0.1) * 1000))
      expect(drawn()).toEqual({ sprites: [], labels: [] })
    } finally { wrapper.unmount() }
  })

  describe('a NEW battle after leaving (closure review of e548dbd, C1): it sets its own scene and area', () => {
    const accept = (world: SharedWorld, requestId: number) => world.ecoBattleMessage(WORLD_MESSAGE.ECO_ENGAGE_RESULT, { requestId, encounterId: CAVE_ID, ok: true, battle: caveBattle() })
    const barsDrawn = (drawn: () => { sprites: readonly { bar?: unknown }[] }) => drawn().sprites.filter(s => s.bar).map(s => { const { wx, wy, hp } = s.bar as { wx: number; wy: number; hp: number }; return { wx, wy, hp } }) // the action fill moves with the clock

    it('from the debug panel right after the end (nothing to close any more): the new battle is drawn; the old one’s late messages change nothing', async () => {
      const { world, wrapper, drawn, toArea } = await fighting()
      try {
        world.ecoBattleMessage(WORLD_MESSAGE.ECO_BATTLE_END, { battleId: 'b', encounterId: ID, outcome: 'left-area', retired: false, snapshot: snapshot(3, 500) })
        await toArea(caveWithOne, 20, 20)
        expect(drawn()).toEqual({ sprites: [], labels: [] })
        expect(wrapper.find('.ebp').exists(), 'no result panel to close (ECO-BATTLE-ENDING-1)').toBe(false)
        await wrapper.find('.eco-dev__toggle').trigger('click')
        await wrapper.findAll('.eco-dev li').find(r => r.text().includes('gruta:1:0'))!.findAll('button')[0].trigger('click')
        accept(world, 2); await flushPromises()
        const bars = barsDrawn(drawn)
        expect(bars, 'the Pikachu’s and the wild one’s bars').toHaveLength(2)
        expect(bars).toContainEqual(expect.objectContaining({ wx: 21 * 16 + 8, wy: 20 * 16 + 14 }))
        // the old battle's late messages: ignored, nothing of it comes back, the new scene stays
        world.ecoBattleMessage(WORLD_MESSAGE.ECO_BATTLE, { battleId: 'b', events: [damage(9)], snapshot: snapshot(9, 900) })
        world.ecoBattleMessage(WORLD_MESSAGE.ECO_BATTLE_END, { battleId: 'b', encounterId: ID, outcome: 'fled', retired: false, snapshot: snapshot(9, 900) }); await flushPromises()
        expect(wrapper.find('.ebp-move').exists(), 'still in the new battle').toBe(true)
        expect(barsDrawn(drawn)).toEqual(bars)
        expect(drawn().labels).toEqual([])
      } finally { wrapper.unmount() }
    })

    it('after the end, from the debug panel or from the card: drawn as well', async () => {
      for (const route of ['debug', 'card'] as const) {
        const { world, wrapper, drawn, toArea } = await fighting()
        try {
          world.ecoBattleMessage(WORLD_MESSAGE.ECO_BATTLE_END, { battleId: 'b', encounterId: ID, outcome: 'left-area', retired: false, snapshot: snapshot(3, 500) })
          await toArea(caveWithOne, 20, 20)
          expect(wrapper.find('.ebp').exists()).toBe(false)
          if (route === 'debug') {
            await wrapper.find('.eco-dev__toggle').trigger('click')
            await wrapper.findAll('.eco-dev li').find(r => r.text().includes('gruta:1:0'))!.findAll('button')[0].trigger('click')
          } else {
            ;(wrapper.vm as unknown as { select(id: string): boolean }).select(CAVE_ID); await flushPromises()
            await wrapper.find('.eco-card__fight').trigger('click')
          }
          accept(world, 2); await flushPromises()
          expect(barsDrawn(drawn), route).toHaveLength(2)
        } finally { wrapper.unmount() }
      }
    })
  })

  // ── ECO-BATTLE-ENDING-1 ──

  describe('the end needs no acceptance and holds nothing (ECO-BATTLE-ENDING-1)', () => {
    type Played = { sprite?: { id?: number; ball?: boolean }; bar?: unknown; alpha?: number }

    it('fled, then the same individual again at once: the trainer was released on the end, the new battle shows one Pikachu and no leftover ball', async () => {
      const { world, wrapper, drawn } = await fighting()
      try {
        const lastLock = () => { const all = wrapper.emitted('battle')!; return all[all.length - 1][0] }
        expect(lastLock()).toBe(true)
        world.ecoBattleMessage(WORLD_MESSAGE.ECO_BATTLE_END, { battleId: 'b', encounterId: ID, outcome: 'fled', retired: false, snapshot: snapshot(3, 500) }); await flushPromises()
        expect(lastLock(), 'released on the end itself').toBe(false)
        expect(wrapper.find('.ebp').exists()).toBe(false)
        ;(wrapper.vm as unknown as { select(id: string): boolean }).select(ID); await flushPromises()
        await wrapper.find('.eco-card__fight').trigger('click')
        world.ecoBattleMessage(WORLD_MESSAGE.ECO_ENGAGE_RESULT, { requestId: 2, encounterId: ID, ok: true, battle: { ...battle, battleId: 'b2', snapshot: { ...snapshot(), battleId: 'b2' } as ClientBattleSnapshot } }); await flushPromises()
        const now = drawn().sprites as unknown as readonly Played[]
        expect(now.filter(x => x.sprite?.id === 25)).toHaveLength(1)
        expect(now.filter(x => x.sprite?.ball)).toHaveLength(0)
        expect(now.filter(x => x.bar)).toHaveLength(2)
      } finally { wrapper.unmount() }
    })

    it('a victory the server retired: the wild one fades once the population drops it; a flight leaves it to the populace', async () => {
      for (const [outcome, retired, fades] of [['victory', true, true], ['fled', false, false], ['defeat', false, false], ['expired', false, false]] as const) {
        const { world, wrapper, drawn } = await fighting()
        try {
          world.ecoBattleMessage(WORLD_MESSAGE.ECO_BATTLE_END, { battleId: 'b', encounterId: ID, outcome, retired, snapshot: snapshot(3, 500) }); await flushPromises()
          const wild = () => (drawn().sprites as unknown as readonly Played[]).filter(x => x.sprite?.id === 13)
          expect(wild(), `${outcome}: listed, drawn by the populace only`).toHaveLength(0)
          world.eco({ now: 3, eco: { ...pradera, encounters: retired ? [] : pradera.encounters } }); await flushPromises()
          expect(wild().length, outcome).toBe(fades ? 1 : 0)
        } finally { wrapper.unmount() }
      }
    })
  })
})
