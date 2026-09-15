<template>
  <section class="lab">
    <div class="lab-bar">
      <span class="pf-kicker">Ir a:</span>
      <button
        v-for="landmark in MINING_LANDMARKS"
        :key="landmark.definitionId"
        type="button"
        class="pf-chip lab-go"
        :class="{ 'lab-go--on': spawnId === landmark.definitionId }"
        @click="spawnId = landmark.definitionId"
      >
        {{ NODE_BY_ID.get(landmark.definitionId)?.name }}
      </button>
      <label class="lab-detect">
        <span>Prospección {{ detectionLabel }}</span>
        <input v-model.number="detection" type="range" min="-0.05" max="1" step="0.05" aria-label="Prospección (radio de detección)">
      </label>
    </div>

    <div class="lab-stage">
      <canvas
        ref="canvasRef"
        class="lab-canvas"
        tabindex="0"
        aria-label="Pradera Brisa en el motor real de WildLands. Tocá el suelo para caminar."
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="press = null"
        @pointercancel="press = null"
        @contextmenu.prevent
      />
      <div class="lab-top">
        <ProfessionHud :session="session" profession="mining" />
        <span class="pf-demo-badge">Motor real · local</span>
      </div>
      <p v-if="!controller.selection.value" class="lab-hint">Caminá hasta una roca con vetas y tocála (o E / Espacio frente a ella).</p>
      <div v-if="controller.selection.value" class="lab-card">
        <MiningActionCard
          :key="controller.selection.value.target.nodeId"
          :session="session"
          :target="controller.selection.value.target"
          :phase="controller.phase.value"
          :outcome="controller.outcome.value"
          @mine="controller.mine()"
          @close="controller.close()"
        />
      </div>
      <button type="button" class="lab-bag-btn" :aria-expanded="bagOpen" @click="bagOpen = !bagOpen">
        Mochila {{ usedSlots(session.state.value.bag) }}/{{ session.state.value.bag.capacity }}
      </button>
      <div v-if="bagOpen" class="lab-bag">
        <InventoryGrid :session="session" :highlight="highlight" compact />
      </div>
    </div>
    <p class="lab-note">Esto es el renderer, la navegación y los nodos reales de WildLands sin presencia R30: sirve para revisar arte, animación e interacción. No se conecta a ningún servidor.</p>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'
import type { Dir } from '../../../wildlands/engine/characters'
import { WildlandsGame } from '../../../wildlands/engine/game'
import { World } from '../../../wildlands/engine/world'
import { NODE_BY_ID } from '../../domain/catalog/nodes'
import { PRADERA_LANDMARKS, PRADERA_SEED } from '../../demo/praderaLandmarks'
import type { ProfessionDemoSession } from '../../demo/useProfessionDemo'
import { usedSlots } from '../../inventory/slotInventory'
import { useMiningController } from '../../mining/useMiningController'
import InventoryGrid from '../InventoryGrid.vue'
import MiningActionCard from '../MiningActionCard.vue'
import ProfessionHud from '../ProfessionHud.vue'

// R31-C1 field lab: the real WildLands engine (renderer, chunks, navigation)
// on Pradera Brisa, without presence or Supabase, with the mining overlay.
const props = defineProps<{ session: ProfessionDemoSession }>()

const MINING_LANDMARKS = PRADERA_LANDMARKS.filter(landmark => NODE_BY_ID.get(landmark.definitionId)?.profession === 'mining')

const canvasRef = ref<HTMLCanvasElement | null>(null)
const game = shallowRef<WildlandsGame | null>(null)
const spawnId = ref('iron_vein')
const bagOpen = ref(false)
/** -0.05 means "use the worker's real detection". */
const detection = ref(-0.05)
const detectionLabel = computed(() => detection.value < 0 ? '(del Pokémon)' : `+${Math.round(detection.value * 100)} %`)

const controller = useMiningController(props.session, () => game.value, () => (detection.value < 0 ? null : detection.value))
const highlight = computed(() => (controller.outcome.value?.ok ? controller.outcome.value.placements : []))

function createGame(): void {
  controller.detach()
  game.value?.destroy()
  if (!canvasRef.value) return
  const landmark = MINING_LANDMARKS.find(entry => entry.definitionId === spawnId.value) ?? MINING_LANDMARKS[0]
  const created = new WildlandsGame(canvasRef.value, {
    pokedex: [],
    onHud: () => undefined,
    startArea: 'pradera',
    spawn: spawnBeside(landmark),
    onWorldObject: hit => controller.inspect(hit),
    isWorldObject: hit => controller.isNode(hit),
  })
  game.value = created
  controller.close()
  controller.attach()
  created.start()
}

/** A free, dry tile two steps from the node (so the approach is visible), facing it; falls back to adjacent. */
function spawnBeside(landmark: { tx: number; ty: number }): { tx: number; ty: number; dir: Dir } {
  const world = new World(PRADERA_SEED)
  const free = (tx: number, ty: number) => !world.isSolid(tx, ty) && !world.isWater(tx, ty)
  const sides: readonly [number, number, Dir][] = [[0, 1, 'up'], [0, -1, 'down'], [1, 0, 'left'], [-1, 0, 'right']]
  for (const distance of [2, 1]) {
    for (const [dx, dy, dir] of sides) {
      const tx = landmark.tx + dx * distance
      const ty = landmark.ty + dy * distance
      const path = distance === 2 ? free(landmark.tx + dx, landmark.ty + dy) : true
      if (path && free(tx, ty)) return { tx, ty, dir }
    }
  }
  return { tx: landmark.tx, ty: landmark.ty + 1, dir: 'up' }
}

const DRAG_START_PX = 12
const press = ref<{ id: number; x: number; y: number; dragging: boolean } | null>(null)
function onPointerDown(event: PointerEvent): void {
  if (!event.isPrimary || event.button > 0) return
  ;(event.target as HTMLElement).setPointerCapture(event.pointerId)
  press.value = { id: event.pointerId, x: event.offsetX, y: event.offsetY, dragging: false }
  game.value?.tap(event.offsetX, event.offsetY)
}
function onPointerMove(event: PointerEvent): void {
  const current = press.value
  if (!current || event.pointerId !== current.id) return
  if (!current.dragging && Math.hypot(event.offsetX - current.x, event.offsetY - current.y) < DRAG_START_PX) return
  current.dragging = true
  game.value?.drag(event.offsetX, event.offsetY)
}

watch(spawnId, createGame)
onMounted(createGame)
onUnmounted(() => {
  controller.detach()
  game.value?.destroy()
})
</script>

<style scoped>
.lab { display: grid; gap: 0.6rem; }
.lab-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 0.4rem; }
.lab-go { border: 1px solid var(--pf-line); font: inherit; font-size: 0.78rem; cursor: pointer; }
.lab-go--on { border-color: var(--pf-gold); background: var(--pf-gold); color: var(--pf-navy); font-weight: 700; }
.lab-detect { display: grid; gap: 0.1rem; min-width: 170px; margin-left: auto; color: var(--pf-soft); font-size: 0.76rem; }
.lab-stage { position: relative; height: min(70vh, 620px); min-height: 420px; border: 2px solid var(--pf-line); border-radius: 14px; overflow: hidden; background: #0f1a33; }
.lab-canvas { display: block; width: 100%; height: 100%; image-rendering: pixelated; touch-action: none; cursor: pointer; }
.lab-top { position: absolute; top: 0.6rem; left: 0.6rem; right: 0.6rem; display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 0.4rem; pointer-events: none; }
.lab-hint { position: absolute; left: 50%; bottom: 1rem; margin: 0; padding: 0.45rem 0.8rem; border: 2px solid var(--pf-line); border-radius: 10px; background: rgba(16, 26, 54, 0.92); color: var(--pf-soft); font-size: 0.84rem; transform: translateX(-50%); white-space: nowrap; }
.lab-card { position: absolute; left: 50%; bottom: 0.75rem; width: min(380px, calc(100% - 1.5rem)); transform: translateX(-50%); }
.lab-bag-btn { position: absolute; right: 0.6rem; top: 3.4rem; min-height: 40px; padding: 0 0.8rem; border: 2px solid var(--pf-gold); border-radius: 999px; background: rgba(16, 26, 54, 0.92); color: var(--pf-gold); font: inherit; font-weight: 700; cursor: pointer; }
.lab-bag { position: absolute; right: 0.6rem; top: 6.4rem; width: min(360px, calc(100% - 1.2rem)); max-height: calc(100% - 7rem); overflow-y: auto; }
.lab-note { margin: 0; color: var(--pf-muted); font-size: 0.76rem; }
@media (max-width: 520px) {
  .lab-stage { height: 78vh; min-height: 520px; }
  .lab-detect { margin-left: 0; }
  .lab-hint { white-space: normal; width: calc(100% - 2rem); text-align: center; }
  .lab-bag { top: auto; bottom: 0.5rem; }
}
</style>
