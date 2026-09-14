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
import { devWarn } from '../../../shared/utils/devTools'
import { Atlas, LOBBY_ID } from '../areas/atlas'
import { loadTrainerSheet, NPC_HUE_SHIFTS, type Dir } from './characters'
import { actorLine } from './dialogue'
import { Entrances } from './doors'
import { KeyboardInput } from './keyboard'
import { TapNavigator } from './navigator'
import type { Tile } from './pathfinding'
import type { PokedexEntry } from './population'
import { lerpLens, LENSES, type CameraLens, type LensName } from './projection'
import { Renderer, type Scene } from './renderer'
import { AreaTravel } from './travel'
import { TILE } from './world'
import type { LobbyFeature } from '../lobby/features'

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

export interface GameOptions {
  pokedex: readonly PokedexEntry[]
  onHud: (hud: HudState) => void
  startArea?: AreaId
  spawn?: Tile | null
  /** The player walked into a building that hosts a PokeSwap feature. */
  onEnterBuilding?: (buildingId: string, feature: LobbyFeature) => void
}

const LENS_ORDER: LensName[] = ['handheld', 'dramatic', 'cenital']
const OPPOSITE: Record<Dir, Dir> = { up: 'down', down: 'up', left: 'right', right: 'left' }

export class WildlandsGame {
  private readonly atlas = new Atlas()
  private readonly renderer: Renderer
  private readonly player: Actor
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
  private readonly nav = new TapNavigator({
    isSolid: (tx, ty) => this.area.isSolid(tx, ty),
    occupied: (tx, ty) => this.populace.actors.some(a => a.tx === tx && a.ty === ty),
  })
  private readonly travel = new AreaTravel()
  private readonly entrances: Entrances
  private running = false
  private paused = false
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
    this.entrances = new Entrances(door => options.onEnterBuilding?.(door.buildingId, door.feature))
    this.player = createActor({ id: 'player', kind: 'player', habitat: 'any', tx: 0, ty: 0, trainer: this.renderer.playerSprites })
    const start = options.startArea && Atlas.isKnown(options.startArea) ? options.startArea : LOBBY_ID
    this.enterArea(start, null, options.spawn ?? null)
    this.loadCharacterArt()
  }

  /** Swaps the code-drawn trainers for the bundled sheet once it loads; NPCs are recolours. */
  private loadCharacterArt(): void {
    loadTrainerSheet(PLAYER_SHEET)
      .then(({ walk, run }) => {
        this.player.trainer = walk
        this.player.trainerRun = run
      })
      .catch(error => devWarn('[wildlands] player sheet unavailable, keeping drawn trainer', error))

    Promise.all(NPC_HUE_SHIFTS.map(shift => loadTrainerSheet(PLAYER_SHEET, shift)))
      .then(sheets => {
        const looks = this.renderer.npcSprites
        looks.splice(0, looks.length, ...sheets.map(s => s.walk))
        for (const actor of this.populace.actors) {
          if (actor.kind === 'npc') actor.trainer = looks[Math.abs(actor.homeTx * 31 + actor.homeTy) % looks.length]
        }
      })
      .catch(error => devWarn('[wildlands] NPC sheets unavailable, keeping drawn trainers', error))
  }

  private readonly rules: MoveRules = {
    blocked: (actor, tx, ty) => {
      const area = this.area
      if (area.isSolid(tx, ty)) return true
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
  private enterArea(id: AreaId, from: AreaId | null, spawn: Tile | null): void {
    const area = this.atlas.get(id)
    this.area = area
    this.populace = area.createPopulace({ pokedex: this.pokedex, npcSprites: this.renderer.npcSprites })
    const arrival = area.arrival(from)
    this.placePlayer(spawn && !area.isSolid(spawn.tx, spawn.ty) ? { ...spawn, dir: arrival.dir } : arrival)
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
    const pos = actorPosition(p)
    this.camX = pos.x
    this.camY = pos.y
  }

  start(): void {
    this.running = true
    if (!this.paused) this.keys.attach()
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
    if (paused) this.keys.detach()
    else this.keys.attach()
  }

  /** Stands the player outside the building hosting `feature`, facing away from it. */
  placeAtDoor(feature: LobbyFeature): void {
    const exit = this.entrances.exitFor(this.area, feature)
    if (exit && !this.travel.active) this.placePlayer(exit)
  }

  setVirtualDir(dir: Dir | null): void {
    this.keys.virtualDir = dir
  }

  /**
   * Tap/click at a CSS-pixel point on the canvas. Tapping a Pokémon, NPC or
   * obstacle walks beside it (and talks); tapping ground walks there.
   */
  tap(cssX: number, cssY: number): void {
    if (this.travel.active || this.paused) return
    this.nav.goTo(this.player, this.entrances.retarget(this.area, this.renderer.pick(cssX, cssY)))
  }

  /** Press-and-drag retargeting: only re-plans when the finger moves to another tile. */
  drag(cssX: number, cssY: number): void {
    if (this.travel.active || this.paused) return
    const pick = this.renderer.pick(cssX, cssY)
    const current = this.nav.route(this.player).target
    if (!pick.tile || (current && current.tx === pick.tile.tx && current.ty === pick.tile.ty)) return
    this.nav.goTo(this.player, { tile: pick.tile, actor: null })
  }

  /** Starts a fade-out trip to another area. */
  travelTo(to: AreaId): void {
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
    const [dx, dy] = DIRS[this.player.dir]
    const tx = this.player.tx + dx
    const ty = this.player.ty + dy
    const other = this.populace.actors.find(a => a.tx === tx && a.ty === ty)
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
      this.say(this.area.name)
    })

    // Player (input is ignored mid-trip)
    const player = this.player
    const keyDir = this.travel.active || this.paused ? null : this.keys.direction
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

    // Wanderers
    this.populace.update(player.tx, player.ty)
    for (const actor of this.populace.actors) {
      wander(actor, this.seconds, this.rules)
      advance(actor, dt)
    }

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
    if (this.area.collect(tx, ty)) {
      this.crystals++
      this.say('+1 cristal · demo, no se guarda')
    }
    if (this.entrances.arrive(this.area, tx, ty)) this.nav.cancel()
    const to = this.travel.destinationAt(this.area, tx, ty)
    if (to) this.travelTo(to)
  }

  private scene(): Scene {
    return {
      area: this.area,
      fade: this.travel.fade(),
      camX: this.camX,
      camY: this.camY,
      lens: this.currentLens(),
      seconds: this.seconds,
      light: lighting(this.clock),
      weather: { kind: this.weather.kind, intensity: this.weather.intensity },
      player: this.player,
      actors: this.populace.actors,
      // The grid helps read procedural terrain; over town art it is noise.
      showGrid: this.showGrid && this.area.kind === 'wild',
      route: this.nav.route(this.player),
    }
  }

  private emitHud(): void {
    const p = this.player
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
