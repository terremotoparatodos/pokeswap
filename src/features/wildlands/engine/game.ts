// Game loop — WildLands prototype
//
// Owns the frame loop, input, camera, travel between areas and session-only
// state (clock, collected crystals). Everything here is cosmetic client state:
// no tokens, ownership or rewards are read or written.

import {
  actorPosition, advance, createActor, createWalkerState, DIRS, driveWalker, isMoving, RUN_SPEED, wander, WALK_SPEED,
  type Actor, type MoveRules,
} from './actors'
import { isPortalTile, portalAt, type Area, type AreaId, type Populace, type Portal } from './area'
import { DAY_SECONDS, lighting, type DayPhase, type WeatherKind } from './atmosphere'
import { devWarn, isDev } from '../../../shared/utils/devTools'
import { Atlas, LOBBY_ID } from '../areas/atlas'
import { loadTrainerSheet, NPC_HUE_SHIFTS, type Dir } from './characters'
import { TapNavigator } from './navigator'
import type { Tile } from './pathfinding'
import type { PokedexEntry } from './population'
import { lerpLens, LENSES, type CameraLens, type LensName } from './projection'
import { Renderer, type Scene } from './renderer'
import { TILE } from './world'

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
}

export interface GameOptions {
  pokedex: readonly PokedexEntry[]
  onHud: (hud: HudState) => void
  startArea?: AreaId
  spawn?: Tile | null
}

const LENS_ORDER: LensName[] = ['handheld', 'dramatic', 'cenital']
const KEY_DIRS: Record<string, Dir> = {
  ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down',
  ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
}
const OPPOSITE: Record<Dir, Dir> = { up: 'down', down: 'up', left: 'right', right: 'left' }
const TRAINER_LINES = [
  '«¡Qué calor hace por acá!»',
  '«Dicen que de noche aparecen cristales raros.»',
  '«Mi Pokémon se escapó hacia el agua…»',
  '«Estoy entrenando para el próximo swap.»',
]
const TOWN_LINES = [
  '«¿Ya elegiste a qué mundo ir hoy?»',
  '«Me encanta pasear por la plaza de las fuentes.»',
  '«El Salón de Concursos está cerrado por ahora.»',
  '«Vengo de la Costa Coral, ¡hay Pokémon nadando por todos lados!»',
]
/** Fade timeline for travelling, in seconds. */
const FADE_OUT = 0.35
const FADE_HOLD = 0.15
const FADE_IN = 0.4

export class WildlandsGame {
  private readonly atlas = new Atlas()
  private readonly renderer: Renderer
  private readonly player: Actor
  private readonly onHud: (hud: HudState) => void
  private readonly pokedex: readonly PokedexEntry[]
  private area!: Area
  private populace!: Populace
  private readonly held: Dir[] = []
  private virtualDir: Dir | null = null
  private sprinting = false
  private walker = createWalkerState()
  private readonly nav = new TapNavigator({
    isSolid: (tx, ty) => this.area.isSolid(tx, ty),
    occupied: (tx, ty) => this.populace.actors.some(a => a.tx === tx && a.ty === ty),
  })
  private travel: { to: AreaId; from: AreaId; t: number; swapped: boolean } | null = null
  private nearPortal: Portal | null = null
  private running = false
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
      // Only the player uses gates; wanderers keep them clear.
      if (actor.kind !== 'player' && isPortalTile(area, tx, ty)) return true
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
    const at = spawn && !area.isSolid(spawn.tx, spawn.ty) ? { ...spawn, dir: arrival.dir } : arrival
    const p = this.player
    p.tx = p.fromTx = at.tx
    p.ty = p.fromTy = at.ty
    p.progress = 1
    p.dir = at.dir
    p.bumping = false
    this.walker = createWalkerState()
    this.nav.cancel()
    this.nearPortal = portalNear(area, at.tx, at.ty)
    const pos = actorPosition(p)
    this.camX = pos.x
    this.camY = pos.y
    this.lensName = area.lens
    this.lensFrom = LENSES[area.lens]
    this.lensBlend = 1
    this.weather = { kind: 'clear', intensity: 0, target: 0 }
    this.weatherCheck = 0
  }

  start(): void {
    this.running = true
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    window.addEventListener('blur', this.clearKeys)
    this.last = performance.now()
    this.frameId = requestAnimationFrame(this.loop)
  }

  destroy(): void {
    this.running = false
    cancelAnimationFrame(this.frameId)
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    window.removeEventListener('blur', this.clearKeys)
  }

  setVirtualDir(dir: Dir | null): void {
    this.virtualDir = dir
  }

  /**
   * Tap/click at a CSS-pixel point on the canvas. Tapping a Pokémon, NPC or
   * obstacle walks beside it (and talks); tapping ground walks there.
   */
  tap(cssX: number, cssY: number): void {
    if (this.travel) return
    this.nav.goTo(this.player, this.renderer.pick(cssX, cssY))
  }

  /** Press-and-drag retargeting: only re-plans when the finger moves to another tile. */
  drag(cssX: number, cssY: number): void {
    if (this.travel) return
    const pick = this.renderer.pick(cssX, cssY)
    const current = this.nav.route(this.player).target
    if (!pick.tile || (current && current.tx === pick.tile.tx && current.ty === pick.tile.ty)) return
    this.nav.goTo(this.player, { tile: pick.tile, actor: null })
  }

  /** Starts a fade-out trip to another area. */
  travelTo(to: AreaId): void {
    if (this.travel || to === this.area.id) return
    this.nav.cancel()
    this.travel = { to, from: this.area.id, t: 0, swapped: false }
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
    const town = this.area.kind === 'town'
    const other = this.populace.actors.find(a => a.tx === tx && a.ty === ty)
    if (other?.pokemon) {
      other.dir = OPPOSITE[this.player.dir]
      other.nextThink = this.seconds + 3
      if (town) this.say(`${other.pokemon.name} te saluda contento.`)
      else if (other.pokemon.shiny) this.say(`✨ ¡Un ${other.pokemon.name} shiny salvaje! ✨`)
      else this.say(`¡Un ${other.pokemon.name} salvaje te mira fijo!`)
      return
    }
    if (other?.kind === 'npc') {
      other.dir = OPPOSITE[this.player.dir]
      other.nextThink = this.seconds + 3
      const lines = other.lines ?? (town ? TOWN_LINES : TRAINER_LINES)
      this.say(lines[Math.abs(tx * 7 + ty * 13) % lines.length])
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

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
    if (e.key === 'Shift') this.sprinting = true
    const dir = KEY_DIRS[e.code]
    if (dir) {
      e.preventDefault()
      if (!this.held.includes(dir)) this.held.push(dir)
      return
    }
    if (e.repeat) return
    // Alternate lenses are a development aid only; players always get each area's lens.
    if (e.code === 'KeyV' && isDev) this.cycleLens()
    else if (e.code === 'KeyG') this.toggleGrid()
    else if (e.code === 'KeyN') this.skipTime()
    else if (e.code === 'KeyE' || e.code === 'Space') { e.preventDefault(); this.interact() }
  }

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    const index = this.held.indexOf(KEY_DIRS[e.code])
    if (index >= 0) this.held.splice(index, 1)
    if (e.key === 'Shift') this.sprinting = false
  }

  private readonly clearKeys = (): void => {
    this.held.length = 0
    this.virtualDir = null
    this.sprinting = false
  }

  private readonly loop = (now: number): void => {
    if (!this.running) return
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
    this.updateTravel(dt)

    // Player (input is ignored mid-trip)
    const player = this.player
    const keyDir = this.travel ? null : (this.virtualDir ?? this.held[this.held.length - 1] ?? null)
    if (keyDir) this.nav.cancel() // Keyboard always wins over a tap route.
    const navigating = !keyDir && this.nav.active
    player.running = this.sprinting
    // Speed is latched per tile so a step never changes pace halfway through.
    if (!isMoving(player)) {
      player.speed = (this.sprinting ? RUN_SPEED : WALK_SPEED) * (this.area.isWater(player.tx, player.ty) ? 0.7 : 1)
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
      this.updatePortalHint()
      this.emitHud()
    }
  }

  private updateTravel(dt: number): void {
    const trip = this.travel
    if (!trip) return
    trip.t += dt
    if (!trip.swapped && trip.t >= FADE_OUT + FADE_HOLD / 2) {
      trip.swapped = true
      this.enterArea(trip.to, trip.from, null)
      this.say(this.area.name)
    }
    if (trip.t >= FADE_OUT + FADE_HOLD + FADE_IN) this.travel = null
  }

  private fadeAmount(): number {
    const trip = this.travel
    if (!trip) return 0
    if (trip.t < FADE_OUT) return trip.t / FADE_OUT
    if (trip.t < FADE_OUT + FADE_HOLD) return 1
    return Math.max(0, 1 - (trip.t - FADE_OUT - FADE_HOLD) / FADE_IN)
  }

  private onPlayerArrive(tx: number, ty: number): void {
    if (this.area.collect(tx, ty)) {
      this.crystals++
      this.say('+1 cristal · demo, no se guarda')
    }
    const portal = portalAt(this.area, tx, ty)
    if (portal) this.travelTo(portal.to)
  }

  /** Announces a gate once when the player walks up to it. */
  private updatePortalHint(): void {
    if (this.travel) return
    const near = portalNear(this.area, this.player.tx, this.player.ty)
    if (near && near !== this.nearPortal) this.say(near.label)
    this.nearPortal = near
  }

  private scene(): Scene {
    return {
      area: this.area,
      fade: this.fadeAmount(),
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
      traveling: this.travel !== null,
      fps: Math.round(this.fps),
      frameMs: Math.round(this.frameMs * 10) / 10,
    })
  }
}

function portalNear(area: Area, tx: number, ty: number): Portal | null {
  return area.portals.find(p => p.tiles.some(t => Math.abs(t.tx - tx) + Math.abs(t.ty - ty) <= 2)) ?? null
}
