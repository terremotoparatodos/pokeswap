<template>
  <section class="fa pf-card" :class="[`fa--${statusView.tone}`, `fa--${phase}`, { 'fa--bite': biting }]" role="dialog" :aria-label="node.name">
    <header class="fa-head">
      <ItemGlyph :item-id="node.drops.primary.itemId" :size="32" />
      <div class="fa-title">
        <p class="pf-kicker">Pesca Nv. {{ level }} · requiere {{ node.requiredLevel }}</p>
        <h2>{{ node.name }}</h2>
      </div>
      <button v-if="phase !== 'casting'" type="button" class="fa-close" aria-label="Cerrar" @click="emit('close')">×</button>
    </header>

    <p class="fa-status" role="status">
      <template v-if="phase === 'casting'">
        <strong>{{ biting ? '¡Pica! Recogé ya' : 'Esperando el pique…' }}</strong>
        <span v-if="!biting" class="fa-dots" aria-hidden="true"><i /><i /><i /></span>
      </template>
      <template v-else>
        <strong>{{ statusView.title }}</strong><span v-if="statusView.detail"> · {{ statusView.detail }}</span>
      </template>
    </p>

    <div v-if="phase !== 'casting'" class="fa-crew">
      <div class="fa-worker">
        <template v-if="worker && summary">
          <PokemonPortrait :species-id="worker.speciesId" :name="worker.name" :size="36" />
          <div><strong>{{ worker.name }}</strong><small>{{ summary.specialty.label }} {{ '●'.repeat(summary.specialty.rating) }}</small></div>
        </template>
        <small v-else>Sin Pokémon · sin bonus</small>
      </div>
      <div class="fa-tool" :class="tool ? `fa-tool--${toolView?.health}` : 'fa-tool--none'">
        <template v-if="tool && toolView">
          <ItemGlyph :item-id="tool.definition.itemId" :size="32" :condition="toolView.health === 'retired' ? 'retired' : toolView.health === 'broken' ? 'broken' : 'ok'" />
          <div>
            <small>{{ toolView.label }}</small>
            <span class="fa-dur"><span :style="{ width: `${(tool.instance.durability / tool.definition.maxDurability) * 100}%` }" /></span>
          </div>
        </template>
        <small v-else>Sin caña</small>
      </div>
    </div>

    <ul v-if="check.ok && phase === 'idle'" class="fa-chips">
      <li class="fa-chip fa-chip--reward"><ItemGlyph :item-id="check.preview.primaryItemId" :size="16" /> ×{{ check.preview.minUnits }}<template v-if="check.preview.extraUnitChance > 0">–{{ check.preview.maxUnits + 1 }}</template></li>
      <li class="fa-chip fa-chip--energy">−{{ Math.round(check.preview.energySpent) }} energía</li>
      <li v-if="!check.preview.bareHands" class="fa-chip">−{{ check.preview.durabilityPoints }} durab.</li>
      <li class="fa-chip fa-chip--xp">+{{ check.preview.xp }} XP</li>
    </ul>

    <template v-if="phase === 'result' && outcome">
      <p class="fa-grade" :class="`fa-grade--${outcome.grade}`">{{ GRADE_LABEL[outcome.grade] }}</p>
      <GatheringFeedback
        v-if="lines.length"
        :lines="lines"
        :rare="rarity === 'rare' || rarity === 'special'"
        :banner="rarity === 'special' ? '¡Captura especial!' : '¡Buena pieza!'"
      />
      <p v-else class="fa-miss">No gastaste energía ni desgaste: volvé a lanzar.</p>
    </template>

    <details v-if="check.ok && phase === 'idle'" class="fa-details">
      <summary>Ver detalle</summary>
      <NodeOutlook :preview="check.preview" :breakdown="breakdown" :rested="state.energy.rested > 0" />
    </details>

    <footer class="fa-actions">
      <button v-if="phase === 'casting'" type="button" class="pf-btn fa-reel" :class="{ 'fa-reel--hot': biting }" @click="emit('reel')">¡Recoger!</button>
      <template v-else>
        <button type="button" class="pf-btn fa-cast" :disabled="!statusView.canAct" @click="emit('cast')">
          {{ phase === 'result' ? 'Lanzar de nuevo' : 'Lanzar caña' }}
        </button>
        <button v-if="canRepair" type="button" class="pf-btn pf-btn--ghost" @click="repair">Reparar</button>
        <button v-if="state.pending.length" type="button" class="pf-btn pf-btn--ghost" @click="collect">Recoger pendientes</button>
      </template>
    </footer>
    <p v-if="note" class="fa-note">{{ note }}</p>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { ENERGY_CONFIG } from '../domain/catalog/professions'
import {
  collectPendingDemo, demoAffinity, demoLevel, demoTool, demoWorker, inspectDemoNode, type DemoNodeTarget,
} from '../demo/demoSession'
import type { ProfessionDemoSession } from '../demo/useProfessionDemo'
import type { FishingOutcome, FishingPhase } from '../fishing/useFishingController'
import type { ReelGrade } from '../fishing/fishingTimeline'
import { outcomeRarity } from '../mining/miningRarity'
import { summarizeWorker } from '../ui/capabilities'
import { gatheringFeedback, inventoryFeedback } from '../ui/feedback'
import { energyCostBreakdown, toolHealth } from '../ui/gearViews'
import { describeNodeStatus, resolveNodeStatus } from '../ui/nodeStatus'
import { itemName } from '../ui/progressionView'
import GatheringFeedback from './GatheringFeedback.vue'
import ItemGlyph from './ItemGlyph.vue'
import NodeOutlook from './NodeOutlook.vue'
import PokemonPortrait from './PokemonPortrait.vue'

// Compact world card for fishing. While the line is out it keeps only the
// header, the state and the reel button, so the water stays visible.
const props = defineProps<{ session: ProfessionDemoSession; target: DemoNodeTarget; phase: FishingPhase; outcome: FishingOutcome | null; biting: boolean }>()
const emit = defineEmits<{ cast: []; reel: []; close: [] }>()

const GRADE_LABEL: Readonly<Record<ReelGrade, string>> = {
  perfect: '¡Tirón perfecto!',
  good: 'Buen tirón',
  late: 'Tarde, pero salió',
  early: 'Recogiste antes de tiempo: se asustó',
  missed: 'Se escapó: tardaste en recoger',
}

const state = computed(() => props.session.state.value)
const node = computed(() => props.target.node)
const level = computed(() => demoLevel(state.value, 'fishing'))
const worker = computed(() => demoWorker(state.value, 'fishing'))
const affinity = computed(() => demoAffinity(state.value, 'fishing'))
const summary = computed(() => affinity.value ? summarizeWorker(affinity.value) : null)
const tool = computed(() => demoTool(state.value, 'fishing'))
const toolView = computed(() => tool.value ? toolHealth(tool.value.instance, tool.value.definition) : null)
const inspection = computed(() => inspectDemoNode(state.value, props.target))
const check = computed(() => inspection.value.check)
const breakdown = computed(() => energyCostBreakdown(node.value, affinity.value?.bonuses.energySaving ?? 0, level.value, ENERGY_CONFIG))
const statusView = computed(() => describeNodeStatus(resolveNodeStatus({ ...inspection.value, phase: 'idle' }), {
  node: node.value, level: level.value, respawnInSeconds: inspection.value.respawnInSeconds,
  energyNeeded: breakdown.value.final, energyHave: state.value.energy.current,
}))
const canRepair = computed(() => !!tool.value && tool.value.instance.durability < tool.value.instance.maxDurability)

const gather = computed(() => (props.outcome?.gather?.ok ? props.outcome.gather : null))
const lines = computed(() => {
  const result = gather.value
  if (!result) return []
  return [
    ...gatheringFeedback(result.result, { profession: 'fishing', leveledUp: result.leveledUp, newLevel: level.value, toolBroke: result.toolBroke, hasTool: tool.value !== null }),
    ...inventoryFeedback(result.placements, result.overflow),
  ]
})
const rarity = computed(() => gather.value ? outcomeRarity(gather.value.result) : 'common')

const note = ref('')
function repair(): void {
  const outcome = props.session.repair('fishing')
  const cost = outcome.cost.map(stack => `${stack.quantity} ${itemName(stack.itemId)}`).join(', ')
  note.value = outcome.ok ? `Reparada · usaste ${cost}`
    : outcome.reason === 'missing_materials' ? `Faltan materiales: ${cost}`
      : outcome.reason === 'worn_out' ? 'Ya no admite reparaciones' : 'No hace falta reparar'
}
function collect(): void {
  props.session.update(value => collectPendingDemo(value).state)
}
</script>

<style scoped>
.fa { display: grid; gap: 0.5rem; width: 100%; padding: 0.75rem 0.85rem; border-top: 4px solid var(--pf-fishing); }
.fa-head { display: flex; align-items: center; gap: 0.6rem; }
.fa-title { flex: 1; min-width: 0; }
.fa-title h2 { margin: 0.05rem 0 0; font-size: 1.05rem; }
.fa-close { width: 40px; height: 40px; margin: -0.35rem -0.4rem 0 0; border: 0; border-radius: 50%; background: transparent; color: inherit; font-size: 1.6rem; cursor: pointer; }
.fa-status { display: flex; align-items: center; gap: 0.3rem; margin: 0; padding: 0.35rem 0.55rem; border-radius: 8px; background: rgba(255, 255, 255, 0.07); font-size: 0.84rem; }
.fa--ready .fa-status { color: var(--pf-good); }
.fa--blocked .fa-status { color: var(--pf-bad); }
.fa--warn .fa-status { color: var(--pf-warn); }
.fa--casting .fa-status { color: var(--pf-soft); }
.fa--bite .fa-status { color: var(--pf-gold); font-weight: 800; }
.fa-dots { display: inline-flex; gap: 3px; }
.fa-dots i { width: 5px; height: 5px; border-radius: 1px; background: var(--pf-soft); animation: fa-dot 0.9s infinite; }
.fa-dots i:nth-child(2) { animation-delay: 0.15s; }
.fa-dots i:nth-child(3) { animation-delay: 0.3s; }
@keyframes fa-dot { 50% { transform: translateY(-3px); } }
.fa-crew { display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; }
.fa-worker, .fa-tool { display: flex; align-items: center; gap: 0.45rem; min-width: 0; }
.fa-worker div, .fa-tool div { display: grid; min-width: 0; flex: 1; }
.fa-worker small, .fa-tool small { color: var(--pf-muted); font-size: 0.74rem; }
.fa-worker small { color: var(--pf-gold); }
.fa-dur { display: block; height: 5px; margin-top: 2px; border-radius: 3px; background: rgba(255, 255, 255, 0.12); overflow: hidden; }
.fa-dur span { display: block; height: 100%; background: var(--pf-good); }
.fa-tool--worn .fa-dur span { background: #d8d46a; }
.fa-tool--critical .fa-dur span { background: var(--pf-warn); }
.fa-tool--broken small, .fa-tool--retired small { color: var(--pf-bad); font-weight: 700; }
.fa-chips { display: flex; flex-wrap: wrap; gap: 0.3rem; margin: 0; padding: 0; list-style: none; }
.fa-chip { display: inline-flex; align-items: center; gap: 0.25rem; padding: 0.15rem 0.5rem; border-radius: 999px; background: rgba(255, 255, 255, 0.08); font-size: 0.78rem; font-weight: 700; }
.fa-chip--reward { color: var(--pf-good); }
.fa-chip--energy { color: var(--pf-energy); }
.fa-chip--xp { color: var(--pf-gold); }
.fa-grade { margin: 0; font-size: 0.84rem; font-weight: 800; }
.fa-grade--perfect { color: var(--pf-gold); }
.fa-grade--good { color: var(--pf-good); }
.fa-grade--late { color: var(--pf-warn); }
.fa-grade--early, .fa-grade--missed { color: var(--pf-bad); }
.fa-miss { margin: 0; color: var(--pf-muted); font-size: 0.8rem; }
.fa-details summary { color: var(--pf-muted); font-size: 0.78rem; cursor: pointer; }
.fa-actions { display: flex; flex-wrap: wrap; gap: 0.4rem; }
.fa-actions .pf-btn { white-space: nowrap; }
.fa-cast, .fa-reel { flex: 1 1 9rem; font-size: 1.02rem; }
.fa-actions .pf-btn--ghost { flex: 1 1 auto; }
.fa-reel--hot { background: var(--pf-gold); color: var(--pf-navy); font-weight: 800; animation: fa-hot 0.4s ease-in-out infinite; }
.fa-note { margin: 0; color: var(--pf-muted); font-size: 0.78rem; }
@keyframes fa-hot { 50% { transform: scale(1.04); } }
@media (prefers-reduced-motion: reduce) {
  .fa-reel--hot, .fa-dots i { animation: none; }
}
@media (max-width: 420px) {
  .fa-crew { grid-template-columns: 1fr; }
}
</style>
