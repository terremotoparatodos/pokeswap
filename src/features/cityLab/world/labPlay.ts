// City Mapping Lab — PLAY MODE (DEV only).
//
// Walks the working copy the way `engine/game.ts` walks Ciudad Corazón: the
// same player actor and character sheet, the same walker (speed latched per
// tile, Shift to run), the same tap navigator with doors retargeted by
// `Entrances`, the same town populace (standing residents and wanderers), and
// the same camera lock. `game.ts` itself can't be pointed at a working copy —
// its atlas is private and always builds the production town — so this runs
// the same parts in the same order, like the dungeon lab does (dungeonScene.ts).
//
// What it does not do, on purpose: travel through gates, open feature panels,
// talk to presence or persist anything. Stepping on a door or a gate says
// where it would lead.

import {
  actorPosition, advance, createActor, createWalkerState, DIRS, driveWalker, isMoving, RUN_SPEED, wander, WALK_SPEED,
  type Actor, type MoveRules,
} from '../../wildlands/engine/actors'
import { isPortalTile, portalAt, type Area, type Populace } from '../../wildlands/engine/area'
import type { Dir, TrainerSprites } from '../../wildlands/engine/characters'
import { actorLine } from '../../wildlands/engine/dialogue'
import { Entrances } from '../../wildlands/engine/doors'
import { TapNavigator } from '../../wildlands/engine/navigator'
import { PlayerAppearance } from '../../wildlands/engine/playerAppearance'
import type { Pick, RouteMarker } from '../../wildlands/engine/renderer'
import { TILE } from '../../wildlands/engine/world'
import { DEFAULT_PLAYER_CHARACTER_ID, playerCharacter } from '../../wildlands/identity/playerCharacters'
import type { LabTownArea } from './labTownArea'

const OPPOSITE: Record<Dir, Dir> = { up: 'down', down: 'up', left: 'right', right: 'left' }

export class LabPlay {
  readonly player: Actor
  readonly populace: Populace
  private walker = createWalkerState()
  private readonly entrances: Entrances
  private readonly nav: TapNavigator
  seconds = 0
  camX = 0
  camY = 0
  toast: { text: string; until: number } | null = null

  constructor(readonly area: LabTownArea, start: { tx: number; ty: number; dir: Dir }, playerSprites: TrainerSprites, npcSprites: TrainerSprites[]) {
    this.player = createActor({ id: 'player', kind: 'player', habitat: 'any', tx: start.tx, ty: start.ty, dir: start.dir, trainer: playerSprites })
    // The same sheet the overworld loads onto the player (its async load keeps the actor alive).
    new PlayerAppearance(this.player, playerSprites).set(playerCharacter(DEFAULT_PLAYER_CHARACTER_ID))
    this.populace = area.createPopulace({ pokedex: [], npcSprites })
    this.entrances = new Entrances(door => this.say(`Entrarías a ${door.buildingId} → panel "${door.feature}" (el lab no abre paneles).`))
    this.nav = new TapNavigator({
      isSolid: (tx, ty) => area.isSolid(tx, ty),
      occupied: (tx, ty) => this.populace.actors.some(a => a.tx === tx && a.ty === ty),
    })
    const home = actorPosition(this.player)
    this.camX = home.x
    this.camY = home.y
  }

  /** Same rules as `WildlandsGame.rules`: only the player uses gates and doors. */
  private readonly rules: MoveRules = {
    blocked: (actor, tx, ty) => {
      if (this.area.isSolid(tx, ty)) return true
      if (actor.kind !== 'player' && (isPortalTile(this.area, tx, ty) || this.entrances.isDoor(this.area, tx, ty))) return true
      if (actor.habitat === 'any') return false
      return (this.area as Area).isWater(tx, ty) !== (actor.habitat === 'water')
    },
    occupied: (tx, ty, self) => {
      for (const a of [this.player, ...this.populace.actors]) if (a !== self && a.tx === tx && a.ty === ty) return true
      return false
    },
  }

  get route(): RouteMarker {
    return this.nav.route(this.player)
  }

  tap(pick: Pick): void {
    this.nav.goTo(this.player, this.entrances.retarget(this.area, pick))
  }

  interact(): void {
    const [dx, dy] = DIRS[this.player.dir]
    const tx = this.player.tx + dx
    const ty = this.player.ty + dy
    const other = this.populace.actors.find(a => a.tx === tx && a.ty === ty)
    const said = other ? actorLine(other, true, tx, ty) : null
    if (other && said) {
      other.dir = OPPOSITE[this.player.dir]
      other.nextThink = this.seconds + 3
      this.say(said)
      return
    }
    if (this.area.noticeBoardAt(tx, ty)) {
      this.say('Tablón de actividad (el lab no abre paneles).')
      return
    }
    const line = this.area.talkAt(tx, ty)
    if (line) this.say(line)
  }

  say(text: string): void {
    this.toast = { text, until: this.seconds + 3.2 }
  }

  update(dt: number, keyDir: Dir | null, sprinting: boolean): void {
    this.seconds += dt
    const player = this.player
    if (keyDir) this.nav.cancel()
    const navigating = !keyDir && this.nav.active
    player.running = sprinting
    if (!isMoving(player)) player.speed = sprinting ? RUN_SPEED : WALK_SPEED
    driveWalker(player, navigating ? this.nav.next : keyDir, dt, this.rules, this.walker, (tx, ty) => {
      if (navigating) this.nav.arrived()
      this.arrive(tx, ty)
    }, navigating)
    if (this.nav.update(player, dt)) this.interact()

    this.populace.update(player.tx, player.ty)
    for (const actor of this.populace.actors) {
      wander(actor, this.seconds, this.rules)
      advance(actor, dt)
    }

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
    if (this.toast && this.seconds > this.toast.until) this.toast = null
  }

  private arrive(tx: number, ty: number): void {
    if (this.entrances.arrive(this.area, tx, ty)) {
      this.nav.cancel()
      return
    }
    const portal = portalAt(this.area, tx, ty)
    if (portal) this.say(`${portal.label} (en el lab no se viaja).`)
  }

  get position(): { tx: number; ty: number } {
    return { tx: this.player.tx, ty: this.player.ty }
  }
}
