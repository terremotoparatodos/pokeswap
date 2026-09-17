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
      <label class="lab-worker">
        <span>Trabajador</span>
        <select :value="session.state.value.workers.mining ?? ''" aria-label="Pokémon trabajador" @change="setWorker(($event.target as HTMLSelectElement).value)">
          <option value="">Sin Pokémon</option>
          <option v-for="worker in DEMO_WORKERS" :key="worker.speciesId" :value="worker.speciesId">{{ worker.name }}</option>
        </select>
      </label>
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
      <button type="button" class="lab-bag-btn" :aria-expanded="bagOpen" @click="bagOpen = !bagOpen">
        Mochila {{ usedSlots(session.state.value.bag) }}/{{ session.state.value.bag.capacity }}
      </button>
      <!-- Bag and card share one bottom-anchored column so they never cover each other. -->
      <div class="lab-dock">
        <div v-if="bagOpen" class="lab-bag">
          <InventoryGrid :session="session" :highlight="highlight" compact />
        </div>
        <p v-if="!controller.selection.value" class="lab-hint">Caminá hasta una roca con vetas y tocála (o E / Espacio frente a ella).</p>
        <div v-else class="lab-card">
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
      </div>
    </div>
    <p class="lab-note">Esto es el renderer, la navegación y los nodos reales de WildLands sin presencia R30: sirve para revisar arte, animación e interacción. No se conecta a ningún servidor.</p>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'
import { WildlandsGame } from '../../../wildlands/engine/game'
import { World } from '../../../wildlands/engine/world'
import { NODE_BY_ID } from '../../domain/catalog/nodes'
import { setDemoWorker } from '../../demo/demoSession'
import { DEMO_WORKERS } from '../../demo/demoWorkers'
import { PRADERA_LANDMARKS, PRADERA_SEED } from '../../demo/praderaLandmarks'
import type { ProfessionDemoSession } from '../../demo/useProfessionDemo'
import { usedSlots } from '../../inventory/slotInventory'
import { useMiningController } from '../../mining/useMiningController'
import InventoryGrid from '../InventoryGrid.vue'
import MiningActionCard from '../MiningActionCard.vue'
import ProfessionHud from '../ProfessionHud.vue'
import { spawnBeside } from './spawnBeside'

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
const setWorker = (value: string) => props.session.update(state => setDemoWorker(state, 'mining', value ? Number(value) : null))
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
    spawn: spawnBeside(new World(PRADERA_SEED), landmark),
    onWorldObject: hit => controller.inspect(hit),
    isWorldObject: hit => controller.isNode(hit),
  })
  game.value = created
  controller.close()
  controller.attach()
  created.start()
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
.lab-worker { display: grid; gap: 0.1rem; margin-left: auto; color: var(--pf-soft); font-size: 0.76rem; }
.lab-worker select { min-height: 36px; border: 1px solid var(--pf-line); border-radius: 8px; background: var(--pf-navy-2); color: inherit; font: inherit; }
.lab-detect { display: grid; gap: 0.1rem; min-width: 170px; color: var(--pf-soft); font-size: 0.76rem; }
.lab-stage { position: relative; height: min(70vh, 620px); min-height: 420px; border: 2px solid var(--pf-line); border-radius: 14px; overflow: hidden; background: #0f1a33; }
.lab-canvas { display: block; width: 100%; height: 100%; image-rendering: pixelated; touch-action: none; cursor: pointer; }
.lab-top { position: absolute; top: 0.6rem; left: 0.6rem; right: 0.6rem; display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 0.4rem; pointer-events: none; }
.lab-dock { position: absolute; top: 6.4rem; right: 0.6rem; bottom: 0.75rem; left: 0.6rem; display: flex; flex-direction: column; justify-content: flex-end; align-items: center; gap: 0.5rem; pointer-events: none; }
.lab-dock > * { pointer-events: auto; }
.lab-hint { margin: 0; padding: 0.45rem 0.8rem; border: 2px solid var(--pf-line); border-radius: 10px; background: rgba(16, 26, 54, 0.92); color: var(--pf-soft); font-size: 0.84rem; white-space: nowrap; }
.lab-card { flex: none; width: min(380px, 100%); }
.lab-bag-btn { position: absolute; right: 0.6rem; top: 3.4rem; min-height: 40px; padding: 0 0.8rem; border: 2px solid var(--pf-gold); border-radius: 999px; background: rgba(16, 26, 54, 0.92); color: var(--pf-gold); font: inherit; font-weight: 700; cursor: pointer; }
/* Shrinks and scrolls inside the dock, so the card below always stays whole. */
.lab-bag { flex: 0 1 auto; align-self: flex-end; width: min(360px, 100%); min-height: 0; overflow-y: auto; }
.lab-note { margin: 0; color: var(--pf-muted); font-size: 0.76rem; }
@media (max-width: 520px) {
  .lab-stage { height: 78vh; min-height: 520px; }
  .lab-detect { margin-left: 0; }
  .lab-hint { white-space: normal; text-align: center; }
  .lab-bag { align-self: stretch; }
}
</style>
