// ECO-OVERWORLD-BATTLE-1: the battle drawn in the world. The Pikachu stands one tile from the
// trainer toward the wild one; both bars come from the snapshot; the server's events land on the
// right Pokémon; «en combate» marks only OTHER players' busy encounters; Dungeon's decor hook
// (torches) is not part of it; with no battle and nothing busy, nothing is drawn.

import { describe, expect, it, vi } from 'vitest'
import type { AuthorityEventEnvelope, ClientBattleSnapshot } from '../../battle/authority'
import { DEFAULT_BATTLE_RULES_CONFIG } from '../../battle/rules/config'
import type { EcoEncounter } from '../../../../services/realtime/src/world/worldProtocol.js'
import type { Area } from '../../wildlands/engine/area'

vi.mock('../../dungeonPrototype/render/dungeonSprites', () => ({ speciesSprite: (id: number, dir: string) => ({ id, dir }) }))
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

const { EcoBattleOverlay, tileFeet } = await import('./ecoBattleOverlay')

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
  const o = new EcoBattleOverlay({ player: () => ({ tx: 0, ty: 0 }), now: () => clock.now })
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
    o.setBattle({ snapshot, snapshotAt: 0, connected: true, encounterId: 'e', wildTile: { tx: 4, ty: 0 } })
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
    o.setBattle({ snapshot, snapshotAt: 1_000, connected: true, encounterId: 'e', wildTile: { tx: 4, ty: 0 } })
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
    o.setBattle({ snapshot, snapshotAt: 0, connected: true, encounterId: 'mine', wildTile: { tx: 4, ty: 0 } })
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
    o.setBattle({ snapshot, snapshotAt: 0, connected: true, encounterId: 'a', wildTile: { tx: 4, ty: 0 } })
    o.pushEvents([{ battleId: 'b', sequence: 1, revision: 1, actionId: null, serverTimeMs: 0, event: { type: 'FAINTED', combatantId: 'wild-0' } } as unknown as AuthorityEventEnvelope])
    o.setBattle({ snapshot, snapshotAt: 0, connected: true, encounterId: 'b', wildTile: { tx: 0, ty: -3 } })
    expect(o.overlay.labels!(area, 0)).toEqual([])
    const pikachu = (o.overlay.sprites!(area, 0) as unknown as { wx: number; wy: number; sprite?: { dir: string } }[]).find(s => s.sprite)!
    expect([pikachu.wx, pikachu.wy, pikachu.sprite!.dir]).toEqual([tileFeet(0, -1).x, tileFeet(0, -1).y, 'up'])
    o.setBattle(null)
    expect(o.overlay.sprites!(area, 0)).toEqual([])
  })
})
