// Game loop — WildLands prototype
//
// Owns the frame loop, camera, actors and session-only state (clock, collected
// crystals). Keyboard input lives in keyboard.ts, area travel in travel.ts and
// building doors in doors.ts. Everything here is cosmetic client state:
// no tokens, ownership or rewards are read or written.

import {
  actorPosition, advance, createActor, createWalkerState, DIRS, driveWalker, isMoving, RUN_SPEED, wander, WALK_SPEED,
  type Actor, type MoveRules,
} from './actors'
import { isPortalTile, type Area, type AreaId, type Arrival, type Populace } from './area'
import { DAY_SECONDS, lighting, type DayPhase, type WeatherKind } from './atmosphere'
import { Atlas, LOBBY_ID } from '../areas/atlas'
import { loadNpcTrainerArt, loadTrainerSheet, type Dir } from './characters'
import { CompanionFollower } from './companion'
import { actorLine } from './dialogue'
import { Entrances } from './doors'
import { KeyboardInput } from './keyboard'
import { TapNavigator } from './navigator'
import type { Tile } from './pathfinding'
import type { PlazaResident } from './plazaPokemon'
import { plazaHitAt, plazaHitFacing, type PlazaHit } from './plazaTaps'
import { wildHitAt, wildHitFacing, type WildHit } from './wildTaps'
import { loadPokemonInfo, type PokedexEntry } from './population'
import { lerpLens, LENSES, type CameraLens, type LensName } from './projection'
import { Renderer, type Scene } from './renderer'
import type { SceneOverlay } from './sceneOverlay'
import { PlayerAppearance } from './playerAppearance'
import { PlacedObjects, retargetToPlaced } from './placedObjects'
import { AreaTravel } from './travel'
import { TILE } from './world'
import type { LobbyFeature } from '../lobby/features'
import { DEFAULT_PLAYER_CHARACTER_ID, isPlayerCharacterId, playerCharacter } from '../identity/playerCharacters'
import type { PlayerVisualIdentity } from '../identity/playerIdentity'
import type { TownPosition } from '../identity/playerPreferences'
import { pokeballInfo } from './pokeball'
import { isPresenceAreaId, type LocalPresencePort, type RemotePresenceActor } from '../multiplayer/domain/presence'
import { reconcilePresenceArea } from '../multiplayer/domain/areaReconciliation'
import { keepsPredictedStep } from '../multiplayer/domain/movementReconciliation'

const PLAYER_SHEET = '/assets/trainers/protahombre.png'
/** While a panel covers the town the scene keeps animating, but at a battery-friendly rate. */
const PAUSED_FRAME_MS = 100

export interface HudState {
  areaId: AreaId
  areaKind: 'town' | 'wild'
  place: string
  tx: number
  ty: number
  phase: DayPhase
  weather: WeatherKind
  crystals: number
  lens: LensName
  toast: string | null
  traveling: boolean
  fps: number
  /** Average CPU time spent in update + render, in ms. */
  frameMs: number
}

/** A world tile the player tapped beside or faces. */
export interface WorldObjectTarget {
  area: Area
  tx: number
  ty: number
}

export interface GameOptions {
  pokedex: readonly PokedexEntry[]
  onHud: (hud: HudState) => void
  startArea?: AreaId
  spawn?: (Tile & { dir?: Dir }) | null
  /** The player walked into a building that hosts a PokeSwap feature. */
  onEnterBuilding?: (buildingId: string, feature: LobbyFeature) => void
  /** The player tapped (or faced) a read-only world interaction. */
  onInspect?: (hit: PlazaHit | WildHit) => void
  /** Development prototypes (R31-B professions): returns true when it handled the tile. */
  onWorldObject?: (target: WorldObjectTarget) => boolean
  /** Side-effect-free probe: walkable tiles to stand beside and face (R31-C1). */
  isWorldObject?: (target: WorldObjectTarget) => boolean
  /** Completed safe town tiles, used only for local cosmetic persistence. */
  onTownPosition?: (position: TownPosition) => void
  presence?: LocalPresencePort | null
}

const LENS_ORDER: LensName[] = ['handheld', 'dramatic', 'cenital']
const OPPOSITE: Record<Dir, Dir> = { up: 'down', down: 'up', left: 'right', right: 'left' }

export class WildlandsGame {
  private readonly atlas = new Atlas()
  private readonly renderer: Renderer
  private readonly player: Actor
  private readonly appearance: PlayerAppearance
  private readonly companion: CompanionFollower
  private readonly onHud: (hud: HudState) => void
  private readonly pokedex: readonly PokedexEntry[]
  private area!: Area
  private populace!: Populace
  private readonly keys = new KeyboardInput({
    cycleLens: () => this.cycleLens(),
    toggleGrid: () => this.toggleGrid(),
    skipTime: () => this.skipTime(),
    interact: () => this.interact(),
  })
  private walker = createWalkerState()
  /**
   * Things placed in the world on purpose (F-1). The world derives its own
   * props from a seed; this is what can be *added* to it, and it answers
   * solidity, navigation and interaction alongside the area.
   */
  readonly placedObjects = new PlacedObjects()
  private readonly nav = new TapNavigator({
    isSolid: (tx, ty) => this.solidAt(tx, ty),
    occupied: (tx, ty) => this.populace.actors.some(a => a.tx === tx && a.ty === ty),
    isInteractive: (tx, ty) => this.placedObjects.isInteractive(this.area.id, tx, ty)
      || (this.isWorldObject?.({ area: this.area, tx, ty }) ?? false),
  })
  private overlay: SceneOverlay | null = null
  private inputLocked = false
  private readonly travel = new AreaTravel()
  private readonly entrances: Entrances
  private readonly onInspect?: (hit: PlazaHit | WildHit) => void
  private readonly onWorldObject?: (target: WorldObjectTarget) => boolean
  private readonly isWorldObject?: (target: WorldObjectTarget) => boolean
  private readonly onTownPosition?: (position: TownPosition) => void
  private readonly presence?: LocalPresencePort | null
  private remoteActors: Actor[] = []
  private remoteCompanions: Actor[] = []
  private remoteGeneration = 0
  private observerAt: string | null = null
  private receivedAuthoritativeActor = false
  /** Area requested locally; old-area socket acknowledgements cannot undo it. */
  private pendingPresenceArea: 'ciudad-corazon' | 'pradera' | null = null
  private nextMoveSequence = 0
  private username: string | null = null
  private owned: readonly PlazaResident[] = []
  private wildPokemonIds: readonly number[] = []
  private running = false
  private paused = false
  private spectator = false
  private visibilityPaused = false
  private reduceMotion = false
  private frameId = 0
  private last = 0
  private seconds = 0
  private clock = 0.4
  private camX = 0
  private camY = 0
  private lensName: LensName = 'handheld'
  private lensFrom: CameraLens = LENSES.handheld
  private lensBlend = 1
  private showGrid = true
  private crystals = 0
  private toast: { text: string; until: number } | null = null
  private weather = { kind: 'clear' as WeatherKind, intensity: 0, target: 0 }
  private weatherCheck = 0
  private hudTimer = 0
  private fps = 60
  private frameMs = 0

  constructor(canvas: HTMLCanvasElement, options: GameOptions) {
    this.renderer = new Renderer(canvas)
    this.pokedex = options.pokedex
    this.onHud = options.onHud
    this.onInspect = options.onInspect
    this.onWorldObject = options.onWorldObject
    this.isWorldObject = options.isWorldObject
    this.onTownPosition = options.onTownPosition
    this.presence = options.presence
    this.entrances = new Entrances(door => options.onEnterBuilding?.(door.buildingId, door.feature))
    this.player = createActor({ id: 'player', kind: 'player', habitat: 'any', tx: 0, ty: 0, trainer: this.renderer.playerSprites })
    this.appearance = new PlayerAppearance(this.player, this.renderer.playerSprites)
    this.companion = new CompanionFollower(entry => loadPokemonInfo(entry, false), pokeballInfo)
    const start = options.startArea && Atlas.isKnown(options.startArea) ? options.startArea : LOBBY_ID
    this.enterArea(start, null, options.spawn ?? null)
    this.appearance.set(playerCharacter(DEFAULT_PLAYER_CHARACTER_ID))
    loadNpcTrainerArt(PLAYER_SHEET, this.renderer.npcSprites, () => this.populace.actors)
  }

  /** Terrain, procedural props and anything placed on top of them (F-1). */
  private solidAt(tx: number, ty: number): boolean {
    return this.area.isSolid(tx, ty) || this.placedObjects.isSolid(this.area.id, tx, ty)
  }

  private readonly rules: MoveRules = {
    blocked: (actor, tx, ty) => {
      const area = this.area
      if (this.solidAt(tx, ty)) return true
      // Only the player uses gates and doors; wanderers keep them clear.
      if (actor.kind !== 'player' && (isPortalTile(area, tx, ty) || this.entrances.isDoor(area, tx, ty))) return true
      if (actor.habitat === 'any') return false
      return area.isWater(tx, ty) !== (actor.habitat === 'water')
    },
    occupied: (tx, ty, self) => {
      for (const a of [this.player, ...this.populace.actors]) {
        if (a !== self && a.tx === tx && a.ty === ty) return true
      }
      return false
    },
  }

  /** Makes `id` the active area and places the player at its arrival point. */
  private enterArea(id: AreaId, from: AreaId | null, spawn: (Tile & { dir?: Dir }) | null): void {
    const area = this.atlas.get(id)
    // Whatever was placed in the area being left stops existing for the
    // engine: its owner re-registers it if the player comes back (F-1).
    if (area.id !== this.area?.id) this.placedObjects.clearArea(this.area?.id ?? '')
    this.area = area
    this.populace = area.createPopulace({ pokedex: this.pokedex, npcSprites: this.renderer.npcSprites })
    this.populace.setOwned?.(this.owned)
    this.populace.setWildPokemonIds?.(this.wildPokemonIds)
    const arrival = area.arrival(from)
    this.placePlayer(spawn && !area.isSolid(spawn.tx, spawn.ty) ? { ...spawn, dir: spawn.dir ?? arrival.dir } : arrival)
    this.lensName = area.lens
    this.lensFrom = LENSES[area.lens]
    this.lensBlend = 1
    this.weather = { kind: 'clear', intensity: 0, target: 0 }
    this.weatherCheck = 0
  }

  /** Stands the player on `at` and snaps the camera there. */
  private placePlayer(at: Arrival): void {
    const p = this.player
    p.tx = p.fromTx = at.tx
    p.ty = p.fromTy = at.ty
    p.progress = 1
    p.dir = at.dir
    p.bumping = false
    this.walker = createWalkerState()
    this.nav.cancel()
    this.travel.arrived(this.area, at.tx, at.ty)
    this.companion?.reset(p)
    const pos = actorPosition(p)
    this.camX = pos.x
    this.camY = pos.y
  }

  start(): void {
    this.running = true
    if (!this.spectator && !this.paused && !this.visibilityPaused) this.keys.attach()
    this.last = performance.now()
    this.frameId = requestAnimationFrame(this.loop)
  }

  destroy(): void {
    this.running = false
    cancelAnimationFrame(this.frameId)
    this.keys.detach()
  }

  /** Ignores player input (a feature panel is open) and slows the loop down. */
  setPaused(paused: boolean): void {
    if (paused === this.paused) return
    this.paused = paused
    this.nav.cancel()
    if (!this.running) return
    if (paused || this.visibilityPaused) this.keys.detach()
    else this.keys.attach()
  }

  /** Stops simulation while the document is hidden without conflating it with UI pause. */
  setVisibilityPaused(paused: boolean): void {
    if (paused === this.visibilityPaused) return
    this.visibilityPaused = paused
    this.nav.cancel()
    if (!this.running) return
    if (paused || this.paused) this.keys.detach()
    else {
      this.last = performance.now()
      this.keys.attach()
    }
  }

  /** Cosmetic preference only: no weather particles or transition fade. */
  setReducedMotion(reduced: boolean): void {
    this.reduceMotion = reduced
  }

  /** Stands the player outside the building hosting `feature`, facing away from it. */
  placeAtDoor(feature: LobbyFeature): void {
    const exit = this.entrances.exitFor(this.area, feature)
    if (exit && !this.travel.active) this.placePlayer(exit)
  }

  /** Owned Pokémon for the town plazas; kept across trips so the town is repopulated on return. */
  setOwnedPokemon(list: readonly PlazaResident[]): void {
    this.owned = list
    this.populace.setOwned?.(list)
  }

  /** Server-filtered pool membership for WildLands; no ownership data enters the engine. */
  setWildPokemonIds(ids: readonly number[]): void {
    this.wildPokemonIds = ids
    this.populace.setWildPokemonIds?.(ids)
  }

  /** Applies display-only identity; ownership was validated before it reached the engine. */
  setPlayerIdentity(identity: PlayerVisualIdentity): void {
    this.username = identity.username
    this.appearance.set(identity.character)
    this.companion.set(identity.companion, this.player)
  }

  /** Guests keep the live scene but cannot create a local actor or movement intent. */
  setSpectator(spectator: boolean): void {
    this.spectator = spectator
    this.nav.cancel()
    if (spectator) this.keys.detach()
    else if (this.running && !this.paused && !this.visibilityPaused) this.keys.attach()
  }

  /** The presence service, not a browser session guess, decides actor access. */
  setPresenceAccess(access: 'pending' | 'player' | 'guest'): void {
    this.setSpectator(access !== 'player')
  }

  /** Reconciles the playable avatar to the ephemeral position confirmed by the server. */
  setAuthoritativeActor(actor: RemotePresenceActor | null): void {
    if (!actor) {
      this.receivedAuthoritativeActor = false
      this.pendingPresenceArea = null
      this.nextMoveSequence = 0
      return
    }
    if (this.spectator) return
    const area = reconcilePresenceArea(this.pendingPresenceArea, actor.areaId)
    this.pendingPresenceArea = area.pendingArea
    if (!area.accept) return
    if (!this.receivedAuthoritativeActor) {
      this.receivedAuthoritativeActor = true
      this.nextMoveSequence = actor.moveSequence
      if (this.area.id !== actor.areaId) this.enterArea(actor.areaId, null, { tx: actor.tx, ty: actor.ty, dir: actor.dir })
      else this.placePlayer({ tx: actor.tx, ty: actor.ty, dir: actor.dir })
      this.player.speed = actor.speed
      return
    }
    // A local prediction may be one or more steps ahead while the server is
    // processing prior input. Never rewind it to an older acknowledgement.
    if (actor.moveSequence < this.nextMoveSequence) return
    if (this.area.id !== actor.areaId) {
      this.enterArea(actor.areaId, null, { tx: actor.tx, ty: actor.ty, dir: actor.dir })
      this.player.speed = actor.speed
      return
    }
    const player = this.player
    if (keepsPredictedStep(isMoving(player), actor.moveSequence, this.nextMoveSequence)) return
    // A completed local step keeps its previous `from` tile for animation.
    // It is not a server disagreement; reconciling it would cancel click-paths
    // and make running restart every tile.
    const differs = player.tx !== actor.tx || player.ty !== actor.ty
    if (differs) this.placePlayer({ tx: actor.tx, ty: actor.ty, dir: actor.dir })
    else player.dir = actor.dir
    player.speed = actor.speed
    player.running = actor.speed > WALK_SPEED
  }

  /** Applies server-authoritative ephemeral actor snapshots through the remote-actor port. */
  setRemoteActors(actors: readonly RemotePresenceActor[]): void {
    const generation = ++this.remoteGeneration
    const previous = new Map(this.remoteActors.map(actor => [actor.id, actor]))
    const previousCompanions = new Map(this.remoteCompanions.map(actor => [actor.id, actor]))
    this.remoteActors = actors.filter(actor => actor.areaId === this.area.id).map(remote => {
      const old = previous.get(`remote:${remote.id}`)
      const actor = createActor({ id: `remote:${remote.id}`, kind: 'remote', habitat: 'any', tx: remote.tx, ty: remote.ty,
        trainer: this.renderer.playerSprites, remoteUsername: remote.username, remote: true, dir: remote.dir, speed: remote.speed,
      })
      if (old && (old.tx !== remote.tx || old.ty !== remote.ty)) {
        actor.fromTx = old.tx; actor.fromTy = old.ty; actor.progress = 0; actor.speed = remote.speed
      }
      const character = playerCharacter(isPlayerCharacterId(remote.characterId) ? remote.characterId : DEFAULT_PLAYER_CHARACTER_ID)
      void loadTrainerSheet(character.sheetUrl).then(sheet => {
        if (generation !== this.remoteGeneration || !this.remoteActors.includes(actor)) return
        actor.trainer = sheet.walk; actor.trainerRun = sheet.run
      }).catch(() => undefined)
      return actor
    })
    this.remoteCompanions = actors.filter(actor => actor.areaId === this.area.id && actor.companionId !== null).map(remote => {
      const id = remote.companionId!
      const owner = this.remoteActors.find(actor => actor.id === `remote:${remote.id}`)
      const companionId = `remote-companion:${remote.id}:${id}`
      const old = previousCompanions.get(companionId)
      const tx = owner?.fromTx ?? remote.tx
      const ty = owner?.fromTy ?? remote.ty
      const companion = createActor({
        id: companionId, kind: 'pokemon', habitat: 'any', tx, ty,
        dir: remote.dir, speed: remote.speed, remote: true, pokemon: pokeballInfo({ id, name_es: String(id) }),
      })
      // Follow the remote trainer's previous completed tile. Preserving the
      // old companion position makes running a continuous one-tile trail.
      if (old && (old.tx !== tx || old.ty !== ty)) {
        companion.fromTx = old.tx; companion.fromTy = old.ty; companion.progress = 0
      }
      const entry = this.pokedex.find(pokemon => pokemon.id === id)
      if (entry) void loadPokemonInfo(entry, false).then(info => {
        if (generation === this.remoteGeneration && this.remoteCompanions.includes(companion) && info) companion.pokemon = info
      }).catch(() => undefined)
      return companion
    })
  }

  /** Prototype effects drawn with the scene; null removes them. */
  setSceneOverlay(overlay: SceneOverlay | null): void {
    this.overlay = overlay
  }

  /** Keeps rendering at full rate but ignores movement, taps and actions (e.g. while an action animates). */
  setInputLocked(locked: boolean): void {
    this.inputLocked = locked
    if (locked) this.nav.cancel()
  }

  /** Read-only snapshot of the local player for overlays. */
  playerSnapshot(): { tx: number; ty: number; dir: Dir; x: number; y: number; moving: boolean; areaId: AreaId } {
    const p = this.player
    const { x, y } = actorPosition(p)
    return { tx: p.tx, ty: p.ty, dir: p.dir, x, y, moving: isMoving(p), areaId: this.area.id }
  }

  setVirtualDir(dir: Dir | null): void {
    this.keys.virtualDir = dir
  }

  /**
   * Tap/click at a CSS-pixel point on the canvas. Tapping an owned Pokémon or
   * the activity board inspects it; tapping another Pokémon, NPC or obstacle
   * walks beside it (and talks); tapping ground walks there.
   */
  tap(cssX: number, cssY: number): void {
    if (this.spectator || this.travel.active || this.paused || this.inputLocked) return
    // A tap on a placed object's art means the object, not the ground behind
    // it (F-1, the same correction buildings make with `doorForTap`).
    const pick = retargetToPlaced(this.placedObjects, this.area.id, this.renderer.pick(cssX, cssY))
    const hit = this.onInspect ? plazaHitAt(this.area, pick) ?? wildHitAt(this.area, pick) : null
    if (hit) this.onInspect!(hit)
    else if (!this.worldObjectBeside(pick.tile)) this.nav.goTo(this.player, this.entrances.retarget(this.area, pick))
  }

  /** A tile next to the player may host a prototype interaction; farther tiles walk there first. */
  private worldObjectBeside(tile: Tile | null): boolean {
    if (!tile || !this.onWorldObject) return false
    const dx = tile.tx - this.player.tx
    const dy = tile.ty - this.player.ty
    if (Math.abs(dx) + Math.abs(dy) !== 1) return false
    const handled = this.onWorldObject({ area: this.area, tx: tile.tx, ty: tile.ty })
    if (handled) this.player.dir = dx > 0 ? 'right' : dx < 0 ? 'left' : dy > 0 ? 'down' : 'up'
    return handled
  }

  /** Press-and-drag retargeting: only re-plans when the finger moves to another tile. */
  drag(cssX: number, cssY: number): void {
    if (this.spectator || this.travel.active || this.paused || this.inputLocked) return
    const pick = this.renderer.pick(cssX, cssY)
    const current = this.nav.route(this.player).target
    if (!pick.tile || (current && current.tx === pick.tile.tx && current.ty === pick.tile.ty)) return
    this.nav.goTo(this.player, { tile: pick.tile, actor: null })
  }

  /** Starts a fade-out trip to another area. */
  travelTo(to: AreaId): void {
    // R30 intentionally shares just Ciudad Corazón and Pradera. Letting a
    // legacy local-only gate transition while presence is active would split
    // client and server area authority.
    if (this.presence && !isPresenceAreaId(to)) {
      this.say('Esta zona llegará próximamente')
      return
    }
    if (this.travel.begin(this.area.id, to)) this.nav.cancel()
  }

  returnToLobby(): void {
    this.travelTo(LOBBY_ID)
  }

  paintMinimap(canvas: HTMLCanvasElement): void {
    this.area.paintMinimap(canvas, this.player.tx, this.player.ty)
  }

  cycleLens(): void {
    const next = LENS_ORDER[(LENS_ORDER.indexOf(this.lensName) + 1) % LENS_ORDER.length]
    this.lensFrom = this.currentLens()
    this.lensName = next
    this.lensBlend = 0
  }

  toggleGrid(): void {
    this.showGrid = !this.showGrid
  }

  skipTime(): void {
    this.clock = (this.clock + 0.125) % 1
    this.say(`La hora avanza… (${lighting(this.clock).phase})`)
  }

  interact(): void {
    if (this.inputLocked) return
    const [dx, dy] = DIRS[this.player.dir]
    const tx = this.player.tx + dx
    const ty = this.player.ty + dy
    const other = this.populace.actors.find(a => a.tx === tx && a.ty === ty)
    const hit = this.onInspect ? plazaHitFacing(this.area, other, tx, ty) ?? wildHitFacing(this.area, other) : null
    if (hit) {
      this.onInspect!(hit)
      return
    }
    if (!other && this.onWorldObject?.({ area: this.area, tx, ty })) return
    const said = other ? actorLine(other, this.area.kind === 'town', tx, ty) : null
    if (other && said) {
      other.dir = OPPOSITE[this.player.dir]
      other.nextThink = this.seconds + 3
      this.say(said)
      return
    }
    const line = this.area.talkAt(tx, ty)
    if (line) this.say(line)
    else if (this.area.isWater(tx, ty) && !this.area.isWater(this.player.tx, this.player.ty)) {
      this.say('El agua está tranquila. Podés nadar.')
    }
  }

  private currentLens(): CameraLens {
    const t = this.lensBlend
    const eased = t * t * (3 - 2 * t)
    return lerpLens(this.lensFrom, LENSES[this.lensName], eased)
  }

  /** Shows a short message in the HUD toast. */
  notify(text: string): void {
    this.say(text)
  }

  private say(text: string): void {
    this.toast = { text, until: this.seconds + 3.2 }
  }

  private readonly loop = (now: number): void => {
    if (!this.running) return
    if (this.visibilityPaused) {
      this.last = now
      this.frameId = requestAnimationFrame(this.loop)
      return
    }
    if (this.paused && now - this.last < PAUSED_FRAME_MS) {
      this.frameId = requestAnimationFrame(this.loop)
      return
    }
    // rAF timestamps can precede the performance.now() taken in start().
    const dt = Math.max(0, Math.min(0.05, (now - this.last) / 1000))
    this.last = now
    this.fps += (1 / Math.max(dt, 0.001) - this.fps) * 0.05
    const workStart = performance.now()
    this.update(dt)
    this.renderer.render(this.scene(), dt)
    this.area.tick()
    this.frameMs += (performance.now() - workStart - this.frameMs) * 0.1
    this.frameId = requestAnimationFrame(this.loop)
  }

  private update(dt: number): void {
    this.seconds += dt
    this.clock = (this.clock + dt / DAY_SECONDS) % 1
    if (this.lensBlend < 1) this.lensBlend = Math.min(1, this.lensBlend + dt * 1.8)
    this.travel.update(dt, (to, from) => {
      this.enterArea(to, from, null)
      // Only these two areas participate in R30 presence. The request is
      // recorded before it crosses the socket so an older town snapshot cannot
      // pull the local player back through the portal.
      this.pendingPresenceArea = this.area.id === LOBBY_ID ? 'ciudad-corazon' : this.area.id === 'pradera' ? 'pradera' : null
      this.presence?.changeArea(this.area.id)
      this.say(this.area.name)
    })

    // Player (input is ignored mid-trip)
    const player = this.player
    const keyDir = this.travel.active || this.paused || this.spectator || this.inputLocked ? null : this.keys.direction
    if (keyDir) this.nav.cancel() // Keyboard always wins over a tap route.
    const navigating = !keyDir && this.nav.active
    player.running = this.keys.sprinting
    // Speed is latched per tile so a step never changes pace halfway through.
    if (!isMoving(player)) {
      player.speed = (this.keys.sprinting ? RUN_SPEED : WALK_SPEED) * (this.area.isWater(player.tx, player.ty) ? 0.7 : 1)
    }
    driveWalker(
      player,
      navigating ? this.nav.next : keyDir,
      dt,
      this.rules,
      this.walker,
      (tx, ty) => {
        if (navigating) this.nav.arrived()
        this.onPlayerArrive(tx, ty)
      },
      navigating,
    )
    if (this.nav.update(player, dt)) this.interact()
    this.companion.update(player, dt)

    // Wanderers
    this.populace.update(player.tx, player.ty)
    for (const actor of this.populace.actors) {
      wander(actor, this.seconds, this.rules)
      advance(actor, dt)
    }
    for (const actor of this.remoteActors) advance(actor, dt)
    for (const actor of this.remoteCompanions) advance(actor, dt)

    // Camera: locked to the player's whole-pixel position, like the handheld games.
    // Easing only kicks in after a large jump so the view never snaps across the map.
    const target = actorPosition(player)
    const gap = Math.hypot(target.x - this.camX, target.y - this.camY)
    if (gap > TILE * 3) {
      const follow = 1 - Math.exp(-dt * 10)
      this.camX += (target.x - this.camX) * follow
      this.camY += (target.y - this.camY) * follow
    } else {
      this.camX = target.x
      this.camY = target.y
    }

    // Weather eases toward the regional value.
    this.weatherCheck -= dt
    if (this.weatherCheck <= 0) {
      this.weatherCheck = 0.5
      const w = this.area.weather(player.tx, player.ty, this.seconds)
      if (w.kind !== 'clear') this.weather.kind = w.kind
      this.weather.target = w.intensity
    }
    this.weather.intensity += (this.weather.target - this.weather.intensity) * Math.min(1, dt * 0.8)
    if (this.weather.intensity < 0.01 && this.weather.target === 0) this.weather.kind = 'clear'

    this.hudTimer -= dt
    if (this.hudTimer <= 0) {
      this.hudTimer = 0.15
      const gate = this.travel.hint(this.area, player.tx, player.ty)
      if (gate) this.say(gate)
      this.emitHud()
    }
  }

  private onPlayerArrive(tx: number, ty: number): void {
    // Only the direction crosses the trust boundary; the presence server derives the position.
    this.presence?.move(this.player.dir, this.player.running, ++this.nextMoveSequence)
    if (this.area.collect(tx, ty)) {
      this.crystals++
      this.say('+1 cristal · demo, no se guarda')
    }
    if (this.entrances.arrive(this.area, tx, ty)) this.nav.cancel()
    const to = this.travel.destinationAt(this.area, tx, ty)
    if (this.area.id === LOBBY_ID && !to && !this.entrances.isDoor(this.area, tx, ty)) {
      this.onTownPosition?.({ tx, ty, dir: this.player.dir })
    }
    this.companion.playerArrived(this.player)
    if (to) this.travelTo(to)
  }

  private scene(): Scene {
    return {
      area: this.area,
      fade: this.reduceMotion ? 0 : this.travel.fade(),
      camX: this.camX,
      camY: this.camY,
      lens: this.currentLens(),
      seconds: this.seconds,
      light: lighting(this.clock),
      weather: { kind: this.weather.kind, intensity: this.reduceMotion ? 0 : this.weather.intensity },
      player: this.player,
      companion: this.companion.actor,
      username: this.username,
      showPlayer: !this.spectator,
      actors: [...this.populace.actors, ...this.remoteActors, ...this.remoteCompanions],
      // The grid helps read procedural terrain; over town art it is noise.
      showGrid: this.showGrid && this.area.kind === 'wild',
      route: this.nav.route(this.player),
      overlay: this.overlay,
    }
  }

  private emitHud(): void {
    const p = this.player
    if (this.spectator) {
      const key = `${this.area.id}:${p.tx}:${p.ty}`
      if (key !== this.observerAt) {
        this.observerAt = key
        this.presence?.observe(this.area.id, p.tx, p.ty)
      }
    }
    if (this.toast && this.seconds > this.toast.until) this.toast = null
    this.onHud({
      areaId: this.area.id,
      areaKind: this.area.kind,
      place: this.area.placeName(p.tx, p.ty),
      tx: p.tx,
      ty: p.ty,
      phase: lighting(this.clock).phase,
      weather: this.weather.intensity > 0.2 ? this.weather.kind : 'clear',
      crystals: this.crystals,
      lens: this.lensName,
      toast: this.toast?.text ?? null,
      traveling: this.travel.active,
      fps: Math.round(this.fps),
      frameMs: Math.round(this.frameMs * 10) / 10,
    })
  }
}
