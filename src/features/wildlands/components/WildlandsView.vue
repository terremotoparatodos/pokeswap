<template>
  <div class="wl">
    <canvas
      ref="canvasRef"
      class="wl-canvas"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
      @contextmenu.prevent
    />

    <div v-if="loading" class="wl-loading">Llegando a Ciudad Corazón…</div>

    <transition name="wl-fade">
      <p v-if="hud.toast" class="wl-toast" role="status">{{ hud.toast }}</p>
    </transition>

    <aside class="wl-help">
      <p class="wl-help-title">WildLands · prototipo</p>
      <ul>
        <li><b>Click</b> para caminar · click en alguien para hablarle</li>
        <li>Caminá hasta una puerta de la ciudad para viajar a otro mundo</li>
        <li><kbd>WASD</kbd>/<kbd>↑↓←→</kbd> también mueven · <kbd>Shift</kbd> correr</li>
        <li><kbd>E</kbd> interactuar · <kbd>G</kbd> grilla · <kbd>N</kbd> +3 h</li>
      </ul>
      <p class="wl-help-perf">{{ hud.fps }} fps · {{ hud.frameMs }} ms/frame</p>
    </aside>

    <div class="wl-minimap">
      <canvas ref="minimapRef" />
      <span class="wl-minimap-n">N</span>
    </div>

    <template v-for="arrow in arrows" :key="arrow.dir">
      <button
        class="wl-arrow"
        :class="`wl-arrow--${arrow.dir}`"
        :aria-label="arrow.label"
        @pointerdown.prevent="game?.setVirtualDir(arrow.dir)"
        @pointerup="game?.setVirtualDir(null)"
        @pointerleave="game?.setVirtualDir(null)"
      >
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 3 L18 16 L2 16 Z" /></svg>
      </button>
    </template>

    <div class="wl-hud">
      <span class="wl-place">
        {{ hud.place }}<template v-if="hud.areaKind === 'wild'"> ({{ hud.tx }}, {{ hud.ty }})</template>
      </span>
      <span class="wl-sep" />
      <span class="wl-weather" :title="WEATHER_LABEL[hud.weather]">
        <svg v-if="hud.weather === 'clear'" viewBox="0 0 20 20" aria-hidden="true">
          <circle cx="10" cy="10" r="3.5" />
          <path d="M10 1.5v3M10 15.5v3M1.5 10h3M15.5 10h3M4 4l2 2M14 14l2 2M4 16l2-2M14 6l2-2" />
        </svg>
        <svg v-else viewBox="0 0 20 20" aria-hidden="true">
          <path d="M5.5 12.5a3.5 3.5 0 0 1 .4-7 4.5 4.5 0 0 1 8.6 1.2 3 3 0 0 1-.5 5.8z" />
          <path v-if="hud.weather === 'rain'" d="M7 15l-1 3M10.5 15l-1 3M14 15l-1 3" />
          <path v-else d="M7 16h.01M10.5 17.5h.01M14 16h.01" stroke-width="2.4" />
        </svg>
      </span>
      <span class="wl-sep" />
      <span class="wl-phase">{{ hud.phase }}</span>
      <template v-if="hud.areaKind === 'wild'">
        <span class="wl-sep" />
        <span class="wl-crystals">{{ hud.crystals }} cristales</span>
        <span class="wl-sep" />
        <button class="wl-hud-btn wl-home" :disabled="hud.traveling" title="Volver a Ciudad Corazón" @click="game?.returnToLobby()">
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 9.5 10 3.5l7 6M5 8.5V16h10V8.5M8.5 16v-4h3v4" /></svg>
          Ciudad
        </button>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, reactive, ref, shallowRef } from 'vue'
import { useRoute } from 'vue-router'
import { listPokemon } from '../../pokemon/api/pokemonApi'
import { devWarn } from '../../../shared/utils/devTools'
import type { Dir } from '../engine/characters'
import { WildlandsGame, type HudState } from '../engine/game'
import type { PokedexEntry } from '../engine/population'
import type { WeatherKind } from '../engine/atmosphere'
import { LOBBY_ID } from '../areas/atlas'

const WEATHER_LABEL: Record<WeatherKind, string> = { clear: 'Despejado', rain: 'Lluvia', snow: 'Nieve' }
const arrows: { dir: Dir; label: string }[] = [
  { dir: 'up', label: 'Arriba' },
  { dir: 'down', label: 'Abajo' },
  { dir: 'left', label: 'Izquierda' },
  { dir: 'right', label: 'Derecha' },
]

const route = useRoute()
const canvasRef = ref<HTMLCanvasElement | null>(null)
const minimapRef = ref<HTMLCanvasElement | null>(null)
const game = shallowRef<WildlandsGame | null>(null)
const loading = ref(true)
const hud = reactive<HudState>({
  areaId: LOBBY_ID, areaKind: 'town', place: '—', tx: 0, ty: 0, phase: 'Día', weather: 'clear', crystals: 0,
  lens: 'handheld', toast: null, traveling: false, fps: 0, frameMs: 0,
})

let minimapAt: { area: string; tx: number; ty: number } | null = null

// Tap walks there; press and drag keeps retargeting under the finger.
const DRAG_START_PX = 12
let press: { id: number; x: number; y: number; dragging: boolean } | null = null

function onPointerDown(e: PointerEvent): void {
  if (!e.isPrimary || e.button > 0) return
  ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  press = { id: e.pointerId, x: e.offsetX, y: e.offsetY, dragging: false }
  game.value?.tap(e.offsetX, e.offsetY)
}

function onPointerMove(e: PointerEvent): void {
  if (!press || e.pointerId !== press.id) return
  if (!press.dragging && Math.hypot(e.offsetX - press.x, e.offsetY - press.y) < DRAG_START_PX) return
  press.dragging = true
  game.value?.drag(e.offsetX, e.offsetY)
}

function onPointerUp(e: PointerEvent): void {
  if (press && e.pointerId === press.id) press = null
}

function onHud(next: HudState): void {
  Object.assign(hud, next)
  // Worlds resample biomes (costly) every few tiles; the town map is just an image.
  const step = next.areaKind === 'town' ? 1 : 6
  const stale = !minimapAt || minimapAt.area !== next.areaId ||
    Math.abs(minimapAt.tx - next.tx) + Math.abs(minimapAt.ty - next.ty) >= step
  if (stale && minimapRef.value && game.value) {
    minimapAt = { area: next.areaId, tx: next.tx, ty: next.ty }
    game.value.paintMinimap(minimapRef.value)
  }
}

onMounted(async () => {
  let pokedex: PokedexEntry[] = []
  try {
    pokedex = await listPokemon()
  } catch (error) {
    devWarn('[wildlands] Pokédex unavailable, spawning trainers only', error)
  }
  if (!canvasRef.value) return
  // ?area=<world>&x=&y= jumps straight to a spot, handy for sharing places in the (deterministic) worlds.
  const x = Number(route.query.x)
  const y = Number(route.query.y)
  const spawn = Number.isInteger(x) && Number.isInteger(y) && route.query.x !== undefined ? { tx: x, ty: y } : null
  const startArea = typeof route.query.area === 'string' ? route.query.area : undefined
  game.value = new WildlandsGame(canvasRef.value, { pokedex, onHud, spawn, startArea })
  game.value.start()
  loading.value = false
  const touch = window.matchMedia('(pointer: coarse)').matches
  game.value.notify(touch ? 'Tocá el suelo para caminar' : 'Hacé click en el suelo para caminar')
})

onUnmounted(() => {
  game.value?.destroy()
})
</script>

<style scoped>
.wl {
  position: relative;
  height: calc(100vh - 52px);
  height: calc(100dvh - 52px);
  min-height: 420px;
  overflow: hidden;
  background: #0f1a33;
  user-select: none;
  font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
}

.wl-canvas {
  display: block;
  width: 100%;
  height: 100%;
  image-rendering: pixelated;
  cursor: pointer;
  /* The canvas owns every gesture: no scroll, pinch-zoom or double-tap zoom. */
  touch-action: none;
  -webkit-touch-callout: none;
  -webkit-tap-highlight-color: transparent;
}

/* Touch screens walk by tapping, so the direction arrows only add clutter. */
@media (pointer: coarse) {
  .wl-arrow { display: none; }
}

.wl-loading {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: #dfe8ff;
  font-size: 1.1rem;
  letter-spacing: 0.03em;
}

.wl-toast {
  position: absolute;
  top: 4.5rem;
  left: 50%;
  transform: translateX(-50%);
  margin: 0;
  padding: 0.6rem 1.1rem;
  border: 2px solid #3a5fb8;
  border-radius: 10px;
  background: rgba(16, 26, 54, 0.92);
  color: #fff;
  font-size: 0.95rem;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.35);
  white-space: nowrap;
}

.wl-fade-enter-active,
.wl-fade-leave-active {
  transition: opacity 0.25s, transform 0.25s;
}
.wl-fade-enter-from,
.wl-fade-leave-to {
  opacity: 0;
  transform: translate(-50%, -6px);
}

.wl-help {
  position: absolute;
  top: 1rem;
  left: 1rem;
  padding: 0.55rem 0.8rem;
  border-radius: 10px;
  background: rgba(16, 26, 54, 0.78);
  color: #dfe8ff;
  font-size: 0.78rem;
  line-height: 1.6;
}
.wl-help-title {
  margin: 0 0 0.15rem;
  font-weight: 700;
  color: #fff;
}
.wl-help-perf {
  margin: 0.2rem 0 0;
  font-variant-numeric: tabular-nums;
  opacity: 0.6;
}
.wl-help ul {
  margin: 0;
  padding: 0;
  list-style: none;
}
kbd {
  padding: 0 0.3rem;
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-bottom-width: 2px;
  border-radius: 4px;
  font-family: inherit;
  font-size: 0.72rem;
}

.wl-minimap {
  position: absolute;
  top: 1rem;
  right: 1rem;
  width: 132px;
  height: 132px;
  padding: 3px;
  border: 2px solid #3a5fb8;
  border-radius: 12px;
  background: #101a36;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.35);
}
.wl-minimap canvas {
  width: 100%;
  height: 100%;
  border-radius: 8px;
  image-rendering: pixelated;
}
.wl-minimap-n {
  position: absolute;
  top: -9px;
  left: 50%;
  transform: translateX(-50%);
  padding: 0 5px;
  border-radius: 6px;
  background: #e03c3c;
  color: #fff;
  font-size: 0.7rem;
  font-weight: 700;
}

.wl-arrow {
  position: absolute;
  width: 44px;
  height: 44px;
  padding: 8px;
  border: 0;
  background: transparent;
  cursor: pointer;
  touch-action: none;
}
.wl-arrow svg {
  width: 100%;
  height: 100%;
  fill: rgba(20, 22, 30, 0.8);
  stroke: rgba(255, 255, 255, 0.85);
  stroke-width: 1.5;
  stroke-linejoin: round;
}
.wl-arrow:hover svg,
.wl-arrow:active svg {
  fill: #e03c3c;
}
.wl-arrow--up { top: 3.5%; left: 50%; transform: translateX(-50%); }
.wl-arrow--up svg { fill: #e03c3c; }
.wl-arrow--down { bottom: 5.5rem; left: 50%; transform: translateX(-50%) rotate(180deg); }
.wl-arrow--left { top: 50%; left: 1rem; transform: translateY(-50%) rotate(-90deg); }
.wl-arrow--right { top: 50%; right: 1rem; transform: translateY(-50%) rotate(90deg); }

.wl-hud {
  position: absolute;
  bottom: 1.25rem;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.55rem 1.25rem;
  border: 2px solid #3a5fb8;
  border-radius: 999px;
  background: rgba(16, 26, 54, 0.92);
  color: #fff;
  font-size: 1rem;
  white-space: nowrap;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
}
.wl-hud svg {
  width: 20px;
  height: 20px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.5;
  stroke-linecap: round;
}
.wl-hud-btn {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.wl-hud-btn:hover {
  color: #9fc0ff;
}
.wl-hud-btn:disabled {
  opacity: 0.5;
  cursor: default;
}
.wl-home {
  color: #ffd27a;
}
.wl-sep {
  width: 1px;
  height: 1.1rem;
  background: rgba(255, 255, 255, 0.25);
}
.wl-weather {
  display: flex;
  color: #dfe8ff;
}
.wl-phase {
  color: #c7d0e6;
}
.wl-crystals {
  color: #7fe3f5;
  font-weight: 600;
}

@media (max-width: 720px) {
  .wl-help { display: none; }
  .wl-toast {
    top: auto;
    bottom: 4.75rem;
    max-width: calc(100% - 2rem);
    white-space: normal;
    text-align: center;
  }
  .wl-hud { font-size: 0.8rem; gap: 0.5rem; padding: 0.45rem 0.9rem; }
  .wl-minimap { width: 96px; height: 96px; }
}
</style>
