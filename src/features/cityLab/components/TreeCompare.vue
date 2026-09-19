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
import { treeFeet } from '../../worldAssets/trees/cityTrees'
import { cityTreeSprite, paintTreeGroundBase } from '../../worldAssets/trees/cityTreeSprites'
import { groundBaseStyle, wildGround } from '../../worldAssets/trees/treeGroundBase'
import { EDIT_LENSES, type EditLens } from '../world/labProjection'
import { LabTownArea } from '../world/labTownArea'
import { showcaseGroups, showcaseTown, wildShowcaseTrees, type ShowcaseTown } from '../world/treeShowcase'

const props = defineProps<{ clock: number }>()
const emit = defineEmits<{ close: [] }>()

type Tab = 'terrains' | 'groups' | 'wild'
const tab = ref<Tab>('terrains')
const lens = ref<EditLens>('handheld')
const zoom = ref(1)
const canvas = ref<HTMLCanvasElement | null>(null)

const scenes: Record<'terrains' | 'groups', { town: ShowcaseTown; area: LabTownArea }> = {
  terrains: scene(showcaseTown()),
  groups: scene(showcaseGroups()),
}
function scene(town: ShowcaseTown) {
  return { town, area: new LabTownArea(town.def, [], town.trees) }
}
const pradera = WORLDS.find(w => w.id === 'pradera') ?? WORLDS[0]
let wildArea: WildArea | null = null
const player = createActor({ id: 'compare-camera', kind: 'player', habitat: 'any', tx: 0, ty: 0 })

let renderer: Renderer | null = null
let frame = 0
let last = 0
let seconds = 0
let camX = scenes.terrains.town.centre.x
let camY = scenes.terrains.town.centre.y
let grab: { x: number; y: number; camX: number; camY: number } | null = null

function wild(): WildArea {
  wildArea ??= new WildArea(pradera, LOBBY_ID)
  return wildArea
}

const cityOverlays = {
  terrains: { labels: () => scenes.terrains.town.labels } satisfies SceneOverlay,
  groups: { labels: () => scenes.groups.town.labels } satisfies SceneOverlay,
}
// WildLands: the world stays untouched; the trees and their ground bases are drawn over it.
const wildOverlay: SceneOverlay = {
  ground(g, _area, x0, y0) {
    const world = wild().world
    for (const t of wildShowcaseTrees(wild().arrival())) {
      const style = groundBaseStyle(wildGround(world.tileTerrain(t.tx, t.ty + 1)), t.kind)
      paintTreeGroundBase(g, x0, y0, t.kind, t.tx, t.ty, style)
    }
  },
  sprites(): readonly OverlaySprite[] {
    const out: OverlaySprite[] = []
    for (const t of wildShowcaseTrees(wild().arrival())) {
      const sprite = cityTreeSprite(t.kind)
      const feet = treeFeet(t.tx, t.ty)
      if (sprite) out.push({ wx: feet.x, wy: feet.y, sprite })
    }
    return out
  },
  labels(): readonly OverlayLabel[] {
    return wildShowcaseTrees(wild().arrival()).slice(0, 8).map(t => {
      const feet = treeFeet(t.tx, t.ty)
      return { wx: feet.x, wy: feet.y + 2, lift: -10, text: t.kind.replace('city-tree-', ''), color: '#9fe8ff' }
    })
  },
}

watch(tab, next => {
  if (next === 'wild') {
    const a = wild().arrival()
    camX = a.tx * TILE
    camY = (a.ty - 2) * TILE
  } else {
    camX = scenes[next].town.centre.x
    camY = scenes[next].town.centre.y
  }
})

function loop(now: number): void {
  const dt = Math.max(0, Math.min(0.05, (now - last) / 1000))
  last = now
  seconds += dt
  if (renderer) {
    const t = tab.value
    const area: Area = t === 'wild' ? wild() : scenes[t].area
    const base = EDIT_LENSES[lens.value]
    const scene: Scene = {
      area, fade: 0, camX, camY, lens: { ...base, zoom: base.zoom * zoom.value }, seconds, light: lighting(props.clock),
      weather: { kind: 'clear', intensity: 0 }, player, companion: null, username: null, showPlayer: false, actors: [],
      showGrid: false, route: { tiles: [], target: null, rejected: null }, overlay: t === 'wild' ? wildOverlay : cityOverlays[t],
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
function onWheel(e: WheelEvent): void {
  zoom.value = Math.min(2.5, Math.max(0.5, zoom.value * Math.pow(1.0015, -e.deltaY)))
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
        <button type="button" :class="{ on: tab === 'terrains' }" @click="tab = 'terrains'">Terrenos: bosque vs placed</button>
        <button type="button" :class="{ on: tab === 'groups' }" @click="tab = 'groups'">Grupos</button>
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
        <template v-if="tab === 'terrains'">
          <b>F·</b> = árbol generado por el terreno bosque (TownArea, PNG original con sombra horneada). En celeste, las 8 variantes
          colocables con su base de suelo. Bandas: pasto, plaza, borde de calle, bosque. Arrastrá para mover la cámara.
        </template>
        <template v-else-if="tab === 'groups'">
          Patrones de ciudad con variantes elegidas como "Árbol aleatorio": lineal, jardín, bosque pequeño, plaza y borde de bosque.
        </template>
        <template v-else>
          Los mismos assets de ciudad sobre el mundo procedural real de {{ pradera.name }}, junto a sus árboles actuales.
          Sólo se dibujan: no se agregan al mundo ni cambian el generador.
        </template>
      </p>
      <canvas ref="canvas" class="cmp-canvas" @pointerdown="down" @pointermove="move" @pointerup="up" @pointercancel="up" @wheel.prevent="onWheel" />
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
