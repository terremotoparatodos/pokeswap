<template>
  <div class="eco-choice">
    <EcoSprite v-if="view.speciesId" :species-id="view.speciesId" :size="40" :label="nameOf(view.speciesId)" />
    <label>
      {{ owned ? 'Tu Pokémon propio' : 'Tu Pokémon de prueba' }}<span v-if="view.level"> · Nv. {{ view.level }}</span>
      <select :aria-label="owned ? 'Pokémon propio' : 'Pokémon de prueba'" :value="selectedValue" :disabled="locked || !view.options.length" :aria-disabled="view.pending || undefined" @keydown.stop @change="choose">
        <option v-if="!view.options.length || (owned && view.selectedSlotPokemonId == null)" value="">{{ owned ? (view.options.length ? 'Elegí un Pokémon propio…' : 'Sin Pokémon propios disponibles') : 'Esperando al servidor…' }}</option>
        <option v-for="entry in view.options" :key="entry.slotPokemonId ?? entry.speciesId" :value="owned ? entry.slotPokemonId : entry.speciesId" :disabled="entry.eligible === false">{{ nameOf(entry.speciesId) }}<template v-if="owned"> · {{ entry.eligible === false ? unavailable(entry.reason) : `Nv. ${entry.level}` }}</template></option>
      </select>
    </label>
    <button v-if="owned" type="button" :disabled="locked || view.pending" @keydown.stop @click="emit('refresh')">Actualizar</button>
    <p v-if="owned" class="eco-choice__source">Proyección temporal M-1: especie, XP y movimientos del registro; IVs, naturaleza y habilidad derivados, EVs=0, forma y género derivados, sin atribuir shiny real. Condición nueva en cada combate; no se guarda.</p>
    <p v-if="view.pending" role="status">Confirmando elección…</p>
    <p v-else-if="view.reason" role="status">{{ reasonText }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { EcoCombatantView } from '../state/ecoCombatantSelection'
import EcoSprite from './EcoSprite.vue'

const props = defineProps<{ view: EcoCombatantView; locked: boolean; nameOf: (id: number) => string }>()
const emit = defineEmits<{ select: [id: number]; refresh: [] }>()
const owned = computed(() => props.view.mode === 'owned')
const selectedValue = computed(() => (owned.value ? props.view.selectedSlotPokemonId : props.view.speciesId) ?? '')
const unavailable = (reason?: string) => ({
  locked: 'bloqueado', 'missing-progression': 'sin progresión', 'missing-moves': 'sin movimientos',
  'unknown-move': 'movimiento desconocido', 'illegal-move': 'movimiento ilegal', 'unsupported-move': 'movimiento no soportado',
}[reason ?? ''] ?? 'no disponible')
const reasonText = computed(() => ({
  'in-battle': 'Terminá el combate antes de cambiar.', offline: 'Sin conexión.', 'no-answer': 'El servidor no confirmó la elección. Volvé a elegir.',
  'battle-unavailable': 'Combatientes no disponibles.', 'invalid-species': 'Esa especie no está disponible.',
  'not-owner': 'Ya no poseés ese Pokémon.', locked: 'Ese Pokémon está bloqueado.', 'read-unavailable': 'No se pudo consultar tu Pokémon. Actualizá para reintentar.',
  'selection-pending': 'Esperá la confirmación pendiente.', 'selection-stale': 'La sesión o elección cambió. Actualizá para reintentar.',
  'not-player': 'Este modo requiere una sesión autenticada; no admite benchmarks.',
}[props.view.reason ?? ''] ?? 'El servidor rechazó la elección.'))
function choose(event: Event): void {
  // Native disabled blurs the select in Chrome. Pending keeps focus, but accepts no new intent.
  if (!props.view.pending) emit('select', Number((event.target as HTMLSelectElement).value))
  // Native select changes immediately; keep showing the confirmed choice while waiting.
  ;(event.target as HTMLSelectElement).value = String(selectedValue.value)
}
</script>

<style scoped>
.eco-choice { display: flex; flex-wrap: wrap; gap: .4rem .6rem; align-items: center; margin: .65rem 0; }
label { flex: 1; font-size: .8rem; color: #dce6ff; }
select { display: block; width: 100%; min-height: 36px; margin-top: .3rem; border: 1px solid #7184aa; border-radius: 6px; color: #fff; background: #1e2b46; font: inherit; }
p { flex-basis: 100%; margin: 0; font-size: .8rem; color: #ffd27a; }
</style>
