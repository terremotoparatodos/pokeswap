<template>
  <section class="wc skx" :class="`wc--${resource.skill}`" :aria-label="`${resource.name}, ${skill.name}`">
    <header class="wc-head">
      <span class="wc-icon" aria-hidden="true">{{ skill.icon }}</span>
      <div class="wc-titles">
        <p class="wc-kicker">{{ skill.name }} · Nv {{ playerLevel }}</p>
        <strong class="wc-title">{{ resource.name }}</strong>
      </div>
      <button type="button" class="wc-x" aria-label="Cerrar" :disabled="phase === 'working'" @click="emit('close')">×</button>
    </header>

    <!-- The world says "not yet", and the card turns it into a goal. -->
    <div v-if="phase === 'idle' && state.status === 'locked_level'" class="wc-locked">
      <p class="wc-req">{{ requirementLine(resource.skill, resource.requiredLevel) }}</p>
      <p class="wc-tip">{{ trainingTip(resource, playerLevel) }}</p>
    </div>

    <p v-else-if="phase === 'idle' && state.status === 'depleted'" class="wc-depleted">
      Agotado · vuelve en {{ state.respawnInSeconds }} s
    </p>

    <template v-else-if="phase === 'idle'">
      <p class="wc-reward">
        <MaterialIcon :item-id="resource.drop.itemId" :size="20" />
        <span>{{ materialName(resource.drop.itemId) }}</span>
        <span class="wc-xp">+{{ resource.xp }} XP</span>
      </p>
      <p v-if="firstTime" class="wc-first">Tu Pokémon hace el trabajo. Vos ganás experiencia en {{ skill.name }}.</p>

      <p class="wc-pick">Elegí un Pokémon</p>
      <p v-if="!options.length" class="wc-empty">No tenés Pokémon en el equipo.</p>
      <ul v-else class="wc-workers" role="radiogroup" aria-label="Pokémon que trabaja">
        <li v-for="option in options" :key="option.instanceId">
          <button
            type="button"
            role="radio"
            class="wc-worker"
            :class="{ 'wc-worker--on': chosen === option.instanceId }"
            :aria-checked="chosen === option.instanceId"
            :disabled="option.unable"
            @click="chosen = option.instanceId"
          >
            <span class="wc-worker-name">{{ option.name }}</span>
            <span class="wc-stars" :aria-label="`aptitud ${option.aptitude} de 5: ${APTITUDE_LABEL[option.aptitude]}`">{{ aptitudeStars(option.aptitude) }}</span>
            <span class="wc-secs">{{ option.unable ? `Necesita ${'★'.repeat(resource.minAptitude)}` : `${option.seconds.toLocaleString('es')} s` }}</span>
          </button>
        </li>
      </ul>
      <p v-if="refusal" class="wc-refusal" role="status">{{ refusal }}</p>
      <button type="button" class="wc-go" :disabled="!chosenOption" @click="go">{{ goLabel }}</button>
    </template>

    <div v-else-if="phase === 'working'" class="wc-working" role="status">
      <p>{{ workerName }} está {{ skill.working.toLowerCase() }}…</p>
      <span class="wc-progress"><span :style="{ animationDuration: `${run?.durationMs ?? 0}ms` }" /></span>
    </div>

    <div v-else-if="view" class="wc-result" role="status">
      <p v-if="view.levelUpLine" class="wc-levelup">{{ view.levelUpLine }}</p>
      <p v-for="line in view.unlockLines" :key="line" class="wc-unlock">{{ line }}</p>
      <p class="wc-gains">
        <span v-if="view.xpLine" class="wc-xp">{{ view.xpLine }}</span>
        <span v-for="item in view.items" :key="item.itemId" class="wc-item">
          <MaterialIcon :item-id="item.itemId" :size="18" /> +{{ item.quantity }} {{ item.name }}
        </span>
      </p>
      <p v-if="view.bonusLine" class="wc-bonus">{{ view.bonusLine }}</p>
      <div class="wc-actions">
        <button v-if="state.status === 'available' && chosenOption" type="button" class="wc-go" @click="go">Otra vez</button>
        <button type="button" class="wc-ghost" @click="emit('close')">Listo</button>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { APTITUDE_LABEL, aptitudeStars } from '../domain/aptitude/aptitudeScale'
import { materialName } from '../domain/materials'
import { requirementLine } from '../domain/messages'
import type { ResourceDefinition } from '../domain/resources'
import { SKILLS, SKILL_IDS, type SkillId } from '../domain/skills'
import { levelForXp } from '../domain/xpCurve'
import type { WorkerRef } from '../ui/workerRef'
import type { NodeState } from '../scene/nodeTarget'
import type { SettleResult } from '../service/skillsService'
import { resultView, trainingTip, workerOptions } from '../ui/skillsView'
import type { WorkPhase, WorkRun } from '../ui/useSkillsLayer'
import MaterialIcon from './MaterialIcon.vue'
import './skills.css'

// One card, three moments: choose a Pokémon, watch it work, see what you got.
// Everything it says comes from the Skills service and the catalogs.
const props = defineProps<{
  resource: ResourceDefinition
  state: NodeState
  phase: WorkPhase
  run: WorkRun | null
  result: SettleResult | null
  refusal: string | null
  xp: Readonly<Record<SkillId, number>>
  workers: readonly WorkerRef[]
  /** instanceId of the Pokémon that last did this skill. */
  lastWorker: string | null
}>()
const emit = defineEmits<{ work: [worker: WorkerRef, name: string]; close: [] }>()

const skill = computed(() => SKILLS[props.resource.skill])
const playerLevel = computed(() => levelForXp(props.xp[props.resource.skill] ?? 0))
const firstTime = computed(() => SKILL_IDS.every(id => (props.xp[id] ?? 0) === 0))
const options = computed(() => workerOptions(props.workers, props.resource, playerLevel.value))

const chosen = ref<string | null>(null)
const workerName = ref<string | null>(null)
watch([options, () => props.lastWorker], () => {
  const usable = options.value.filter(option => !option.unable)
  if (chosen.value && usable.some(option => option.instanceId === chosen.value)) return
  chosen.value = usable.find(option => option.instanceId === props.lastWorker)?.instanceId ?? usable[0]?.instanceId ?? null
}, { immediate: true })
const chosenOption = computed(() => options.value.find(option => option.instanceId === chosen.value && !option.unable) ?? null)
const goLabel = computed(() => (chosenOption.value ? `${skill.value.verb} con ${chosenOption.value.name}` : 'Elegí un Pokémon'))

const view = computed(() => resultView(props.result, workerName.value))

function go(): void {
  const option = chosenOption.value
  if (!option) return
  workerName.value = option.name
  emit('work', { instanceId: option.instanceId, speciesId: option.speciesId }, option.name)
}
</script>

<style scoped>
.wc {
  box-sizing: border-box;
  display: grid;
  gap: 0.5rem;
  padding: 0.7rem 0.8rem 0.8rem;
  border: 2px solid var(--skx-line);
  border-left-width: 5px;
  border-radius: 14px;
  background: rgba(16, 26, 54, 0.96);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.4);
}
.wc--woodcutting { border-left-color: var(--skx-woodcutting); }
.wc--mining { border-left-color: var(--skx-mining); }
.wc-head { display: flex; align-items: center; gap: 0.55rem; }
.wc-icon { font-size: 1.35rem; }
.wc-titles { flex: 1; min-width: 0; }
.wc-kicker { margin: 0; color: var(--skx-muted); font-size: 0.7rem; letter-spacing: 0.05em; text-transform: uppercase; }
.wc-title { font-size: 1rem; }
.wc-x { width: 36px; height: 36px; border: 1px solid rgba(255, 255, 255, 0.22); border-radius: 8px; background: transparent; color: var(--skx-soft); font: inherit; font-size: 1.2rem; cursor: pointer; }
.wc-x:disabled { opacity: 0.3; cursor: default; }
.wc p { margin: 0; }

.wc-locked { display: grid; gap: 0.2rem; }
.wc-req { color: var(--skx-warn); font-size: 1rem; font-weight: 800; }
.wc-tip, .wc-depleted, .wc-empty { color: var(--skx-soft); font-size: 0.8rem; opacity: 0.8; }

.wc-reward { display: flex; align-items: center; gap: 0.4rem; font-size: 0.85rem; }
.wc-xp { color: var(--skx-gold); font-weight: 800; }
.wc-first { color: var(--skx-soft); font-size: 0.76rem; opacity: 0.75; }
.wc-pick { color: var(--skx-muted); font-size: 0.72rem; letter-spacing: 0.05em; text-transform: uppercase; }

.wc-workers { display: grid; gap: 0.3rem; max-height: 11rem; margin: 0; padding: 0; overflow-y: auto; list-style: none; }
.wc-worker {
  display: grid;
  grid-template-columns: 1fr auto auto;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  min-height: 40px;
  padding: 0.3rem 0.6rem;
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 9px;
  background: rgba(255, 255, 255, 0.04);
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.wc-worker--on { border-color: var(--skx-gold); background: rgba(255, 210, 122, 0.12); }
.wc-worker:disabled { opacity: 0.45; cursor: not-allowed; }
.wc-worker-name { font-size: 0.85rem; font-weight: 600; }
.wc-stars { color: var(--skx-gold); font-size: 0.8rem; letter-spacing: 0.04em; }
.wc-secs { min-width: 3.2rem; color: var(--skx-muted); font-size: 0.72rem; text-align: right; font-variant-numeric: tabular-nums; }
.wc-refusal { color: var(--skx-warn); font-size: 0.8rem; }

.wc-go, .wc-ghost { min-height: 44px; padding: 0 1rem; border-radius: 10px; font: inherit; font-weight: 800; cursor: pointer; }
.wc-go { border: 0; background: var(--skx-gold); color: var(--skx-navy); }
.wc-go:disabled { opacity: 0.45; cursor: default; }
.wc-ghost { border: 1px solid rgba(255, 255, 255, 0.25); background: transparent; color: var(--skx-soft); }
.wc-actions { display: flex; gap: 0.5rem; }
.wc-actions .wc-go { flex: 1; }

.wc-working { display: grid; gap: 0.45rem; font-size: 0.9rem; }
.wc-progress { display: block; height: 8px; border-radius: 999px; background: rgba(255, 255, 255, 0.12); overflow: hidden; }
.wc-progress span { display: block; width: 100%; height: 100%; background: var(--skx-gold); transform-origin: left; animation: wc-fill linear forwards; }
@keyframes wc-fill { from { transform: scaleX(0); } to { transform: scaleX(1); } }

.wc-result { display: grid; gap: 0.35rem; }
.wc-levelup { color: var(--skx-gold); font-size: 1.1rem; font-weight: 900; }
.wc-unlock { color: var(--skx-good); font-size: 0.82rem; font-weight: 700; }
.wc-gains { display: flex; flex-wrap: wrap; align-items: center; gap: 0.3rem 0.8rem; font-size: 0.9rem; }
.wc-item { display: inline-flex; align-items: center; gap: 0.3rem; }
.wc-bonus { color: var(--skx-rare); font-size: 0.78rem; }

@media (prefers-reduced-motion: reduce) {
  .wc-progress span { animation: none; transform: none; }
}
</style>
