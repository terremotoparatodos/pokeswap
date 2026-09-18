<script setup lang="ts">
// City Mapping Lab — "Comparar árboles" (DEV only).
//
// Human visual review of the city tree family, drawn by the real WildLands
// renderer: forest-generated vs placed trees on grass, plaza, street edge and
// forest; and the very same assets standing in a real procedural world.
// Nothing here is saved or reaches production.

import { onMounted, onUnmounted, ref, watch } from 'vue'
import { LOBBY_ID, WORLDS } from '../../wildlands/areas/atlas'
import { WildArea } from '../../wildlands/areas/wildArea'
import { createActor } from '../../wildlands/engine/actors'
import type { Area } from '../../wildlands/engine/area'
import { lighting } from '../../wildlands/engine/atmosphere'
import { Renderer, type Scene } from '../../wildlands/engine/renderer'
import type { OverlayLabel, OverlaySprite, SceneOverlay } from '../../wildlands/engine/sceneOverlay'
import { TILE } from '../../wildlands/engine/world'
import { cityTreeSprite } from '../../worldAssets/trees/cityTreeSprites'
import { EDIT_LENSES, type EditLens } from '../world/labProjection'
import { LabTownArea } from '../world/labTownArea'
import { showcaseTown, wildShowcaseTrees } from '../world/treeShowcase'

const props = defineProps<{ clock: number }>()
const emit = defineEmits<{ close: [] }>()

type Tab = 'city' | 'wild'
const tab = ref<Tab>('city')
const lens = ref<EditLens>('handheld')
const zoom = ref(1)
const canvas = ref<HTMLCanvasElement | null>(null)

const town = showcaseTown()
const cityArea = new LabTownArea(town.def, [], town.trees)
const pradera = WORLDS.find(w => w.id === 'pradera') ?? WORLDS[0]
let wildArea: WildArea | null = null
const player = createActor({ id: 'compare-camera', kind: 'player', habitat: 'any', tx: 0, ty: 0 })

let renderer: Renderer | null = null
let frame = 0
let last = 0
let seconds = 0
let camX = town.centre.x
let camY = town.centre.y
let grab: { x: number; y: number; camX: number; camY: number } | null = null

function wild(): WildArea {
  wildArea ??= new WildArea(pradera, LOBBY_ID)
  return wildArea
}

const cityOverlay: SceneOverlay = { labels: () => town.labels }
const wildOverlay: SceneOverlay = {
  sprites(): readonly OverlaySprite[] {
    const out: OverlaySprite[] = []
    for (const t of wildShowcaseTrees(wild().arrival())) {
      const sprite = cityTreeSprite(t.kind)
      if (sprite) out.push({ wx: t.x, wy: t.y, sprite })
    }
    return out
  },
  labels(): readonly OverlayLabel[] {
    return wildShowcaseTrees(wild().arrival()).map(t => ({ wx: t.x, wy: t.y + 2, lift: -10, text: t.kind.replace('city-tree-', ''), color: '#9fe8ff' }))
  },
}

watch(tab, next => {
  if (next === 'wild') {
    const a = wild().arrival()
    camX = a.tx * TILE
    camY = (a.ty - 2) * TILE
  } else {
    camX = town.centre.x
    camY = town.centre.y
  }
})

function loop(now: number): void {
  const dt = Math.max(0, Math.min(0.05, (now - last) / 1000))
  last = now
  seconds += dt
  if (renderer) {
    const area: Area = tab.value === 'city' ? cityArea : wild()
    const base = EDIT_LENSES[lens.value]
    const scene: Scene = {
      area, fade: 0, camX, camY, lens: { ...base, zoom: base.zoom * zoom.value }, seconds, light: lighting(props.clock),
      weather: { kind: 'clear', intensity: 0 }, player, companion: null, username: null, showPlayer: false, actors: [],
      showGrid: false, route: { tiles: [], target: null, rejected: null }, overlay: tab.value === 'city' ? cityOverlay : wildOverlay,
    }
    renderer.render(scene, dt)
    area.tick()
  }
  frame = requestAnimationFrame(loop)
}

// Drag pans; the scale is approximate (screen px → world px at the focus).
function down(e: PointerEvent): void {
  grab = { x: e.clientX, y: e.clientY, camX, camY }
  ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
}
function move(e: PointerEvent): void {
  if (!grab) return
  const k = EDIT_LENSES[lens.value].zoom * zoom.value
  camX = grab.camX - (e.clientX - grab.x) / k
  camY = grab.camY - (e.clientY - grab.y) / k
}
function up(): void {
  grab = null
}

onMounted(() => {
  if (!canvas.value) return
  renderer = new Renderer(canvas.value)
  last = performance.now()
  frame = requestAnimationFrame(loop)
})
onUnmounted(() => cancelAnimationFrame(frame))
</script>

<template>
  <div class="cmp-backdrop" @click.self="emit('close')">
    <div class="cmp" role="dialog" aria-modal="true">
      <header>
        <strong>Comparar árboles</strong>
        <button type="button" :class="{ on: tab === 'city' }" @click="tab = 'city'">Ciudad: bosque vs placed</button>
        <button type="button" :class="{ on: tab === 'wild' }" @click="tab = 'wild'">WildLands DEV (Pradera)</button>
        <label>Lente
          <select v-model="lens">
            <option value="handheld">Vista jugador</option>
            <option value="plan">Planta</option>
            <option value="dramatic">Dramática</option>
          </select>
        </label>
        <label>Zoom <input v-model.number="zoom" type="range" min="0.5" max="2.5" step="0.05"></label>
        <button type="button" class="close" @click="emit('close')">✕</button>
      </header>
      <p class="note">
        <template v-if="tab === 'city'">
          <b>F·</b> = árbol generado por el terreno bosque (TownArea). <b>P·</b> = el mismo asset colocado a mano.
          Bandas: pasto, plaza, borde de calle, bosque. Arrastrá para mover la cámara.
        </template>
        <template v-else>
          Los mismos assets de ciudad sobre el mundo procedural real de {{ pradera.name }}, junto a sus árboles actuales.
          Sólo se dibujan: no se agregan al mundo ni cambian el generador.
        </template>
      </p>
      <canvas ref="canvas" class="cmp-canvas" @pointerdown="down" @pointermove="move" @pointerup="up" @pointercancel="up" />
    </div>
  </div>
</template>

<style scoped>
.cmp-backdrop { position: fixed; inset: 0; z-index: 30; display: grid; place-items: center; background: rgba(0, 0, 0, 0.6); }
.cmp { display: flex; flex-direction: column; gap: 6px; width: min(1100px, 95vw); height: min(760px, 92vh); padding: 10px; border-radius: 10px; background: #141a2b; color: #dfe7ff; font: 12px system-ui, sans-serif; }
header { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
header label { display: flex; align-items: center; gap: 4px; color: #aab4d4; }
.close { margin-left: auto; }
button, select { padding: 4px 9px; border: 1px solid #34406a; border-radius: 6px; background: #1d2540; color: #dfe7ff; font: inherit; cursor: pointer; }
button.on { background: #3c5bd6; border-color: #6d8cff; }
.note { margin: 0; color: #aab4d4; }
.cmp-canvas { flex: 1; min-height: 0; width: 100%; border-radius: 8px; image-rendering: pixelated; cursor: grab; touch-action: none; }
</style>
