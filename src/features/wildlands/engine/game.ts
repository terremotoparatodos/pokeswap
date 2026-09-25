// Game loop — WildLands prototype
//
// Owns the frame loop, camera, actors and session-only state (clock, collected
// crystals). Keyboard input lives in keyboard.ts, area travel in travel.ts and
// building doors in doors.ts. Everything here is cosmetic client state:
// no tokens, ownership or rewards are read or written.

import {
  actorPosition, advance, createActor, createWalkerState, DIRS, driveWalker, isMoving, RUN_SPEED, WALK_SPEED,
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
import { PlacedObjects, nearestTile, placedObject, type PlacedObjectSpec } from './placedObjects'
import { AreaTravel } from './travel'
import { TILE } from './world'
import type { LobbyFeature } from '../lobby/features'
import { DEFAULT_PLAYER_CHARACTER_ID, isPlayerCharacterId, playerCharacter } from '../identity/playerCharacters'
import type { PlayerVisualIdentity } from '../identity/playerIdentity'
import type { TownPosition } from '../identity/playerPreferences'
import { pokeballInfo } from './pokeball'
import { isPresenceAreaId, type LocalPresencePort, type RemotePresenceActor } from '../multiplayer/domain/presence'
import { reconcilePresenceArea } from '../multiplayer/domain/areaReconciliation'
import { keepsPredictedStep, safeAuthoritativePosition } from '../multiplayer/domain/movementReconciliation'
import { PresenceDiagnostics, type PresenceDiagnosticsSnapshot } from '../multiplayer/domain/presenceDiagnostics'
import type { FrameProbe, RenderProbe } from './perfHooks'
import { RemoteStepPlayback } from './remotePlayback'
import type { WorldLayer, WorldLayerContext } from './worldLayer'
import { driveWanderer } from './patrolMotion'
import type { SharedPopulace } from './area'

const PLAYER_SHEET = '/assets/trainers/protahombre.png'

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
  /** 95th percentile of recent update + render work. */
  frameP95Ms: number
  frameP99Ms: number
  frameMaxMs: number
  /** Share of recent frames whose CPU work exceeded 33.3 ms. */
  longFramePercent: number
  remoteActors: number
  remoteUpdatesPerSecond: number
  groundComposeMs: number
  groundProjectMs: number
  actorCollectMs: number
  actorSortMs: number
  spriteDrawMs: number
  lightingMs: number
  loadedChunks: number
  generatedChunks: number
  evictedChunks: number
  lastChunkBuildMs: number
  maxChunkBuildMs: number
  /** Aggregate presence counters for the playtest HUD; no ids or coordinates. */
  presence: PresenceDiagnosticsSnapshot
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
  /** Physical objects a feature places in an area (F-1); asked on every entry. */
  placedObjectsIn?: (area: Area) => readonly PlacedObjectSpec[]
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
    occupied: (tx, ty) => this.populace.actors.some(a => !a.patrol && a.tx === tx && a.ty === ty),
    isInteractive: (tx, ty) => this.placedObjects.isInteractive(this.area.id, tx, ty)
      || (this.isWorldObject?.({ area: this.area, tx, ty }) ?? false),
  })
  private overlay: SceneOverlay | null = null
  /** WORLD-1: shared world entities drawn over this client's scene. */
  private worldLayer: WorldLayer | null = null
  private readonly worldContext: WorldLayerContext = {
    area: () => this.area,
    playerTile: id => id === this.localPresenceActorId ? this.player : this.remoteActorsById.get(id) ?? null,
    isSolid: (tx, ty) => this.solidAt(tx, ty),
  }
  /** Placed objects are left out on purpose: they differ between builds, the patrol must not. */
  private readonly sharedPopulace: SharedPopulace = {
    serverNow: () => this.worldLayer?.serverNow() ?? null,
    wildRoster: () => this.worldLayer?.wildRoster(this.area.id) ?? null,
    walkable: (habitat, tx, ty) => !this.area.isSolid(tx, ty) && !isPortalTile(this.area, tx, ty) && !this.entrances.isDoor(this.area, tx, ty)
      && (habitat === 'any' || this.area.isWater(tx, ty) === (habitat === 'water')),
  }
  private inputLocked = false
  private readonly travel = new AreaTravel()
  private readonly entrances: Entrances
  private readonly onInspect?: (hit: PlazaHit | WildHit) => void
  private readonly onWorldObject?: (target: WorldObjectTarget) => boolean
  private readonly isWorldObject?: (target: WorldObjectTarget) => boolean
  private readonly placedObjectsIn?: (area: Area) => readonly PlacedObjectSpec[]
  private readonly onTownPosition?: (position: TownPosition) => void
  private readonly presence?: LocalPresencePort | null
  private remoteActors: Actor[] = []
  private remoteCompanions: Actor[] = []
  private readonly remoteActorsById = new Map<string, Actor>()
  private readonly remoteCompanionsByOwnerId = new Map<string, Actor>()
  private readonly remoteCharacterIds = new Map<string, string>()
  private readonly remoteMoveSequences = new Map<string, number>()
  private readonly remotePlayback = new RemoteStepPlayback()
  private observerAt: string | null = null
  private receivedAuthoritativeActor = false
  /** Server id of the local player, used only to attach accepted chat to its sprite. */
  private localPresenceActorId: string | null = null
  /** Area requested locally; old-area socket acknowledgements cannot undo it. */
  private pendingPresenceArea: 'ciudad-corazon' | 'pradera' | null = null
  /**
   * Set whenever this client asks the service to re-place its actor. Every
   * `presence:self` ack still in flight describes the position from before that
   * request, so only the answering snapshot may reconcile until it arrives.
   */
  private awaitingAreaSnapshot = false
  private readonly presenceDiagnostics = new PresenceDiagnostics()
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
  /** Local "skip time" (dev key) on top of the shared day, in day fractions. */
  private clockShift = 0
  private camX = 0
  private camY = 0
  private lensName: LensName = 'handheld'
  private lensFrom: CameraLens = LENSES.handheld
  private lensBlend = 1
  private showGrid = true
  private crystals = 0
  private toast: { text: string; until: number } | null = null
  private readonly chatBubbles = new Map<string, { text: string; until: number }>()
  private readonly renderedChatBubbles = new Map<string, string>()
  private readonly renderedActors: Actor[] = []
  private weather = { kind: 'clear' as WeatherKind, intensity: 0, target: 0 }
  private weatherCheck = 0
  private hudTimer = 0
  private fps = 60
  private frameMs = 0
  private readonly frameSamples = new Float32Array(180)
  private frameSampleIndex = 0
  private frameSampleCount = 0
  private frameP95Ms = 0
  private frameP99Ms = 0
  private frameMaxMs = 0
  private longFramePercent = 0
  private lastPerformanceSampleAt = 0
  private remoteUpdatesSinceSample = 0
  private remoteUpdatesPerSecond = 0
  private frameProbe: FrameProbe | null = null

  constructor(canvas: HTMLCanvasElement, options: GameOptions) {
    this.renderer = new Renderer(canvas)
    this.pokedex = options.pokedex
    this.onHud = options.onHud
    this.onInspect = options.onInspect
    this.onWorldObject = options.onWorldObject
    this.isWorldObject = options.isWorldObject
    this.placedObjectsIn = options.placedObjectsIn
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
        // Shared wanderers never block: a player can never be stopped by one
        // another player does not see in the same place (WORLD-1D).
        if (a !== self && !a.patrol && a.tx === tx && a.ty === ty) return true
      }
      return false
    },
  }

  /** Makes `id` the active area and places the player at its arrival point. */
  private enterArea(id: AreaId, from: AreaId | null, spawn: (Tile & { dir?: Dir }) | null): void {
    const area = this.atlas.get(id)
    // Whatever was placed in the area being left stops existing for the
    // engine: its owner re-registers it if the player comes back (F-1).
    if (area.id !== this.area?.id) {
      this.placedObjects.clearArea(this.area?.id ?? '')
      this.area?.deactivate?.()
    }
    this.area = area
    this.populace = area.createPopulace({ pokedex: this.pokedex, npcSprites: this.renderer.npcSprites })
    this.populace.share?.(this.sharedPopulace)
    this.populace.setOwned?.(this.owned)
    this.populace.setWildPokemonIds?.(this.wildPokemonIds)
    const arrival = area.arrival(from)
    this.placePlayer(spawn && !area.isSolid(spawn.tx, spawn.ty) ? { ...spawn, dir: spawn.dir ?? arrival.dir } : arrival)
    this.lensName = area.lens
    this.lensFrom = LENSES[area.lens]
    this.lensBlend = 1
    this.weather = { kind: 'clear', intensity: 0, target: 0 }
    this.weatherCheck = 0
    this.syncPlacedObjects()
    area.prefetch?.(this.player.tx, this.player.ty)
  }

  /**
   * Asks the owning feature what it has placed in the current area (F-1). The
   * engine pulls instead of being pushed to, so entering and leaving an area
   * is the only lifecycle there is and nothing can survive the trip.
   */
  syncPlacedObjects(): void {
    this.placedObjects.clearArea(this.area.id)
    for (const spec of this.placedObjectsIn?.(this.area) ?? []) this.placedObjects.register(placedObject(spec))
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
    if (this.running) return
    this.running = true
    if (!this.spectator && !this.paused && !this.visibilityPaused) this.keys.attach()
    this.resumeFrameLoop()
  }

  destroy(): void {
    this.running = false
    this.stopFrameLoop()
    this.keys.detach()
  }

  /** Blocks world controls while a UI surface is open; rendering stays live at full rate. */
  setPaused(paused: boolean): void {
    if (paused === this.paused) return
    this.paused = paused
    this.nav.cancel()
    if (!this.running) return
    if (paused || this.visibilityPaused) this.keys.detach()
    else if (!this.spectator) this.keys.attach()
  }

  /** Stops simulation while the document is hidden without conflating it with UI pause. */
  setVisibilityPaused(paused: boolean): void {
    if (paused === this.visibilityPaused) return
    this.visibilityPaused = paused
    this.nav.cancel()
    if (!this.running) return
    if (paused) {
      this.keys.detach()
      this.stopFrameLoop()
    } else if (!this.paused) {
      if (!this.spectator) this.keys.attach()
      this.resumeFrameLoop()
    }
  }

  private stopFrameLoop(): void {
    if (this.frameId === 0) return
    cancelAnimationFrame(this.frameId)
    this.frameId = 0
  }

  private resumeFrameLoop(): void {
    if (!this.running || this.visibilityPaused || this.frameId !== 0) return
    // Presence keeps receiving while a hidden document is frozen. Start a
    // fresh rate window so its first HUD sample is not an accumulated burst.
    this.remoteUpdatesSinceSample = 0
    this.remoteUpdatesPerSecond = 0
    this.lastPerformanceSampleAt = this.seconds
    // The first rAF supplies the timestamp domain used by every later frame.
    // `performance.now()` can be slightly ahead of it and produce a fake
    // sub-millisecond delta (and an impossible FPS spike) after resuming.
    this.last = 0
    this.frameId = requestAnimationFrame(this.loop)
  }

  /** Cosmetic preference only: no weather particles or transition fade. */
  setReducedMotion(reduced: boolean): void {
    this.reduceMotion = reduced
  }

  /** Stands the player outside the building hosting `feature`, facing away from it. */
  placeAtDoor(feature: LobbyFeature): void {
    const door = this.entrances.doorFor(this.area, feature)
    if (!door || this.travel.active) return
    const p = this.player
    const onDoor = p.tx === door.door.tx && p.ty === door.door.ty && !isMoving(p)
    const step = stepBetween(door.door, door.exit)
    if (onDoor && step && this.presence && !this.spectator && this.receivedAuthoritativeActor) {
      // Presence owns the position, and a building is not an area: the player
      // never left the street. Leaving is one ordinary step out of the doorway,
      // announced like any other, so the server and every observer follow it.
      // Moving the avatar locally alone left the server on the door tile, and
      // the next sideways step then landed inside the building's solid front
      // row, which the safe point answered with the town spawn (TRANS-1).
      this.nav.cancel()
      this.walker = createWalkerState()
      p.dir = step
      p.fromTx = p.tx; p.fromTy = p.ty
      p.tx = door.exit.tx; p.ty = door.exit.ty
      p.progress = 0
      this.startStep(p)
      return
    }
    // No presence, or not standing in the doorway (a direct link to a
    // feature, before any authoritative position): nothing to announce.
    this.placePlayer(door.exit)
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
  setAuthoritativeActor(actor: RemotePresenceActor | null, source: 'snapshot' | 'self' = 'snapshot'): void {
    if (!actor) {
      if (this.localPresenceActorId !== null) this.presenceDiagnostics.disconnected()
      this.receivedAuthoritativeActor = false
      this.localPresenceActorId = null
      this.pendingPresenceArea = null
      this.awaitingAreaSnapshot = false
      this.nextMoveSequence = 0
      return
    }
    if (this.spectator) return
    this.localPresenceActorId = actor.id
    if (source === 'self') this.presenceDiagnostics.ackReceived(actor.moveSequence, performance.now())
    if (this.awaitingAreaSnapshot && source !== 'snapshot') {
      this.presenceDiagnostics.staleAckIgnored()
      return
    }
    const area = reconcilePresenceArea(this.pendingPresenceArea, actor.areaId)
    this.pendingPresenceArea = area.pendingArea
    if (!area.accept) return
    this.awaitingAreaSnapshot = false
    if (this.area.id !== actor.areaId) this.enterArea(actor.areaId, null, { tx: actor.tx, ty: actor.ty, dir: actor.dir })
    const safe = safeAuthoritativePosition(
      actor,
      this.area.arrival(null),
      (tx, ty) => this.solidAt(tx, ty) || !(this.area.isReachable?.(tx, ty) ?? true),
    )
    if (safe.recovered) {
      this.presenceDiagnostics.recoveredFromSolid()
      // The presence service deliberately owns ephemeral position, so repair
      // both sides. Keeping only the local fallback would let the next server
      // acknowledgement push the player straight back into the same hitbox.
      this.placePlayer(safe.position)
      // The service's sequence never goes backwards: restarting ours at zero
      // made every step taken before the reply look like a replay and get
      // rejected, leaving the server behind the client again.
      this.receivedAuthoritativeActor = true
      this.nextMoveSequence = Math.max(this.nextMoveSequence, actor.moveSequence)
      this.requestPresencePlacement(actor.areaId)
      this.say('Tu posición se corrigió al punto seguro de esta zona')
      return
    }
    if (!this.receivedAuthoritativeActor) {
      this.receivedAuthoritativeActor = true
      this.nextMoveSequence = actor.moveSequence
      this.placePlayer(safe.position)
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
    if (differs) {
      this.presenceDiagnostics.reconciled()
      this.placePlayer({ tx: actor.tx, ty: actor.ty, dir: actor.dir })
    }
    else player.dir = actor.dir
    player.speed = actor.speed
    player.running = actor.speed > WALK_SPEED
  }

  /** The service refused an intent; counted for the playtest HUD only. */
  presenceRejected(reason: string): void {
    this.presenceDiagnostics.rejected(reason)
  }

  /** Reconciles an authoritative snapshot while preserving every unchanged actor object. */
  replaceRemoteActors(actors: readonly RemotePresenceActor[]): void {
    const present = new Set(actors.map(actor => actor.id))
    for (const presenceId of this.remoteActorsById.keys()) if (!present.has(presenceId)) this.removeRemoteActor(presenceId)
    for (const actor of actors) this.applyRemoteActor(actor)
  }

  /** Completes optional cold terrain work before the first playable frame. */
  prepare(): Promise<void> {
    return this.area.warm?.(this.player.tx, this.player.ty) ?? Promise.resolve()
  }

  /** Applies one presence delta without rebuilding the rest of the remote crowd. */
  upsertRemoteActor(remote: RemotePresenceActor): void {
    this.remoteUpdatesSinceSample++
    this.applyRemoteActor(remote)
  }

  private applyRemoteActor(remote: RemotePresenceActor): void {
    if (remote.areaId !== this.area.id) {
      this.removeRemoteActor(remote.id)
      return
    }

    const actorId = `remote:${remote.id}`
    let actor = this.remoteActorsById.get(remote.id)
    if (!actor) {
      actor = createActor({ id: actorId, kind: 'remote', habitat: 'any', tx: remote.tx, ty: remote.ty,
        trainer: this.renderer.playerSprites, remoteUsername: remote.username, remote: true, dir: remote.dir, speed: remote.speed,
      })
      actor.running = remote.speed > WALK_SPEED
      this.remoteActorsById.set(remote.id, actor)
      this.remoteActors.push(actor)
      this.remoteMoveSequences.set(remote.id, remote.moveSequence)
    } else {
      this.queueRemoteStep(remote, actor)
    }
    actor.remoteUsername = remote.username

    const characterId = isPlayerCharacterId(remote.characterId) ? remote.characterId : DEFAULT_PLAYER_CHARACTER_ID
    if (this.remoteCharacterIds.get(remote.id) !== characterId) {
      this.remoteCharacterIds.set(remote.id, characterId)
      const character = playerCharacter(characterId)
      const target = actor
      void loadTrainerSheet(character.sheetUrl).then(sheet => {
        if (this.remoteCharacterIds.get(remote.id) !== characterId || !this.remoteActors.includes(target)) return
        target.trainer = sheet.walk; target.trainerRun = sheet.run
      }).catch(() => undefined)
    }

    this.upsertRemoteCompanion(remote, actor)
  }

  removeRemoteActor(id: string): void {
    const actor = this.remoteActorsById.get(id)
    if (actor) this.remoteActors = this.remoteActors.filter(candidate => candidate !== actor)
    const companion = this.remoteCompanionsByOwnerId.get(id)
    if (companion) this.remoteCompanions = this.remoteCompanions.filter(candidate => candidate !== companion)
    this.remoteActorsById.delete(id)
    this.remoteCompanionsByOwnerId.delete(id)
    this.remoteCharacterIds.delete(id)
    this.remoteMoveSequences.delete(id)
    this.remotePlayback.delete(id)
  }

  private queueRemoteStep(remote: RemotePresenceActor, actor: Actor): void {
    const sequence = this.remoteMoveSequences.get(remote.id) ?? -1
    if (remote.moveSequence <= sequence) return
    this.remoteMoveSequences.set(remote.id, remote.moveSequence)

    const tail = this.remotePlayback.tail(remote.id, actor)
    if (tail.tx === remote.tx && tail.ty === remote.ty) {
      if (!isMoving(actor) && this.remotePlayback.backlog(remote.id) === 0) {
        actor.dir = remote.dir; actor.speed = remote.speed; actor.running = remote.speed > WALK_SPEED
      }
      return
    }
    this.remotePlayback.push(remote.id, actor, { tx: remote.tx, ty: remote.ty, dir: remote.dir, speed: remote.speed })
  }

  private advanceRemoteActors(dt: number): void {
    for (const actor of this.remoteActors) this.remotePlayback.advance(actor.id.slice('remote:'.length), actor, dt)
  }

  private upsertRemoteCompanion(remote: RemotePresenceActor, owner: Actor): void {
    const prefix = `remote-companion:${remote.id}:`
    const existing = this.remoteCompanionsByOwnerId.get(remote.id)
    if (remote.companionId === null) {
      if (existing) {
        this.remoteCompanions = this.remoteCompanions.filter(actor => actor !== existing)
        this.remoteCompanionsByOwnerId.delete(remote.id)
      }
      return
    }

    const pokemonId = remote.companionId
    const companionId = `${prefix}${pokemonId}`
    let companion = existing?.id === companionId ? existing : undefined
    if (existing && !companion) this.remoteCompanions = this.remoteCompanions.filter(actor => actor !== existing)
    const tx = owner.fromTx
    const ty = owner.fromTy
    if (!companion) {
      companion = createActor({
        id: companionId, kind: 'pokemon', habitat: 'any', tx, ty,
        dir: remote.dir, speed: remote.speed, remote: true, pokemon: pokeballInfo({ id: pokemonId, name_es: String(pokemonId) }),
      })
      this.remoteCompanionsByOwnerId.set(remote.id, companion)
      this.remoteCompanions.push(companion)
      const target = companion
      const entry = this.pokedex.find(pokemon => pokemon.id === pokemonId)
      if (entry) void loadPokemonInfo(entry, false).then(info => {
        if (this.remoteCompanions.includes(target) && info) target.pokemon = info
      }).catch(() => undefined)
    } else if (companion.tx !== tx || companion.ty !== ty) {
      companion.fromTx = companion.tx; companion.fromTy = companion.ty
      companion.tx = tx; companion.ty = ty; companion.progress = 0
    }
    companion.dir = remote.dir
    companion.speed = remote.speed
  }

  /** WORLD-1: the shared world's entities and clock; null removes them. */
  setWorldLayer(layer: WorldLayer | null): void {
    this.worldLayer = layer
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

  /** PERF-1 only: installs measurement hooks (see perfHooks.ts); scripted runs also hold sprint. */
  setFrameProbe(probe: FrameProbe | null, render: RenderProbe | null): void {
    this.frameProbe = probe
    this.renderer.probe = render
    probe?.attached?.(this.renderer.playerSprites)
  }

  setVirtualSprint(on: boolean): void {
    this.keys.sprinting = on
  }

  /** The touch Correr toggle (MOBILE-1): same gait as Shift, applied from the next step. */
  setRunMode(on: boolean): void {
    this.keys.runMode = on
  }

  /**
   * Tap/click at a CSS-pixel point on the canvas. Tapping an owned Pokémon or
   * the activity board inspects it; tapping another Pokémon, NPC or obstacle
   * walks beside it (and talks); tapping ground walks there.
   */
  tap(cssX: number, cssY: number): void {
    if (this.spectator || this.travel.active || this.paused || this.inputLocked) return
    // A tap on a placed object's art resolves to it in the renderer, behind
    // actors and props (F-1); everything else still answers with the ground.
    const pick = this.renderer.pick(cssX, cssY)
    const hit = this.onInspect ? plazaHitAt(this.area, pick) ?? wildHitAt(this.area, pick) : null
    if (hit) this.onInspect!(hit)
    else if (!this.worldObjectBeside(this.placedRetarget(pick.tile))) this.nav.goTo(this.player, this.entrances.retarget(this.area, pick))
  }

  /**
   * A tap on a placed object answers with its anchor, which on a multi-tile
   * object can be several tiles from the side the player is standing on. The
   * tile that matters is the nearest one *of the same object*, so adjacency
   * and walking both work for any footprint without anyone knowing its size
   * (R33). A tap on anything else is returned untouched.
   */
  private placedRetarget(tile: Tile | null): Tile | null {
    if (!tile) return null
    const object = this.placedObjects.at(this.area.id, tile.tx, tile.ty)
    return object ? nearestTile(object, this.player.tx, this.player.ty) : tile
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
    if (this.area.id !== LOBBY_ID) {
      this.travelTo(LOBBY_ID)
      return
    }
    // The same-area action is an escape hatch: reset every local movement
    // state and ask presence to authoritatively place the actor at town spawn.
    const arrival = this.area.arrival(null)
    this.placePlayer(arrival)
    this.onTownPosition?.({ tx: arrival.tx, ty: arrival.ty, dir: arrival.dir })
    if (this.presence && !this.spectator) {
      this.requestPresencePlacement('ciudad-corazon')
    } else {
      this.observerAt = null
    }
    this.say('Volviste al centro de Ciudad Corazón')
  }

  /**
   * Asks the service to place the actor at this area's arrival. The barrier
   * and the kept move sequence let the player keep walking before the reply.
   */
  private requestPresencePlacement(areaId: 'ciudad-corazon' | 'pradera'): void {
    this.pendingPresenceArea = areaId
    this.awaitingAreaSnapshot = true
    if (this.presence) this.presenceDiagnostics.placementRequested()
    this.presence?.changeArea(areaId)
  }

  /** Shows only a line the server accepted and echoed; never an optimistic draft. */
  showChatMessage(line: { from: string; text: string }): void {
    const actorId = line.from === this.localPresenceActorId ? this.player.id : `remote:${line.from}`
    this.chatBubbles.set(actorId, { text: line.text, until: this.seconds + 5 })
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
    this.clockShift = (this.clockShift + 0.125) % 1
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
    if (this.lensBlend >= 1) return LENSES[this.lensName]
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
    this.frameId = 0
    if (!this.running) return
    if (this.visibilityPaused) return
    if (this.last === 0) {
      this.last = now
      this.frameId = requestAnimationFrame(this.loop)
      return
    }
    const dt = Math.max(0, Math.min(0.05, (now - this.last) / 1000))
    this.last = now
    this.fps += (1 / Math.max(dt, 0.001) - this.fps) * 0.05
    const workStart = performance.now()
    this.update(dt)
    const updateEnd = this.frameProbe ? performance.now() : 0
    this.renderer.render(this.scene(), dt)
    const renderEnd = this.frameProbe ? performance.now() : 0
    this.area.tick()
    const workMs = performance.now() - workStart
    this.frameProbe?.frame(now, workStart, updateEnd, renderEnd, workStart + workMs, this.player, this.camX, this.camY,
      this.area, this.remoteActors, this.populace.actors.length)
    this.frameMs += (workMs - this.frameMs) * 0.1
    this.frameSamples[this.frameSampleIndex] = workMs
    this.frameSampleIndex = (this.frameSampleIndex + 1) % this.frameSamples.length
    this.frameSampleCount = Math.min(this.frameSamples.length, this.frameSampleCount + 1)
    this.frameId = requestAnimationFrame(this.loop)
  }

  private update(dt: number): void {
    this.seconds += dt
    // WORLD-1: day and weather follow the server's clock once it is known, so
    // two players standing together see the same hour and the same rain.
    const serverNow = this.worldLayer?.serverNow() ?? null
    const sharedSeconds = serverNow === null ? null : serverNow / 1000
    this.clock = sharedSeconds === null
      ? (this.clock + dt / DAY_SECONDS) % 1
      : (sharedSeconds / DAY_SECONDS + 0.4 + this.clockShift) % 1
    if (this.lensBlend < 1) this.lensBlend = Math.min(1, this.lensBlend + dt * 1.8)
    this.travel.update(dt, (to, from) => {
      this.enterArea(to, from, null)
      // Only these two areas participate in R30 presence. The request is
      // recorded before it crosses the socket so an older town snapshot cannot
      // pull the local player back through the portal.
      const presenceArea = this.area.id === LOBBY_ID ? 'ciudad-corazon' : this.area.id === 'pradera' ? 'pradera' : null
      if (presenceArea) this.requestPresencePlacement(presenceArea)
      else this.pendingPresenceArea = null
      this.say(this.area.name)
    })

    // Player (input is ignored mid-trip)
    const player = this.player
    const keyDir = this.travel.active || this.paused || this.spectator || this.inputLocked ? null : this.keys.direction
    if (keyDir) this.nav.cancel() // Keyboard always wins over a tap route.
    const navigating = !keyDir && this.nav.active
    // The gait is latched per tile so a step never changes pace halfway
    // through, and re-read at the start of every chained step so Shift takes
    // effect on the next tile without stopping. Speed, animation and the gait
    // announced to presence all describe the same step.
    if (!isMoving(player)) this.latchGait(player, player.tx, player.ty)
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
      this.onStepStart,
    )
    if (this.nav.update(player, dt)) this.interact()
    this.companion.update(player, dt)

    // Wanderers
    this.populace.update(player.tx, player.ty)
    const worldNow = this.worldLayer?.serverNow() ?? null
    // Frozen on their deterministic tile until the server clock arrives, then
    // on their shared patrol: never a local random walk (WORLD-1).
    for (const actor of this.populace.actors) driveWanderer(actor, worldNow)
    this.advanceRemoteActors(dt)
    for (const actor of this.remoteCompanions) advance(actor, dt)
    this.worldLayer?.update(dt, this.worldContext)

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
      const w = this.area.weather(player.tx, player.ty, sharedSeconds ?? this.seconds)
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

  /** Water slows a step by the tile it starts from. */
  private latchGait(player: Actor, fromTx: number, fromTy: number): void {
    player.running = this.keys.sprinting
    player.speed = (player.running ? RUN_SPEED : WALK_SPEED) * (this.area.isWater(fromTx, fromTy) ? 0.7 : 1)
  }

  private readonly onStepStart = (player: Actor): void => this.startStep(player)

  private startStep(player: Actor): void {
    this.latchGait(player, player.fromTx, player.fromTy)
    // Announced as the step starts, not when it lands: observers learn of it
    // a whole tile earlier, and of a gait change before it is walked. Only the
    // direction crosses the trust boundary; the presence server derives the position.
    this.presence?.move(player.dir, player.running, ++this.nextMoveSequence)
    if (this.presence) this.presenceDiagnostics.moveSent(this.nextMoveSequence, performance.now())
  }

  private onPlayerArrive(tx: number, ty: number): void {
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
    this.area.prefetch?.(tx, ty)
    if (to) this.travelTo(to)
  }

  private scene(): Scene {
    const chatBubbles = this.renderedChatBubbles
    chatBubbles.clear()
    for (const [actorId, bubble] of this.chatBubbles) {
      if (bubble.until <= this.seconds) this.chatBubbles.delete(actorId)
      else chatBubbles.set(actorId, bubble.text)
    }
    const actors = this.renderedActors
    actors.length = 0
    for (const actor of this.populace.actors) actors.push(actor)
    for (const actor of this.remoteActors) actors.push(actor)
    const world = this.worldLayer
    for (const [ownerId, actor] of this.remoteCompanionsByOwnerId) {
      if (!world?.hidesCompanion(ownerId, actor.pokemon?.id ?? -1)) actors.push(actor)
    }
    if (world) for (const actor of world.actors()) actors.push(actor)
    const companion = this.companion.actor
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
      companion: companion && this.localPresenceActorId && world?.hidesCompanion(this.localPresenceActorId, companion.pokemon?.id ?? -1) ? null : companion,
      username: this.username,
      showPlayer: !this.spectator,
      actors,
      chatBubbles,
      // The grid helps read procedural terrain; over town art it is noise.
      showGrid: this.showGrid && this.area.kind === 'wild',
      route: this.nav.route(this.player),
      placed: this.placedObjects.inArea(this.area.id),
      overlay: this.overlay,
    }
  }

  private emitHud(): void {
    this.samplePerformance()
    const p = this.player
    const chunks = this.area.chunkMetrics?.()
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
      frameP95Ms: this.frameP95Ms,
      frameP99Ms: this.frameP99Ms,
      frameMaxMs: this.frameMaxMs,
      longFramePercent: this.longFramePercent,
      remoteActors: this.remoteActors.length,
      remoteUpdatesPerSecond: this.remoteUpdatesPerSecond,
      groundComposeMs: this.renderer.metrics.groundComposeMs,
      groundProjectMs: this.renderer.metrics.groundProjectMs,
      actorCollectMs: this.renderer.metrics.collectMs,
      actorSortMs: this.renderer.metrics.sortMs,
      spriteDrawMs: this.renderer.metrics.spriteDrawMs,
      lightingMs: this.renderer.metrics.lightingMs,
      loadedChunks: chunks?.loaded ?? 0,
      generatedChunks: chunks?.generated ?? 0,
      evictedChunks: chunks?.evicted ?? 0,
      lastChunkBuildMs: chunks?.lastBuildMs ?? 0,
      maxChunkBuildMs: chunks?.maxBuildMs ?? 0,
      presence: this.presenceDiagnostics.snapshot(),
    })
  }

  private samplePerformance(): void {
    const elapsed = this.seconds - this.lastPerformanceSampleAt
    if (elapsed < 1 || this.frameSampleCount === 0) return
    const samples = Array.from(this.frameSamples.subarray(0, this.frameSampleCount)).sort((a, b) => a - b)
    this.frameP95Ms = Math.round(samples[Math.ceil(samples.length * 0.95) - 1] * 10) / 10
    this.frameP99Ms = Math.round(samples[Math.ceil(samples.length * 0.99) - 1] * 10) / 10
    this.frameMaxMs = Math.round(samples[samples.length - 1] * 10) / 10
    this.longFramePercent = Math.round(samples.filter(value => value > 33.3).length / samples.length * 100)
    this.remoteUpdatesPerSecond = Math.round(this.remoteUpdatesSinceSample / elapsed * 10) / 10
    this.remoteUpdatesSinceSample = 0
    this.lastPerformanceSampleAt = this.seconds
  }
}

/** The direction of a one-tile move from `a` to `b`, or null when they are not neighbours. */
function stepBetween(a: Tile, b: Tile): Dir | null {
  for (const [dir, [dx, dy]] of Object.entries(DIRS) as [Dir, readonly [number, number]][]) {
    if (a.tx + dx === b.tx && a.ty + dy === b.ty) return dir
  }
  return null
}
