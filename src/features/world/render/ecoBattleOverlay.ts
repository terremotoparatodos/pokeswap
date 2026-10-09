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
//   - everyone else in the area (ECO-BATTLE-SPECTATORS-1): each of the others' battles the same way
//     (the Pikachu beside its trainer, both bars, the same marks), from the server's public view,
//     with a short label when it ends; «en combate» stays only over a busy encounter whose battle
//     has not been told yet (decision D1, still the fallback).
// Every individual is drawn once: the wild one is the populace's actor (held on its tile while
// busy), the trainer is the presence avatar; this overlay adds only the Pikachu, bars and marks.
// It draws in world coordinates: the engine projects through the camera and skips what is off it.
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
import type { EcoPublicEventEnvelope } from '../../../../services/realtime/src/world/worldProtocol.js'
import { PLAYER_COMBATANT, WILD_COMBATANT, presentCombatant, spectatorSnapshot, stageOf, vfxOf, type PresentedCombatant, type Stage } from '../domain/ecoBattlePresentation'
import { ECO_SPECTATOR_OUTCOME_TEXT } from '../domain/ecoBattleText'
import type { SpectatedBattle } from '../state/ecoSpectatedBattles'

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

/** One battle drawn in the world: the owner's own (`OWN`) or someone else's (its battle id). */
interface Scene {
  readonly key: string
  readonly snapshot: ClientBattleSnapshot
  readonly receivedAt: number
  readonly connected: boolean
  readonly stage: Stage
  readonly wildTile: { readonly tx: number; readonly ty: number }
  readonly encounterId: string
  /** Someone else's battle that ended: its short label (shown while the store keeps it). */
  readonly endLabel: string | null
}

const OWN = 'own'

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
  /** Marks, each tagged with the scene it belongs to. */
  private effects: (WorldEffect & { scene: string })[] = []
  private texts: (WorldText & { scene: string })[] = []
  /** The stage is fixed when the battle starts: the trainer cannot walk during it (decision C). */
  private stage: Stage | null = null
  /** Others' battles in this area (ECO-BATTLE-SPECTATORS-1), keyed by battle id. */
  private spectated = new Map<string, Scene>()

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
      sprites: (area: Area, s: number): readonly OverlaySprite[] => (this.battle || this.busy.length || this.spectated.size ? world.sprites?.(area, s) ?? [] : []),
      labels: (area: Area, s: number): readonly OverlayLabel[] => [...(world.labels?.(area, s) ?? []), ...this.markers()],
    }
  }

  setCatalog(catalog: BattleCatalogIndex | null): void {
    this.catalog = catalog
  }

  /** The owner's battle (or null). A new battle fixes a new stage and drops old marks. */
  setBattle(battle: OverlayBattle | null): void {
    if (!battle) { this.battle = null; this.stage = null; this.dropMarks(OWN); return }
    if (this.battle?.encounterId !== battle.encounterId || !this.stage) {
      const player = this.input.player()
      this.stage = player ? stageOf({ player, wild: battle.wildTile }) : null
      this.dropMarks(OWN)
    }
    this.battle = battle
  }

  /**
   * ECO-BATTLE-SPECTATORS-1: the others' battles of this area as the spectator store keeps them.
   * Each stands where the server placed it (its trainer's and its wild one's tiles when reserved);
   * a battle no longer listed takes its marks with it.
   */
  setSpectated(battles: readonly SpectatedBattle[]): void {
    const next = new Map<string, Scene>()
    for (const b of battles) {
      const { owner, wild } = b.view.stage
      next.set(b.battleId, {
        key: b.battleId, snapshot: spectatorSnapshot(b.view, b.ended !== null), receivedAt: b.receivedAt, connected: b.view.connected,
        stage: stageOf({ player: owner, wild }), wildTile: wild, encounterId: b.encounterId,
        endLabel: b.ended ? ECO_SPECTATOR_OUTCOME_TEXT[b.ended.outcome] ?? null : null,
      })
    }
    for (const key of this.spectated.keys()) if (!next.has(key)) this.dropMarks(key)
    this.spectated = next
  }

  /** New events of someone else's battle: the same marks the owner sees, on that battle's Pokémon. */
  pushSpectatorEvents(battleId: string, events: readonly EcoPublicEventEnvelope[]): void {
    // vfxOf reads only `event` and, of each listed type, only fields the public view keeps.
    this.mark(battleId, events as unknown as readonly AuthorityEventEnvelope[])
  }

  /** This area's busy encounters, minus the owner's own battle. */
  setBusy(encounters: readonly EcoEncounter[]): void {
    const own = this.battle?.encounterId
    this.busy = encounters.filter(e => e.busy && e.id !== own)
  }

  /** The server's new events: marks on the two Pokémon, stamped now. */
  pushEvents(events: readonly AuthorityEventEnvelope[]): void {
    this.mark(OWN, events)
  }

  /** The two combatants as drawn now (also read by the panel). */
  combatants(): { player: PresentedCombatant | null; wild: PresentedCombatant | null } {
    const own = this.ownScene()
    return own ? this.present(own) : { player: null, wild: null }
  }

  private mark(key: string, events: readonly AuthorityEventEnvelope[]): void {
    const scene = key === OWN ? this.ownScene() : this.spectated.get(key) ?? null
    if (!scene) return
    const now = this.input.now() / 1000
    let rise = 0
    for (const mark of vfxOf(events, this.catalog, colourOfType)) {
      const to = positionIn(scene, mark.at)
      if (!to) continue
      if (mark.type === 'text') {
        this.texts.push({ scene: key, wx: to.x, wy: to.y, text: mark.text, colour: mark.colour, bornAt: now, life: mark.life, rise: rise++ * 7 })
        continue
      }
      const from = mark.type === 'effect' && mark.from ? positionIn(scene, mark.from) : null
      this.effects.push({ scene: key, kind: mark.kind, wx: (from ?? to).x, wy: (from ?? to).y, toX: to.x, toY: to.y, bornAt: now, life: mark.life, colour: mark.colour })
    }
  }

  private dropMarks(scene: string): void {
    this.effects = this.effects.filter(e => e.scene !== scene)
    this.texts = this.texts.filter(t => t.scene !== scene)
  }

  private ownScene(): Scene | null {
    if (!this.battle || !this.stage) return null
    const b = this.battle
    return { key: OWN, snapshot: b.snapshot, receivedAt: b.snapshotAt, connected: b.connected, stage: this.stage, wildTile: b.wildTile, encounterId: b.encounterId, endLabel: null }
  }

  /** Scenes drawn now: the owner's, then the others'. */
  private scenes(): Scene[] {
    const own = this.ownScene()
    return own ? [own, ...this.spectated.values()] : [...this.spectated.values()]
  }

  private present(scene: Scene): { player: PresentedCombatant | null; wild: PresentedCombatant | null } {
    const clock = { receivedAt: scene.receivedAt, now: this.input.now(), connected: scene.connected }
    return { player: presentCombatant(scene.snapshot, PLAYER_COMBATANT, clock), wild: presentCombatant(scene.snapshot, WILD_COMBATANT, clock) }
  }

  private bars(): WorldBar[] {
    const out: WorldBar[] = []
    for (const scene of this.scenes()) {
      const { player, wild } = this.present(scene)
      for (const c of [player, wild]) {
        if (!c) continue
        const at = positionIn(scene, c.combatantId)
        if (!at) continue
        out.push({ wx: at.x, wy: at.y, hp: c.hpFraction, action: c.hp > 0 ? c.actionFill : null, status: c.status ? MARK[c.status] ?? null : null, confused: c.confused, lift: 22 })
      }
    }
    return out
  }

  /** One Pikachu per battle, beside its trainer (the wild one is the populace's own actor). */
  private props(seconds: number) {
    const out = []
    for (const scene of this.scenes()) {
      const { player } = this.present(scene)
      if (!player || player.hp <= 0) continue
      const at = tileFeet(scene.stage.pikachu.tx, scene.stage.pikachu.ty)
      out.push({ wx: at.x, wy: at.y, sprite: speciesSprite(player.speciesId, scene.stage.pikachuFacing, seconds), depthBias: 1 })
    }
    return out
  }

  private markers(): OverlayLabel[] {
    const watched = new Set([...this.spectated.values()].map(scene => scene.encounterId))
    const out: OverlayLabel[] = this.busy.filter(e => !watched.has(e.id)).map(e => {
      const at = tileFeet(e.tx, e.ty)
      return { wx: at.x, wy: at.y, lift: 30, text: 'en combate', color: '#ffd27a' }
    })
    for (const scene of this.spectated.values()) {
      if (!scene.endLabel) continue
      const at = tileFeet(scene.wildTile.tx, scene.wildTile.ty)
      out.push({ wx: at.x, wy: at.y, lift: 30, text: scene.endLabel, color: '#ffd27a' })
    }
    return out
  }

  private prune<T extends { bornAt: number; life: number }>(list: T[], now: number): T[] {
    for (let i = list.length - 1; i >= 0; i--) if (now - list[i].bornAt > list[i].life) list.splice(i, 1)
    return list
  }
}

/** Where a combatant of a scene stands: the wild one on its tile, the Pikachu on its stage tile. */
function positionIn(scene: Scene, combatantId: string): { x: number; y: number } | null {
  if (combatantId === WILD_COMBATANT) return tileFeet(scene.wildTile.tx, scene.wildTile.ty)
  if (combatantId === PLAYER_COMBATANT) return tileFeet(scene.stage.pikachu.tx, scene.stage.pikachu.ty)
  return null
}
