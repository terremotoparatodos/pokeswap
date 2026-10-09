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
// Positions are authoritative (ECO-BATTLE-SCENE-1): the server decides the scene once, when the
// battle is reserved — the wild one frozen where it was seen (EcoActors stands it there, `stand`),
// the Pikachu in front of it, both facings — and the owner and every spectator draw exactly that,
// wherever the trainer walks afterwards.
//
// ECO-BATTLE-ENDING-1: an end the server decided is played out briefly in the world, for the owner
// and for spectators alike, and never holds anything: the Pikachu goes back into its Poké Ball
// (reusing the engine's own ball sprite), and the wild one fades ONLY on a victory and only once
// the server's population no longer lists it (fled, defeat, expiry: it stays, as the populace's
// actor). A new battle of the owner drops its previous ending at once.

import type { Area } from '../../wildlands/engine/area'
import type { OverlayLabel, OverlaySprite, SceneOverlay } from '../../wildlands/engine/sceneOverlay'
import { TILE } from '../../wildlands/engine/world'
import { pokeballInfo } from '../../wildlands/engine/pokeball'
import { speciesSprite } from '../../dungeonPrototype/render/dungeonSprites'
import { colourOfType, createWorldOverlay, type StatusMark, type WorldBar, type WorldEffect, type WorldText } from '../../dungeonPrototype/render/worldOverlay'
import type { BattleCatalogIndex } from '../../battle/catalog'
import type { AuthorityEventEnvelope, ClientBattleSnapshot } from '../../battle/authority'
import type { EcoBattleStage, EcoEncounter } from '../../../../services/realtime/src/world/worldProtocol.js'
import type { EcoPublicEventEnvelope } from '../../../../services/realtime/src/world/worldProtocol.js'
import { PLAYER_COMBATANT, WILD_COMBATANT, presentCombatant, spectatorSnapshot, stageFrom, vfxOf, type PresentedCombatant, type Stage } from '../domain/ecoBattlePresentation'
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
  /** ECO-BATTLE-SCENE-1: the scene the server decided (the wild one's frozen tile, the Pikachu's, facings). */
  readonly stage: EcoBattleStage
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
  /** An ended battle being played out (seconds of the overlay's clock), or null while it runs. */
  readonly ending: { readonly at: number; readonly victory: boolean } | null
}

const OWN = 'own'
const OWN_ENDING = 'own-ending'

/** The ending's timing, in seconds (presentation only; nothing waits for it). */
export const ENDING = Object.freeze({
  /** The Pikachu shrinks and fades into its ball. */
  recall: 0.35,
  /** The ball shows, then fades. */
  ball: 0.9,
  /** The wild one fades after a victory, from when the population stops listing it. */
  fade: 0.7,
  /** How long a victory waits for the population to drop the wild one before giving up the fade. */
  wait: 3,
})

/** The engine's own drawn Poké Ball (pokeball.ts), resting frame. */
const ballSprite = () => pokeballInfo({ id: 0, name_es: '' }).frames.down[0]

export interface EcoBattleOverlayInput {
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
  /** ECO-BATTLE-ENDING-1: the owner's last battle being played out after its end. */
  private ownEnding: Scene | null = null
  /** Encounter ids the server lists in this area now (a victory's fade waits until it is gone). */
  private listed = new Set<string>()
  /** When each ending's wild one was first seen unlisted (seconds). */
  private fadeFrom = new Map<string, number>()

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
      sprites: (area: Area, s: number): readonly OverlaySprite[] => (this.battle || this.ownEnding || this.busy.length || this.spectated.size ? world.sprites?.(area, s) ?? [] : []),
      labels: (area: Area, s: number): readonly OverlayLabel[] => [...(world.labels?.(area, s) ?? []), ...this.markers()],
    }
  }

  setCatalog(catalog: BattleCatalogIndex | null): void {
    this.catalog = catalog
  }

  /**
   * The owner's battle (or null). A new battle fixes a new stage and drops old marks — and the
   * previous battle's ending, so a quick new battle never shows two Pikachu.
   */
  setBattle(battle: OverlayBattle | null): void {
    if (!battle) { this.battle = null; this.stage = null; this.dropMarks(OWN); return }
    if (this.battle?.encounterId !== battle.encounterId || !this.stage) {
      this.stage = stageFrom(battle.stage)
      this.dropMarks(OWN)
      this.dropOwnEnding()
    }
    this.battle = battle
  }

  /**
   * ECO-BATTLE-ENDING-1: the server ended the owner's battle against `encounterId`. Its scene is
   * played out (Pikachu back to its ball; the wild one fades only if `victory`, as the server
   * confirmed it) and nothing waits for it. No-op unless that battle is the one drawn.
   */
  finish(encounterId: string, victory: boolean): void {
    const own = this.ownScene()
    if (!own || own.encounterId !== encounterId) return
    this.ownEnding = { ...own, key: OWN_ENDING, ending: { at: this.input.now() / 1000, victory } }
    this.battle = null
    this.stage = null
  }

  /** The owner's ending goes now (another area, or a new battle). */
  dropOwnEnding(): void {
    if (this.ownEnding) this.fadeFrom.delete(OWN_ENDING)
    this.ownEnding = null
  }

  /**
   * ECO-BATTLE-SPECTATORS-1: the others' battles of this area as the spectator store keeps them.
   * Each stands where the server placed it (its trainer's and its wild one's tiles when reserved);
   * a battle no longer listed takes its marks with it.
   */
  setSpectated(battles: readonly SpectatedBattle[]): void {
    const next = new Map<string, Scene>()
    for (const b of battles) {
      const stage = stageFrom(b.view.stage)
      if (!stage) continue // a scene the server did not give is not drawn (an older server)
      next.set(b.battleId, {
        key: b.battleId, snapshot: spectatorSnapshot(b.view, b.ended !== null), receivedAt: b.receivedAt, connected: b.view.connected,
        stage, wildTile: b.view.stage.wild, encounterId: b.encounterId,
        endLabel: b.ended ? ECO_SPECTATOR_OUTCOME_TEXT[b.ended.outcome] ?? null : null,
        ending: b.ended ? { at: b.ended.at / 1000, victory: b.ended.outcome === 'victory' } : null,
      })
    }
    for (const key of this.spectated.keys()) if (!next.has(key)) { this.dropMarks(key); this.fadeFrom.delete(key) }
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
    this.listed = new Set(encounters.map(e => e.id))
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
    return { key: OWN, snapshot: b.snapshot, receivedAt: b.snapshotAt, connected: b.connected, stage: this.stage, wildTile: b.stage.wild, encounterId: b.encounterId, endLabel: null, ending: null }
  }

  /** Running scenes drawn now: the owner's, then the others'. */
  private scenes(): Scene[] {
    const own = this.ownScene()
    const others = [...this.spectated.values()].filter(scene => !scene.ending)
    return own ? [own, ...others] : others
  }

  /** Ended scenes being played out: the owner's last one, then the others'. */
  private endings(): Scene[] {
    const others = [...this.spectated.values()].filter(scene => scene.ending)
    return this.ownEnding ? [this.ownEnding, ...others] : others
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
    const out: { wx: number; wy: number; sprite: ReturnType<typeof speciesSprite>; alpha?: number; scale?: number; lift?: number; depthBias: number }[] = []
    for (const scene of this.scenes()) {
      const { player } = this.present(scene)
      if (!player || player.hp <= 0) continue
      const at = tileFeet(scene.stage.pikachu.tx, scene.stage.pikachu.ty)
      out.push({ wx: at.x, wy: at.y, sprite: speciesSprite(player.speciesId, scene.stage.pikachuFacing, seconds), depthBias: 1 })
    }
    for (const scene of this.endings()) out.push(...this.ending(scene, seconds))
    return out
  }

  /**
   * One ended scene, played out: the Pikachu shrinks and fades into its ball, the ball fades, and —
   * after a victory, once the population no longer lists the wild one — a short fade of the wild one
   * where it stood (it is no longer drawn by the populace then, so it is never drawn twice).
   */
  private ending(scene: Scene, seconds: number) {
    const out: { wx: number; wy: number; sprite: ReturnType<typeof speciesSprite>; alpha?: number; scale?: number; lift?: number; depthBias: number }[] = []
    const t = seconds - (scene.ending?.at ?? seconds)
    const at = tileFeet(scene.stage.pikachu.tx, scene.stage.pikachu.ty)
    const pikachu = scene.snapshot.combatants[PLAYER_COMBATANT]
    if (pikachu && t < ENDING.recall) {
      const k = Math.max(0, t) / ENDING.recall
      out.push({ wx: at.x, wy: at.y, sprite: speciesSprite(pikachu.instance.speciesId, scene.stage.pikachuFacing, seconds), alpha: 1 - k, scale: 1 - 0.7 * k, depthBias: 1 })
    }
    if (t < ENDING.ball) out.push({ wx: at.x, wy: at.y, sprite: ballSprite(), alpha: Math.min(1, Math.max(0, t) / 0.12, (ENDING.ball - t) / 0.3), depthBias: 1 })
    const wild = scene.snapshot.combatants[WILD_COMBATANT]
    if (scene.ending?.victory && wild && t < ENDING.wait + ENDING.fade && !this.listed.has(scene.encounterId)) {
      const from = this.fadeFrom.get(scene.key) ?? seconds
      this.fadeFrom.set(scene.key, from)
      const k = (seconds - from) / ENDING.fade
      const spot = tileFeet(scene.wildTile.tx, scene.wildTile.ty)
      if (k < 1 && from - (scene.ending.at) < ENDING.wait) out.push({ wx: spot.x, wy: spot.y, sprite: speciesSprite(wild.instance.speciesId, scene.stage.wildFacing, seconds), alpha: 1 - k, depthBias: 0 })
    }
    if (scene === this.ownEnding && t > Math.max(ENDING.ball, scene.ending?.victory ? ENDING.wait + ENDING.fade : 0)) this.dropOwnEnding()
    return out
  }

  private markers(): OverlayLabel[] {
    // Drawn (running or ending) battles carry no «en combate»: the others' and the owner's ending one.
    const watched = new Set([...this.spectated.values(), ...(this.ownEnding ? [this.ownEnding] : [])].map(scene => scene.encounterId))
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
