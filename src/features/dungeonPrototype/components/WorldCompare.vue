<script setup lang="ts">
// "Do they look like the same game?" (D1.2.1 §16)
//
// Two viewports of exactly the same size, one showing a stretch of the real
// WildLands generator and one showing a dungeon floor. One player actor each,
// built the same way, with the same character sheet. One camera rule. One set
// of keys driving **both** at once, so any difference in scale, projection,
// pace or feel shows up as the two halves disagreeing.
//
// A development aid, not a feature.

import { onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'
import {
  actorPosition, advance, createActor, createWalkerState, driveWalker, isMoving,
  RUN_SPEED, WALK_SPEED, type Actor,
} from '../../wildlands/engine/actors'
import type { Area } from '../../wildlands/engine/area'
import { lighting } from '../../wildlands/engine/atmosphere'
import { KeyboardInput } from '../../wildlands/engine/keyboard'
import { PlayerAppearance } from '../../wildlands/engine/playerAppearance'
import { LENSES } from '../../wildlands/engine/projection'
import { Renderer, type Scene } from '../../wildlands/engine/renderer'
import { TILE } from '../../wildlands/engine/world'
import { DEFAULT_PLAYER_CHARACTER_ID, playerCharacter } from '../../wildlands/identity/playerCharacters'
import { generateFloor } from '../domain/floorPlan'
import { buildFloorTiles, openWidth, PATH_WIDTH, type FloorTiles } from '../domain/floorTiles'
import { dungeonProfile, DUNGEON_THEMES, type DungeonTheme } from '../domain/tiers'
import { caveLight } from '../world/dungeonScene'
import { DungeonArea } from '../world/dungeonArea'
import { SampleArea } from '../world/sampleArea'

const props = defineProps<{ theme?: DungeonTheme; seed?: number }>()

const theme = ref<DungeonTheme>(props.theme ?? 'cave')
const seed = ref(props.seed ?? 4242)

const left = ref<HTMLCanvasElement | null>(null)
const right = ref<HTMLCanvasElement | null>(null)
const stats = ref({ tiles: 0, walkable: 0, narrow: 0, median: 0 })

interface Side {
  renderer: Renderer
  area: Area
  player: Actor
  walker: ReturnType<typeof createWalkerState>
  camX: number
  camY: number
  cave: boolean
}

const sides = shallowRef<Side[]>([])
const keys = new KeyboardInput({
  cycleLens: () => undefined, toggleGrid: () => undefined, skipTime: () => undefined, interact: () => undefined,
})

let frame = 0
let last = 0
let seconds = 0

function makeSide(canvas: HTMLCanvasElement, area: Area, cave: boolean): Side {
  const renderer = new Renderer(canvas)
  const start = area.arrival(null)
  const player = createActor({
    id: 'player', kind: 'player', habitat: 'any', tx: start.tx, ty: start.ty, trainer: renderer.playerSprites,
  })
  new PlayerAppearance(player, renderer.playerSprites).set(playerCharacter(DEFAULT_PLAYER_CHARACTER_ID))
  const home = actorPosition(player)
  return { renderer, area, player, walker: createWalkerState(), camX: home.x, camY: home.y, cave }
}

/** How much clear ground the floor actually offers, in tiles. */
function measure(tiles: FloorTiles): void {
  const widths: number[] = []
  let narrow = 0
  for (let y = 0; y < tiles.height; y += 2) {
    for (let x = 0; x < tiles.width; x += 2) {
      const width = openWidth(tiles, x, y)
      if (!width) continue
      widths.push(width)
      if (width < PATH_WIDTH.side) narrow++
    }
  }
  widths.sort((a, b) => a - b)
  stats.value = {
    tiles: tiles.width * tiles.height,
    walkable: widths.length,
    narrow,
    median: widths[Math.floor(widths.length / 2)] ?? 0,
  }
}

function loop(time: number): void {
  frame = requestAnimationFrame(loop)
  const dt = Math.min(0.05, last ? (time - last) / 1000 : 0)
  last = time
  seconds += dt

  for (const side of sides.value) {
    const player = side.player
    player.running = keys.sprinting
    if (!isMoving(player)) {
      player.speed = (keys.sprinting ? RUN_SPEED : WALK_SPEED) * (side.area.isWater(player.tx, player.ty) ? 0.7 : 1)
    }
    driveWalker(player, keys.direction, dt, {
      blocked: (_actor, tx, ty) => side.area.isSolid(tx, ty),
      occupied: () => false,
    }, side.walker)
    advance(player, dt)

    const target = actorPosition(player)
    if (Math.hypot(target.x - side.camX, target.y - side.camY) > TILE * 3) {
      const follow = 1 - Math.exp(-dt * 10)
      side.camX += (target.x - side.camX) * follow
      side.camY += (target.y - side.camY) * follow
    } else {
      side.camX = target.x
      side.camY = target.y
    }

    const scene: Scene = {
      area: side.area,
      fade: 0,
      camX: side.camX,
      camY: side.camY,
      lens: LENSES[side.area.lens],
      seconds,
      light: side.cave ? caveLight(theme.value) : lighting(0.5),
      weather: { kind: 'clear', intensity: 0 },
      player,
      companion: null,
      username: null,
      showPlayer: true,
      actors: [],
      showGrid: false,
      route: { tiles: [], target: null, rejected: null },
      overlay: null,
    }
    side.renderer.render(scene, dt)
  }
}

function build(): void {
  if (!left.value || !right.value) return
  const plan = generateFloor(dungeonProfile(seed.value, 'B', theme.value), 3, [4, 7, 25])
  const tiles = buildFloorTiles(plan, theme.value, seed.value)
  measure(tiles)
  sides.value = [
    makeSide(left.value, new SampleArea(seed.value), false),
    makeSide(right.value, new DungeonArea(tiles, seed.value, 3), true),
  ]
}

const reroll = (): void => { seed.value = Math.floor(Math.random() * 100000); build() }

watch(theme, build)

onMounted(() => {
  build()
  keys.attach()
  frame = requestAnimationFrame(loop)
})

onUnmounted(() => {
  cancelAnimationFrame(frame)
  keys.detach()
})
</script>

<template>
  <section class="wc">
    <p class="wc-hint">
      Las flechas mueven a los dos a la vez · Shift corre · misma cámara, mismo jugador, misma escala.
    </p>
    <div class="wc-controls">
      <button
        v-for="option in DUNGEON_THEMES" :key="option" type="button"
        :class="{ 'wc-on': theme === option }" @click="theme = option"
      >{{ option }}</button>
      <button type="button" @click="reroll">Otra seed</button>
    </div>
    <div class="wc-grid">
      <figure>
        <figcaption>WildLands</figcaption>
        <canvas ref="left" />
      </figure>
      <figure>
        <figcaption>Dungeon · {{ theme }}</figcaption>
        <canvas ref="right" />
      </figure>
    </div>
    <p class="wc-stats">
      Piso: {{ stats.walkable }} muestras transitables · ancho mediano
      <b>{{ stats.median }}</b> tiles · por debajo de {{ PATH_WIDTH.side }}:
      <b>{{ stats.narrow }}</b> ({{ stats.walkable ? Math.round((stats.narrow / stats.walkable) * 100) : 0 }} %)
    </p>
  </section>
</template>

<style scoped>
.wc { display: grid; gap: 8px; }
.wc-hint, .wc-stats { margin: 0; font-size: 0.72rem; color: #93a2c6; }
.wc-stats b { color: #ffd27a; }
.wc-controls { display: flex; flex-wrap: wrap; gap: 4px; }
.wc-controls button {
  padding: 5px 9px; border: 1px solid #2b3a5e; border-radius: 7px; background: #16203a;
  color: #cfe0ff; font: inherit; font-size: 0.68rem; cursor: pointer;
}
.wc-controls .wc-on { border-color: #d9a441; color: #ffe2a8; }
.wc-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
figure { display: grid; gap: 4px; margin: 0; }
figcaption {
  font-size: 0.68rem; font-weight: 700; letter-spacing: 0.08em;
  color: #6b7ba8; text-transform: uppercase;
}
canvas {
  display: block; width: 100%; height: min(42vh, 360px);
  border-radius: 10px; background: #0a0d16; image-rendering: pixelated;
}

@media (max-width: 720px) {
  .wc-grid { grid-template-columns: 1fr; }
  canvas { height: 34vh; }
}
</style>
