<template>
  <div class="pf pgd">
    <header class="pgd-head">
      <div>
        <p class="pf-kicker">Herramienta interna · solo en desarrollo</p>
        <h1>Profession Playground</h1>
      </div>
      <span class="pf-demo-badge">Demo local · nada se guarda ni se envía</span>
    </header>

    <nav class="pgd-tabs" aria-label="Secciones">
      <button v-for="(label, id) in TABS" :key="id" type="button" :class="{ 'pgd-tab--on': tab === id }" @click="tab = id">{{ label }}</button>
    </nav>

    <div class="pgd-layout" :class="{ 'pgd-layout--wide': tab === 'lab' || tab === 'fishing' || tab === 'gallery' }">
      <PlaygroundControls v-if="tab !== 'gallery'" v-model:profession="profession" v-model:target="target" :session="session" />

      <main class="pgd-main">
        <MiningFieldLab v-if="tab === 'lab'" :session="session" />

        <FishingFieldLab v-else-if="tab === 'fishing'" :session="session" />

        <AssetGallery v-else-if="tab === 'gallery'" />

        <template v-else-if="tab === 'gathering'">
          <div class="pgd-landmarks">
            <span class="pf-kicker">Pradera Brisa (real):</span>
            <button
              v-for="landmark in landmarks"
              :key="landmark.definitionId"
              type="button"
              class="pf-chip pgd-landmark"
              @click="Object.assign(center, { tx: landmark.tx, ty: landmark.ty })"
            >
              {{ NODE_BY_ID.get(landmark.definitionId)?.name }}
            </button>
          </div>
          <div class="pgd-split">
            <WorldNodeMap :seed="PRADERA_SEED" :center-tx="center.tx" :center-ty="center.ty" title="Pradera Brisa" :selected-id="target?.nodeId ?? null" @select="selectFromMap" />
            <NodeInteractionPanel v-if="target" :key="target.nodeId" :session="session" :target="target" />
          </div>
          <ProfessionHud :session="session" :profession="profession" />
          <NodeStateGallery v-if="target" :node="target.node" :level="demoLevel(state, target.node.profession)" />
        </template>

        <template v-else-if="tab === 'pokemon'">
          <div class="pgd-split">
            <PokemonWorkerCard v-if="worker && affinity" :worker="worker" :affinity="affinity" :level="state.workerLevel" />
            <p v-else class="pgd-empty pf-card">Sin Pokémon asignado a {{ PROFESSIONS[profession].name }}.</p>
            <WorkerParty :profession="profession" :worker="worker" :profession-level="demoLevel(state, profession)" />
          </div>
          <PokemonComparison :profession="profession" :level="state.workerLevel" />
          <div class="pgd-cards">
            <PokemonWorkerCard
              v-for="entry in roster"
              :key="entry.worker.speciesId"
              compact
              :worker="entry.worker"
              :affinity="entry.affinity"
              :level="state.workerLevel"
            />
          </div>
        </template>

        <div v-else-if="tab === 'progression'" class="pgd-cards pgd-cards--wide">
          <ProfessionProgress v-for="id in PROFESSION_IDS" :key="id" :profession="id" :xp="state.xp[id]" />
        </div>

        <AlchemyBench v-else-if="tab === 'crafting'" :session="session" />

        <InventoryGrid v-else :session="session" />
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, shallowRef, watch } from 'vue'
import { NODE_BY_ID } from '../../domain/catalog/nodes'
import { PROFESSIONS } from '../../domain/catalog/professions'
import { PROFESSION_IDS, type ProfessionId } from '../../domain/types'
import { PRADERA_LANDMARKS, PRADERA_SEED, PRADERA_SPAWN } from '../../demo/praderaLandmarks'
import { demoAffinity, demoLevel, demoWorker, type DemoNodeTarget } from '../../demo/demoSession'
import { DEMO_WORKERS, workerAffinity } from '../../demo/demoWorkers'
import { useProfessionDemo } from '../../demo/useProfessionDemo'
import AlchemyBench from '../AlchemyBench.vue'
import InventoryGrid from '../InventoryGrid.vue'
import NodeInteractionPanel from '../NodeInteractionPanel.vue'
import PokemonComparison from '../PokemonComparison.vue'
import PokemonWorkerCard from '../PokemonWorkerCard.vue'
import ProfessionHud from '../ProfessionHud.vue'
import ProfessionProgress from '../ProfessionProgress.vue'
import WorkerParty from '../WorkerParty.vue'
import WorldNodeMap from '../WorldNodeMap.vue'
import AssetGallery from './AssetGallery.vue'
import FishingFieldLab from './FishingFieldLab.vue'
import MiningFieldLab from './MiningFieldLab.vue'
import NodeStateGallery from './NodeStateGallery.vue'
import PlaygroundControls from './PlaygroundControls.vue'
import '../professions.css'

// Internal tool: routed only in development builds (app/router/routes.ts).
// R31-C1 adds the mining field lab (real engine) and the asset gallery.
const TABS = {
  lab: 'Laboratorio minero', fishing: 'Laboratorio de pesca', gallery: 'Galería', inventory: 'Mochila', gathering: 'Mapa de nodos',
  pokemon: 'Pokémon', progression: 'Progresión', crafting: 'Crafteo',
} as const

const session = useProfessionDemo()
const state = computed(() => session.state.value)
const tab = ref<keyof typeof TABS>('lab')
const profession = ref<ProfessionId>('mining')
const center = reactive<{ tx: number; ty: number }>({ ...PRADERA_SPAWN })
const target = shallowRef<DemoNodeTarget | null>(null)

const landmarks = computed(() => PRADERA_LANDMARKS.filter(landmark => NODE_BY_ID.get(landmark.definitionId)?.profession === profession.value))
const worker = computed(() => demoWorker(state.value, profession.value))
const affinity = computed(() => demoAffinity(state.value, profession.value))
const roster = computed(() => DEMO_WORKERS.map(entry => ({ worker: entry, affinity: workerAffinity(entry, profession.value, state.value.workerLevel) })))

function selectFromMap(next: DemoNodeTarget): void {
  target.value = next
  profession.value = next.node.profession
}

watch(profession, id => {
  if (target.value?.node.profession === id) return
  const first = landmarks.value[0]
  if (first) Object.assign(center, { tx: first.tx, ty: first.ty })
  target.value = null
})
</script>

<style scoped>
.pgd { box-sizing: border-box; min-height: 100vh; padding: 1rem clamp(1rem, 3vw, 2rem) 3rem; background: #0b1430; }
.pgd-head { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 0.75rem; margin-bottom: 0.75rem; }
.pgd-head h1 { margin: 0.1rem 0 0; font-size: 1.6rem; }
.pgd-tabs { display: flex; gap: 0.4rem; margin-bottom: 1rem; overflow-x: auto; }
.pgd-tabs button { flex: none; min-height: 40px; padding: 0 0.9rem; border: 2px solid var(--pf-line); border-radius: 999px; background: transparent; color: var(--pf-soft); font: inherit; cursor: pointer; }
.pgd-tabs .pgd-tab--on { border-color: var(--pf-gold); background: var(--pf-gold); color: var(--pf-navy); font-weight: 700; }
.pgd-layout { display: grid; grid-template-columns: 280px 1fr; align-items: start; gap: 1rem; }
.pgd-layout--wide:has(> .pgd-main:only-child) { grid-template-columns: 1fr; }
.pgd-main { display: grid; gap: 1rem; min-width: 0; }
.pgd-split { display: grid; grid-template-columns: minmax(0, 1fr) minmax(300px, 420px); align-items: start; gap: 1rem; }
.pgd-landmarks { display: flex; flex-wrap: wrap; align-items: center; gap: 0.4rem; }
.pgd-landmark { border: 1px solid var(--pf-line); cursor: pointer; font: inherit; font-size: 0.78rem; }
.pgd-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 0.75rem; }
.pgd-cards--wide { grid-template-columns: repeat(auto-fill, minmax(360px, 1fr)); }
.pgd-empty { margin: 0; padding: 1rem; color: var(--pf-muted); }
@media (max-width: 1100px) { .pgd-split { grid-template-columns: 1fr; } }
@media (max-width: 820px) {
  .pgd-layout { grid-template-columns: 1fr; }
  /* Controls follow the content on phones so the lab is the first thing visible (R31-B finding B-20). */
  .pgd-layout > :first-child:not(.pgd-main) { order: 2; }
}
@media (max-width: 420px) { .pgd-cards--wide { grid-template-columns: 1fr; } }
</style>
