<template>
  <div class="ra">
    <canvas ref="canvasRef" class="ra-canvas" aria-label="Mapa del Rancho de Guti" role="img" />

    <div class="ra-top">
      <RanchSearch :index="index" @pick="goTo" />
    </div>

    <div class="ra-zoom">
      <button type="button" aria-label="Acercar" @click="nudgeZoom(1)">+</button>
      <button type="button" aria-label="Alejar" @click="nudgeZoom(-1)">−</button>
    </div>

    <p v-if="notice" class="ra-notice" role="status">{{ notice }}</p>

    <p v-if="debug" class="ra-debug">
      {{ stats.residents }} habitantes · {{ stats.visible }} a la vista · {{ stats.fps }} fps ·
      {{ stats.chunks }} chunks · {{ stats.species }} especies
    </p>

    <ResidentCard v-if="selected" :resident="selected" @close="close" />
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import RanchSearch from './components/RanchSearch.vue'
import ResidentCard from './components/ResidentCard.vue'
import { createMockSnapshot } from './data/mockSnapshot'
import { readRanchParams, urlWithUser } from './data/urlParams'
import type { RanchResident } from './domain/membership'
import { buildSearchIndex, findByName, type SearchEntry } from './domain/search'
import { RanchScene, type RanchStats } from './render/ranchScene'

/** How long a "nobody with that name" message stays up. */
const NOTICE_MS = 5000

const canvasRef = ref<HTMLCanvasElement | null>(null)
const selected = shallowRef<RanchResident | null>(null)
const index = shallowRef<SearchEntry<RanchResident>[]>([])
const stats = ref<RanchStats>({ residents: 0, visible: 0, fps: 0, chunks: 0, species: 0 })
const notice = ref('')
const debug = ref(false)

let scene: RanchScene | null = null
let statsTimer = 0
let noticeTimer = 0

const params = readRanchParams(window.location.search)

/** Keeps the address bar on whoever is open, so the page is always shareable. */
function show(resident: RanchResident | null): void {
  selected.value = resident
  history.replaceState(null, '', urlWithUser(window.location.href, resident?.displayName ?? null))
}

function goTo(resident: RanchResident): void {
  scene?.focus(resident.id)
  show(resident)
}

function close(): void {
  scene?.focus(null)
  show(null)
}

function nudgeZoom(direction: number): void {
  const camera = scene?.camera
  if (!camera) return
  camera.stop()
  camera.zoomAt(camera.viewW / 2, camera.viewH / 2, camera.zoom * (direction > 0 ? 1.5 : 1 / 1.5))
}

function say(message: string): void {
  notice.value = message
  window.clearTimeout(noticeTimer)
  noticeTimer = window.setTimeout(() => (notice.value = ''), NOTICE_MS)
}

onMounted(() => {
  const canvas = canvasRef.value
  if (!canvas) return
  debug.value = params.debug

  scene = new RanchScene(canvas, {
    initialZoom: window.innerWidth < 640 ? 1.5 : 2,
    onSelect: show,
  })
  // The mock stands in for the backend: it decides species and homes, exactly
  // as the server will, and the page only renders the snapshot it returns.
  const snapshot = createMockSnapshot(params.mock, scene.capacity)
  scene.setSnapshot(snapshot)
  index.value = buildSearchIndex(snapshot.residents, resident => resident.displayName)
  scene.start()

  if (params.user) {
    const resident = findByName(index.value, params.user)
    if (resident) {
      scene.focus(resident.id, { instant: true })
      selected.value = resident

    } else {
      say(`Nadie llamado “${params.user}” vive en el Rancho.`)
    }
  }

  if (params.debug) statsTimer = window.setInterval(() => (stats.value = scene!.stats()), 500)
})

onBeforeUnmount(() => {
  window.clearInterval(statsTimer)
  window.clearTimeout(noticeTimer)
  scene?.destroy()
  scene = null
})
</script>

<style>
/* The ranch fills the window and never scrolls: the canvas owns the gestures. */
html,
body {
  margin: 0;
  height: 100%;
  overflow: hidden;
  background: #24401f;
  overscroll-behavior: none;
}
</style>

<style scoped>
.ra {
  position: fixed;
  inset: 0;
}
.ra-canvas {
  display: block;
  width: 100%;
  height: 100%;
  /* Without this a one-finger pan scrolls the page instead of the map. */
  touch-action: none;
  cursor: grab;
}
.ra-canvas:active {
  cursor: grabbing;
}
.ra-top {
  position: absolute;
  top: max(12px, env(safe-area-inset-top));
  left: 12px;
  z-index: 10;
}
.ra-zoom {
  position: absolute;
  right: 12px;
  bottom: max(18px, env(safe-area-inset-bottom));
  z-index: 10;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.ra-zoom button {
  width: 42px;
  height: 42px;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 12px;
  background: rgba(20, 22, 26, 0.82);
  color: #fff;
  font: 600 20px/1 system-ui, sans-serif;
  cursor: pointer;
}
.ra-notice {
  position: absolute;
  left: 50%;
  bottom: max(22px, env(safe-area-inset-bottom));
  transform: translateX(-50%);
  z-index: 10;
  margin: 0;
  max-width: calc(100vw - 96px);
  padding: 9px 14px;
  border-radius: 999px;
  background: rgba(20, 22, 26, 0.88);
  color: #f1f4f8;
  font: 400 14px/1.3 system-ui, -apple-system, sans-serif;
  text-align: center;
}
.ra-debug {
  position: absolute;
  top: max(12px, env(safe-area-inset-top));
  right: 12px;
  z-index: 10;
  margin: 0;
  padding: 6px 10px;
  border-radius: 8px;
  background: rgba(20, 22, 26, 0.82);
  color: #cfe6c8;
  font: 400 12px/1.3 ui-monospace, SFMono-Regular, Menlo, monospace;
}
</style>
