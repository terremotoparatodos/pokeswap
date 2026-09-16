<template>
  <section class="lab">
    <div class="lab-bar">
      <span class="pf-kicker">Ir a:</span>
      <button
        v-for="spot in PLACES"
        :key="spot.id"
        type="button"
        class="pf-chip lab-go"
        :class="{ 'lab-go--on': spot.id === place }"
        @click="place = spot.id"
      >{{ spot.label }}</button>
      <span class="pf-chip lab-where">{{ whereLabel }}</span>
      <span class="pf-chip lab-where">{{ hereLabel }}</span>
      <label class="lab-worker">
        <span>Trabajador</span>
        <select :value="session.state.value.workers.alchemy ?? ''" aria-label="Pokémon trabajador" @change="setWorker(($event.target as HTMLSelectElement).value)">
          <option value="">Sin Pokémon</option>
          <option v-for="worker in DEMO_WORKERS" :key="worker.speciesId" :value="worker.speciesId">{{ worker.name }}</option>
        </select>
      </label>
    </div>

    <div class="lab-stage">
      <canvas
        ref="canvasRef"
        class="lab-canvas"
        tabindex="0"
        aria-label="Pradera Brisa en el motor real de WildLands, con la Mesa de Alquimia y las plantas recolectables. Tocá una planta o la mesa."
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="press = null"
        @pointercancel="press = null"
        @contextmenu.prevent
      />
      <div class="lab-top">
        <ProfessionHud :session="session" profession="alchemy" />
        <span class="pf-demo-badge">Motor real · local</span>
      </div>
      <button type="button" class="lab-bag-btn" :aria-expanded="bagOpen" @click="bagOpen = !bagOpen">
        Mochila {{ usedSlots(session.state.value.bag) }}/{{ session.state.value.bag.capacity }}
      </button>
      <div class="lab-dock">
        <div v-if="bagOpen" class="lab-bag">
          <InventoryGrid :session="session" :highlight="highlight" compact />
        </div>
        <div v-if="forage.selection.value" class="lab-card">
          <ForageActionCard
            :key="forage.selection.value.target.nodeId"
            :session="session"
            :target="forage.selection.value.target"
            :phase="forage.phase.value"
            :outcome="forage.outcome.value"
            @gather="forage.gather()"
            @close="forage.close()"
          />
        </div>
        <div v-else-if="alchemy.open.value" class="lab-card">
          <AlchemyStationCard
            :recipes="alchemy.recipes.value"
            :detail="alchemy.view.value"
            :phase="alchemy.phase.value"
            :quantity="alchemy.quantity.value"
            :max-quantity="alchemy.maxQuantity.value"
            :level="alchemy.level.value"
            :outcome="alchemy.outcome.value"
            :progress="alchemy.progress.value"
            @select="alchemy.select($event)"
            @quantity="alchemy.setQuantity($event)"
            @brew="alchemy.brew()"
            @close="alchemy.close()"
          />
        </div>
        <p v-else class="lab-hint">{{ hint }}</p>
      </div>
    </div>
    <p class="lab-note">
      Alquimia recolecta y procesa: bayas y hierbas se juntan <strong>a mano</strong> (el catálogo no pide herramienta),
      la arboleda y la flor de escarcha piden <strong>hoz</strong>. La mesa se deriva del mundo y preparar no consume energía.
      La mochila es la misma en los dos lados: lo que recolectás acá se usa allá.
    </p>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'
import type { Dir } from '../../../wildlands/engine/characters'
import { WildlandsGame } from '../../../wildlands/engine/game'
import { World } from '../../../wildlands/engine/world'
import { alchemyStationTile, type StationTile } from '../../alchemy/stationPlacement'
import { useAlchemyController } from '../../alchemy/useAlchemyController'
import { NODE_BY_ID } from '../../domain/catalog/nodes'
import { setDemoWorker } from '../../demo/demoSession'
import { DEMO_WORKERS } from '../../demo/demoWorkers'
import { PRADERA_LANDMARKS, PRADERA_SEED, PRADERA_SPAWN } from '../../demo/praderaLandmarks'
import type { ProfessionDemoSession } from '../../demo/useProfessionDemo'
import { nodeAt, worldNodePort } from '../../domain/nodePlacement'
import { useForageController } from '../../forage/useForageController'
import { usedSlots } from '../../inventory/slotInventory'
import { CompositeOverlay } from '../../overworld/compositeOverlay'
import AlchemyStationCard from '../AlchemyStationCard.vue'
import ForageActionCard from '../ForageActionCard.vue'
import InventoryGrid from '../InventoryGrid.vue'
import ProfessionHud from '../ProfessionHud.vue'

// R31-C4 field lab, extended in R31-C4.1: the real WildLands engine with both
// halves of Alchemy attached — the bench in its clearing and the four forage
// nodes on their own props. One session, so a berry picked here is an
// ingredient there.
const props = defineProps<{ session: ProfessionDemoSession }>()

/** Alchemy's own gathering nodes, in catalog order, plus the bench. */
const FORAGE_LANDMARKS = PRADERA_LANDMARKS.filter(landmark => NODE_BY_ID.get(landmark.definitionId)?.profession === 'alchemy')
const PLACES = [
  { id: 'bench', label: 'Mesa de Alquimia' },
  ...FORAGE_LANDMARKS.map(landmark => ({ id: landmark.definitionId, label: NODE_BY_ID.get(landmark.definitionId)?.name ?? landmark.definitionId })),
]

const canvasRef = ref<HTMLCanvasElement | null>(null)
const game = shallowRef<WildlandsGame | null>(null)
const place = ref<string>('bench')
const bagOpen = ref(false)

/** The bench tile, derived from the same world the engine builds. */
const station = computed<StationTile | null>(() => {
  const world = new World(PRADERA_SEED)
  const port = worldNodePort(world)
  return alchemyStationTile({
    isSolid: (tx, ty) => world.isSolid(tx, ty),
    isWater: (tx, ty) => world.isWater(tx, ty),
    hasNode: (tx, ty) => nodeAt(port, tx, ty) !== null,
  }, PRADERA_SPAWN)
})

// The controller gets the raw anchor, never the derived tile: the overlay runs
// the same search and deriving twice would move the bench.
const alchemy = useAlchemyController(props.session, () => game.value, () => PRADERA_SPAWN)
const forage = useForageController(props.session, () => game.value)
/** The engine holds one overlay, so both halves share a composite. */
const overlay = new CompositeOverlay(forage.overlay, alchemy.overlay)

const highlight = computed(() => (forage.outcome.value?.ok ? forage.outcome.value.placements : []))
const whereLabel = computed(() => (place.value === 'bench'
  ? station.value ? `mesa en ${station.value.tx}, ${station.value.ty}` : 'sin claro libre'
  : (() => {
    const landmark = FORAGE_LANDMARKS.find(entry => entry.definitionId === place.value)
    return landmark ? `planta en ${landmark.tx}, ${landmark.ty}` : ''
  })()))
/** Where the player is standing, so a review can say "the plant is two tiles up". */
const here = ref<{ tx: number; ty: number } | null>(null)
const hereLabel = computed(() => (here.value ? `jugador en ${here.value.tx}, ${here.value.ty}` : 'sin jugador'))

const hint = computed(() => (place.value === 'bench'
  ? 'Caminá hasta la mesa de alquimia y tocála para abrirla.'
  : 'Buscá la planta con fruto y tocála para recolectarla.'))

const setWorker = (value: string) => props.session.update(state => setDemoWorker(state, 'alchemy', value ? Number(value) : null))

function createGame(): void {
  forage.detach()
  alchemy.detach()
  game.value?.destroy()
  if (!canvasRef.value) return
  const landmark = FORAGE_LANDMARKS.find(entry => entry.definitionId === place.value)
  const tile = landmark ?? station.value ?? PRADERA_SPAWN
  alchemy.setStation(station.value ?? PRADERA_SPAWN)
  const created = new WildlandsGame(canvasRef.value, {
    pokedex: [],
    onHud: () => undefined,
    startArea: 'pradera',
    spawn: spawnBeside(tile),
    onWorldObject: hit => inspect(hit),
    isWorldObject: hit => forage.isPlant(hit) || alchemy.isStation(hit),
  })
  game.value = created
  forage.close()
  alchemy.close()
  created.setSceneOverlay(overlay)
  created.start()
}

/** A plant wins over the bench: they are never on the same tile anyway. */
function inspect(hit: { area: Parameters<typeof forage.isPlant>[0]['area']; tx: number; ty: number }): boolean {
  if (forage.inspect(hit)) {
    alchemy.close()
    return true
  }
  if (alchemy.inspect(hit)) {
    forage.close()
    return true
  }
  return false
}

/** A free, dry tile two steps from the target, facing it, so the walk is visible. */
function spawnBeside(tile: { tx: number; ty: number }): { tx: number; ty: number; dir: Dir } {
  const world = new World(PRADERA_SEED)
  const free = (tx: number, ty: number) => !world.isSolid(tx, ty) && !world.isWater(tx, ty)
  const sides: readonly [number, number, Dir][] = [[0, 1, 'up'], [0, -1, 'down'], [1, 0, 'left'], [-1, 0, 'right']]
  for (const distance of [2, 1]) {
    for (const [dx, dy, dir] of sides) {
      const tx = tile.tx + dx * distance
      const ty = tile.ty + dy * distance
      const path = distance === 2 ? free(tile.tx + dx, tile.ty + dy) : true
      if (path && free(tx, ty)) return { tx, ty, dir }
    }
  }
  return { tx: tile.tx, ty: tile.ty + 1, dir: 'up' }
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

const pulse = setInterval(() => {
  const snapshot = game.value?.playerSnapshot()
  here.value = snapshot ? { tx: snapshot.tx, ty: snapshot.ty } : null
}, 250)

watch(place, createGame)
onMounted(createGame)
onUnmounted(() => {
  clearInterval(pulse)
  forage.detach()
  alchemy.detach()
  game.value?.destroy()
})
</script>

<style scoped>
.lab { display: grid; gap: 0.6rem; }
.lab-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 0.4rem; }
.lab-go { border: 1px solid var(--pf-line); font: inherit; font-size: 0.78rem; cursor: pointer; }
.lab-go--on { border-color: var(--pf-gold); background: var(--pf-gold); color: var(--pf-navy); font-weight: 700; }
.lab-where { color: var(--pf-muted); font-size: 0.74rem; }
.lab-worker { display: grid; gap: 0.1rem; margin-left: auto; color: var(--pf-soft); font-size: 0.76rem; }
.lab-worker select { min-height: 36px; border: 1px solid var(--pf-line); border-radius: 8px; background: var(--pf-navy-2); color: inherit; font: inherit; }
.lab-stage { position: relative; height: min(70vh, 620px); min-height: 420px; border: 2px solid var(--pf-line); border-radius: 14px; overflow: hidden; background: #0f1a33; }
.lab-canvas { display: block; width: 100%; height: 100%; image-rendering: pixelated; touch-action: none; cursor: pointer; }
.lab-top { position: absolute; top: 0.6rem; left: 0.6rem; right: 0.6rem; display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 0.4rem; pointer-events: none; }
.lab-dock { position: absolute; top: 6.4rem; right: 0.6rem; bottom: 0.75rem; left: 0.6rem; display: flex; flex-direction: column; justify-content: flex-end; align-items: center; gap: 0.5rem; pointer-events: none; }
.lab-dock > * { pointer-events: auto; }
.lab-hint { margin: 0; padding: 0.45rem 0.8rem; border: 2px solid var(--pf-line); border-radius: 10px; background: rgba(16, 26, 54, 0.92); color: var(--pf-soft); font-size: 0.84rem; white-space: nowrap; }
.lab-card { flex: none; width: min(400px, 100%); }
.lab-bag-btn { position: absolute; right: 0.6rem; top: 3.4rem; min-height: 40px; padding: 0 0.8rem; border: 2px solid var(--pf-gold); border-radius: 999px; background: rgba(16, 26, 54, 0.92); color: var(--pf-gold); font: inherit; font-weight: 700; cursor: pointer; }
.lab-bag { flex: 0 1 auto; align-self: flex-end; width: min(360px, 100%); min-height: 0; overflow-y: auto; }
.lab-note { margin: 0; color: var(--pf-muted); font-size: 0.76rem; }
@media (max-width: 520px) {
  .lab-stage { height: 78vh; min-height: 520px; }
  .lab-worker { margin-left: 0; }
  .lab-hint { white-space: normal; text-align: center; }
  .lab-bag { align-self: stretch; }
}
</style>
