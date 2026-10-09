// ECO-OVERWORLD-BATTLE-1: the battle drawn in the world. The Pikachu stands one tile from the
// trainer toward the wild one; both bars come from the snapshot; the server's events land on the
// right Pokémon; «en combate» marks only OTHER players' busy encounters; Dungeon's decor hook
// (torches) is not part of it; with no battle and nothing busy, nothing is drawn.

import { describe, expect, it, vi } from 'vitest'
import type { AuthorityEventEnvelope, ClientBattleSnapshot } from '../../battle/authority'
import { DEFAULT_BATTLE_RULES_CONFIG } from '../../battle/rules/config'
import type { EcoEncounter } from '../../../../services/realtime/src/world/worldProtocol.js'
import type { Area } from '../../wildlands/engine/area'
import type { EcoPublicBattle, EcoPublicEventEnvelope } from '../../../../services/realtime/src/world/worldProtocol.js'
import type { SpectatedBattle } from '../state/ecoSpectatedBattles'

vi.mock('../../dungeonPrototype/render/dungeonSprites', () => ({ speciesSprite: (id: number, dir: string) => ({ id, dir }) }))
// The engine's ball is drawn with a canvas (none in jsdom): a marker stands in for it.
vi.mock('../../wildlands/engine/pokeball', () => ({ pokeballInfo: () => ({ frames: { down: [{ ball: true }] } }) }))
vi.mock('../../dungeonPrototype/render/worldOverlay', async importOriginal => {
  const real = await importOriginal<typeof import('../../dungeonPrototype/render/worldOverlay')>()
  // The real overlay draws sprites for bars and effects through canvas helpers; here only its inputs matter.
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

const { EcoBattleOverlay, ENDING, tileFeet } = await import('./ecoBattleOverlay')

/**
 * A scene as the server sends it (ECO-BATTLE-SCENE-1: the server decides it; the overlay only draws
 * it). The fixture puts the Pikachu one tile from the trainer toward the wild one, facing it.
 */
function fixtureStage(owner: { tx: number; ty: number }, wild: { tx: number; ty: number }) {
  const dx = wild.tx - owner.tx, dy = wild.ty - owner.ty
  const across = Math.abs(dx) >= Math.abs(dy)
  const face = (x: number, y: number) => (Math.abs(x) >= Math.abs(y) ? (x >= 0 ? 'right' : 'left') : (y >= 0 ? 'down' : 'up')) as 'up' | 'down' | 'left' | 'right'
  const pokemon = Math.max(Math.abs(dx), Math.abs(dy)) > 1 ? { tx: owner.tx + (across ? Math.sign(dx) : 0), ty: owner.ty + (across ? 0 : Math.sign(dy)) } : { ...owner }
  return { owner, wild, pokemon, pokemonFacing: face(dx, dy), wildFacing: face(-dx, -dy) }
}

const combatant = (combatantId: string, speciesId: number, hp: number, max: number) => ({
  combatantId, sideId: combatantId.split('-')[0], level: 10, wild: combatantId === 'wild-0', stats: { hp: max, atk: 20, def: 20, spa: 20, spd: 20, spe: 60 },
  condition: { currentHp: hp, pp: {}, majorStatus: 'none' },
  instance: { speciesId, moves: [{ moveId: 84, ppUps: 0 }] },
  runtime: { actionElapsedMs: 1300, cooldownMultiplier: 1, stages: {}, confusionRemainingMs: 0, selected: null },
})
const snapshot = { battleId: 'b', revision: 1, timeMs: 0, config: DEFAULT_BATTLE_RULES_CONFIG, outcome: { kind: 'ongoing' }, combatants: { 'player-0': combatant('player-0', 25, 30, 34), 'wild-0': combatant('wild-0', 13, 10, 26) } } as unknown as ClientBattleSnapshot
const area = {} as Area
const busy = (id: string, tx: number, ty: number, isBusy = true): EcoEncounter => ({ id, groupId: id, speciesId: 13, tx, ty, busy: isBusy })

function overlay(now = 0) {
  const clock = { now }
  const o = new EcoBattleOverlay({ now: () => clock.now })
  return { o, clock }
}

describe('EcoBattleOverlay', () => {
  it('draws nothing with no battle and nothing busy; it has no decor hook', () => {
    const { o } = overlay()
    expect(o.overlay.decor).toBeUndefined()
    expect(o.overlay.sprites?.(area, 0)).toEqual([])
    expect(o.overlay.labels?.(area, 0)).toEqual([])
  })

  it('the Pikachu stands one tile toward the wild one; both bars carry the snapshot\'s HP', () => {
    const { o } = overlay()
    o.setBattle({ snapshot, snapshotAt: 0, connected: true, encounterId: 'e', stage: fixtureStage({ tx: 0, ty: 0 }, { tx: 4, ty: 0 }) })
    const sprites = o.overlay.sprites!(area, 0) as unknown as { wx: number; wy: number; sprite?: { id: number; dir: string }; bar?: { wx: number; hp: number; action: number } }[]
    const pikachu = sprites.find(s => s.sprite)!
    expect([pikachu.wx, pikachu.wy]).toEqual([tileFeet(1, 0).x, tileFeet(1, 0).y])
    expect(pikachu.sprite).toEqual({ id: 25, dir: 'right' })
    const bars = sprites.filter(s => s.bar).map(s => s.bar!)
    expect(bars.map(b => [b.wx, b.hp])).toEqual([[tileFeet(1, 0).x, 30 / 34], [tileFeet(4, 0).x, 10 / 26]])
    for (const b of bars) expect(b.action).toBeGreaterThan(0)
  })

  it('the server\'s events land on the right Pokémon, and fade', () => {
    const { o, clock } = overlay(1_000)
    o.setBattle({ snapshot, snapshotAt: 1_000, connected: true, encounterId: 'e', stage: fixtureStage({ tx: 0, ty: 0 }, { tx: 4, ty: 0 }) })
    const e = (event: Record<string, unknown>) => ({ battleId: 'b', sequence: 1, revision: 1, actionId: null, serverTimeMs: 0, event }) as unknown as AuthorityEventEnvelope
    o.pushEvents([e({ type: 'MOVE_USED', combatantId: 'player-0', moveId: 84, targetId: 'wild-0', hits: 1 }), e({ type: 'DAMAGE', combatantId: 'wild-0', sourceId: 'player-0', amount: 7, remainingHp: 3, critical: false, effectiveness: 1, hit: 1, cause: 'move' })])
    const effects = (o.overlay.sprites!(area, 0) as unknown as { effect?: { toX: number } }[]).filter(s => s.effect)
    expect(effects.map(s => s.effect!.toX)).toEqual([tileFeet(4, 0).x])
    expect(o.overlay.labels!(area, 0).map(l => [l.text, l.wx])).toEqual([['-7', tileFeet(4, 0).x]])
    clock.now = 3_000 // past every mark's life
    expect((o.overlay.sprites!(area, 0) as unknown as { effect?: unknown }[]).filter(s => s.effect)).toEqual([])
    expect(o.overlay.labels!(area, 0)).toEqual([])
  })

  it('«en combate» only over OTHER busy encounters (decision D1), on their server tile', () => {
    const { o } = overlay()
    o.setBattle({ snapshot, snapshotAt: 0, connected: true, encounterId: 'mine', stage: fixtureStage({ tx: 0, ty: 0 }, { tx: 4, ty: 0 }) })
    o.setBusy([busy('mine', 4, 0), busy('theirs', 9, 2), busy('free', 1, 1, false)])
    expect(o.overlay.labels!(area, 0)).toEqual([{ wx: tileFeet(9, 2).x, wy: tileFeet(9, 2).y, lift: 30, text: 'en combate', color: '#ffd27a' }])
    // a spectator with no battle of its own still sees the mark
    const spectator = overlay().o
    spectator.setBusy([busy('theirs', 9, 2)])
    expect(spectator.overlay.labels!(area, 0).map(l => l.text)).toEqual(['en combate'])
    expect(spectator.overlay.sprites!(area, 0)).toEqual([])
  })

  it('a new battle fixes a new stage and drops the old marks; null clears everything', () => {
    const { o } = overlay()
    o.setBattle({ snapshot, snapshotAt: 0, connected: true, encounterId: 'a', stage: fixtureStage({ tx: 0, ty: 0 }, { tx: 4, ty: 0 }) })
    o.pushEvents([{ battleId: 'b', sequence: 1, revision: 1, actionId: null, serverTimeMs: 0, event: { type: 'FAINTED', combatantId: 'wild-0' } } as unknown as AuthorityEventEnvelope])
    o.setBattle({ snapshot, snapshotAt: 0, connected: true, encounterId: 'b', stage: fixtureStage({ tx: 0, ty: 0 }, { tx: 0, ty: -3 }) })
    expect(o.overlay.labels!(area, 0)).toEqual([])
    const pikachu = (o.overlay.sprites!(area, 0) as unknown as { wx: number; wy: number; sprite?: { dir: string } }[]).find(s => s.sprite)!
    expect([pikachu.wx, pikachu.wy, pikachu.sprite!.dir]).toEqual([tileFeet(0, -1).x, tileFeet(0, -1).y, 'up'])
    o.setBattle(null)
    expect(o.overlay.sprites!(area, 0)).toEqual([])
  })
})

// ── ECO-BATTLE-SPECTATORS-1: someone else's battles, from the public view ──

const publicCombatant = (speciesId: number, currentHp: number, maxHp: number) => ({ speciesId, level: 10, maxHp, currentHp, majorStatus: 'none', confused: false, spe: 60, speStage: 0, actionElapsedMs: 1300, cooldownMultiplier: 1 })
const watched = (battleId: string, encounterId: string, owner: { tx: number; ty: number }, wild: { tx: number; ty: number }, over: Partial<SpectatedBattle> = {}): SpectatedBattle => ({
  battleId, encounterId, areaId: 'pradera', receivedAt: 0, ended: null,
  view: {
    battleId, encounterId, areaId: 'pradera', seq: 1, revision: 1, timeMs: 0, connected: true, stage: fixtureStage(owner, wild),
    config: { actionBar: DEFAULT_BATTLE_RULES_CONFIG.actionBar, statStages: DEFAULT_BATTLE_RULES_CONFIG.statStages },
    combatants: { 'player-0': publicCombatant(25, 30, 34), 'wild-0': publicCombatant(13, 10, 26) },
  } as unknown as EcoPublicBattle,
  ...over,
})
type Drawn = { wx: number; wy: number; sprite?: { id: number; dir: string }; bar?: { wx: number; wy: number; hp: number; action: number | null }; effect?: { toX: number } }
const drawn = (o: InstanceType<typeof EcoBattleOverlay>) => o.overlay.sprites!(area, 0) as unknown as Drawn[]

describe('EcoBattleOverlay · spectators', () => {
  it('someone else’s battle: the Pikachu beside ITS trainer, both bars — and no second wild Pokémon (the populace draws it)', () => {
    const { o } = overlay()
    o.setSpectated([watched('b1', 'e1', { tx: 10, ty: 5 }, { tx: 13, ty: 5 })])
    const sprites = drawn(o)
    const pokemon = sprites.filter(s => s.sprite)
    expect(pokemon.map(s => [s.wx, s.wy, s.sprite!.id, s.sprite!.dir])).toEqual([[tileFeet(11, 5).x, tileFeet(11, 5).y, 25, 'right']])
    expect(sprites.filter(s => s.bar).map(s => [s.bar!.wx, s.bar!.hp])).toEqual([[tileFeet(11, 5).x, 30 / 34], [tileFeet(13, 5).x, 10 / 26]])
    // its encounter no longer carries «en combate»; another busy one without a told battle still does
    o.setBusy([busy('e1', 13, 5), busy('e9', 2, 2)])
    expect(o.overlay.labels!(area, 0).map(l => [l.text, l.wx])).toEqual([['en combate', tileFeet(2, 2).x]])
  })

  it('two battles at once, and the owner’s own: each drawn once, each with its own Pikachu and bars', () => {
    const { o } = overlay()
    o.setBattle({ snapshot, snapshotAt: 0, connected: true, encounterId: 'mine', stage: fixtureStage({ tx: 0, ty: 0 }, { tx: 4, ty: 0 }) })
    o.setSpectated([watched('b1', 'e1', { tx: 10, ty: 5 }, { tx: 13, ty: 5 }), watched('b2', 'e2', { tx: -6, ty: 3 }, { tx: -6, ty: 0 })])
    const sprites = drawn(o)
    expect(sprites.filter(s => s.sprite)).toHaveLength(3)
    expect(sprites.filter(s => s.bar)).toHaveLength(6)
    expect(sprites.filter(s => s.sprite).map(s => s.sprite!.dir)).toEqual(['right', 'right', 'up'])
  })

  it('the same marks as the owner, on that battle’s Pokémon; a battle that goes takes its marks; the end shows a short label', () => {
    const { o } = overlay(1_000)
    o.setSpectated([watched('b1', 'e1', { tx: 10, ty: 5 }, { tx: 13, ty: 5 }), watched('b2', 'e2', { tx: -6, ty: 3 }, { tx: -6, ty: 0 })])
    const ev = [{ sequence: 1, event: { type: 'MOVE_USED', combatantId: 'player-0', moveId: 84, targetId: 'wild-0', hits: 1 } }, { sequence: 2, event: { type: 'DAMAGE', combatantId: 'wild-0', sourceId: 'player-0', amount: 7, remainingHp: 3, critical: false, effectiveness: 1, hit: 1, cause: 'move' } }] as unknown as EcoPublicEventEnvelope[]
    o.pushSpectatorEvents('b1', ev)
    o.pushSpectatorEvents('unknown', ev)
    expect(drawn(o).filter(s => s.effect).map(s => s.effect!.toX)).toEqual([tileFeet(13, 5).x])
    expect(o.overlay.labels!(area, 0).map(l => [l.text, l.wx])).toEqual([['-7', tileFeet(13, 5).x]])
    // the owner's view of the same events gives the same marks
    const owner = overlay(1_000).o
    owner.setBattle({ snapshot, snapshotAt: 1_000, connected: true, encounterId: 'mine', stage: fixtureStage({ tx: 0, ty: 0 }, { tx: 13, ty: 5 }) })
    owner.pushEvents(ev.map(e => ({ battleId: 'x', revision: 1, actionId: null, serverTimeMs: 0, ...e })) as unknown as AuthorityEventEnvelope[])
    expect(owner.overlay.labels!(area, 0).map(l => l.text)).toEqual(['-7'])
    // b1 ends: its label over its wild one; then it goes with its marks
    o.setSpectated([watched('b1', 'e1', { tx: 10, ty: 5 }, { tx: 13, ty: 5 }, { ended: { outcome: 'victory', at: 1_000 } }), watched('b2', 'e2', { tx: -6, ty: 3 }, { tx: -6, ty: 0 })])
    expect(o.overlay.labels!(area, 0).map(l => l.text)).toEqual(['-7', 'Ganó'])
    o.setSpectated([watched('b2', 'e2', { tx: -6, ty: 3 }, { tx: -6, ty: 0 })])
    expect(o.overlay.labels!(area, 0)).toEqual([])
    expect(drawn(o).filter(s => s.effect)).toEqual([])
    o.setSpectated([])
    expect(o.overlay.sprites!(area, 0)).toEqual([])
  })

  it('bars follow the receive time like the owner’s; paused they stand still; ended they go (ECO-BATTLE-ENDING-1)', () => {
    const { o, clock } = overlay(0)
    const fill = () => drawn(o).filter(s => s.bar)[0].bar!.action!
    o.setSpectated([watched('b1', 'e1', { tx: 10, ty: 5 }, { tx: 13, ty: 5 })])
    const start = fill()
    clock.now = 500
    expect(fill()).toBeGreaterThan(start)
    o.setSpectated([watched('b1', 'e1', { tx: 10, ty: 5 }, { tx: 13, ty: 5 }, { view: { ...watched('b1', 'e1', { tx: 10, ty: 5 }, { tx: 13, ty: 5 }).view, connected: false } })])
    expect(fill()).toBe(start)
    o.setSpectated([watched('b1', 'e1', { tx: 10, ty: 5 }, { tx: 13, ty: 5 }, { ended: { outcome: 'fled', at: 0 } })])
    expect(drawn(o).filter(s => s.bar)).toHaveLength(0)
  })
})

// ── ECO-BATTLE-ENDING-1: the end is played out, briefly, and holds nothing ──

type Played = { wx: number; wy: number; sprite?: { id?: number; dir?: string; ball?: boolean }; alpha?: number; scale?: number; bar?: unknown }
const played = (o: InstanceType<typeof EcoBattleOverlay>) => o.overlay.sprites!(area, 0) as unknown as Played[]
const pikachus = (o: InstanceType<typeof EcoBattleOverlay>) => played(o).filter(s => s.sprite?.id === 25)
const balls = (o: InstanceType<typeof EcoBattleOverlay>) => played(o).filter(s => s.sprite?.ball)
const wilds = (o: InstanceType<typeof EcoBattleOverlay>) => played(o).filter(s => s.sprite?.id === 13)

describe('EcoBattleOverlay · the end played out (ECO-BATTLE-ENDING-1)', () => {
  it('the owner\u2019s end: no bars; the Pikachu shrinks and fades into its ball; the ball fades; then nothing', () => {
    const { o, clock } = overlay(1_000)
    o.setBattle({ snapshot, snapshotAt: 1_000, connected: true, encounterId: 'e', stage: fixtureStage({ tx: 0, ty: 0 }, { tx: 4, ty: 0 }) })
    o.setBusy([busy('e', 4, 0)])
    o.finish('e', false)
    expect(played(o).filter(s => s.bar)).toHaveLength(0)
    expect(pikachus(o)).toHaveLength(1)
    expect(balls(o)).toHaveLength(1)
    clock.now = 1_000 + ENDING.recall * 500
    const [half] = pikachus(o)
    expect(half.scale!).toBeLessThan(1)
    expect(half.alpha!).toBeLessThan(1)
    clock.now = 1_000 + ENDING.recall * 1000 + 50
    expect(pikachus(o)).toHaveLength(0)
    expect(balls(o)).toHaveLength(1)
    clock.now = 1_000 + ENDING.ball * 1000 + 50
    expect(played(o)).toEqual([])
  })

  it('fled, defeat or expiry: the wild one never fades, listed or not', () => {
    const { o, clock } = overlay(1_000)
    o.setBattle({ snapshot, snapshotAt: 1_000, connected: true, encounterId: 'e', stage: fixtureStage({ tx: 0, ty: 0 }, { tx: 4, ty: 0 }) })
    o.finish('e', false)
    o.setBusy([]) // even if it left the list (released and walked off), a non-victory draws no fade
    for (const t of [0, 300, 900]) { clock.now = 1_000 + t; expect(wilds(o)).toHaveLength(0) }
  })

  it('a victory the server confirmed: the wild one fades only once the population no longer lists it', () => {
    const { o, clock } = overlay(1_000)
    o.setBattle({ snapshot, snapshotAt: 1_000, connected: true, encounterId: 'e', stage: fixtureStage({ tx: 0, ty: 0 }, { tx: 4, ty: 0 }) })
    o.setBusy([busy('e', 4, 0)])
    o.finish('e', true)
    expect(wilds(o), 'still listed: the populace draws it, never twice').toHaveLength(0)
    clock.now = 1_200
    o.setBusy([]) // the server retired it
    const [ghost] = wilds(o)
    expect([ghost.wx, ghost.wy, ghost.alpha]).toEqual([tileFeet(4, 0).x, tileFeet(4, 0).y, 1])
    clock.now = 1_200 + ENDING.fade * 500
    expect(wilds(o)[0].alpha!).toBeCloseTo(0.5, 5)
    clock.now = 1_200 + ENDING.fade * 1000 + 10
    expect(wilds(o)).toHaveLength(0)
  })

  it('a new battle right after (even against the same individual) drops the old ending: one Pikachu, no ball', () => {
    const { o } = overlay(1_000)
    o.setBattle({ snapshot, snapshotAt: 1_000, connected: true, encounterId: 'e', stage: fixtureStage({ tx: 0, ty: 0 }, { tx: 4, ty: 0 }) })
    o.finish('e', false)
    expect(balls(o)).toHaveLength(1)
    o.setBattle({ snapshot, snapshotAt: 1_100, connected: true, encounterId: 'e', stage: fixtureStage({ tx: 0, ty: 0 }, { tx: 4, ty: 0 }) })
    expect(balls(o)).toHaveLength(0)
    expect(pikachus(o)).toHaveLength(1)
    expect(played(o).filter(s => s.bar)).toHaveLength(2)
  })

  it('finish is about the battle drawn: another encounter\u2019s end changes nothing; dropOwnEnding clears it at once', () => {
    const { o } = overlay(1_000)
    o.setBattle({ snapshot, snapshotAt: 1_000, connected: true, encounterId: 'e', stage: fixtureStage({ tx: 0, ty: 0 }, { tx: 4, ty: 0 }) })
    o.finish('other', true)
    expect(played(o).filter(s => s.bar)).toHaveLength(2)
    o.finish('e', true)
    o.dropOwnEnding()
    expect(played(o)).toEqual([])
  })

  it('spectators see the same: no bars once ended, the ball, the label; the wild one fades only on a victory it no longer lists', () => {
    const { o, clock } = overlay(1_000)
    o.setBusy([busy('e1', 13, 5), busy('e2', -6, 0)])
    o.setSpectated([
      watched('b1', 'e1', { tx: 10, ty: 5 }, { tx: 13, ty: 5 }, { ended: { outcome: 'victory', at: 1_000 } }),
      watched('b2', 'e2', { tx: -6, ty: 3 }, { tx: -6, ty: 0 }, { ended: { outcome: 'fled', at: 1_000 } }),
    ])
    expect(played(o).filter(s => s.bar)).toHaveLength(0)
    expect(balls(o)).toHaveLength(2)
    expect(o.overlay.labels!(area, 0).map(l => l.text).sort()).toEqual(['Ganó', 'Huyó'])
    expect(wilds(o)).toHaveLength(0)
    clock.now = 1_100
    o.setBusy([]) // both left the list: only the victory fades
    const ghosts = wilds(o)
    expect(ghosts.map(g => g.wx)).toEqual([tileFeet(13, 5).x])
  })
})
