<template>
  <aside class="eco-dev" aria-label="ECO experimental (desarrollo)">
    <header>
      <strong>ECO · experimento (dev)</strong>
      <span>{{ statusLabel }} · {{ encounters.length }} en el área</span>
    </header>
    <ol v-if="nearest.length">
      <li v-for="row in nearest" :key="row.id">
        <span class="eco-dev__who">#{{ row.speciesId }} · {{ row.short }}</span>
        <span class="eco-dev__where">({{ row.tx }}, {{ row.ty }}) · {{ row.distance }} t</span>
        <button type="button" :disabled="busy" @click="retire(row.id)">Retirar (prueba)</button>
      </li>
    </ol>
    <p v-else class="eco-dev__empty">Sin encuentros visibles en esta área.</p>
    <p v-if="last" class="eco-dev__last" role="status">{{ last }}</p>
    <p class="eco-dev__note">Retirada de simulación: sin captura, drop ni recompensa.</p>
  </aside>
</template>

<script setup lang="ts">
// ECO-GAMEPLAY-1 (experimental, development builds only): lists the server's ECO population of the
// current area and asks the server for a TEST retirement. It decides nothing: the server validates,
// retires with a simulated cause and every client then receives the same new list.
import { computed, onUnmounted, ref, shallowRef } from 'vue'
import type { EcoArea } from '../../../../services/realtime/src/world/worldProtocol.js'
import type { SharedWorld } from '../state/sharedWorld'

const props = defineProps<{ world: SharedWorld; areaId: string; tx: number; ty: number }>()

const area = shallowRef<EcoArea | null>(null)
const stop = props.world.onEco(next => { area.value = next })
onUnmounted(stop)

const encounters = computed(() => (area.value?.areaId === props.areaId ? area.value.encounters : []))
const statusLabel = computed(() => ({ active: 'activa', 'not-simulated': 'sin simular', unavailable: 'no disponible' })[area.value?.status ?? 'unavailable'] ?? '—')
const nearest = computed(() => encounters.value
  .map(e => ({ ...e, short: e.id.split(':').slice(2).join(':'), distance: Math.max(Math.abs(e.tx - props.tx), Math.abs(e.ty - props.ty)) }))
  .sort((a, b) => a.distance - b.distance || a.id.localeCompare(b.id))
  .slice(0, 8))

const busy = ref(false)
const last = ref('')
const REASONS: Record<string, string> = {
  disabled: 'el servidor no tiene el experimento activo', invalid: 'pedido inválido', 'not-alive': 'ya no estaba',
  'other-area': 'está en otra área', 'not-player': 'solo un jugador puede retirar', unavailable: 'sin respuesta del servidor',
  'client-outdated': 'cliente desactualizado',
}

async function retire(id: string) {
  busy.value = true
  const result = await props.world.ecoDevRetire(id)
  busy.value = false
  const short = id.split(':').slice(2).join(':')
  last.value = result.ok ? `Retirado ${short}. Reaparece tras el retraso provisional del nido.` : `Rechazado (${REASONS[result.reason ?? ''] ?? result.reason}).`
}
</script>

<style scoped>
.eco-dev {
  position: absolute;
  top: 56px;
  left: 12px;
  z-index: 20;
  width: min(330px, calc(100vw - 24px));
  padding: 8px 10px;
  border-radius: 8px;
  background: rgba(16, 24, 32, 0.86);
  color: #e8f0f4;
  font: 12px/1.35 system-ui, sans-serif;
}
.eco-dev header { display: flex; flex-direction: column; margin-bottom: 6px; }
.eco-dev ol { margin: 0; padding: 0; list-style: none; display: grid; gap: 4px; }
.eco-dev li { display: grid; grid-template-columns: 1fr auto; gap: 2px 8px; align-items: center; }
.eco-dev__where { grid-column: 1; opacity: 0.75; }
.eco-dev button { grid-column: 2; grid-row: 1 / span 2; font: inherit; padding: 3px 6px; cursor: pointer; }
.eco-dev__empty, .eco-dev__last, .eco-dev__note { margin: 6px 0 0; }
.eco-dev__note { opacity: 0.6; }
</style>
