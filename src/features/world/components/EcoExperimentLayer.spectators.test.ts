// ECO-BATTLE-SPECTATORS-1: someone else's battle in this area, through the real layer and world.
// The spectator sees the Pikachu beside that trainer, both bars and the same marks, never a panel
// or a lock: it keeps walking. Arriving mid-battle shows the current state without past effects;
// leaving clears it and coming back shows only what the server sends again; the end shows briefly.
// The player's own battle is never drawn twice.

import { describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import type { EcoArea, EcoBattleInfo, EcoPublicBattle } from '../../../../services/realtime/src/world/worldProtocol.js'
import { WORLD_MESSAGE as M } from '../../../../services/realtime/src/world/worldProtocol.js'
import type { ClientBattleSnapshot } from '../../battle/authority'
import { DEFAULT_BATTLE_RULES_CONFIG } from '../../battle/rules/config'
import type { PokemonInfo } from '../../wildlands/engine/actors'
import type { Area } from '../../wildlands/engine/area'
import type { SceneOverlay } from '../../wildlands/engine/sceneOverlay'
import { ECO_SPECTATOR_END_MS } from '../state/ecoSpectatedBattles'
import { SharedWorld } from '../state/sharedWorld'

vi.mock('../../dungeonPrototype/render/dungeonSprites', () => ({ speciesSprite: (id: number) => ({ id }) }))
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

const THEIRS = 'eco-n:pradera:soto:1:0'
const MINE = 'eco-n:pradera:soto:1:1'
const pradera: EcoArea = {
  protocol: 1, areaId: 'pradera', status: 'active',
  encounters: [{ id: THEIRS, groupId: 'g', speciesId: 13, tx: 3, ty: 2, busy: true }, { id: MINE, groupId: 'g', speciesId: 16, tx: 2, ty: 0, busy: false }],
}
const cave: EcoArea = { protocol: 1, areaId: 'cueva-inicial', status: 'active', encounters: [] }
const combatant = (speciesId: number, currentHp: number) => ({ speciesId, level: 10, maxHp: 30, currentHp, majorStatus: 'none', confused: false, spe: 60, speStage: 0, actionElapsedMs: 400, cooldownMultiplier: 1 })
const theirs = (seq: number, over: Partial<EcoPublicBattle> = {}): EcoPublicBattle => ({
  battleId: 'b-theirs', encounterId: THEIRS, areaId: 'pradera', seq, revision: seq, timeMs: seq * 100, connected: true,
  stage: { owner: { tx: 1, ty: 2 }, wild: { tx: 3, ty: 2 } }, // in the 3-tile engage range of the spectator at (0,0)
  config: { actionBar: DEFAULT_BATTLE_RULES_CONFIG.actionBar, statStages: DEFAULT_BATTLE_RULES_CONFIG.statStages },
  combatants: { 'player-0': combatant(25, 30), 'wild-0': combatant(13, 20) },
  ...over,
})
const damage = (sequence: number) => ({ sequence, event: { type: 'DAMAGE' as const, combatantId: 'wild-0', sourceId: 'player-0', amount: 3, remainingHp: 17, critical: false, effectiveness: 1, hit: 1, cause: 'move' } })
const area = {} as Area

function setup() {
  const world = new SharedWorld(async () => null, id => ({ id, name: String(id), shiny: false, frames: {} }) as unknown as PokemonInfo)
  world.attach(() => {})
  world.snapshot({ now: 1, areaId: 'pradera', chunks: [], nodes: [], eco: pradera })
  const locks: boolean[] = []
  const wrapper = mount(EcoExperimentLayer, { props: { world, areaId: 'pradera', tx: 0, ty: 0, onBattle: (open: boolean) => locks.push(open) }, attachTo: document.body })
  const overlay = wrapper.emitted('overlay')![0][0] as SceneOverlay
  const drawn = () => (overlay.sprites?.(area, 0) ?? []) as unknown as readonly { sprite?: { id: number }; bar?: { wx: number }; effect?: unknown }[]
  const labels = () => (overlay.labels?.(area, 0) ?? []).map(l => l.text)
  const send = async (view: EcoPublicBattle) => { world.ecoBattleMessage(M.ECO_BATTLE_PUBLIC, JSON.parse(JSON.stringify(view))); await flushPromises() }
  const toArea = async (next: EcoArea) => {
    world.snapshot({ now: 2, areaId: next.areaId, chunks: [], nodes: [], eco: next })
    await wrapper.setProps({ areaId: next.areaId }); await flushPromises()
  }
  return { world, wrapper, drawn, labels, send, toArea, locks }
}

describe('ECO experiment layer · watching someone else’s battle', () => {
  it('arriving mid-battle: the Pikachu and both bars, no past effects, no panel, no lock; later events draw the same marks', async () => {
    const s = setup()
    try {
      await s.send(theirs(7))
      expect(s.drawn().filter(x => x.sprite).map(x => x.sprite!.id)).toEqual([25])
      expect(s.drawn().filter(x => x.bar)).toHaveLength(2)
      expect(s.drawn().filter(x => x.effect)).toEqual([])
      expect(s.labels(), 'no «en combate» over a battle that is drawn, no old damage numbers').toEqual([])
      expect(s.wrapper.find('.ebp').exists()).toBe(false)
      expect(s.locks, 'the spectator is never held').toEqual([false])
      await s.send(theirs(8, { events: [damage(31)] }))
      expect(s.labels()).toEqual(['-3'])
      // the same message again: nothing repeats
      await s.send(theirs(8, { events: [damage(31)] }))
      expect(s.labels()).toEqual(['-3'])
      // its individual stays someone else's: the card offers no fight
      ;(s.wrapper.vm as unknown as { select(id: string): boolean }).select(THEIRS); await flushPromises()
      expect((s.wrapper.find('.eco-card__fight').element as HTMLButtonElement).disabled).toBe(true)
    } finally { s.wrapper.unmount() }
  })

  it('leaving clears it; coming back shows nothing until the server sends what is still running', async () => {
    const s = setup()
    try {
      await s.send(theirs(3, { events: [damage(1)] }))
      await s.toArea(cave)
      expect(s.drawn()).toEqual([])
      expect(s.labels()).toEqual([])
      await s.send(theirs(4)) // Pradera's, arriving after the change
      expect(s.drawn()).toEqual([])
      await s.toArea(pradera)
      expect(s.drawn(), 'no cached scene').toEqual([])
      await s.send(theirs(9))
      expect(s.drawn().filter(x => x.bar)).toHaveLength(2)
    } finally { s.wrapper.unmount() }
  })

  it('the end shows a short label for 1.5 s, then the battle is gone; nothing reopens it', async () => {
    const s = setup()
    try {
      await s.send(theirs(2))
      await s.send(theirs(3, { ended: { outcome: 'fled' } }))
      expect(s.labels()).toContain('Huyó')
      await new Promise(resolve => setTimeout(resolve, ECO_SPECTATOR_END_MS + 100))
      expect(s.drawn()).toEqual([])
      await s.send(theirs(4))
      expect(s.drawn()).toEqual([])
    } finally { s.wrapper.unmount() }
  })

  it('the player’s own battle is drawn once (its own channel), while another one is watched beside it', async () => {
    const s = setup()
    try {
      ;(s.wrapper.vm as unknown as { select(id: string): boolean }).select(MINE); await flushPromises()
      await s.wrapper.find('.eco-card__fight').trigger('click')
      const snapshot = { battleId: 'b-mine', revision: 1, timeMs: 0, catalogVersion: 'c', battleRulesVersion: 'r', config: DEFAULT_BATTLE_RULES_CONFIG, outcome: { kind: 'ongoing' },
        combatants: Object.fromEntries([['player-0', 25], ['wild-0', 16]].map(([key, speciesId]) => [key, { combatantId: key, sideId: String(key).split('-')[0], level: 12, stats: { hp: 30, spe: 60 }, condition: { currentHp: 30, pp: {}, majorStatus: 'none' }, instance: { speciesId, moves: [] }, runtime: { actionElapsedMs: 0, cooldownMultiplier: 1, stages: {}, confusionRemainingMs: 0, selected: null } }])) } as unknown as ClientBattleSnapshot
      const battle: EcoBattleInfo = { battleId: 'b-mine', speciesId: 16, fixture: true, fixtureLabel: 'fixture de prueba', expiresInMs: 120_000, snapshot,
        joinAck: { battleId: 'b-mine', controllerId: 'p', currentRevision: 1, nextActionSequence: 1, catalogVersion: 'c', battleRulesVersion: 'r', controlledCombatantIds: ['player-0'] } }
      s.world.ecoBattleMessage(M.ECO_ENGAGE_RESULT, { requestId: 1, encounterId: MINE, ok: true, battle }); await flushPromises()
      await s.send(theirs(2))
      await s.send(theirs(1, { battleId: 'b-mine', encounterId: MINE, stage: { owner: { tx: 0, ty: 0 }, wild: { tx: 2, ty: 0 } } })) // never sent by the server; ignored if it were
      expect(s.drawn().filter(x => x.sprite)).toHaveLength(2)
      expect(s.drawn().filter(x => x.bar)).toHaveLength(4)
      expect(s.locks, 'only the own battle holds the player').toEqual([false, true])
    } finally { s.wrapper.unmount() }
  })

  // ── Review of 3decc3d: S1 and S2 ──

  it('S1 the area shown changes before the world snapshot: scenes and marks leave at once; late messages do not bring them back', async () => {
    const s = setup()
    try {
      await s.send(theirs(7, { events: [damage(1)] }))
      expect(s.drawn().filter(x => x.bar)).toHaveLength(2)
      expect(s.labels()).toEqual(['-3'])
      await s.wrapper.setProps({ areaId: 'cueva-inicial' }); await flushPromises() // the game entered; no snapshot yet
      expect(s.drawn()).toEqual([])
      expect(s.labels()).toEqual([])
      await s.send(theirs(8, { events: [damage(2)] }))
      expect(s.drawn()).toEqual([])
      expect(s.labels()).toEqual([])
      // back without a snapshot (a refused crossing): still nothing until the server re-sends
      await s.wrapper.setProps({ areaId: 'pradera' }); await flushPromises()
      await s.send(theirs(9, { events: [damage(3)] }))
      expect(s.drawn()).toEqual([])
      s.world.snapshot({ now: 3, areaId: 'pradera', chunks: [], nodes: [], eco: pradera }); await flushPromises()
      await s.send(theirs(9))
      expect(s.drawn().filter(x => x.bar)).toHaveLength(2)
      expect(s.labels()).toEqual([])
    } finally { s.wrapper.unmount() }
  })

  it('S2 the same individual fought again while the earlier end shows: one Pikachu and one pair of bars; another individual’s battle stays', async () => {
    const s = setup()
    try {
      const another = (seq: number) => theirs(seq, { battleId: 'b-another', encounterId: MINE, stage: { owner: { tx: 0, ty: 3 }, wild: { tx: 2, ty: 0 } } })
      await s.send(theirs(1))
      await s.send(another(1))
      await s.send(theirs(2, { ended: { outcome: 'fled' } }))
      expect(s.labels()).toContain('Huyó')
      await s.send(theirs(1, { battleId: 'b-theirs-again', stage: { owner: { tx: 2, ty: 2 }, wild: { tx: 3, ty: 2 } } }))
      const pikachus = s.drawn().filter(x => x.sprite)
      expect(pikachus).toHaveLength(2) // this individual's new battle + the other individual's
      expect(s.drawn().filter(x => x.bar)).toHaveLength(4)
      expect(s.labels()).not.toContain('Huyó')
      // nothing of the replaced battle comes back
      await s.send(theirs(5, { events: [damage(9)] }))
      expect(s.drawn().filter(x => x.sprite)).toHaveLength(2)
      expect(s.labels()).toEqual([])
    } finally { s.wrapper.unmount() }
  })

  // ── Closure review of 4cb773d: S1 residual (the snapshot and the fresh view may come before the visible change) ──

  describe('S1 residual: what the server already re-sent for the area now seen is drawn when the player sees it', () => {
    const caveBattle = (seq: number, over: Partial<EcoPublicBattle> = {}) => theirs(seq, { battleId: 'b-cave', encounterId: 'eco-n:cueva-inicial:x:1:0', areaId: 'cueva-inicial', ...over })
    const snapshotOf = (s: ReturnType<typeof setup>, next: EcoArea) => s.world.snapshot({ now: 5, areaId: next.areaId, chunks: [], nodes: [], eco: next })
    const see = async (s: ReturnType<typeof setup>, next: EcoArea) => { await s.wrapper.setProps({ areaId: next.areaId }); await flushPromises() }

    it('snapshot and a PAUSED battle’s fresh view first, the visible change after: its scene appears with no further message', async () => {
      const s = setup()
      try {
        await s.send(theirs(7, { events: [damage(1)] }))
        snapshotOf(s, cave)
        await s.send(caveBattle(30, { connected: false })) // owner away: this battle sends nothing more for now
        expect(s.drawn(), 'not seen yet: the player still sees Pradera').toEqual([])
        await see(s, cave)
        expect(s.drawn().filter(x => x.bar)).toHaveLength(2)
        expect(s.drawn().filter(x => x.sprite)).toHaveLength(1)
        expect(s.labels()).toEqual([])
      } finally { s.wrapper.unmount() }
    })

    it('a refused crossing: the snapshot of Pradera and its fresh view come before the visible rollback; it appears on the rollback', async () => {
      const s = setup()
      try {
        await s.send(theirs(7))
        await see(s, cave)
        snapshotOf(s, pradera)
        await s.send(theirs(30, { connected: false }))
        expect(s.drawn()).toEqual([])
        await see(s, pradera)
        expect(s.drawn().filter(x => x.bar)).toHaveLength(2)
      } finally { s.wrapper.unmount() }
    })

    it('control, the inverse order (visible change first, then snapshot and fresh view): drawn when the view arrives', async () => {
      const s = setup()
      try {
        await s.send(theirs(7))
        await see(s, cave)
        expect(s.drawn()).toEqual([])
        snapshotOf(s, cave)
        await s.send(caveBattle(30, { connected: false }))
        expect(s.drawn().filter(x => x.bar)).toHaveLength(2)
      } finally { s.wrapper.unmount() }
    })

    it('control, late messages of the area left: dropped at once, never back — before or after the new area’s battle appears', async () => {
      const s = setup()
      try {
        await s.send(theirs(7, { events: [damage(1)] }))
        await see(s, cave)
        await s.send(theirs(8, { events: [damage(2)] })) // Pradera's, before any snapshot
        expect(s.drawn()).toEqual([])
        expect(s.labels()).toEqual([])
        snapshotOf(s, cave)
        await s.send(caveBattle(30, { connected: false }))
        await s.send(theirs(9, { events: [damage(3)] })) // Pradera's again, after the cave snapshot
        expect(s.drawn().filter(x => x.bar)).toHaveLength(2) // only the cave battle
        expect(s.labels()).toEqual([])
      } finally { s.wrapper.unmount() }
    })
  })
})
