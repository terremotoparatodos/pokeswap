<template>
  <section class="party pf-card">
    <header class="party-head">
      <p class="pf-kicker">Equipo de {{ PROFESSIONS[profession].name }}</p>
      <span class="party-concept">Concepto · no aprobado</span>
    </header>
    <ol class="party-slots">
      <li class="party-slot party-slot--lead">
        <template v-if="worker">
          <PokemonPortrait :species-id="worker.speciesId" :name="worker.name" :size="56" />
          <strong>{{ worker.name }}</strong>
        </template>
        <span v-else class="party-empty">Vacío</span>
        <small>Líder · 100 %</small>
      </li>
      <li v-for="slot in ASSISTANT_SLOTS" :key="slot.level" class="party-slot" :class="{ 'party-slot--locked': professionLevel < slot.level }">
        <span class="party-lock" aria-hidden="true">{{ professionLevel < slot.level ? '🔒' : '＋' }}</span>
        <strong>Asistente</strong>
        <small>{{ professionLevel < slot.level ? `Nv. ${slot.level} (propuesta)` : 'Disponible (propuesta)' }} · 50 %</small>
      </li>
    </ol>
    <p class="party-note">
      Visualización de la recomendación de R31-A (líder + asistentes). Los niveles de desbloqueo y el peso de los asistentes
      no están aprobados y <strong>no afectan ningún cálculo</strong>: solo cuenta el líder.
    </p>
  </section>
</template>

<script setup lang="ts">
import { PROFESSIONS } from '../domain/catalog/professions'
import type { ProfessionId } from '../domain/types'
import type { DemoWorker } from '../demo/demoWorkers'
import PokemonPortrait from './PokemonPortrait.vue'

defineProps<{ profession: ProfessionId; worker: DemoWorker | null; professionLevel: number }>()

/** Proposal from POKEMON_PROFESSION_SYSTEM.md §6 — display only. */
const ASSISTANT_SLOTS = [{ level: 20 }, { level: 40 }] as const
</script>

<style scoped>
.party { display: grid; gap: 0.75rem; padding: 1rem; }
.party-head { display: flex; justify-content: space-between; align-items: center; gap: 0.5rem; }
.party-concept { padding: 0.15rem 0.5rem; border: 1px dashed var(--pf-warn); border-radius: 6px; color: var(--pf-warn); font-size: 0.72rem; }
.party-slots { display: grid; grid-template-columns: 1.3fr 1fr 1fr; gap: 0.6rem; margin: 0; padding: 0; list-style: none; }
.party-slot { display: grid; justify-items: center; align-content: center; gap: 0.25rem; min-height: 120px; padding: 0.6rem; border: 2px solid var(--pf-line); border-radius: 12px; background: var(--pf-navy-2); text-align: center; }
.party-slot small { color: var(--pf-muted); font-size: 0.72rem; }
.party-slot--lead { border-color: var(--pf-gold); }
.party-slot--locked { border-style: dashed; opacity: 0.6; }
.party-lock { font-size: 1.4rem; }
.party-empty { color: var(--pf-muted); }
.party-note { margin: 0; color: var(--pf-muted); font-size: 0.78rem; line-height: 1.4; }
@media (max-width: 520px) {
  .party-slots { grid-template-columns: 1fr 1fr; }
  .party-slot--lead { grid-column: 1 / -1; }
}
</style>
