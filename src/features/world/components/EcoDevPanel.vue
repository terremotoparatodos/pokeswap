<template>
  <aside class="eco-dev" :class="{ 'eco-dev--collapsed': collapsed }" aria-label="ECO experimental (desarrollo)">
    <header>
      <button type="button" class="eco-dev__toggle" :aria-expanded="!collapsed" @click="collapsed = !collapsed">{{ collapsed ? '▸' : '▾' }} ECO · depuración (dev)</button>
      <span>{{ statusLabel }} · {{ encounters.length }} en el área</span>
    </header>
    <template v-if="!collapsed">
    <ol v-if="nearest.length">
      <li v-for="row in nearest" :key="row.id">
        <span class="eco-dev__who">#{{ row.speciesId }} · {{ row.short }}</span>
        <span class="eco-dev__where">({{ row.tx }}, {{ row.ty }}) · {{ row.distance }} t<template v-if="row.busy"> · ocupado</template></span>
        <span class="eco-dev__actions">
          <button type="button" :disabled="!canEngage(row)" :title="engageHint(row)" @click="props.session.engage(row.id)">{{ row.busy ? 'Ocupado' : row.distance > ECO_ENGAGE_RANGE ? 'Lejos' : 'Combatir' }}</button>
          <button type="button" :disabled="busy || row.busy" @click="retire(row.id)">Retirar (prueba)</button>
        </span>
      </li>
    </ol>
    <p v-else class="eco-dev__empty">Sin encuentros visibles en esta área.</p>
    <p v-if="last" class="eco-dev__last" role="status">{{ last }}</p>
    <p class="eco-dev__note">Herramienta secundaria: para jugar, tocá un Pokémon en el mapa. Retirada de simulación: sin captura, drop ni recompensa.</p>
    </template>
  </aside>
</template>

<script setup lang="ts">
// ECO-GAMEPLAY-1 (experimental, development builds only): lists the server's ECO population of the
// current area and asks the server for a TEST retirement. It decides nothing: the server validates,
// retires with a simulated cause and every client then receives the same new list.
//
// ECO-GAMEPLAY-2: it also starts a TEST battle against one encounter (the server reserves it,
// validates identity, area, distance and that nobody else holds it, and decides the result).
//
// ECO-PRESENTATION-1: a SECONDARY tool (collapsed by default). Playing goes through the map (tap an
// individual → its card → the battle screen); this list shares that same session and screen.
import { computed, ref } from 'vue'
import type { EcoArea, EcoEncounter } from '../../../../services/realtime/src/world/worldProtocol.js'
import { ECO_ENGAGE_RANGE } from '../../../../services/realtime/src/world/worldProtocol.js'
import type { EcoBattleSession, EcoBattleView } from '../state/ecoBattleSession'
import type { SharedWorld } from '../state/sharedWorld'

const props = defineProps<{ world: SharedWorld; session: EcoBattleSession; battle: EcoBattleView; area: EcoArea | null; tx: number; ty: number }>()

const collapsed = ref(true)
const battle = computed(() => props.battle)
const encounters = computed(() => props.area?.encounters ?? [])
const statusLabel = computed(() => ({ active: 'activa', 'not-simulated': 'sin simular', unavailable: 'no disponible' })[props.area?.status ?? 'unavailable'] ?? '—')
const nearest = computed(() => encounters.value
  .map(e => ({ ...e, short: e.id.split(':').slice(2).join(':'), distance: Math.max(Math.abs(e.tx - props.tx), Math.abs(e.ty - props.ty)) }))
  .sort((a, b) => a.distance - b.distance || a.id.localeCompare(b.id))
  .slice(0, 8))

const busy = ref(false)
const last = ref('')
const REASONS: Record<string, string> = {
  disabled: 'el servidor no tiene el experimento activo', invalid: 'pedido inválido', 'not-alive': 'ya no estaba',
  'other-area': 'está en otra área', 'not-player': 'solo un jugador puede retirar', unavailable: 'sin respuesta del servidor',
  'client-outdated': 'cliente desactualizado', busy: 'está en combate',
}

const canEngage = (row: EcoEncounter & { distance: number }) => !row.busy && row.distance <= ECO_ENGAGE_RANGE && (battle.value.phase === 'idle' || battle.value.phase === 'ended' || battle.value.phase === 'refused')
const engageHint = (row: EcoEncounter & { distance: number }) => (row.busy ? 'Otro jugador lo está combatiendo' : row.distance > ECO_ENGAGE_RANGE ? `Acercate a ${ECO_ENGAGE_RANGE} casillas o menos` : 'Combate de prueba con un fixture sintético')

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
.eco-dev--collapsed header { margin-bottom: 0; }
.eco-dev__toggle { align-self: flex-start; padding: 0; border: 0; background: none; color: inherit; font-weight: 700; cursor: pointer; }
.eco-dev ol { margin: 0; padding: 0; list-style: none; display: grid; gap: 4px; }
.eco-dev li { display: grid; grid-template-columns: 1fr auto; gap: 2px 8px; align-items: center; }
.eco-dev__where { grid-column: 1; opacity: 0.75; }
.eco-dev__actions { grid-column: 2; grid-row: 1 / span 2; display: flex; gap: 4px; }
.eco-dev button { font: inherit; padding: 3px 6px; cursor: pointer; }
/* Disabled («Lejos», «Ocupado»): explicit colours, legible on the dark panel (the browser default at half opacity was not). */
.eco-dev button:disabled { cursor: default; opacity: 1; color: #c9d3da; background: #34404b; border: 1px solid #5a6874; border-radius: 3px; }
.eco-dev__empty, .eco-dev__last, .eco-dev__note { margin: 6px 0 0; }
.eco-dev__note { opacity: 0.6; }
</style>
