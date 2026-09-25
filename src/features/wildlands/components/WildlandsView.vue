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
    <component :is="PerfPanel" v-if="PerfPanel && perfCapture" :session="perfCapture.session" :auto-scenario="perfCapture.autoScenario" :auto-label="perfCapture.autoLabel" />
    <component
      :is="PlaytestPerformanceHud"
      v-if="PlaytestPerformanceHud"
      :fps="hud.fps"
      :frame-ms="hud.frameMs"
      :frame-p95-ms="hud.frameP95Ms"
      :frame-p99-ms="hud.frameP99Ms"
      :frame-max-ms="hud.frameMaxMs"
      :long-frame-percent="hud.longFramePercent"
      :remote-actors="hud.remoteActors"
      :remote-updates-per-second="hud.remoteUpdatesPerSecond"
      :ground-compose-ms="hud.groundComposeMs"
      :ground-project-ms="hud.groundProjectMs"
      :actor-collect-ms="hud.actorCollectMs"
      :actor-sort-ms="hud.actorSortMs"
      :sprite-draw-ms="hud.spriteDrawMs"
      :lighting-ms="hud.lightingMs"
      :loaded-chunks="hud.loadedChunks"
      :generated-chunks="hud.generatedChunks"
      :evicted-chunks="hud.evictedChunks"
      :last-chunk-build-ms="hud.lastChunkBuildMs"
      :max-chunk-build-ms="hud.maxChunkBuildMs"
      :presence="hud.presence"
    />

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

    <RunToggle v-model:active="runMode" />

    <LobbyPlaza
      ref="plazaRef"
      :game="game"
      :pokedex="pokedex"
      :covered="covered"
      @overlay="open => (plazaOpen = open)"
      @market="openFeature('mercado', 'menu')"
      @feature="feature => openFeature(feature, 'menu')"
    />

    <ProfessionWorldDemo
      v-if="ProfessionWorldDemo"
      ref="professionRef"
      :area-kind="hud.areaKind"
      :game="game"
      :skills="dungeonsInWorld"
      :fresh="isPlaytest"
      :owned-tools="playtestStore?.tools.value"
      :owned-supplies="playtestStore?.supplies.value"
      @overlay="(open: boolean) => (professionOpen = open)"
      @panel="onHudPanel"
    />

    <component
      :is="DungeonEntrances"
      v-if="DungeonEntrances"
      ref="dungeonRef"
      :game="game"
      :is-taken="professionClaims"
      @enter="dungeonRun = $event"
    />

    <component
      :is="DungeonRunPanel"
      v-if="DungeonRunPanel && dungeonRun"
      :entrance="dungeonRun"
      :party="playtestStore?.party.value"
      :inventory="playtestStore?.supplies.value"
      @close="leaveDungeon"
    />

    <WorldHintTray :hints="worldHints" />

    <component
      :is="ChatPanel"
      v-if="ChatPanel && !dungeonRun && !playtestSurface"
      ref="chatRef"
      @open="(open: boolean) => { chatOpen = open; onHudPanel('chat', open) }"
    />

    <component
      :is="CityPanel"
      v-if="CityPanel && playtestSurface"
      :surface="playtestSurface"
      @close="closePlaytestSurface"
    />

    <LobbyMenu
      v-model:open="menuOpen"
      :inventory="isPlaytest"
      :inventory-open="hudPanel === 'bag'"
      :reduced-motion="reduceMotion"
      @select="feature => openFeature(feature, 'menu')"
      @activity="plazaRef?.openBoard()"
      @inventory="professionRef?.toggleInventory()"
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
import { computed, defineAsyncComponent, nextTick, onMounted, onUnmounted, reactive, ref, shallowRef, watch, watchEffect } from 'vue'
import { useRoute } from 'vue-router'
import AuthModal from '../../auth/components/AuthModal.vue'
import { listPokemon } from '../../pokemon/api/pokemonApi'
import { devWarn } from '../../../shared/utils/devTools'
import type { Dir } from '../engine/characters'
import { WildlandsGame, type HudState, type WorldObjectTarget } from '../engine/game'
import { PresenceDiagnostics } from '../multiplayer/domain/presenceDiagnostics'
import type { Area } from '../engine/area'
import type { PlacedObjectSpec } from '../engine/placedObjects'
import type { PokedexEntry } from '../engine/population'
import { LOBBY_ID } from '../areas/atlas'
import { useLobbyPanel } from '../lobby/useLobbyPanel'
import type { LobbyFeature } from '../lobby/features'
import { usePlayerIdentity } from '../identity/usePlayerIdentity'
import LobbyHud from './LobbyHud.vue'
import RunToggle from './RunToggle.vue'
import LobbyMenu from './LobbyMenu.vue'
import LobbyPanel from './LobbyPanel.vue'
import LobbyPlaza from './LobbyPlaza.vue'
import WorldHintTray from './WorldHintTray.vue'
import { visibleWorldHints, type WorldHint } from './worldHints'
import { preloadLobbyArt } from '../lobby/preloadLobbyArt'
import { ColyseusPresence } from '../multiplayer/api/colyseusPresence'
import type { Chat } from '../../chat/state/useChat'
import type { LocalPresencePort } from '../multiplayer/domain/presence'
import { useAuth } from '../../auth/composables/useAuth'
import { composeWorldProbes } from '../engine/worldProbes'
import { CompositeOverlay } from '../engine/compositeOverlay'
import { isPlaytest } from '../../playtest/playtestBuild'
import { usePlaytestContext } from '../../playtest/state/playtestContext'
import { playtestSurfaceFor, type PlaytestSurface } from '../../playtest/domain/cityFeatures'
import type { PlaytestStore } from '../../playtest/state/usePlaytestStore'
import type { AreaEntrance } from '../../dungeonEntrances/domain/entranceSpawns'
import type { PokemonInstance } from '../../dungeonPrototype/domain/party'
import type { SceneOverlay } from '../engine/sceneOverlay'
import type { PerfCapture } from '../perf/usePerfCapture'

// Controls and fps help: development builds only, so production never ships it.
const DevHelp = import.meta.env.DEV ? defineAsyncComponent(() => import('./DevHelp.vue')) : null
const performanceMode = import.meta.env.VITE_PERF === 'on'
const PlaytestPerformanceHud = isPlaytest || performanceMode
  ? defineAsyncComponent(() => import('../../playtest/components/PlaytestPerformanceHud.vue'))
  : null
// PERF-1 capture panel and hooks: VITE_PERF=on builds only (see perf/usePerfCapture.ts).
const PerfPanel = performanceMode ? defineAsyncComponent(() => import('../perf/PerfPanel.vue')) : null
const perfCapture = shallowRef<PerfCapture | null>(null)
// R31-B profession prototype: development builds, and Community Playtest 0.1,
// where the same local session is what the Skills panel reads. A normal
// production build still never mounts it.
const ProfessionWorldDemo = import.meta.env.DEV || isPlaytest ? defineAsyncComponent(() => import('../../professions/components/world/ProfessionWorldDemo.vue')) : null
// Dungeons appear physically in WildLands. Same two gates as the professions
// above, for the same two reasons: a playtest build is where players meet them,
// and a development build is where they are worked on. A normal production
// build mounts neither, so nobody outside the playtest ever finds a cave.
const dungeonsInWorld = import.meta.env.DEV || isPlaytest
const DungeonEntrances = dungeonsInWorld ? defineAsyncComponent(() => import('../../dungeonEntrances/components/DungeonEntrances.vue')) : null
const DungeonRunPanel = dungeonsInWorld ? defineAsyncComponent(() => import('../../dungeonEntrances/components/DungeonRunPanel.vue')) : null
// Area chat rides the presence socket. Same gates again: playtest builds have
// players to talk to, development builds have the server to talk to.
const ChatPanel = dungeonsInWorld ? defineAsyncComponent(() => import('../../chat/components/ChatPanel.vue')) : null
// The city during the playtest: two doors open, the rest say why they are not.
const CityPanel = isPlaytest ? defineAsyncComponent(() => import('../../playtest/components/CityPanel.vue')) : null

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
  frameP95Ms: 0, frameP99Ms: 0, frameMaxMs: 0, longFramePercent: 0, remoteActors: 0, remoteUpdatesPerSecond: 0,
  groundComposeMs: 0, groundProjectMs: 0, actorCollectMs: 0, actorSortMs: 0, spriteDrawMs: 0, lightingMs: 0,
  loadedChunks: 0, generatedChunks: 0, evictedChunks: 0, lastChunkBuildMs: 0, maxChunkBuildMs: 0,
  presence: new PresenceDiagnostics().snapshot(),
})
const identity = usePlayerIdentity(game)
const { user } = useAuth()
let presence: ColyseusPresence | null = null
let stopChatBubbles: (() => void) | null = null
let disposed = false
/**
 * Null outside a playtest or development build, and then nothing below routes
 * chat traffic at all. Loaded dynamically for the same reason as the playtest
 * store: a module with top-level state is a module a bundler must keep.
 */
const chat = shallowRef<Chat | null>(null)
/** One socket, two passengers: presence and chat. */
function connectPresence(target: WildlandsGame): ColyseusPresence {
  const socket = new ColyseusPresence(perfCapture.value?.port(target) ?? target, chat.value?.sink ?? null)
  chat.value?.attach(text => socket.sendChat(text))
  return socket
}
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
const professionRef = ref<{
  inspect: (target: WorldObjectTarget) => boolean
  isWorldObject: (target: WorldObjectTarget) => boolean
  placedObjects: (area: Area) => readonly PlacedObjectSpec[]
  overlay: SceneOverlay
  closeTransient: () => void
  toggleInventory: () => void
  closeSkills: () => void
  closeBag: () => void
  hint: WorldHint | null
  actionOpen: boolean
} | null>(null)
const professionOpen = ref(false)

// Community Playtest 0.1 only. With the flag off these stay null, the
// components are never imported and every expression below folds away.
const dungeonRef = ref<{
  inspect: (target: WorldObjectTarget) => boolean
  isWorldObject: (target: WorldObjectTarget) => boolean
  placedObjects: (area: Area) => readonly PlacedObjectSpec[]
  overlay: SceneOverlay
  hint: WorldHint | null
} | null>(null)
const dungeonRun = shallowRef<AreaEntrance | null>(null)

// Every feature's hint in one tray above the area pill, out of the way while
// the chat or a profession action card owns the bottom of the screen.
const chatOpen = ref(false)
// MOBILE-1: the touch Correr mode. It lives as long as this view: panels,
// buildings, trips and reconnects keep it (the game object stays the same).
const runMode = ref(false)
watch(runMode, on => game.value?.setRunMode(on))
const chatRef = ref<{ close: () => void } | null>(null)

// MOBILE-1: Chat, Skills and the bag compete for the same space over the
// world, so they behave as one group: opening one closes the others, and each
// opener closes its own panel again. Escape closes the open one, but only when
// nothing sits above it (menu, a building's panel, a card or an action), whose
// own Escape handlers win.
type HudPanel = 'chat' | 'skills' | 'bag'
const hudPanel = ref<HudPanel | null>(null)
function onHudPanel(which: HudPanel, open: boolean): void {
  if (!open) {
    if (hudPanel.value === which) hudPanel.value = null
    return
  }
  hudPanel.value = which
  if (which !== 'chat') chatRef.value?.close()
  if (which !== 'skills') professionRef.value?.closeSkills()
  if (which !== 'bag') professionRef.value?.closeBag()
}
function closeHudPanel(): void {
  if (hudPanel.value === 'chat') chatRef.value?.close()
  else if (hudPanel.value === 'skills') professionRef.value?.closeSkills()
  else if (hudPanel.value === 'bag') professionRef.value?.closeBag()
}
// Capture phase: this runs before the menu's own handler closes the menu, so
// one Escape never closes two things.
const onHudEscape = (event: KeyboardEvent) => {
  if (event.key !== 'Escape' || !hudPanel.value) return
  if (covered.value || plazaOpen.value || professionOpen.value || professionRef.value?.actionOpen) return
  closeHudPanel()
}
const worldHints = computed(() => visibleWorldHints(
  [dungeonRef.value?.hint, professionRef.value?.hint],
  { chatOpen: chatOpen.value, actionOpen: professionRef.value?.actionOpen ?? false },
))

/** Tiles the professions already own, so a cave never lands on a node or a bench. */
const professionClaims = (area: Area, tx: number, ty: number): boolean =>
  professionRef.value?.isWorldObject({ area, tx, ty }) ?? false

/**
 * The engine takes one provider per world probe; the playtest has two. Asking
 * the refs per call rather than capturing them means a component that mounts
 * late is picked up without re-creating the game.
 */
const worldProbes = composeWorldProbes(() => [professionRef.value, dungeonRef.value])
const hasWorldProviders = !!(ProfessionWorldDemo || DungeonEntrances)

/**
 * Session-only player state (coins, tools, party, boxes).
 *
 * Imported dynamically rather than at the top of the file. A static import
 * kept the module — and through it the Dungeon prototype's species fixtures —
 * inside a normal production build, which is exactly the leak the playtest is
 * supposed to be incapable of. Null until the playtest asks for it, and in a
 * normal build nothing ever does.
 */
const playtestStore = shallowRef<PlaytestStore | null>(null)
/** Which playtest surface a city door opened, or null when none is open. */
const playtestSurface = shallowRef<PlaytestSurface | null>(null)
/** Remembered so closing a door puts the player back outside it, as before. */
let playtestDoorFeature: LobbyFeature | null = null

/**
 * Every way into a city feature goes through here: the door, the lobby menu
 * and the plaza all hand over the same feature id.
 *
 * Outside the playtest this is the call it always was. Inside it, the panel
 * route is never pushed at all — a closed feature must not merely be hidden,
 * it must not load — and the playtest's own surface opens instead.
 */
function openFeature(feature: LobbyFeature, origin: 'menu' | 'door'): void {
  if (!isPlaytest) {
    panel.open(feature, origin)
    return
  }
  playtestDoorFeature = origin === 'door' ? feature : null
  playtestSurface.value = playtestSurfaceFor(feature)
}

/**
 * Coming out of a Dungeon. The party comes back as the expedition left it —
 * hurt, out of PP, maybe fainted — which is the whole reason the Centro
 * Pokémon exists. Nothing else crosses back: a capture made in there is
 * client-side loot and stays client-side loot.
 */
function leaveDungeon(party?: readonly PokemonInstance[] | null): void {
  playtestStore.value?.returnFromExpedition(party)
  dungeonRun.value = null
}

function closePlaytestSurface(): void {
  playtestSurface.value = null
  if (playtestDoorFeature) game.value?.placeAtDoor(playtestDoorFeature)
  playtestDoorFeature = null
}

const covered = computed(() =>
  panel.feature.value !== null || menuOpen.value || authOpen.value
  || dungeonRun.value !== null || playtestSurface.value !== null)

/**
 * Where the player is and what is on top of them, for the bug reporter.
 *
 * Declared here rather than beside `onHud` because the `watchEffect` below
 * runs eagerly and reads it. `if (isPlaytest)` short-circuits in a normal
 * build, so the temporal dead zone was invisible until a playtest build
 * actually ran — which is what a white screen on first boot turned out to be.
 */
const playtest = usePlaytestContext()

const motionMedia = window.matchMedia('(prefers-reduced-motion: reduce)')
const reduceMotion = ref(motionMedia.matches)
const hidden = ref(document.visibilityState === 'hidden')

watchEffect(() => {
  if (isPlaytest) playtest.setSurface(dungeonRun.value ? 'dungeon' : playtestSurface.value?.kind ?? null)
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
  dismissTransientOverlays()
  ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  press = { id: e.pointerId, x: e.offsetX, y: e.offsetY, dragging: false }
  game.value?.tap(e.offsetX, e.offsetY)
}

function dismissTransientOverlays(): void {
  plazaRef.value?.dismissTransient()
  professionRef.value?.closeTransient()
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
  const moved = next.areaId !== hud.areaId || next.tx !== hud.tx || next.ty !== hud.ty
  if (perfCapture.value) perfCapture.value.measureHud(() => Object.assign(hud, next))
  else Object.assign(hud, next)
  if (moved) dismissTransientOverlays()
  // Where the player is, so a bug report can say so instead of "no me anda".
  if (isPlaytest) playtest.setWorld(next.areaId, next.tx, next.ty)
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
  if (ChatPanel) {
    const { useChat } = await import('../../chat/state/useChat')
    chat.value = useChat()
    stopChatBubbles = chat.value.subscribe(line => game.value?.showChatMessage(line))
  }
  if (isPlaytest) {
    const { usePlaytestStore } = await import('../../playtest/state/usePlaytestStore')
    playtestStore.value = usePlaytestStore()
  }
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
    onEnterBuilding: (_building, feature) => openFeature(feature, 'door'),
    onInspect: hit => plazaRef.value?.inspect(hit),
    onWorldObject: hasWorldProviders ? target => worldProbes.inspect(target) : undefined,
    isWorldObject: hasWorldProviders ? target => worldProbes.isWorldObject(target) : undefined,
    placedObjectsIn: hasWorldProviders ? area => worldProbes.placedObjects(area) : undefined,
    onTownPosition: identity.recordTownPosition,
    presence: presencePort,
  })
  // A direct link to a feature shows the town from that building's door.
  if (panel.feature.value && !querySpawn) created.placeAtDoor(panel.feature.value)
  game.value = created
  if (performanceMode) {
    const { usePerfCapture } = await import('../perf/usePerfCapture')
    perfCapture.value = usePerfCapture()
    perfCapture.value.attach(created)
  }
  await created.prepare()
  if (disposed) return
  created.setPresenceAccess('pending')
  presence = connectPresence(created)
  void presence.connect(identity.visualIdentity.value)
  created.setVisibilityPaused(hidden.value)
  created.setReducedMotion(reduceMotion.value)
  created.start()
  // Playtest: the professions and the dungeon entrances both draw into the
  // scene and the engine holds exactly one overlay. Compose after the children
  // have mounted, so this is the installation that wins.
  if (dungeonsInWorld) {
    await nextTick()
    const parts = [professionRef.value?.overlay, dungeonRef.value?.overlay]
      .filter((part): part is SceneOverlay => !!part)
    if (parts.length) created.setSceneOverlay(parts.length === 1 ? parts[0] : new CompositeOverlay(...parts))
  }
  loading.value = false
  const touch = window.matchMedia('(pointer: coarse)').matches
  created.notify(touch ? 'Tocá el suelo para caminar' : 'Hacé click en el suelo para caminar')
})

onMounted(() => {
  window.addEventListener('keydown', onHudEscape, true)
  motionMedia.addEventListener('change', onMotionChange)
  document.addEventListener('visibilitychange', onVisibilityChange)
})

onUnmounted(() => {
  disposed = true
  window.removeEventListener('keydown', onHudEscape, true)
  motionMedia.removeEventListener('change', onMotionChange)
  document.removeEventListener('visibilitychange', onVisibilityChange)
  perfCapture.value?.detach()
  game.value?.destroy()
  presence?.disconnect()
  stopChatBubbles?.()
  chat.value?.attach(null)
})

// A session change replaces the socket rather than keeping an authenticated actor after logout.
watch(user, () => {
  if (!game.value) return
  game.value.setPresenceAccess('pending')
  presence?.disconnect()
  presence = connectPresence(game.value)
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
  /* A landscape phone is ~350 px tall: a taller floor pushed the bottom HUD off screen. */
  min-height: 300px;
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
  top: calc(4.5rem + var(--safe-top, 0px));
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
  top: calc(1rem + var(--safe-top, 0px));
  right: calc(1rem + var(--safe-right, 0px));
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

/* Phones, portrait or landscape. */
@media (max-width: 720px), (max-height: 500px) {
  .wl-toast {
    top: auto;
    /* Above the bottom tab row. */
    bottom: calc(0.75rem + 44px + 0.6rem + var(--safe-bottom, 0px));
    max-width: calc(100% - 2rem);
    white-space: normal;
    text-align: center;
  }
  .wl-minimap {
    top: calc(0.75rem + var(--safe-top, 0px));
    right: calc(0.75rem + var(--safe-right, 0px));
    width: 96px;
    height: 96px;
  }
}
</style>
