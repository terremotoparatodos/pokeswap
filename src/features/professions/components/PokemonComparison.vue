<template>
  <section class="cmp pf-card">
    <header class="cmp-head">
      <p class="pf-kicker">Comparar para {{ PROFESSIONS[profession].name }} · Nv. Pokémon {{ level }}</p>
      <div class="cmp-pickers">
        <label v-for="side in (['a', 'b'] as const)" :key="side" class="cmp-picker">
          <PokemonPortrait :species-id="picked[side].speciesId" :name="picked[side].name" :size="40" />
          <select v-model.number="ids[side]" :aria-label="`Pokémon ${side === 'a' ? 'izquierdo' : 'derecho'}`">
            <option v-for="worker in DEMO_WORKERS" :key="worker.speciesId" :value="worker.speciesId">{{ worker.name }}</option>
          </select>
        </label>
      </div>
    </header>

    <table class="cmp-table">
      <thead>
        <tr><th scope="col">Capacidad</th><th scope="col">{{ picked.a.name }}</th><th scope="col">{{ picked.b.name }}</th></tr>
      </thead>
      <tbody>
        <tr v-for="row in comparison.rows" :key="row.id">
          <th scope="row" :title="row.a.hint">{{ row.label }}</th>
          <td v-for="side in (['a', 'b'] as const)" :key="side" :class="{ 'cmp-lead': row.leader === side }">
            <span class="cmp-pips" role="img" :aria-label="`${row[side].rating} de ${MAX_RATING}`">
              <span v-for="n in MAX_RATING" :key="n" class="cmp-pip" :class="{ 'cmp-pip--on': n <= row[side].rating }" />
            </span>
            <small>{{ row[side].lines[0]?.text ?? '—' }}</small>
          </td>
        </tr>
      </tbody>
    </table>

    <ul class="cmp-verdict">
      <li v-for="side in (['a', 'b'] as const)" :key="side">
        <template v-if="leads(side).length">
          <strong>{{ picked[side].name }}</strong> si buscás {{ leads(side).join(' y ').toLowerCase() }}.
        </template>
        <template v-else>
          <strong>{{ picked[side].name }}</strong> no supera a {{ picked[side === 'a' ? 'b' : 'a'].name }} en ninguna capacidad de esta profesión.
        </template>
      </li>
    </ul>
  </section>
</template>

<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import { PROFESSIONS } from '../domain/catalog/professions'
import type { ProfessionId } from '../domain/types'
import { DEMO_WORKERS, findDemoWorker, workerAffinity } from '../demo/demoWorkers'
import { CAPABILITIES, compareWorkers, MAX_RATING } from '../ui/capabilities'
import PokemonPortrait from './PokemonPortrait.vue'

const props = defineProps<{ profession: ProfessionId; level: number }>()

const DEFAULT_PAIRS: Readonly<Record<ProfessionId, [number, number]>> = {
  mining: [68, 81], woodcutting: [400, 123], fishing: [9, 6], alchemy: [242, 44],
}

const ids = reactive({ a: DEFAULT_PAIRS[props.profession][0], b: DEFAULT_PAIRS[props.profession][1] })
watch(() => props.profession, profession => { [ids.a, ids.b] = DEFAULT_PAIRS[profession] })

const picked = computed(() => ({ a: findDemoWorker(ids.a) ?? DEMO_WORKERS[0], b: findDemoWorker(ids.b) ?? DEMO_WORKERS[1] }))
const comparison = computed(() => compareWorkers(
  workerAffinity(picked.value.a, props.profession, props.level),
  workerAffinity(picked.value.b, props.profession, props.level),
))
const leads = (side: 'a' | 'b') => (side === 'a' ? comparison.value.aLeads : comparison.value.bLeads).map(id => CAPABILITIES[id].label)
</script>

<style scoped>
.cmp { display: grid; gap: 0.75rem; padding: 1rem; }
.cmp-pickers { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; margin-top: 0.5rem; }
.cmp-picker { display: flex; align-items: center; gap: 0.5rem; min-width: 0; }
.cmp-picker select { flex: 1; min-width: 0; }
.cmp-table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
.cmp-table th, .cmp-table td { padding: 0.4rem 0.35rem; border-bottom: 1px solid rgba(255, 255, 255, 0.08); text-align: left; vertical-align: top; }
.cmp-table thead th { color: var(--pf-muted); font-weight: 600; }
.cmp-table td small { display: block; margin-top: 0.2rem; color: var(--pf-muted); }
.cmp-lead { background: rgba(255, 210, 122, 0.08); }
.cmp-lead .cmp-pip--on { background: var(--pf-gold); }
.cmp-pips { display: inline-flex; gap: 3px; }
.cmp-pip { width: 12px; height: 7px; border-radius: 2px; background: rgba(255, 255, 255, 0.14); }
.cmp-pip--on { background: var(--pf-soft); }
.cmp-verdict { display: grid; gap: 0.35rem; margin: 0; padding-left: 1.1rem; color: var(--pf-soft); font-size: 0.88rem; }
@media (max-width: 520px) {
  .cmp-pickers { grid-template-columns: 1fr; }
  .cmp-table td small { display: none; }
}
</style>
