<template>
  <section class="svl">
    <header class="svl-head">
      <div>
        <p class="svl-kicker">HERRAMIENTA INTERNA · SOLO EN DESARROLLO</p>
        <h1>Station Visual Lab</h1>
      </div>
      <span class="svl-badge">T-S3.1 · sólo arte · nada conectado a gameplay</span>
    </header>

    <nav class="svl-tabs">
      <button
        v-for="tab in TABS" :key="tab.id" type="button"
        class="svl-tab" :class="{ 'svl-tab--on': view === tab.id }"
        @click="view = tab.id"
      >{{ tab.label }}</button>
    </nav>

    <div class="svl-controls">
      <span class="svl-label">Estado</span>
      <button
        v-for="state in STATION_STATES" :key="state" type="button"
        class="svl-chip" :class="{ 'svl-chip--on': allState === state }"
        @click="setAll(state)"
      >{{ state }}</button>
      <span class="svl-sep" />
      <button type="button" class="svl-chip" :class="{ 'svl-chip--on': playing }" @click="playing = !playing">
        {{ playing ? '⏸ animación' : '▶ animación' }}
      </button>
      <button type="button" class="svl-chip" :disabled="playing" @click="step()">
        frame {{ frame }} / 3
      </button>
      <span class="svl-sep" />
      <label class="svl-zoom">
        <span>Zoom ×{{ zoom }}</span>
        <input v-model.number="zoom" type="range" min="1" max="6" step="1">
      </label>
    </div>

    <!-- Per-station override, so two can be compared in different states. -->
    <div class="svl-controls svl-controls--rows">
      <div v-for="entry in ENTRIES" :key="entry.id" class="svl-row">
        <span class="svl-name">{{ entry.label }}</span>
        <button
          v-for="state in STATION_STATES" :key="state" type="button"
          class="svl-chip svl-chip--sm" :class="{ 'svl-chip--on': states[entry.id] === state }"
          @click="states[entry.id] = state"
        >{{ state }}</button>
      </div>
    </div>

    <!-- 1 · Real world data: real terrain, real solid props, real tile scale. -->
    <div v-show="view === 'world'" class="svl-stage svl-stage--flat">
      <canvas ref="worldRef" class="svl-canvas svl-canvas--flat" aria-label="Las cuatro estaciones sobre el terreno real de Pradera Brisa" />
      <p class="svl-hint">
        Terreno real de Pradera Brisa (semilla {{ PRADERA_SEED }}): mismos biomas, misma agua y mismos props sólidos
        que genera el mundo, en la misma cuadrícula de {{ TILE }} px. Lo pinta este lab, no el renderer del juego
        (ver la nota al pie). Los cuadros sombreados son tiles con prop sólido; las estaciones no colisionan con nada.
      </p>
    </div>

    <!-- 2 · Side by side on a neutral ground line, with a tile ruler. -->
    <div v-show="view === 'compare'" class="svl-stage svl-stage--flat">
      <canvas ref="compareRef" class="svl-canvas svl-canvas--flat" aria-label="Las cuatro estaciones alineadas por su anclaje sobre una línea de suelo, con una regla de tiles" />
      <p class="svl-hint">
        Alineadas por el anclaje sobre una línea de suelo común. Cada marca de la regla es un tile ({{ TILE }} px);
        la barra azul bajo cada una es su ancho de arte y la marca ámbar, su anclaje.
      </p>
    </div>

    <!-- 3 · The state matrix: four stations × four states. -->
    <div v-show="view === 'states'" class="svl-stage svl-stage--flat">
      <canvas ref="matrixRef" class="svl-canvas svl-canvas--flat" aria-label="Matriz de las cuatro estaciones en sus cuatro estados" />
      <p class="svl-hint">
        Una fila por estación, una columna por estado. El frame de <code>working</code> avanza con la animación.
      </p>
    </div>

    <table class="svl-table">
      <thead>
        <tr><th>Estación</th><th>Ancho</th><th>Alto</th><th>Anchor</th><th>Tiles de ancho</th><th>Tiles de alto</th></tr>
      </thead>
      <tbody>
        <tr v-for="entry in ENTRIES" :key="entry.id">
          <td>{{ entry.label }}</td>
          <td>{{ entry.bounds.width }}</td>
          <td>{{ entry.bounds.height }}</td>
          <td>{{ entry.bounds.anchorX }}, {{ entry.bounds.anchorY }}</td>
          <td>{{ (entry.bounds.width / TILE).toFixed(2) }}</td>
          <td>{{ (entry.bounds.height / TILE).toFixed(2) }}</td>
        </tr>
      </tbody>
    </table>

    <p class="svl-foot">
      <strong>Por qué el mundo lo pinta el lab.</strong> R31 mantiene profesiones aislado: sólo los cuatro field labs
      existentes pueden instanciar el motor (<code>professionsIsolation.test.ts</code>). Sumar este lab a esa lista
      implica tocar un test existente, y esa es una decisión de revisión, no de esta tarea. Lo que se ve acá es el
      mundo real como <em>dato</em>; lo que no se ve es el render productivo con su cámara, iluminación y clima.
    </p>
  </section>
</template>

<script setup lang="ts">
// T-S3.1 — Station Visual Lab. Development only.
//
// The art kit of T-S3 had never been seen next to the world it is meant to live
// in, or next to the Alchemy bench it took its cues from. This lab puts the four
// of them on real terrain, side by side on a ruler, and in a state matrix, so a
// human can approve or reject the look before anything is frozen.
//
// It is a viewer. There is no PlacedObject, no hitbox, no collision, no recipe,
// no crafting, no furnace loop, no timer that means anything, no resource, no
// XP, no persistence and no networking.
//
// The world view reads the **real** Pradera Brisa world — same seed, same
// terrain, same solid props, same 16 px grid — and paints it with flat colours
// of its own. See the note in the template for why it does not run the engine.
//
// The Alchemy bench is here as a reference only and is not modified: this reads
// its art exactly as its own overlay does.

import { onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { isSolidDecor, T, TILE, World, type Terrain } from '../../../wildlands/engine/world'
import { alchemyStationArt, STATION_H, STATION_W } from '../../art/alchemyStation'
import { CAMPFIRE_BOUNDS, campfireStationArt } from '../../art/campfireStation'
import { FURNACE_BOUNDS, furnaceStationArt } from '../../art/furnaceStation'
import { toSprite, type PixelArt } from '../../art/pixelArt'
import { STATION_STATES, type StationBounds, type StationState } from '../../art/stationVisuals'
import { WORKBENCH_BOUNDS, workbenchStationArt } from '../../art/workbenchStation'
import { PRADERA_SEED, PRADERA_SPAWN } from '../../demo/praderaLandmarks'

type EntryId = 'alchemy' | 'furnace' | 'campfire' | 'workbench'

/** The bench keeps its own state name for `working`; the rest share the kit's. */
const alchemyArt = (state: StationState, frame: number): PixelArt =>
  alchemyStationArt(state === 'working' ? 'brewing' : state, undefined, frame)

const ALCHEMY_BOUNDS: StationBounds = {
  width: STATION_W, height: STATION_H, anchorX: Math.floor(STATION_W / 2), anchorY: STATION_H - 1,
}

interface Entry {
  readonly id: EntryId
  readonly label: string
  readonly art: (state: StationState, frame: number) => PixelArt
  readonly bounds: StationBounds
}

/** Reference first, then the three new ones — the order the review asked for. */
const ENTRIES: readonly Entry[] = [
  { id: 'alchemy', label: 'Mesa de Alquimia', art: alchemyArt, bounds: ALCHEMY_BOUNDS },
  { id: 'furnace', label: 'Horno', art: furnaceStationArt, bounds: FURNACE_BOUNDS },
  { id: 'campfire', label: 'Fogata', art: campfireStationArt, bounds: CAMPFIRE_BOUNDS },
  { id: 'workbench', label: 'Banco de Trabajo', art: workbenchStationArt, bounds: WORKBENCH_BOUNDS },
]

const TABS = [
  { id: 'world', label: 'En el mundo' },
  { id: 'compare', label: 'Comparación' },
  { id: 'states', label: 'Estados' },
] as const

const view = ref<(typeof TABS)[number]['id']>('world')
const states = reactive<Record<EntryId, StationState>>({
  alchemy: 'idle', furnace: 'idle', campfire: 'idle', workbench: 'idle',
})
const allState = ref<StationState | null>('idle')
const playing = ref(true)
const frame = ref(0)
const zoom = ref(3)

function setAll(state: StationState): void {
  allState.value = state
  for (const entry of ENTRIES) states[entry.id] = state
}

const step = (): void => { frame.value = (frame.value + 1) % 4 }

// Any per-station override clears the "all" highlight.
watch(states, () => {
  const first = states.alchemy
  allState.value = ENTRIES.every(entry => states[entry.id] === first) ? first : null
})

// ── Where the stations stand ────────────────────────────────────────────────
//
// One row, four tiles apart, a few tiles north of the Pradera spawn. Local to
// this lab: nothing is registered anywhere and nothing reads it back.
const ROW_Y = PRADERA_SPAWN.ty - 4
const SPOTS: Readonly<Record<EntryId, { tx: number; ty: number }>> = {
  alchemy: { tx: PRADERA_SPAWN.tx - 6, ty: ROW_Y },
  furnace: { tx: PRADERA_SPAWN.tx - 2, ty: ROW_Y },
  campfire: { tx: PRADERA_SPAWN.tx + 2, ty: ROW_Y },
  workbench: { tx: PRADERA_SPAWN.tx + 6, ty: ROW_Y },
}

const worldRef = ref<HTMLCanvasElement | null>(null)
const compareRef = ref<HTMLCanvasElement | null>(null)
const matrixRef = ref<HTMLCanvasElement | null>(null)

const PAPER = '#141a29'
const GROUND = '#2a3550'
const RULE = '#3d4a6b'
const INK = '#cfe0ff'

/** Flat stand-ins for the terrain, so the backdrop reads without the renderer. */
const TERRAIN_TONE: Readonly<Record<Terrain, string>> = {
  [T.DEEP]: '#16324f',
  [T.WATER]: '#1f4f74',
  [T.SAND]: '#c8b183',
  [T.GRASS]: '#4a8b45',
  [T.DUNE]: '#b89b6a',
  [T.TALL]: '#3c7639',
  [T.SNOW]: '#d8e4ea',
}

function blit(ctx: CanvasRenderingContext2D, art: PixelArt, x: number, y: number, scale: number): void {
  const sprite = toSprite(art)
  ctx.drawImage(sprite.canvas, 0, 0, art.w, art.h, x, y, art.w * scale, art.h * scale)
}

/** The stations on the real terrain, at real tile scale. */
function drawWorld(): void {
  const canvas = worldRef.value
  const ctx = canvas?.getContext('2d')
  if (!canvas || !ctx) return
  const scale = zoom.value
  const world = new World(PRADERA_SEED)
  // A window wide enough for the whole row plus a margin of world around it.
  const x0 = SPOTS.alchemy.tx - 5
  const x1 = SPOTS.workbench.tx + 6
  const y0 = ROW_Y - 6
  const y1 = ROW_Y + 4

  canvas.width = (x1 - x0 + 1) * TILE * scale
  canvas.height = (y1 - y0 + 1) * TILE * scale
  ctx.imageSmoothingEnabled = false

  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      const px = (tx - x0) * TILE * scale
      const py = (ty - y0) * TILE * scale
      ctx.fillStyle = TERRAIN_TONE[world.tileTerrain(tx, ty)] ?? '#4a8b45'
      ctx.fillRect(px, py, TILE * scale, TILE * scale)
      // Tile grid: the scale reference the review needs.
      ctx.fillStyle = 'rgba(0, 0, 0, 0.12)'
      ctx.fillRect(px, py, TILE * scale, 1)
      ctx.fillRect(px, py, 1, TILE * scale)
      // A solid prop stands here: the thing a station must not be mistaken for.
      if (isSolidDecor(world.decorAt(tx, ty))) {
        ctx.fillStyle = 'rgba(14, 26, 14, 0.5)'
        ctx.fillRect(px + 2 * scale, py + 2 * scale, (TILE - 4) * scale, (TILE - 4) * scale)
      }
    }
  }

  for (const entry of ENTRIES) {
    const spot = SPOTS[entry.id]
    const art = entry.art(states[entry.id], frame.value)
    // Feet on the front edge of the tile, the same rule an overlay would use.
    const footX = (spot.tx - x0) * TILE * scale + (TILE / 2) * scale
    const footY = (spot.ty - y0) * TILE * scale + (TILE - 2) * scale
    blit(ctx, art, footX - art.ax * scale, footY - art.ay * scale, scale)
    ctx.fillStyle = INK
    ctx.font = `${Math.max(9, 3 * scale)}px ui-monospace, monospace`
    ctx.textAlign = 'center'
    ctx.fillText(`${entry.label} · ${states[entry.id]}`, footX, footY + 7 * scale)
    ctx.textAlign = 'left'
  }
}

/** Side by side, feet on one line, with a tile ruler to judge scale. */
function drawCompare(): void {
  const canvas = compareRef.value
  const ctx = canvas?.getContext('2d')
  if (!canvas || !ctx) return
  const scale = zoom.value
  const gap = 14 * scale
  const pad = 8 * scale
  const arts = ENTRIES.map(entry => entry.art(states[entry.id], frame.value))
  // A slot is as wide as the art or its caption, whichever needs more room.
  const slot = (art: PixelArt): number => Math.max(art.w * scale, 22 * scale)
  const width = pad * 2 + arts.reduce((sum, art) => sum + slot(art), 0) + gap * (arts.length - 1)
  const tallest = Math.max(...arts.map(art => art.h))
  const height = pad * 2 + tallest * scale + 22 * scale

  canvas.width = width
  canvas.height = height
  ctx.imageSmoothingEnabled = false
  ctx.fillStyle = PAPER
  ctx.fillRect(0, 0, width, height)

  const baseline = pad + tallest * scale
  ctx.fillStyle = GROUND
  ctx.fillRect(0, baseline, width, Math.max(1, scale))
  ctx.fillStyle = RULE
  for (let x = pad; x < width; x += TILE * scale) ctx.fillRect(x, baseline, 1, 6 * scale)

  let x = pad
  for (let i = 0; i < ENTRIES.length; i++) {
    const art = arts[i]
    const left = x + (slot(art) - art.w * scale) / 2
    blit(ctx, art, left, baseline - art.h * scale, scale)
    ctx.fillStyle = '#5f7ab5'
    ctx.fillRect(left, baseline + 2 * scale, art.w * scale, Math.max(1, scale))
    ctx.fillStyle = '#ffd27a'
    ctx.fillRect(left + art.ax * scale, baseline, Math.max(1, scale), 4 * scale)
    const centre = left + (art.w * scale) / 2
    ctx.textAlign = 'center'
    ctx.fillStyle = INK
    ctx.font = `${Math.max(9, 3.2 * scale)}px ui-monospace, monospace`
    ctx.fillText(ENTRIES[i].label, centre, baseline + 11 * scale)
    ctx.fillStyle = RULE
    ctx.fillText(`${art.w}×${art.h} · anchor ${art.ax},${art.ay}`, centre, baseline + 17 * scale)
    ctx.textAlign = 'left'
    x += slot(art) + gap
  }
}

/** Four stations down, four states across. */
function drawMatrix(): void {
  const canvas = matrixRef.value
  const ctx = canvas?.getContext('2d')
  if (!canvas || !ctx) return
  const scale = Math.max(1, zoom.value - 1)
  const cellW = 40 * scale
  const cellH = 40 * scale
  const left = 26 * scale
  const top = 12 * scale
  const width = left + cellW * STATION_STATES.length
  const height = top + cellH * ENTRIES.length

  canvas.width = width
  canvas.height = height
  ctx.imageSmoothingEnabled = false
  ctx.fillStyle = PAPER
  ctx.fillRect(0, 0, width, height)
  ctx.font = `${Math.max(9, 3.5 * scale)}px ui-monospace, monospace`

  ctx.fillStyle = INK
  STATION_STATES.forEach((state, column) => ctx.fillText(state, left + column * cellW + 2, 9 * scale))

  ENTRIES.forEach((entry, row) => {
    const y = top + row * cellH
    ctx.fillStyle = INK
    ctx.fillText(entry.label.slice(0, 9), 2, y + cellH / 2)
    STATION_STATES.forEach((state, column) => {
      const art = entry.art(state, frame.value)
      const x = left + column * cellW
      ctx.fillStyle = row % 2 === 0 ? '#182033' : PAPER
      ctx.fillRect(x, y, cellW, cellH)
      ctx.fillStyle = GROUND
      ctx.fillRect(x + 2, y + cellH - 4 * scale, cellW - 4, Math.max(1, scale))
      blit(ctx, art, x + (cellW - art.w * scale) / 2, y + cellH - 4 * scale - art.h * scale, scale)
    })
  })
}

function redraw(): void {
  drawWorld()
  drawCompare()
  drawMatrix()
}

const FRAME_HZ = 6
let timer = 0

watch([states, frame, zoom, view], () => redraw(), { deep: true })

onMounted(() => {
  redraw()
  timer = window.setInterval(() => {
    if (playing.value) step()
  }, 1000 / FRAME_HZ)
})

onUnmounted(() => window.clearInterval(timer))
</script>

<style scoped>
.svl {
  display: grid; gap: 12px; padding: 16px; min-height: 100vh;
  background: #0b1020; color: #e8eeff;
  font-family: ui-sans-serif, system-ui, sans-serif;
}
.svl-head { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; justify-content: space-between; }
.svl-head h1 { margin: 2px 0 0; font-size: 1.3rem; }
.svl-kicker { margin: 0; color: #7f8db5; font-size: 0.66rem; letter-spacing: 0.08em; }
.svl-badge {
  padding: 4px 10px; border: 1px solid #5c3a52; border-radius: 999px;
  background: #241a2c; color: #ffb7d8; font-size: 0.68rem;
}

.svl-tabs { display: flex; flex-wrap: wrap; gap: 6px; }
.svl-tab {
  padding: 6px 12px; border: 1px solid #2b3a5e; border-radius: 999px;
  background: #121b31; color: #b9c8ee; font: inherit; font-size: 0.75rem; cursor: pointer;
}
.svl-tab--on { border-color: #d9a441; color: #ffe2a8; }

.svl-controls {
  display: flex; flex-wrap: wrap; gap: 6px; align-items: center;
  padding: 8px; border: 1px solid #1e2740; border-radius: 10px; background: #0e1424;
}
.svl-controls--rows { display: grid; gap: 4px; }
.svl-row { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
.svl-name { min-width: 128px; color: #9fb0d8; font-size: 0.7rem; }
.svl-label { color: #7f8db5; font-size: 0.7rem; letter-spacing: 0.06em; }
.svl-sep { width: 1px; height: 18px; background: #24304d; }
.svl-chip {
  padding: 4px 10px; border: 1px solid #2b3a5e; border-radius: 7px;
  background: #16203a; color: #cfe0ff; font: inherit; font-size: 0.7rem; cursor: pointer;
}
.svl-chip--sm { padding: 2px 8px; font-size: 0.66rem; }
.svl-chip--on { border-color: #d9a441; color: #ffe2a8; }
.svl-chip:disabled { opacity: 0.45; cursor: default; }
.svl-zoom { display: flex; gap: 6px; align-items: center; color: #9fb0d8; font-size: 0.7rem; }

.svl-stage { position: relative; border: 1px solid #1e2740; border-radius: 10px; background: #070b16; }
.svl-stage--flat { padding: 10px; overflow: auto; }
.svl-canvas { display: block; }
.svl-canvas--flat { width: auto; height: auto; max-width: 100%; image-rendering: pixelated; }
.svl-hint { margin: 6px 0 0; color: #8fa0c8; font-size: 0.7rem; line-height: 1.35; }
.svl-foot {
  margin: 0; padding: 8px 10px; border: 1px solid #2a2340; border-radius: 8px;
  background: #140f22; color: #b7a8d8; font-size: 0.68rem; line-height: 1.4;
}

.svl-table { border-collapse: collapse; font-size: 0.72rem; }
.svl-table th, .svl-table td { padding: 4px 10px; border: 1px solid #1e2740; text-align: left; }
.svl-table th { color: #9fb0d8; font-weight: 600; }

@media (max-width: 420px) {
  .svl { padding: 10px; }
  .svl-name { min-width: 100%; }
  .svl-table { font-size: 0.66rem; }
}
</style>
