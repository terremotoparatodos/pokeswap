<template>
  <div
    class="map-container"
    ref="containerRef"
    @mousedown="onMouseDown"
    @mousemove="onMouseMove"
    @mouseup="onMouseUp"
    @mouseleave="onMouseUp"
    @wheel.prevent="onWheel"
  >
    <!-- World -->
    <div class="map-world" :style="worldStyle">
      <!-- Zone tiles -->
      <img
        v-for="zone in ZONES"
        :key="zone.name"
        :src="zone.img"
        :alt="zone.name"
        :style="{
          position: 'absolute',
          left: zone.x + 'px',
          top:  zone.y + 'px',
          width: zone.w + 'px',
        }"
        draggable="false"
      />

      <!-- Entities -->
      <button
        v-for="entity in entityList"
        :key="entity.id"
        class="map-entity"
        :class="{ 'map-entity--wild': entity.isWild, 'map-entity--selected': selectedId === entity.id }"
        :style="{ left: entity.x + 'px', top: entity.y + 'px' }"
        :title="entity.pokemon.name_es"
        @click.stop="selectedId = entity.id"
      >
        <img
          v-if="entity.pokemon.sprite_url"
          :src="entity.pokemon.sprite_url"
          :alt="entity.pokemon.name_es"
          class="map-entity-sprite"
          draggable="false"
        />
        <span v-else class="map-entity-fallback">{{ entity.pokemon.name_es[0] }}</span>
      </button>
    </div>

    <!-- Controls -->
    <div class="map-controls">
      <button class="map-ctrl-btn" @click="camera.setScale(cameraState.scale + 0.2)" title="Acercar">+</button>
      <button class="map-ctrl-btn" @click="camera.setScale(cameraState.scale - 0.2)" title="Alejar">−</button>
      <button class="map-ctrl-btn" @click="camera.reset()" title="Resetear vista">⌖</button>
    </div>

    <!-- Realtime indicator -->
    <div class="map-status" :class="{ connected }">
      {{ connected ? '● EN VIVO' : '○ conectando…' }}
    </div>

    <!-- Activity feed -->
    <aside v-if="recentActivity.length" class="map-activity">
      <p class="map-activity-title">Actividad</p>
      <ul class="map-activity-list">
        <li
          v-for="event in recentActivity"
          :key="event.id"
          class="map-activity-item"
        >
          <span class="map-activity-type">{{ formatActivityType(event.type) }}</span>
          <span v-if="event.pokemon_id"> #{{ event.pokemon_id }}</span>
        </li>
      </ul>
    </aside>

    <!-- Selected entity panel -->
    <div v-if="selectedEntity" class="map-panel">
      <button class="map-panel-close" @click="selectedId = null">✕</button>
      <p class="map-panel-name">{{ selectedEntity.pokemon.name_es }}</p>
      <div class="map-panel-types">
        <span class="map-panel-type">{{ selectedEntity.pokemon.type1 }}</span>
        <span v-if="selectedEntity.pokemon.type2" class="map-panel-type">
          {{ selectedEntity.pokemon.type2 }}
        </span>
      </div>
      <template v-if="selectedEntity.slot?.owner_username">
        <p class="map-panel-owner">Dueño: {{ selectedEntity.slot.owner_username }}</p>
        <p class="map-panel-price">
          {{ selectedEntity.slot.current_price.toLocaleString('es-AR') }} tokens
        </p>
      </template>
      <p v-else class="map-panel-wild">Salvaje</p>
    </div>

    <!-- Loading overlay -->
    <div v-if="isLoading" class="map-loading">Cargando mapa…</div>
    <p v-if="loadError" class="map-load-error" role="alert">{{ loadError }}</p>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useAuth } from '../../auth/composables/useAuth'
import { useCamera } from '../composables/useCamera'
import { useMapEntities } from '../composables/useMapEntities'
import { useMapRealtime } from '../composables/useMapRealtime'
import { fetchMapData, fetchRecentActivity } from '../api/mapApi'
import { ZONES, MAP_W, MAP_H, WILD_ROTATE_MS } from '../data/mapConfig'
import type { Pokemon, Slot } from '../../../shared/types/database'
import type { MapEntity } from '../types'

const { user } = useAuth()

const containerRef = ref<HTMLElement | null>(null)
const camera = useCamera(
  () => containerRef.value?.offsetWidth  ?? window.innerWidth,
  () => containerRef.value?.offsetHeight ?? (window.innerHeight - 48),
)

const { entities: entityList, spawnAll, applySlotPatch, rotateWildPool } = useMapEntities()

const _pokemon = ref<Pokemon[]>([])
const _slots   = ref<Record<number, Slot>>({})

const realtime = useMapRealtime((patch) => {
  applySlotPatch(patch, _pokemon.value, _slots.value, user.value?.id ?? null)
})

const { recentActivity, connected, seedActivity } = realtime

const selectedId   = ref<number | null>(null)
const isLoading    = ref(false)
const loadError    = ref<string | null>(null)

const cameraState  = computed(() => camera.state.value)
const worldStyle   = computed(() => ({
  transform:        camera.transform.value,
  transformOrigin:  '0 0',
  width:  MAP_W + 'px',
  height: MAP_H + 'px',
}))

const selectedEntity = computed<MapEntity | null>(() => {
  if (selectedId.value === null) return null
  return entityList.value.find((e) => e.id === selectedId.value) ?? null
})

// Pan state
let _dragging = false
let _lastX    = 0
let _lastY    = 0

function onMouseDown(e: MouseEvent) {
  _dragging = true
  _lastX = e.clientX
  _lastY = e.clientY
}
function onMouseMove(e: MouseEvent) {
  if (!_dragging) return
  camera.pan(e.clientX - _lastX, e.clientY - _lastY)
  _lastX = e.clientX
  _lastY = e.clientY
}
function onMouseUp() { _dragging = false }

function onWheel(e: WheelEvent) {
  const rect = containerRef.value?.getBoundingClientRect()
  const px = rect ? e.clientX - rect.left : e.clientX
  const py = rect ? e.clientY - rect.top  : e.clientY
  camera.zoom(-Math.sign(e.deltaY), px, py)
}

function formatActivityType(type: string): string {
  const labels: Record<string, string> = {
    claim: 'Captura', steal: 'Robo',
    unlock_region: 'Región', unlock_legendary: 'Legendario', free_claim: 'Gratis',
  }
  return labels[type] ?? type
}

let _rotateTimer: ReturnType<typeof setInterval> | null = null

onMounted(async () => {
  isLoading.value = true
  loadError.value = null
  try {
    const [mapData, activity] = await Promise.all([
      fetchMapData(),
      fetchRecentActivity(),
    ])
    _pokemon.value = mapData.pokemon
    _slots.value   = mapData.slots
    spawnAll(mapData.pokemon, mapData.slots, user.value?.id ?? null)
    seedActivity(activity)
    camera.reset()
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : 'Error al cargar el mapa'
  } finally {
    isLoading.value = false
  }

  _rotateTimer = setInterval(() => {
    rotateWildPool(_pokemon.value, _slots.value)
  }, WILD_ROTATE_MS)
})

onUnmounted(() => {
  if (_rotateTimer) clearInterval(_rotateTimer)
})
</script>

<style scoped>
.map-container {
  position: relative;
  width: 100%;
  height: calc(100vh - 3rem);
  overflow: hidden;
  background: #1a1a2e;
  cursor: grab;
  user-select: none;
}

.map-container:active {
  cursor: grabbing;
}

.map-world {
  position: absolute;
  top: 0;
  left: 0;
  will-change: transform;
}

/* Entities */
.map-entity {
  position: absolute;
  transform: translate(-50%, -50%);
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  transition: filter 0.15s;
}

.map-entity:hover {
  filter: brightness(1.3) drop-shadow(0 0 4px #fff8);
}

.map-entity--selected {
  filter: brightness(1.4) drop-shadow(0 0 6px #f4a261);
}

.map-entity--wild {
  opacity: 0.85;
}

.map-entity-sprite {
  width: 32px;
  height: 32px;
  object-fit: contain;
  image-rendering: pixelated;
  display: block;
}

.map-entity-fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: rgba(255,255,255,0.15);
  font-size: 0.75rem;
  color: #fff;
}

/* Controls */
.map-controls {
  position: absolute;
  bottom: 1rem;
  right: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  z-index: 10;
}

.map-ctrl-btn {
  width: 2rem;
  height: 2rem;
  border: 1px solid rgba(255,255,255,0.3);
  background: rgba(0,0,0,0.6);
  color: #fff;
  border-radius: 4px;
  cursor: pointer;
  font-size: 1rem;
  line-height: 1;
}

.map-ctrl-btn:hover {
  background: rgba(0,0,0,0.85);
}

/* Status */
.map-status {
  position: absolute;
  top: 0.6rem;
  right: 0.75rem;
  font-size: 0.7rem;
  color: rgba(255,255,255,0.4);
  z-index: 10;
}

.map-status.connected {
  color: #2a9d8f;
}

/* Activity feed */
.map-activity {
  position: absolute;
  top: 0.6rem;
  left: 0.6rem;
  width: 160px;
  background: rgba(0,0,0,0.65);
  border-radius: 6px;
  padding: 0.5rem 0.6rem;
  z-index: 10;
  backdrop-filter: blur(4px);
}

.map-activity-title {
  font-size: 0.65rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: rgba(255,255,255,0.45);
  margin: 0 0 0.35rem;
}

.map-activity-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.map-activity-item {
  font-size: 0.75rem;
  color: rgba(255,255,255,0.75);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.map-activity-type {
  color: #f4a261;
  margin-right: 0.25rem;
}

/* Selected panel */
.map-panel {
  position: absolute;
  bottom: 1rem;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(0,0,0,0.75);
  border: 1px solid rgba(255,255,255,0.15);
  border-radius: 8px;
  padding: 0.75rem 1rem;
  min-width: 180px;
  z-index: 10;
  backdrop-filter: blur(6px);
  color: #fff;
}

.map-panel-close {
  position: absolute;
  top: 0.4rem;
  right: 0.5rem;
  background: none;
  border: none;
  color: rgba(255,255,255,0.5);
  cursor: pointer;
  font-size: 0.8rem;
}

.map-panel-name {
  font-weight: 700;
  font-size: 1rem;
  margin: 0 0 0.4rem;
  text-transform: capitalize;
}

.map-panel-types {
  display: flex;
  gap: 0.3rem;
  margin-bottom: 0.5rem;
}

.map-panel-type {
  font-size: 0.7rem;
  padding: 0.1rem 0.4rem;
  border-radius: 3px;
  background: rgba(255,255,255,0.15);
  text-transform: capitalize;
}

.map-panel-owner,
.map-panel-price {
  font-size: 0.82rem;
  margin: 0.15rem 0;
  opacity: 0.8;
}

.map-panel-wild {
  font-size: 0.82rem;
  opacity: 0.55;
  margin: 0;
}

/* Loading */
.map-loading {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0,0,0,0.6);
  color: #fff;
  font-size: 1rem;
  z-index: 20;
}

.map-load-error {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  color: #e63946;
  z-index: 20;
}
</style>
