<template>
  <section
    class="np pf-card"
    :class="[`np--${statusView.tone}`, `np--${node.profession}`]"
    role="dialog"
    :aria-label="node.name"
  >
    <header class="np-head">
      <div class="np-title">
        <p class="pf-kicker">{{ profession.name }} · Tier {{ node.tier }}</p>
        <h2>{{ node.name }}</h2>
      </div>
      <span class="np-level" :class="{ 'np-level--short': level < node.requiredLevel }">
        Nv. {{ level }}<small>req. {{ node.requiredLevel }}</small>
      </span>
      <button v-if="closable" class="np-close" aria-label="Cerrar" @click="emit('close')">×</button>
    </header>

    <p class="np-status" role="status">
      <strong>{{ statusView.title }}</strong><span v-if="statusView.detail"> · {{ statusView.detail }}</span>
    </p>

    <div class="np-crew">
      <div class="np-worker">
        <template v-if="worker && summary">
          <PokemonPortrait :species-id="worker.speciesId" :name="worker.name" :size="44" />
          <div>
            <p class="pf-kicker">Trabajador</p>
            <strong>{{ worker.name }}</strong>
            <p class="np-spec">{{ summary.specialty.label }} {{ '●'.repeat(summary.specialty.rating) }}{{ '○'.repeat(MAX_RATING - summary.specialty.rating) }}</p>
          </div>
        </template>
        <p v-else class="np-muted">Sin Pokémon asignado · sin bonus</p>
      </div>
      <ToolStatus :tool="tool" :kind="profession.toolKind" compact />
    </div>

    <NodeOutlook v-if="inspection.check.ok" :preview="inspection.check.preview" :breakdown="breakdown" :rested="state.energy.rested > 0" />

    <EnergyMeter
      compact
      :current="energy.current"
      :max="energy.max"
      :rested="energy.rested"
      :cost="inspection.check.ok ? inspection.check.preview.energySpent : breakdown.final"
    />

    <div v-if="phase === 'working'" class="np-progress" aria-hidden="true"><span :style="{ animationDuration: `${workMs}ms` }" /></div>
    <GatheringFeedback v-if="feedback.length" :lines="feedback" :rare="lastRare" />

    <footer class="np-actions">
      <FishingCast v-if="node.profession === 'fishing'" :disabled="!statusView.canAct" @caught="collect" @escaped="onEscaped" />
      <button v-else class="pf-btn np-act" :disabled="!statusView.canAct" @click="start">{{ ACTION_LABEL[node.profession] }}</button>
      <button v-if="canRepair" class="pf-btn pf-btn--ghost" @click="repair">Reparar</button>
    </footer>
    <p v-if="repairNote" class="np-muted">{{ repairNote }}</p>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, shallowRef } from 'vue'
import { ENERGY_CONFIG, PROFESSIONS } from '../domain/catalog/professions'
import type { ProfessionId } from '../domain/types'
import {
  demoAffinity, demoLevel, demoMaxEnergy, demoTool, demoWorker, inspectDemoNode, type DemoNodeTarget,
} from '../demo/demoSession'
import type { ProfessionDemoSession } from '../demo/useProfessionDemo'
import { MAX_RATING, summarizeWorker } from '../ui/capabilities'
import { gatheringFeedback, type FeedbackLine } from '../ui/feedback'
import { energyCostBreakdown, energyView } from '../ui/gearViews'
import { describeNodeStatus, resolveNodeStatus, type NodePhase } from '../ui/nodeStatus'
import { itemName } from '../ui/progressionView'
import EnergyMeter from './EnergyMeter.vue'
import FishingCast from './FishingCast.vue'
import GatheringFeedback from './GatheringFeedback.vue'
import NodeOutlook from './NodeOutlook.vue'
import PokemonPortrait from './PokemonPortrait.vue'
import ToolStatus from './ToolStatus.vue'

// One panel for every gathering profession: inspect → understand → act → feedback.
const props = withDefaults(defineProps<{ session: ProfessionDemoSession; target: DemoNodeTarget; closable?: boolean }>(), { closable: false })
const emit = defineEmits<{ close: [] }>()

const ACTION_LABEL: Readonly<Record<ProfessionId, string>> = { mining: 'Extraer', woodcutting: 'Talar', fishing: 'Pescar', alchemy: 'Recolectar' }
/** The prototype compresses real action seconds so the loop can be felt quickly. */
const DEMO_TIME_SCALE_MS = 100
const RESULT_MS = 1400
const COOLDOWN_MS = 500

const state = computed(() => props.session.state.value)
const node = computed(() => props.target.node)
const profession = computed(() => PROFESSIONS[node.value.profession])
const level = computed(() => demoLevel(state.value, node.value.profession))
const worker = computed(() => demoWorker(state.value, node.value.profession))
const affinity = computed(() => demoAffinity(state.value, node.value.profession))
const summary = computed(() => affinity.value ? summarizeWorker(affinity.value) : null)
const tool = computed(() => demoTool(state.value, node.value.profession))
const inspection = computed(() => inspectDemoNode(state.value, props.target))
const energy = computed(() => energyView(state.value.energy, demoMaxEnergy(state.value), ENERGY_CONFIG))
const breakdown = computed(() => energyCostBreakdown(node.value, affinity.value?.bonuses.energySaving ?? 0, level.value, ENERGY_CONFIG))

const phase = ref<NodePhase>('idle')
const workMs = ref(0)
const feedback = shallowRef<readonly FeedbackLine[]>([])
const lastRare = ref(false)
const repairNote = ref('')

const status = computed(() => resolveNodeStatus({ ...inspection.value, phase: phase.value }))
const statusView = computed(() => describeNodeStatus(status.value, {
  node: node.value, level: level.value, respawnInSeconds: inspection.value.respawnInSeconds,
  energyNeeded: breakdown.value.final, energyHave: state.value.energy.current,
}))
const canRepair = computed(() => !!tool.value && tool.value.instance.durability < tool.value.instance.maxDurability && phase.value === 'idle')

const timers = new Set<ReturnType<typeof setTimeout>>()
const later = (ms: number, run: () => void) => {
  const id = setTimeout(() => { timers.delete(id); run() }, ms)
  timers.add(id)
}

function start(): void {
  if (!statusView.value.canAct || !inspection.value.check.ok) return
  feedback.value = []
  repairNote.value = ''
  workMs.value = Math.min(1800, Math.max(500, inspection.value.check.preview.actionSeconds * DEMO_TIME_SCALE_MS))
  phase.value = 'working'
  later(workMs.value, collect)
}

function collect(): void {
  const outcome = props.session.gather(props.target)
  if (!outcome.ok) {
    phase.value = 'idle'
    feedback.value = [{ text: describeNodeStatus(outcome.status, {
      node: node.value, level: level.value, respawnInSeconds: inspection.value.respawnInSeconds,
      energyNeeded: breakdown.value.final, energyHave: state.value.energy.current,
    }).title, tone: 'warn' }]
    return
  }
  lastRare.value = outcome.result.rareDrops.length > 0 || outcome.result.critical
  feedback.value = gatheringFeedback(outcome.result, {
    profession: node.value.profession, leveledUp: outcome.leveledUp, newLevel: level.value,
    toolBroke: outcome.toolBroke, hasTool: tool.value !== null,
  })
  phase.value = lastRare.value ? 'rare' : 'success'
  later(RESULT_MS, () => {
    phase.value = 'cooldown'
    later(COOLDOWN_MS, () => { phase.value = 'idle' })
  })
}

function onEscaped(): void {
  lastRare.value = false
  feedback.value = [{ text: 'El pez se escapó · sin coste de energía ni desgaste', tone: 'warn' }]
}

function repair(): void {
  const outcome = props.session.repair(node.value.profession)
  const cost = outcome.cost.map(stack => `${stack.quantity} ${itemName(stack.itemId)}`).join(', ')
  if (outcome.ok) repairNote.value = `Reparada · usaste ${cost}`
  else if (outcome.reason === 'missing_materials') repairNote.value = `Faltan materiales: ${cost}`
  else if (outcome.reason === 'worn_out') repairNote.value = 'Ya no admite reparaciones: fabricá una nueva'
  else repairNote.value = 'No hace falta reparar'
}

const onKeyDown = (event: KeyboardEvent) => { if (props.closable && event.key === 'Escape') emit('close') }
let clock: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  window.addEventListener('keydown', onKeyDown)
  clock = setInterval(() => props.session.sync(), 1000)
})
onUnmounted(() => {
  window.removeEventListener('keydown', onKeyDown)
  if (clock) clearInterval(clock)
  for (const id of timers) clearTimeout(id)
})
</script>

<style scoped>
.np { display: grid; gap: 0.7rem; width: 100%; padding: 1rem; border-top-width: 4px; }
.np--mining { border-top-color: var(--pf-mining); }
.np--woodcutting { border-top-color: var(--pf-woodcutting); }
.np--fishing { border-top-color: var(--pf-fishing); }
.np--alchemy { border-top-color: var(--pf-alchemy); }
.np-head { display: flex; align-items: flex-start; gap: 0.75rem; }
.np-title { flex: 1; min-width: 0; }
.np-title h2 { margin: 0.1rem 0 0; font-size: 1.25rem; }
.np-level { display: grid; justify-items: end; color: var(--pf-gold); font-weight: 800; }
.np-level small { color: var(--pf-muted); font-weight: 500; font-size: 0.72rem; }
.np-level--short { color: var(--pf-bad); }
.np-close { width: 44px; height: 44px; margin: -0.5rem -0.5rem 0 0; border: 0; border-radius: 50%; background: transparent; color: inherit; font-size: 1.8rem; cursor: pointer; }
.np-status { margin: 0; padding: 0.45rem 0.65rem; border-radius: 8px; background: rgba(255, 255, 255, 0.07); font-size: 0.88rem; }
.np--ready .np-status { color: var(--pf-good); }
.np--busy .np-status { color: var(--pf-soft); }
.np--good .np-status { color: var(--pf-good); }
.np--rare .np-status { color: var(--pf-rare); }
.np--blocked .np-status { color: var(--pf-bad); }
.np--warn .np-status { color: var(--pf-warn); }
.np-crew { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; }
.np-worker { display: flex; align-items: center; gap: 0.55rem; min-width: 0; }
.np-worker strong { display: block; }
.np-spec { margin: 0; color: var(--pf-gold); font-size: 0.76rem; letter-spacing: 0.04em; }
.np-muted { margin: 0; color: var(--pf-muted); font-size: 0.8rem; }
.np-progress { height: 6px; border-radius: 999px; background: rgba(255, 255, 255, 0.1); overflow: hidden; }
.np-progress span { display: block; height: 100%; background: var(--pf-gold); animation: np-fill linear forwards; transform-origin: left; }
.np-actions { display: flex; flex-wrap: wrap; gap: 0.5rem; }
.np-act { flex: 1; font-size: 1.05rem; }
.np--rare { box-shadow: 0 0 0 2px rgba(208, 168, 255, 0.5), 0 12px 32px rgba(0, 0, 0, 0.4); }
@keyframes np-fill { from { transform: scaleX(0); } to { transform: scaleX(1); } }
@media (max-width: 520px) {
  .np { padding: 0.85rem; }
  .np-crew { grid-template-columns: 1fr; }
}
</style>
