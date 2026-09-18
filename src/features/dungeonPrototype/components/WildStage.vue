<script setup lang="ts">
// The dungeon, drawn by the real WildLands renderer (D1.2 §2, §4, §8, §17).
//
// This component owns nothing about the rules. It reads the session, keeps a
// scene in sync with it (one area per floor, one actor per Pokémon, the trainer
// always on screen) and hands that scene to `engine/renderer.ts` — the same
// renderer the overworld uses, unmodified.
//
// The fight happens here, on the floor: the foe is the actor that was already
// standing there, our Pokémon arrive by Poké Ball next to it, and the trainer
// stays put and watches.

import { computed, onMounted, onUnmounted, ref, shallowRef } from 'vue'
import { actorPosition, type Actor } from '../../wildlands/engine/actors'
import type { Dir } from '../../wildlands/engine/characters'
import { KeyboardInput } from '../../wildlands/engine/keyboard'
import { LENSES } from '../../wildlands/engine/projection'
import { Renderer, type Scene } from '../../wildlands/engine/renderer'
import type { PlaySession } from '../domain/playSession'
import { isWalkable } from '../domain/floorTiles'
import { isBossFloor } from '../domain/bossRoom'
import { blockedByObstacles, type MinableProp } from '../domain/obstacles'

/** Prop tiles the player has cleared: the area takes them off the floor. */
const clearedPropTiles = (props: readonly MinableProp[]): Set<string> =>
  new Set(props.filter(prop => prop.cleared).map(prop => prop.at.x + ':' + prop.at.y))
import { caveLight, DungeonWorld } from '../world/dungeonScene'
import { tileCentre } from '../world/dungeonArea'
import { chestSprite, doorSprite, obstacleSprite, stairsSprite, torchSprite } from '../world/dungeonProps'
import {
  burst, createWorldOverlay,
  type StatusMark, type WorldBar, type WorldEffect, type WorldProp, type WorldText,
} from '../render/worldOverlay'
import { speciesFrames } from '../render/dungeonSprites'

const props = defineProps<{ session: PlaySession | null; pad?: boolean }>()
const emit = defineEmits<{
  (event: 'arrive', tx: number, ty: number): void
  (event: 'interact'): void
}>()

const canvas = ref<HTMLCanvasElement | null>(null)
const renderer = shallowRef<Renderer | null>(null)
const world = shallowRef<DungeonWorld | null>(null)

let frame = 0
let last = 0
let clock = 0
/** The floor the scene was built from; a new one means a new area. */
let builtFrom: unknown = null
/** When each ally's sprite becomes visible: its Ball has to land first. */
const revealAt = new Map<string, number>()

const effects: WorldEffect[] = []
const texts: WorldText[] = []

const BALL_FLIGHT = 0.36
/** The soft light an unclaimed chest and an open stairway give off (§6, §7). */
const GLOW = burst('#ffd98a', 10)

// ── What the overlay reads each frame ──────────────────────────────────────

function combatBars(): WorldBar[] {
  const live = props.session
  const scene = world.value
  if (!live?.battle || !scene) return []
  const out: WorldBar[] = []
  for (const actor of live.battle.actors) {
    const pokemon = actor.combatant.pokemon
    const spot = actor.side === 'ally' ? scene.allyActor(actor.id) : foeActor()
    if (!spot) continue
    // A Pokémon inside a ball has no bar to show.
    if (actor.side === 'enemy' && live.battle.throw) continue
    const at = actorPosition(spot)
    // The Alpha is the Alpha whichever way the fight started.
    const alpha = actor.side === 'enemy' && spot === scene.alphaActor
    out.push({
      wx: at.x,
      wy: at.y,
      hp: Math.max(0, pokemon.hp) / pokemon.maxHp,
      action: actor.bar > 0.02 ? actor.bar : null,
      status: pokemon.status === 'none' ? null : (pokemon.status as StatusMark),
      confused: pokemon.confusedFor > 0,
      alpha,
      scale: alpha ? 2 : 1,
      // Sit just above the art, whatever the species and whatever the scale.
      lift: spriteHeight(spot) * (alpha ? 2 : 1) + 6,
    })
  }
  return out
}

/** Visible height of an actor's current frame, in world pixels. */
function spriteHeight(actor: Actor): number {
  const frames = actor.pokemon?.frames[actor.dir]
  const sprite = frames?.[0]
  return sprite ? sprite.ay - (sprite.top ?? 0) : 16
}

/** The one visual entity for the foe — never a second copy of it. */
function foeActor(): Actor | null {
  const live = props.session
  const scene = world.value
  if (!live || !scene) return null
  if (live.phase === 'boss') return scene.alphaActor
  return live.engagedId ? scene.wildActor(live.engagedId) ?? null : null
}

function overlayProps(): WorldProp[] {
  const live = props.session
  const scene = world.value
  if (!live || !scene) return []
  const out: WorldProp[] = []

  for (const entity of live.entities) {
    if (entity.kind !== 'chest') continue
    const at = tileCentre(entity.at.x, entity.at.y)
    // D1.2.2 §6: an unopened chest breathes a little light, so it can be found
    // from across a hall. An opened one goes quiet.
    if (!entity.taken) {
      const pulse = 0.35 + Math.sin(clock * 1.6 + entity.at.x * 0.7) * 0.22
      out.push({ wx: at.x, wy: at.y, sprite: GLOW, lift: 7, scale: 1 + pulse * 0.4, alpha: Math.max(0, pulse), depthBias: -1 })
    }
    out.push({ wx: at.x, wy: at.y, sprite: chestSprite(entity.taken) })
  }

  // Rockfalls and barricades: solid until somebody breaks them (D1.2.4 §1).
  for (const obstacle of live.obstacles) {
    if (obstacle.cleared) continue
    // One block, one tile (D1.2.4ter §4).
    const at = tileCentre(obstacle.at.x, obstacle.at.y)
    out.push({ wx: at.x, wy: at.y, sprite: obstacleSprite(obstacle.kind) })
  }

  const boss = isBossFloor(live.tiles) ? live.tiles.boss : null
  if (boss) {
    // The Boss Room's door: shut while we are still outside, open once we have
    // committed, shut again behind us when the fight starts (§13, §16).
    const at = tileCentre(boss.door.x, boss.door.y)
    out.push({ wx: at.x, wy: at.y, sprite: doorSprite(live.phase === 'antechamber'), depthBias: -2 })
  } else {
    // The way down: a landing cut into the floor, sealed until the key drops (§7).
    const exit = tileCentre(live.tiles.exit.x, live.tiles.exit.y)
    const unlocked = live.expedition.key.hasKey
    out.push({ wx: exit.x, wy: exit.y, sprite: stairsSprite(unlocked), depthBias: -4 })
    if (unlocked) {
      const pulse = 0.3 + Math.sin(clock * 2.2) * 0.2
      out.push({ wx: exit.x, wy: exit.y, sprite: GLOW, lift: 3, scale: 1.4, alpha: Math.max(0, pulse * 0.7), depthBias: -3 })
    }
  }

  // The Alpha is drawn here, at twice the scale, instead of as a plain actor.
  const alpha = scene.alphaActor
  if (alpha?.pokemon) {
    const at = actorPosition(alpha)
    const cycle = speciesFrames(alpha.pokemon.id)[alpha.dir]
    out.push({ wx: at.x, wy: at.y, sprite: cycle[Math.floor(clock * 1.6) % cycle.length], scale: 2, depthBias: 2 })
  }
  return out
}

const source = {
  seconds: () => clock,
  bars: combatBars,
  effects: () => effects,
  texts: () => texts,
  props: overlayProps,
  torch: torchSprite,
}
const overlay = createWorldOverlay(source)

// ── Public surface ─────────────────────────────────────────────────────────

function spawn(effect: Omit<WorldEffect, 'bornAt'> & { bornAt?: number }): void {
  effects.push({ ...effect, bornAt: effect.bornAt ?? clock })
}

function say(text: Omit<WorldText, 'bornAt'> & { bornAt?: number }): void {
  texts.push({ ...text, bornAt: text.bornAt ?? clock })
}

/** World-pixel anchor of a battle actor, so the parent can aim its effects. */
function anchorOf(actorId: string): { x: number; y: number } | null {
  const scene = world.value
  if (!scene) return null
  const actor = scene.allyActor(actorId) ?? (actorId.startsWith('enemy') ? foeActor() : null)
  return actor ? actorPosition(actor) : null
}

function clearEffects(): void {
  effects.length = 0
  texts.length = 0
}

const now = (): number => clock

defineExpose({ spawn, say, anchorOf, clearEffects, now })

// ── Input ──────────────────────────────────────────────────────────────────

// D1.2.1 §4: the overworld's own input object, not a copy of it. Held keys
// stack and the last one wins, Shift runs, and the d-pad feeds `virtualDir`
// exactly as it does in WildLands.
const keys = new KeyboardInput({
  cycleLens: () => undefined,
  toggleGrid: () => undefined,
  skipTime: () => undefined,
  interact: () => emit('interact'),
})

const press = (dir: Dir): void => { keys.virtualDir = dir }
const release = (): void => { keys.virtualDir = null }

// Sprint on a phone (§3): the least invasive option is one button that behaves
// like the Shift key — held, not toggled, so it cannot be left on by accident.
const running = ref(false)
const holdRun = (on: boolean): void => {
  running.value = on
  keys.sprinting = on
}

/** Click or tap the ground to walk there (§4). */
function onTap(event: PointerEvent): void {
  const engine = renderer.value
  const scene = world.value
  const element = canvas.value
  if (!engine || !scene || !element) return
  if (props.session?.phase !== 'exploring') return
  const rect = element.getBoundingClientRect()
  scene.goTo(engine.pick(event.clientX - rect.left, event.clientY - rect.top))
}

// ── Frame ──────────────────────────────────────────────────────────────────

function syncFloor(live: PlaySession): DungeonWorld | null {
  const engine = renderer.value
  if (!engine) return null
  if (!world.value) {
    world.value = new DungeonWorld(
      engine.playerSprites, live.tiles, live.entities, live.player, live.expedition.seed, live.expedition.floor,
    )
    builtFrom = live.tiles
  } else if (builtFrom !== live.tiles) {
    world.value.loadFloor(live.tiles, live.entities, live.player, live.expedition.seed, live.expedition.floor)
    builtFrom = live.tiles
    revealAt.clear()
    clearEffects()
  }
  // The rules can move the player without the scene having walked there — a DEV
  // teleport does exactly that. When the session says we are somewhere else and
  // we are not mid-step, follow it.
  const scene = world.value
  const settled = scene.player.progress >= 1 && !scene.locked
  if (settled && (scene.player.tx !== live.player.x || scene.player.ty !== live.player.y)) {
    scene.place(live.player)
  }
  // Never leave the trainer standing inside a Pokémon (the Alpha owns the stairs).
  const stepped = scene.stepOffOccupied(live.tiles)
  if (stepped) emit('arrive', stepped.x, stepped.y)
  return scene
}

/**
 * D1.2.3 §3: a switch used to be invisible — the sprite kept fighting as the
 * Pokémon that left. This watches the battle rather than the log: whenever the
 * species on an ally slot stops matching the sprite standing there, the sprite
 * is recalled and the newcomer comes out of its Ball on the same tile.
 */
function syncSwitches(live: PlaySession, scene: DungeonWorld): void {
  if (!live.battle) return
  for (const actor of live.battle.actors) {
    if (actor.side !== 'ally') continue
    const sprite = scene.allyActor(actor.id)
    const speciesId = actor.combatant.pokemon.speciesId
    if (!sprite?.pokemon || sprite.pokemon.id === speciesId) continue
    const at = actorPosition(sprite)
    scene.swapAlly(actor.id, speciesId)
    revealAt.set(actor.id, clock + 0.3)
    spawn({ kind: 'recall', wx: at.x, wy: at.y, life: 0.3 })
    spawn({ kind: 'open', wx: at.x, wy: at.y, bornAt: clock + 0.3, life: 0.25 })
    spawn({ kind: 'summon', wx: at.x, wy: at.y, bornAt: clock + 0.3, life: 0.45 })
  }
}

/** Sends our side out by Ball when a fight starts, and recalls it when it ends. */
function syncCombat(live: PlaySession, scene: DungeonWorld): void {
  const fighting = live.phase === 'combat' || live.phase === 'boss'
  if (!fighting) {
    if (scene.allyActors.length) {
      for (const ally of scene.allyActors) {
        const at = actorPosition(ally)
        spawn({ kind: 'recall', wx: at.x, wy: at.y, life: 0.4 })
      }
      scene.closeCombat(null)
      revealAt.clear()
    }
    return
  }
  if (!live.battle || scene.allyActors.length) return

  const allies = live.battle.actors
    .filter(actor => actor.side === 'ally')
    .map(actor => ({ combatantId: actor.id, speciesId: actor.combatant.pokemon.speciesId }))
  if (!allies.length) return

  const foeId = live.phase === 'boss'
    ? live.entities.find(entity => entity.isAlpha && !entity.taken)?.id ?? ''
    : live.engagedId ?? ''
  const staged = scene.openCombat(live.tiles, foeId, allies)
  const from = actorPosition(scene.player)
  staged.spots.forEach((spot, index) => {
    const target = tileCentre(spot.x, spot.y)
    const at = clock + index * 0.18
    spawn({ kind: 'ball', wx: from.x, wy: from.y - 8, toX: target.x, toY: target.y, bornAt: at, life: BALL_FLIGHT })
    spawn({ kind: 'open', wx: target.x, wy: target.y, bornAt: at + BALL_FLIGHT, life: 0.3 })
    spawn({ kind: 'summon', wx: target.x, wy: target.y, bornAt: at + BALL_FLIGHT, life: 0.45 })
    revealAt.set(allies[index].combatantId, at + BALL_FLIGHT)
  })
}

function loop(time: number): void {
  frame = requestAnimationFrame(loop)
  const engine = renderer.value
  const live = props.session
  const dt = Math.min(0.05, last ? (time - last) / 1000 : 0)
  last = time
  clock += dt
  if (!engine || !live) return

  const scene = syncFloor(live)
  if (!scene) return
  scene.syncWild(live.entities)
  scene.setSealed(blockedByObstacles(live.obstacles))
  scene.clearProps(clearedPropTiles(live.minable))
  scene.refreshFrames()
  syncCombat(live, scene)
  scene.locked = live.phase !== 'exploring'

  scene.update(dt, live.tiles, keys.direction, (tx, ty) => emit('arrive', tx, ty), keys.sprinting)
  // A tap route that ended beside something is the same as pressing E there.
  if (scene.arrivedAtTarget) emit('interact')
  syncSwitches(live, scene)
  // DEV probe: /dev/dungeon only exists in development, and this is how the
  // scene is inspected from the console during a visual QA pass.
  if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__dungeon = { scene, live }

  // Effects and floating text expire on their own.
  for (let i = effects.length - 1; i >= 0; i--) if (clock - effects[i].bornAt > effects[i].life) effects.splice(i, 1)
  for (let i = texts.length - 1; i >= 0; i--) if (clock - texts[i].bornAt > texts[i].life) texts.splice(i, 1)

  // While a ball is in the air the wild Pokémon is inside it: only the ball is
  // on screen, and its bar goes with it (D1.2.4 §2).
  const swallowed = live.battle?.throw ? foeActor() : null
  const actors = scene.actors().filter(actor => {
    if (actor === swallowed) return false
    const reveal = revealAt.get(actor.id.replace(/^ally-/, ''))
    return reveal === undefined || clock >= reveal
  })

  const frameScene: Scene = {
    area: scene.area,
    fade: 0,
    camX: scene.camX,
    camY: scene.camY,
    lens: LENSES[scene.area.lens],
    seconds: clock,
    light: caveLight(live.tiles.theme),
    weather: { kind: 'clear', intensity: 0 },
    player: scene.player,
    companion: null,
    username: null,
    showPlayer: true,
    actors,
    showGrid: false,
    route: scene.route(),
    overlay,
  }
  engine.render(frameScene, dt)
}

onMounted(() => {
  if (canvas.value) renderer.value = new Renderer(canvas.value)
  keys.attach()
  frame = requestAnimationFrame(loop)
})

onUnmounted(() => {
  cancelAnimationFrame(frame)
  keys.detach()
})

const walkable = computed(() => {
  const live = props.session
  const scene = world.value
  if (!live || !scene) return { up: false, down: false, left: false, right: false }
  const { tx, ty } = scene.player
  return {
    up: isWalkable(live.tiles, tx, ty - 1),
    down: isWalkable(live.tiles, tx, ty + 1),
    left: isWalkable(live.tiles, tx - 1, ty),
    right: isWalkable(live.tiles, tx + 1, ty),
  }
})
</script>

<template>
  <div class="ws">
    <canvas ref="canvas" class="ws-canvas" @pointerdown="onTap" />
    <div v-if="pad" class="ws-pad">
      <button
        type="button" class="ws-key ws-up" :class="{ 'ws-key--off': !walkable.up }"
        @pointerdown.prevent="press('up')" @pointerup="release" @pointerleave="release"
      >▲</button>
      <button
        type="button" class="ws-key ws-left" :class="{ 'ws-key--off': !walkable.left }"
        @pointerdown.prevent="press('left')" @pointerup="release" @pointerleave="release"
      >◀</button>
      <button
        type="button" class="ws-key ws-right" :class="{ 'ws-key--off': !walkable.right }"
        @pointerdown.prevent="press('right')" @pointerup="release" @pointerleave="release"
      >▶</button>
      <button
        type="button" class="ws-key ws-down" :class="{ 'ws-key--off': !walkable.down }"
        @pointerdown.prevent="press('down')" @pointerup="release" @pointerleave="release"
      >▼</button>
    </div>
    <!-- Sprint on a phone: held like Shift, never a toggle (§3). -->
    <button
      v-if="pad" type="button" class="ws-run" :class="{ 'ws-run--on': running }"
      @pointerdown.prevent="holdRun(true)" @pointerup="holdRun(false)"
      @pointerleave="holdRun(false)" @pointercancel="holdRun(false)"
    >CORRER</button>
    <slot />
  </div>
</template>

<style scoped>
.ws { position: relative; overflow: hidden; border-radius: 12px; background: #0a0d16; }
.ws-canvas { display: block; width: 100%; height: 100%; image-rendering: pixelated; }

.ws-pad {
  position: absolute; bottom: 10px; left: 10px;
  display: grid; grid-template-columns: repeat(3, 44px); grid-template-rows: repeat(3, 44px);
  opacity: 0.85;
}
.ws-key {
  width: 44px; height: 44px; border: 1px solid rgba(255, 255, 255, 0.22); border-radius: 10px;
  background: rgba(10, 16, 30, 0.55); color: #e8eeff; font-size: 0.95rem; line-height: 1; cursor: pointer;
  touch-action: none; user-select: none;
}
.ws-key--off { opacity: 0.35; }
.ws-run {
  position: absolute; right: 12px; bottom: 14px;
  min-width: 64px; min-height: 44px; padding: 0 12px;
  border: 1px solid rgba(255, 255, 255, 0.22); border-radius: 12px;
  background: rgba(10, 16, 30, 0.55); color: #e8eeff;
  font: inherit; font-size: 0.66rem; font-weight: 700; letter-spacing: 0.08em;
  cursor: pointer; touch-action: none; user-select: none;
}
.ws-run--on { border-color: #ffd27a; background: rgba(60, 44, 10, 0.75); color: #ffd27a; }
.ws-up { grid-area: 1 / 2; }
.ws-left { grid-area: 2 / 1; }
.ws-right { grid-area: 2 / 3; }
.ws-down { grid-area: 3 / 2; }

@media (max-width: 420px) {
  .ws-pad { grid-template-columns: repeat(3, 48px); grid-template-rows: repeat(3, 48px); }
  .ws-key { width: 48px; height: 48px; }
}
</style>
