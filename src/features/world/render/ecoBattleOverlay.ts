// ECO-OVERWORLD-BATTLE-1 (experimental, development builds only): the test battle drawn IN the
// world, on the tiles where it happens, through the engine's `SceneOverlay` port.
//
// Reuses the Dungeon prototype's world overlay as is (decision A): its HP and action bars, status
// chips, attack/impact/shield/heal marks and damage numbers — fed here from the server's snapshot
// and events through `ecoBattlePresentation` instead of Dungeon's own engine. Its `decor` hook is
// left out: it turns lit decor into dungeon torches, and the overworld has its own lights.
//
// Two audiences:
//   - the owner: the synthetic Pikachu beside the trainer, both bars, the marks;
//   - everyone (decision D1): «en combate» over any busy encounter that is not the owner's own
//     battle — from the public `busy` flag only. Spectators get nothing else (pending, explicitly).
//
// Positions are authoritative: the wild one stands on its server-listed tile while busy (see
// EcoActors), the Pikachu one tile from the trainer toward it.

import type { Area } from '../../wildlands/engine/area'
import type { OverlayLabel, OverlaySprite, SceneOverlay } from '../../wildlands/engine/sceneOverlay'
import { TILE } from '../../wildlands/engine/world'
import { speciesSprite } from '../../dungeonPrototype/render/dungeonSprites'
import { colourOfType, createWorldOverlay, type StatusMark, type WorldBar, type WorldEffect, type WorldText } from '../../dungeonPrototype/render/worldOverlay'
import type { BattleCatalogIndex } from '../../battle/catalog'
import type { AuthorityEventEnvelope, ClientBattleSnapshot } from '../../battle/authority'
import type { EcoEncounter } from '../../../../services/realtime/src/world/worldProtocol.js'
import { PLAYER_COMBATANT, WILD_COMBATANT, presentCombatant, stageOf, vfxOf, type PresentedCombatant, type Stage } from '../domain/ecoBattlePresentation'

/** Feet of a tile, in world pixels: where the engine stands an actor that rests on it. */
export const tileFeet = (tx: number, ty: number) => ({ x: tx * TILE + TILE / 2, y: ty * TILE + TILE - 2 })

const MARK: Partial<Record<string, StatusMark>> = { burn: 'burn', paralysis: 'paralysis', poison: 'poison', badlyPoisoned: 'poison', freeze: 'freeze', sleep: 'sleep' }

/** The owner's running battle, as the overlay needs it. */
export interface OverlayBattle {
  readonly snapshot: ClientBattleSnapshot
  /** Local ms (the session's clock) when the snapshot arrived. */
  readonly snapshotAt: number
  readonly connected: boolean
  readonly encounterId: string
  /** The encounter's server-listed tile. */
  readonly wildTile: { readonly tx: number; readonly ty: number }
}

export interface EcoBattleOverlayInput {
  /** The local trainer's tile, or null before it is placed. */
  player(): { readonly tx: number; readonly ty: number } | null
  /** Local ms, the session's clock (the same one `snapshotAt` uses). */
  now(): number
}

export class EcoBattleOverlay {
  readonly overlay: SceneOverlay
  private battle: OverlayBattle | null = null
  private catalog: BattleCatalogIndex | null = null
  /** Busy encounters of this area that are not the owner's own battle: «en combate». */
  private busy: readonly EcoEncounter[] = []
  private effects: WorldEffect[] = []
  private texts: WorldText[] = []
  /** The stage is fixed when the battle starts: the trainer cannot walk during it (decision C). */
  private stage: Stage | null = null

  constructor(private readonly input: EcoBattleOverlayInput) {
    const seconds = () => this.input.now() / 1000
    const world = createWorldOverlay({
      seconds,
      bars: () => this.bars(),
      effects: () => this.prune(this.effects, seconds()),
      texts: () => this.prune(this.texts, seconds()),
      props: () => this.props(seconds()),
      torch: () => { throw new Error('unused: no decor hook') },
    })
    this.overlay = {
      ground: world.ground,
      sprites: (area: Area, s: number): readonly OverlaySprite[] => (this.battle || this.busy.length ? world.sprites?.(area, s) ?? [] : []),
      labels: (area: Area, s: number): readonly OverlayLabel[] => [...(world.labels?.(area, s) ?? []), ...this.markers()],
    }
  }

  setCatalog(catalog: BattleCatalogIndex | null): void {
    this.catalog = catalog
  }

  /** The owner's battle (or null). A new battle fixes a new stage and drops old marks. */
  setBattle(battle: OverlayBattle | null): void {
    if (!battle) { this.battle = null; this.stage = null; this.effects = []; this.texts = []; return }
    if (this.battle?.encounterId !== battle.encounterId || !this.stage) {
      const player = this.input.player()
      this.stage = player ? stageOf({ player, wild: battle.wildTile }) : null
      this.effects = []
      this.texts = []
    }
    this.battle = battle
  }

  /** This area's busy encounters, minus the owner's own battle. */
  setBusy(encounters: readonly EcoEncounter[]): void {
    const own = this.battle?.encounterId
    this.busy = encounters.filter(e => e.busy && e.id !== own)
  }

  /** The server's new events: marks on the two Pokémon, stamped now. */
  pushEvents(events: readonly AuthorityEventEnvelope[]): void {
    const now = this.input.now() / 1000
    let rise = 0
    for (const mark of vfxOf(events, this.catalog, colourOfType)) {
      const to = this.positionOf(mark.at)
      if (!to) continue
      if (mark.type === 'text') {
        this.texts.push({ wx: to.x, wy: to.y, text: mark.text, colour: mark.colour, bornAt: now, life: mark.life, rise: rise++ * 7 })
        continue
      }
      const from = mark.type === 'effect' && mark.from ? this.positionOf(mark.from) : null
      this.effects.push({ kind: mark.kind, wx: (from ?? to).x, wy: (from ?? to).y, toX: to.x, toY: to.y, bornAt: now, life: mark.life, colour: mark.colour })
    }
  }

  /** The two combatants as drawn now (also read by the panel). */
  combatants(): { player: PresentedCombatant | null; wild: PresentedCombatant | null } {
    const b = this.battle
    if (!b) return { player: null, wild: null }
    const clock = { receivedAt: b.snapshotAt, now: this.input.now(), connected: b.connected }
    return { player: presentCombatant(b.snapshot, PLAYER_COMBATANT, clock), wild: presentCombatant(b.snapshot, WILD_COMBATANT, clock) }
  }

  private positionOf(combatantId: string): { x: number; y: number } | null {
    if (!this.battle || !this.stage) return null
    if (combatantId === WILD_COMBATANT) return tileFeet(this.battle.wildTile.tx, this.battle.wildTile.ty)
    if (combatantId === PLAYER_COMBATANT) return tileFeet(this.stage.pikachu.tx, this.stage.pikachu.ty)
    return null
  }

  private bars(): WorldBar[] {
    const { player, wild } = this.combatants()
    const out: WorldBar[] = []
    for (const c of [player, wild]) {
      if (!c) continue
      const at = this.positionOf(c.combatantId)
      if (!at) continue
      out.push({ wx: at.x, wy: at.y, hp: c.hpFraction, action: c.hp > 0 ? c.actionFill : null, status: c.status ? MARK[c.status] ?? null : null, confused: c.confused, lift: 22 })
    }
    return out
  }

  private props(seconds: number) {
    const { player } = this.combatants()
    if (!player || !this.stage || player.hp <= 0) return []
    const at = tileFeet(this.stage.pikachu.tx, this.stage.pikachu.ty)
    return [{ wx: at.x, wy: at.y, sprite: speciesSprite(player.speciesId, this.stage.pikachuFacing, seconds), depthBias: 1 }]
  }

  private markers(): OverlayLabel[] {
    return this.busy.map(e => {
      const at = tileFeet(e.tx, e.ty)
      return { wx: at.x, wy: at.y, lift: 30, text: 'en combate', color: '#ffd27a' }
    })
  }

  private prune<T extends { bornAt: number; life: number }>(list: T[], now: number): T[] {
    for (let i = list.length - 1; i >= 0; i--) if (now - list[i].bornAt > list[i].life) list.splice(i, 1)
    return list
  }
}
