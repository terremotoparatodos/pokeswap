<template>
  <article class="wk pf-card" :class="{ 'wk--compact': compact }">
    <header class="wk-head">
      <PokemonPortrait :species-id="worker.speciesId" :name="worker.name" :size="compact ? 40 : 64" />
      <div class="wk-id">
        <p class="pf-kicker">Trabajador · {{ PROFESSIONS[affinity.profession].name }}</p>
        <h3>{{ worker.name }}</h3>
        <p class="wk-meta">Nv. {{ level }} · {{ types }}</p>
      </div>
    </header>
    <p class="wk-specialty">
      <span class="pf-chip wk-chip">{{ summary.specialty.label }}</span>
      <span>{{ summary.specialty.hint }}</span>
    </p>
    <CapabilityBars :ratings="summary.ratings" :highlight="summary.specialty.id" :compact="compact" />
    <p v-if="!compact" class="wk-note">Menos fuerte en {{ summary.weakest.label.toLowerCase() }}.</p>
    <p v-if="affinity.access.length" class="wk-note wk-access">Accede a {{ affinity.access.map(tag => ACCESS_SHORT[tag]).join(', ') }}</p>
    <p v-if="!compact && affinity.homeBiomes.length" class="wk-note">Hábitat: {{ affinity.homeBiomes.map(biome => BIOME_LABEL[biome]).join(', ') }}</p>
  </article>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { BIOME_LABEL } from '../../wildlands/engine/world'
import { PROFESSIONS } from '../domain/catalog/professions'
import type { AccessTag, PokemonProfessionAffinity } from '../domain/types'
import { TYPE_LABEL, type DemoWorker } from '../demo/demoWorkers'
import { summarizeWorker } from '../ui/capabilities'
import CapabilityBars from './CapabilityBars.vue'
import PokemonPortrait from './PokemonPortrait.vue'

const props = withDefaults(defineProps<{ worker: DemoWorker; affinity: PokemonProfessionAffinity; level: number; compact?: boolean }>(), { compact: false })

const ACCESS_SHORT: Readonly<Record<AccessTag, string>> = { hardRock: 'roca dura', deepWater: 'aguas profundas', frozenGround: 'suelo helado' }

const summary = computed(() => summarizeWorker(props.affinity))
const types = computed(() => [props.worker.type1, props.worker.type2].filter(Boolean).map(type => TYPE_LABEL[type!] ?? type).join(' / '))
</script>

<style scoped>
.wk { display: grid; gap: 0.6rem; padding: 1rem; }
.wk-head { display: flex; align-items: center; gap: 0.75rem; }
.wk-id { min-width: 0; }
.wk-id h3 { margin: 0.1rem 0 0; font-size: 1.15rem; }
.wk-meta, .wk-note { margin: 0; color: var(--pf-muted); font-size: 0.8rem; }
.wk-specialty { display: flex; flex-wrap: wrap; align-items: center; gap: 0.4rem; margin: 0; color: var(--pf-soft); font-size: 0.85rem; }
.wk-chip { background: var(--pf-gold); color: var(--pf-navy); font-weight: 700; }
.wk-access { color: var(--pf-good); }
.wk--compact { padding: 0.75rem; gap: 0.45rem; }
.wk--compact .wk-id h3 { font-size: 1rem; }
</style>
