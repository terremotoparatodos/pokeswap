<template>
  <div class="wl">
    <canvas
      ref="canvasRef"
      class="wl-canvas"
      aria-label="Mundo explorable de Ciudad Corazón. Tocá o hacé clic en el suelo para caminar."
      tabindex="0"
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

    <DevHelp v-if="DevHelp" :fps="hud.fps" :frame-ms="hud.frameMs" />

    <div class="wl-minimap" aria-label="Minimapa de la zona actual">
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

    <LobbyHud :hud="hud" @home="game?.returnToLobby()" />

    <LobbyPlaza
      ref="plazaRef"
      :game="game"
      :pokedex="pokedex"
      :covered="covered"
      @overlay="open => (plazaOpen = open)"
      @market="panel.open('mercado', 'menu')"
      @feature="feature => panel.open(feature, 'menu')"
    />

    <ProfessionWorldDemo
      v-if="ProfessionWorldDemo"
      ref="professionRef"
      :area-kind="hud.areaKind"
      :game="game"
      @overlay="(open: boolean) => (professionOpen = open)"
    />

    <LobbyMenu
      v-model:open="menuOpen"
      :reduced-motion="reduceMotion"
      @select="feature => panel.open(feature, 'menu')"
      @activity="plazaRef?.openBoard()"
      @sign-in="signInOpen = true"
      @update:reduced-motion="reduceMotion = $event"
    />

    <LobbyPanel v-if="panelShown" :title="panel.title.value" @close="panel.close()">
      <p v-if="panel.access.value === 'wait'" class="wl-panel-wait">Cargando sesión…</p>
      <router-view v-else />
    </LobbyPanel>

    <AuthModal :open="authOpen" @success="authSucceeded = true" @close="onAuthClose" />
  </div>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, onUnmounted, reactive, ref, shallowRef, watch, watchEffect } from 'vue'
import { useRoute } from 'vue-router'
import AuthModal from '../../auth/components/AuthModal.vue'
import { listPokemon } from '../../pokemon/api/pokemonApi'
import { devWarn } from '../../../shared/utils/devTools'
import type { Dir } from '../engine/characters'
import { WildlandsGame, type HudState, type WorldObjectTarget } from '../engine/game'
import type { PokedexEntry } from '../engine/population'
import { LOBBY_ID } from '../areas/atlas'
import { useLobbyPanel } from '../lobby/useLobbyPanel'
import { usePlayerIdentity } from '../identity/usePlayerIdentity'
import LobbyHud from './LobbyHud.vue'
import LobbyMenu from './LobbyMenu.vue'
import LobbyPanel from './LobbyPanel.vue'
import LobbyPlaza from './LobbyPlaza.vue'
import { preloadLobbyArt } from '../lobby/preloadLobbyArt'
import { ColyseusPresence } from '../multiplayer/api/colyseusPresence'
import type { LocalPresencePort } from '../multiplayer/domain/presence'
import { useAuth } from '../../auth/composables/useAuth'

// Controls and fps help: development builds only, so production never ships it.
const DevHelp = import.meta.env.DEV ? defineAsyncComponent(() => import('./DevHelp.vue')) : null
// R31-B profession prototype: development builds only, never shipped to production.
const ProfessionWorldDemo = import.meta.env.DEV ? defineAsyncComponent(() => import('../../professions/components/world/ProfessionWorldDemo.vue')) : null

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
const identity = usePlayerIdentity(game)
const { user } = useAuth()
let presence: ColyseusPresence | null = null
const presencePort: LocalPresencePort = {
  move: (direction, running, sequence) => presence?.move(direction, running, sequence),
  changeArea: areaId => presence?.changeArea(areaId),
  observe: (areaId, tx, ty) => presence?.observe(areaId, tx, ty),
}

// Panels over the town. Leaving a building (or a building's direct link) puts the
// player back outside its door; panels opened from the menu leave them where they were.
const panel = useLobbyPanel({
  onClosed: (feature, origin) => {
    if (origin !== 'menu') game.value?.placeAtDoor(feature)
    void identity.refreshOwnership()
  },
})
const menuOpen = ref(false)
const signInOpen = ref(false)
/** Signing in finished but the session may still be on its way. */
const authSucceeded = ref(false)
watch(panel.feature, () => { authSucceeded.value = false })

const needsSignIn = computed(() => panel.access.value === 'auth' && !authSucceeded.value)
const authOpen = computed(() => signInOpen.value || needsSignIn.value)
// After a successful sign-in the feature view shows itself (and its own sign-in hint until the session lands).
const panelShown = computed(() => panel.access.value !== 'closed' && !needsSignIn.value)

function onAuthClose(): void {
  signInOpen.value = false
  if (needsSignIn.value) panel.close()
}

// Plaza (R26): owned Pokémon cards and the activity board also pause the town.
const pokedex = shallowRef<readonly PokedexEntry[]>([])
const plazaRef = ref<InstanceType<typeof LobbyPlaza> | null>(null)
const plazaOpen = ref(false)
const professionRef = ref<{ inspect: (target: WorldObjectTarget) => boolean; isWorldObject: (target: WorldObjectTarget) => boolean } | null>(null)
const professionOpen = ref(false)
const covered = computed(() => panel.feature.value !== null || menuOpen.value || authOpen.value)
const motionMedia = window.matchMedia('(prefers-reduced-motion: reduce)')
const reduceMotion = ref(motionMedia.matches)
const hidden = ref(document.visibilityState === 'hidden')

watchEffect(() => {
  game.value?.setPaused(covered.value || plazaOpen.value || professionOpen.value)
  game.value?.setVisibilityPaused(hidden.value)
  game.value?.setReducedMotion(reduceMotion.value)
})

const onMotionChange = (event: MediaQueryListEvent) => { reduceMotion.value = event.matches }
const onVisibilityChange = () => { hidden.value = document.visibilityState === 'hidden' }

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
  const authReady = identity.waitUntilReady()
  try {
    const [catalog] = await Promise.all([listPokemon(), preloadLobbyArt()])
    pokedex.value = catalog
  } catch (error) {
    devWarn('[wildlands] Pokédex unavailable, spawning trainers only', error)
  }
  await authReady
  if (!canvasRef.value) return
  // ?area=<world>&x=&y= jumps straight to a spot, handy for sharing places in the (deterministic) worlds.
  const x = Number(route.query.x)
  const y = Number(route.query.y)
  const querySpawn = Number.isInteger(x) && Number.isInteger(y) && route.query.x !== undefined ? { tx: x, ty: y } : null
  const startArea = typeof route.query.area === 'string' ? route.query.area : undefined
  const savedSpawn = !querySpawn && !panel.feature.value && (!startArea || startArea === LOBBY_ID)
    ? identity.initialTownPosition()
    : null
  const spawn = querySpawn ?? savedSpawn
  const created = new WildlandsGame(canvasRef.value, {
    pokedex: pokedex.value, onHud, spawn, startArea,
    onEnterBuilding: (_building, feature) => panel.open(feature, 'door'),
    onInspect: hit => plazaRef.value?.inspect(hit),
    onWorldObject: ProfessionWorldDemo ? target => professionRef.value?.inspect(target) ?? false : undefined,
    isWorldObject: ProfessionWorldDemo ? target => professionRef.value?.isWorldObject(target) ?? false : undefined,
    onTownPosition: identity.recordTownPosition,
    presence: presencePort,
  })
  // A direct link to a feature shows the town from that building's door.
  if (panel.feature.value && !querySpawn) created.placeAtDoor(panel.feature.value)
  game.value = created
  created.setPresenceAccess('pending')
  presence = new ColyseusPresence(created)
  void presence.connect(identity.visualIdentity.value)
  created.setVisibilityPaused(hidden.value)
  created.setReducedMotion(reduceMotion.value)
  created.start()
  loading.value = false
  const touch = window.matchMedia('(pointer: coarse)').matches
  created.notify(touch ? 'Tocá el suelo para caminar' : 'Hacé click en el suelo para caminar')
})

onMounted(() => {
  motionMedia.addEventListener('change', onMotionChange)
  document.addEventListener('visibilitychange', onVisibilityChange)
})

onUnmounted(() => {
  motionMedia.removeEventListener('change', onMotionChange)
  document.removeEventListener('visibilitychange', onVisibilityChange)
  game.value?.destroy()
  presence?.disconnect()
})

// A session change replaces the socket rather than keeping an authenticated actor after logout.
watch(user, () => {
  if (!game.value) return
  game.value.setPresenceAccess('pending')
  presence?.disconnect()
  presence = new ColyseusPresence(game.value)
  void presence.connect(identity.visualIdentity.value)
})

// Visibility pauses rendering and detaches input in WildlandsGame, but does
// not end presence. A minimized player remains visible at their last
// server-authoritative tile and cannot move until the document is visible.
</script>

<style scoped>
.wl {
  position: relative;
  height: 100vh;
  height: 100dvh;
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

@media (prefers-reduced-motion: reduce) {
  .wl-fade-enter-active,
  .wl-fade-leave-active { transition: none; }
}
.wl-fade-enter-from,
.wl-fade-leave-to {
  opacity: 0;
  transform: translate(-50%, -6px);
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

.wl-panel-wait {
  padding: 2rem 1.25rem;
  text-align: center;
  opacity: 0.7;
}

@media (max-width: 720px) {
  .wl-toast {
    top: auto;
    bottom: 4.75rem;
    max-width: calc(100% - 2rem);
    white-space: normal;
    text-align: center;
  }
  .wl-minimap { top: 0.75rem; right: 0.75rem; width: 96px; height: 96px; }
}
</style>
