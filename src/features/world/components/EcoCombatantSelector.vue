<template>
  <div class="eco-choice">
    <EcoSprite v-if="view.speciesId" :species-id="view.speciesId" :size="40" :label="nameOf(view.speciesId)" />
    <label>
      Tu Pokémon de prueba · Nv. 12
      <select aria-label="Pokémon de prueba" :value="view.speciesId ?? ''" :disabled="locked || view.pending || !view.options.length" @keydown.stop @change="choose">
        <option v-if="!view.options.length" value="">Esperando al servidor…</option>
        <option v-for="entry in view.options" :key="entry.speciesId" :value="entry.speciesId">{{ nameOf(entry.speciesId) }}</option>
      </select>
    </label>
    <p v-if="view.pending" role="status">Confirmando elección…</p>
    <p v-else-if="view.reason" role="status">{{ reasonText }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { EcoCombatantView } from '../state/ecoCombatantSelection'
import EcoSprite from './EcoSprite.vue'

const props = defineProps<{ view: EcoCombatantView; locked: boolean; nameOf: (id: number) => string }>()
const emit = defineEmits<{ select: [speciesId: number] }>()
const reasonText = computed(() => ({
  'in-battle': 'Terminá el combate antes de cambiar.', offline: 'Sin conexión.', 'no-answer': 'El servidor no confirmó la elección. Volvé a elegir.',
  'battle-unavailable': 'Combatientes no disponibles.', 'invalid-species': 'Esa especie no está disponible.',
}[props.view.reason ?? ''] ?? 'El servidor rechazó la elección.'))
function choose(event: Event): void {
  emit('select', Number((event.target as HTMLSelectElement).value))
  // Native select changes immediately; keep showing the confirmed choice while waiting.
  ;(event.target as HTMLSelectElement).value = String(props.view.speciesId ?? '')
}
</script>

<style scoped>
.eco-choice { display: flex; flex-wrap: wrap; gap: .4rem .6rem; align-items: center; margin: .65rem 0; }
label { flex: 1; font-size: .8rem; color: #dce6ff; }
select { display: block; width: 100%; min-height: 36px; margin-top: .3rem; border: 1px solid #7184aa; border-radius: 6px; color: #fff; background: #1e2b46; font: inherit; }
p { flex-basis: 100%; margin: 0; font-size: .8rem; color: #ffd27a; }
</style>
