<template>
  <section class="fc skx" aria-label="Parcela, Agricultura">
    <header class="fc-head">
      <span class="fc-icon" aria-hidden="true">🌱</span>
      <div class="fc-titles">
        <p class="fc-kicker">Agricultura · Nv {{ level }}</p>
        <strong class="fc-title">{{ title }}</strong>
      </div>
      <button type="button" class="fc-x" aria-label="Cerrar" :disabled="phase === 'working'" @click="emit('close')">×</button>
    </header>

    <template v-if="phase === 'idle'">
      <p class="fc-stage">{{ stageLine }}</p>

      <!-- Empty: pick what to plant. SKILLS says what this level and this soil allow. -->
      <template v-if="plot.action === 'plant'">
        <p class="fc-pick">Qué plantar</p>
        <ul class="fc-crops" role="radiogroup" aria-label="Cultivo">
          <li v-for="option in crops" :key="option.crop.id">
            <button
              type="button" role="radio" class="fc-crop" :class="{ 'fc-crop--on': cropId === option.crop.id }"
              :aria-checked="cropId === option.crop.id" :disabled="option.locked" @click="cropId = option.crop.id"
            >
              <MaterialIcon :item-id="option.crop.harvest.itemId" :size="20" />
              <span class="fc-crop-name">{{ option.crop.name }}</span>
              <span class="fc-crop-line">{{ option.line }}</span>
            </button>
          </li>
        </ul>
      </template>

      <template v-if="plot.action">
        <p class="fc-pick">Elegí un Pokémon</p>
        <p v-if="!workers.length" class="fc-muted">No tenés Pokémon para trabajar.</p>
        <ul v-else class="fc-workers" role="radiogroup" aria-label="Pokémon que trabaja">
          <li v-for="option in options" :key="option.instanceId">
            <button
              type="button" role="radio" class="fc-worker" :class="{ 'fc-worker--on': chosen === option.instanceId }"
              :aria-checked="chosen === option.instanceId" :disabled="option.unable" @click="chosen = option.instanceId"
            >
              <span>{{ option.name }}</span>
              <span class="fc-stars">{{ aptitudeStars(option.aptitude) }}</span>
              <span class="fc-muted">{{ option.seconds.toLocaleString('es') }} s</span>
            </button>
          </li>
        </ul>
      </template>
      <p v-if="refusal" class="fc-refusal" role="status">{{ refusal }}</p>
      <button v-if="plot.action" type="button" class="fc-go" :disabled="!canGo" @click="go">{{ goLabel }}</button>
    </template>

    <div v-else-if="phase === 'working'" class="fc-working" role="status">
      <p>{{ workerName ?? 'Tu Pokémon' }} está trabajando la parcela…</p>
      <span class="fc-progress"><span :style="{ animationDuration: `${durationMs}ms` }" /></span>
    </div>

    <div v-else-if="view" class="fc-result" role="status">
      <p v-if="view.levelUpLine" class="fc-levelup">{{ view.levelUpLine }}</p>
      <p v-for="line in view.unlockLines" :key="line" class="fc-unlock">{{ line }}</p>
      <p class="fc-gains">
        <span v-if="view.xpLine" class="fc-xp">{{ view.xpLine }}</span>
        <span v-for="item in view.items" :key="item.itemId" class="fc-item"><MaterialIcon :item-id="item.itemId" :size="18" /> +{{ item.quantity }} {{ item.name }}</span>
      </p>
      <button type="button" class="fc-ghost" @click="emit('close')">Listo</button>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { aptitudeStars } from '../domain/aptitude/aptitudeScale'
import { CROP_BY_ID, type FarmAction } from '../domain/farming'
import type { SkillId } from '../domain/skills'
import { levelForXp } from '../domain/xpCurve'
import type { SettleResult } from '../service/skillsService'
import { cropOptions, farmWorkerOptions, FARM_VERB, STAGE_LINE, timeLeft, type PlotStageName } from '../ui/farmView'
import { resultView } from '../ui/skillsView'
import type { WorkerRef } from '../ui/workerRef'
import MaterialIcon from './MaterialIcon.vue'
import './skills.css'

// Agricultura on a shared plot (INTEGRATION-1). Plant, tend, harvest: the
// server decides, this card shows what it will say and what it said.
const props = defineProps<{
  plot: {
    readonly stage: PlotStageName
    readonly cropId: string | null
    readonly mine: boolean
    readonly readyInMs: number
    readonly action: FarmAction | null
  }
  phase: 'idle' | 'working' | 'result'
  durationMs: number
  result: SettleResult | null
  refusal: string | null
  xp: Readonly<Record<SkillId, number>>
  workers: readonly WorkerRef[]
  lastWorker: string | null
}>()
const emit = defineEmits<{ work: [worker: WorkerRef, name: string, cropId: string | null]; close: [] }>()

const level = computed(() => levelForXp(props.xp.farming ?? 0))
const crop = computed(() => (props.plot.cropId ? CROP_BY_ID.get(props.plot.cropId) ?? null : null))
const title = computed(() => (crop.value ? crop.value.name : 'Huerta comunal'))
const stageLine = computed(() => {
  if (props.plot.stage === 'empty') return STAGE_LINE.empty
  if (!props.plot.mine && props.plot.stage !== 'working') return 'La plantó otro jugador.'
  if (props.plot.stage === 'planted' || props.plot.stage === 'growing') return `${STAGE_LINE[props.plot.stage]} · lista en ${timeLeft(props.plot.readyInMs)}`
  return STAGE_LINE[props.plot.stage]
})

const crops = computed(() => cropOptions('town', level.value))
const cropId = ref<string | null>(null)
watch(crops, list => { if (!cropId.value) cropId.value = list.find(option => !option.locked)?.crop.id ?? null }, { immediate: true })

const options = computed(() => props.plot.action ? farmWorkerOptions(props.workers, props.plot.action, props.plot.action === 'plant' ? cropId.value : props.plot.cropId, level.value) : [])
const chosen = ref<string | null>(null)
watch([options, () => props.lastWorker], () => {
  const usable = options.value.filter(option => !option.unable)
  if (chosen.value && usable.some(option => option.instanceId === chosen.value)) return
  chosen.value = usable.find(option => option.instanceId === props.lastWorker)?.instanceId ?? usable[0]?.instanceId ?? null
}, { immediate: true })
const chosenOption = computed(() => options.value.find(option => option.instanceId === chosen.value && !option.unable) ?? null)
const canGo = computed(() => !!chosenOption.value && (props.plot.action !== 'plant' || !!cropId.value))
const goLabel = computed(() => (props.plot.action && chosenOption.value ? `${FARM_VERB[props.plot.action]} con ${chosenOption.value.name}` : 'Elegí un Pokémon'))

const workerName = ref<string | null>(null)
const view = computed(() => resultView(props.result, workerName.value))

function go(): void {
  const option = chosenOption.value
  if (!option || !canGo.value) return
  workerName.value = option.name
  emit('work', { instanceId: option.instanceId, speciesId: option.speciesId }, option.name, props.plot.action === 'plant' ? cropId.value : null)
}
</script>

<style scoped>
.fc { box-sizing: border-box; display: grid; gap: 0.55rem; padding: 0.8rem; border: 2px solid rgba(255, 255, 255, 0.14); border-left: 4px solid var(--skx-farming, #7bc96f); border-radius: 12px; background: rgba(12, 20, 42, 0.97); color: var(--skx-soft, #eef2ff); }
.fc p { margin: 0; }
.fc-head { display: flex; align-items: center; gap: 0.55rem; }
.fc-icon { font-size: 1.35rem; }
.fc-titles { flex: 1; min-width: 0; }
.fc-kicker, .fc-pick { color: var(--skx-muted, #9fb2da); font-size: 0.7rem; letter-spacing: 0.05em; text-transform: uppercase; }
.fc-title { font-size: 1rem; }
.fc-x { width: 36px; height: 36px; border: 1px solid rgba(255, 255, 255, 0.22); border-radius: 8px; background: transparent; color: inherit; font: inherit; font-size: 1.2rem; cursor: pointer; }
.fc-x:disabled { opacity: 0.3; cursor: default; }
.fc-stage { font-size: 0.88rem; }
.fc-muted { color: var(--skx-muted, #9fb2da); font-size: 0.75rem; }
.fc-crops, .fc-workers { display: grid; gap: 0.3rem; max-height: 9.5rem; margin: 0; padding: 0; overflow-y: auto; list-style: none; }
.fc-crop, .fc-worker { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 0.5rem; width: 100%; min-height: 40px; padding: 0.3rem 0.6rem; border: 1px solid rgba(255, 255, 255, 0.16); border-radius: 9px; background: rgba(255, 255, 255, 0.04); color: inherit; font: inherit; text-align: left; cursor: pointer; }
.fc-worker { grid-template-columns: 1fr auto auto; }
.fc-crop--on, .fc-worker--on { border-color: var(--skx-gold, #ffd27a); background: rgba(255, 210, 122, 0.12); }
.fc-crop:disabled, .fc-worker:disabled { opacity: 0.45; cursor: not-allowed; }
.fc-crop-name { font-size: 0.85rem; font-weight: 600; }
.fc-crop-line { color: var(--skx-muted, #9fb2da); font-size: 0.72rem; }
.fc-stars { color: var(--skx-gold, #ffd27a); font-size: 0.8rem; }
.fc-refusal { color: var(--skx-warn, #ff9f7a); font-size: 0.8rem; }
.fc-go, .fc-ghost { min-height: 44px; padding: 0 1rem; border-radius: 10px; font: inherit; font-weight: 800; cursor: pointer; }
.fc-go { border: 0; background: var(--skx-gold, #ffd27a); color: var(--skx-navy, #101a36); }
.fc-go:disabled { opacity: 0.45; cursor: default; }
.fc-ghost { border: 1px solid rgba(255, 255, 255, 0.25); background: transparent; color: inherit; }
.fc-working { display: grid; gap: 0.45rem; font-size: 0.9rem; }
.fc-progress { display: block; height: 8px; border-radius: 999px; background: rgba(255, 255, 255, 0.12); overflow: hidden; }
.fc-progress span { display: block; width: 100%; height: 100%; background: var(--skx-gold, #ffd27a); transform-origin: left; animation: fc-fill linear forwards; }
@keyframes fc-fill { from { transform: scaleX(0); } to { transform: scaleX(1); } }
.fc-result { display: grid; gap: 0.35rem; }
.fc-levelup { color: var(--skx-gold, #ffd27a); font-size: 1.1rem; font-weight: 900; }
.fc-unlock { color: var(--skx-good, #9be27a); font-size: 0.82rem; font-weight: 700; }
.fc-gains { display: flex; flex-wrap: wrap; align-items: center; gap: 0.3rem 0.8rem; font-size: 0.9rem; }
.fc-xp { color: var(--skx-gold, #ffd27a); font-weight: 800; }
.fc-item { display: inline-flex; align-items: center; gap: 0.3rem; }
@media (prefers-reduced-motion: reduce) { .fc-progress span { animation: none; transform: none; } }
</style>
