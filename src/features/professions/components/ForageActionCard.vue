<template>
  <section class="fc pf-card" :class="[`fc--${statusView.tone}`, `fc--${phase}`]" role="dialog" :aria-label="node.name">
    <header class="fc-head">
      <ItemGlyph :item-id="node.drops.primary.itemId" :size="32" />
      <div class="fc-title">
        <p class="pf-kicker">Alquimia Nv. {{ level }} · requiere {{ node.requiredLevel }}</p>
        <h2>{{ node.name }}</h2>
      </div>
      <button v-if="phase !== 'gathering'" type="button" class="fc-close" aria-label="Cerrar" @click="emit('close')">×</button>
    </header>

    <p v-if="phase !== 'gathering'" class="fc-status" role="status">
      <strong>{{ statusView.title }}</strong><span v-if="statusView.detail"> · {{ statusView.detail }}</span>
    </p>
    <p v-else class="fc-status fc-status--busy" role="status">
      <strong>{{ byHand ? 'Recolectando…' : 'Cortando…' }}</strong><span class="fc-dots" aria-hidden="true"><i /><i /><i /></span>
    </p>

    <div v-if="phase !== 'gathering'" class="fc-crew">
      <div class="fc-worker">
        <template v-if="worker && summary">
          <PokemonPortrait :species-id="worker.speciesId" :name="worker.name" :size="36" />
          <div><strong>{{ worker.name }}</strong><small>{{ summary.specialty.label }} {{ '●'.repeat(summary.specialty.rating) }}</small></div>
        </template>
        <small v-else>Sin Pokémon · sin bonus</small>
      </div>
      <!-- A berry needs no blade, but if a sickle is equipped the domain uses it: the card shows whichever really happens. -->
      <div v-if="byHand" class="fc-tool fc-tool--hand"><small>A mano · no necesita hoz</small></div>
      <div v-else class="fc-tool" :class="tool ? `fc-tool--${toolView?.health}` : 'fc-tool--none'">
        <template v-if="tool && toolView">
          <ItemGlyph :item-id="tool.definition.itemId" :size="32" :condition="toolView.health === 'retired' ? 'retired' : toolView.health === 'broken' ? 'broken' : 'ok'" />
          <div>
            <small>{{ toolView.label }}<span v-if="optionalTool"> · opcional</span></small>
            <span class="fc-dur"><span :style="{ width: `${(tool.instance.durability / tool.definition.maxDurability) * 100}%` }" /></span>
          </div>
        </template>
        <small v-else>Sin hoz</small>
      </div>
    </div>

    <ul v-if="check.ok && phase === 'idle'" class="fc-chips">
      <li class="fc-chip fc-chip--reward"><ItemGlyph :item-id="check.preview.primaryItemId" :size="16" /> ×{{ check.preview.minUnits }}<template v-if="check.preview.extraUnitChance > 0">–{{ check.preview.maxUnits + 1 }}</template></li>
      <li class="fc-chip fc-chip--energy">−{{ Math.round(check.preview.energySpent) }} energía</li>
      <li v-if="!check.preview.bareHands" class="fc-chip">−{{ check.preview.durabilityPoints }} durab.</li>
      <li class="fc-chip fc-chip--xp">+{{ check.preview.xp }} XP</li>
      <li class="fc-chip fc-chip--charges">{{ chargesLabel }}</li>
    </ul>

    <GatheringFeedback
      v-if="phase === 'result' && lines.length"
      :lines="lines"
      :rare="rarity === 'rare' || rarity === 'special'"
      :banner="rarity === 'special' ? '¡Hallazgo especial!' : '¡Buena cosecha!'"
    />

    <details v-if="check.ok && phase === 'idle'" class="fc-details">
      <summary>Ver detalle</summary>
      <NodeOutlook :preview="check.preview" :breakdown="breakdown" :rested="state.energy.rested > 0" />
    </details>

    <footer v-if="phase !== 'gathering'" class="fc-actions">
      <button type="button" class="pf-btn fc-go" :disabled="!statusView.canAct" @click="emit('gather')">
        {{ phase === 'result' ? 'Seguir recolectando' : 'Recolectar' }}
      </button>
      <button v-if="canRepair" type="button" class="pf-btn pf-btn--ghost" @click="repair">Reparar</button>
      <button v-if="state.pending.length" type="button" class="pf-btn pf-btn--ghost" @click="collect">Recoger pendientes</button>
    </footer>
    <p v-if="note" class="fc-note">{{ note }}</p>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { ENERGY_CONFIG } from '../domain/catalog/professions'
import {
  collectPendingDemo, demoAffinity, demoLevel, demoTool, demoWorker, inspectDemoNode, type DemoGatherOutcome, type DemoNodeTarget,
} from '../demo/demoSession'
import type { ProfessionDemoSession } from '../demo/useProfessionDemo'
import type { ForagePhase } from '../forage/useForageController'
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

// Compact world card for Alchemy foraging. While the plant is worked it
// collapses to its header and a status pill, so the plant, the sickle and the
// petals stay visible.
const props = defineProps<{ session: ProfessionDemoSession; target: DemoNodeTarget; phase: ForagePhase; outcome: DemoGatherOutcome | null }>()
const emit = defineEmits<{ gather: []; close: [] }>()

const state = computed(() => props.session.state.value)
const node = computed(() => props.target.node)
const level = computed(() => demoLevel(state.value, 'alchemy'))
const worker = computed(() => demoWorker(state.value, 'alchemy'))
const affinity = computed(() => demoAffinity(state.value, 'alchemy'))
const summary = computed(() => affinity.value ? summarizeWorker(affinity.value) : null)
const tool = computed(() => demoTool(state.value, 'alchemy'))
const toolView = computed(() => tool.value ? toolHealth(tool.value.instance, tool.value.definition) : null)
const inspection = computed(() => inspectDemoNode(state.value, props.target))
const check = computed(() => inspection.value.check)
/** The catalog asks for no tool on this node… */
const optionalTool = computed(() => node.value.minToolTier === 0)
/** …but the domain still uses the sickle if you carry one, and wears it. */
const byHand = computed(() => (check.value.ok ? check.value.preview.bareHands : optionalTool.value))
const breakdown = computed(() => energyCostBreakdown(node.value, affinity.value?.bonuses.energySaving ?? 0, level.value, ENERGY_CONFIG))
const statusView = computed(() => describeNodeStatus(resolveNodeStatus({ ...inspection.value, phase: 'idle' }), {
  node: node.value, level: level.value, respawnInSeconds: inspection.value.respawnInSeconds,
  energyNeeded: breakdown.value.final, energyHave: state.value.energy.current,
}))
const chargesLabel = computed(() => inspection.value.remainingCharges <= 1
  ? 'Queda lo último de la planta'
  : `Quedan ${inspection.value.remainingCharges} recolecciones`)
const canRepair = computed(() => props.phase !== 'gathering' && !!tool.value && tool.value.instance.durability < tool.value.instance.maxDurability)

const lines = computed(() => {
  const outcome = props.outcome
  if (!outcome?.ok) return []
  return [
    ...gatheringFeedback(outcome.result, { profession: 'alchemy', leveledUp: outcome.leveledUp, newLevel: level.value, toolBroke: outcome.toolBroke, hasTool: tool.value !== null }),
    ...inventoryFeedback(outcome.placements, outcome.overflow),
  ]
})
const rarity = computed(() => props.outcome?.ok ? outcomeRarity(props.outcome.result) : 'common')

const note = ref('')
function repair(): void {
  const outcome = props.session.repair('alchemy')
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
.fc { display: grid; gap: 0.5rem; width: 100%; padding: 0.75rem 0.85rem; border-top: 4px solid var(--pf-alchemy); }
.fc-head { display: flex; align-items: center; gap: 0.6rem; }
.fc-title { flex: 1; min-width: 0; }
.fc-title h2 { margin: 0.05rem 0 0; font-size: 1.05rem; }
.fc-close { width: 40px; height: 40px; margin: -0.35rem -0.4rem 0 0; border: 0; border-radius: 50%; background: transparent; color: inherit; font-size: 1.6rem; cursor: pointer; }
.fc-status { display: flex; align-items: center; gap: 0.3rem; margin: 0; padding: 0.35rem 0.55rem; border-radius: 8px; background: rgba(255, 255, 255, 0.07); font-size: 0.84rem; }
.fc--ready .fc-status { color: var(--pf-good); }
.fc--blocked .fc-status { color: var(--pf-bad); }
.fc--warn .fc-status { color: var(--pf-warn); }
.fc-status--busy { color: var(--pf-gold) !important; }
.fc-dots { display: inline-flex; gap: 3px; }
.fc-dots i { width: 5px; height: 5px; border-radius: 1px; background: var(--pf-gold); animation: fc-dot 0.9s infinite; }
.fc-dots i:nth-child(2) { animation-delay: 0.15s; }
.fc-dots i:nth-child(3) { animation-delay: 0.3s; }
@keyframes fc-dot { 50% { transform: translateY(-3px); } }
.fc-crew { display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; }
.fc-worker, .fc-tool { display: flex; align-items: center; gap: 0.45rem; min-width: 0; }
.fc-worker div, .fc-tool div { display: grid; min-width: 0; flex: 1; }
.fc-worker small, .fc-tool small { color: var(--pf-muted); font-size: 0.74rem; }
.fc-worker small { color: var(--pf-gold); }
.fc-dur { display: block; height: 5px; margin-top: 2px; border-radius: 3px; background: rgba(255, 255, 255, 0.12); overflow: hidden; }
.fc-dur span { display: block; height: 100%; background: var(--pf-good); }
.fc-tool--worn .fc-dur span { background: #d8d46a; }
.fc-tool--critical .fc-dur span { background: var(--pf-warn); }
.fc-tool--broken small, .fc-tool--retired small { color: var(--pf-bad); font-weight: 700; }
.fc-chips { display: flex; flex-wrap: wrap; gap: 0.3rem; margin: 0; padding: 0; list-style: none; }
.fc-chip { display: inline-flex; align-items: center; gap: 0.25rem; padding: 0.15rem 0.5rem; border-radius: 999px; background: rgba(255, 255, 255, 0.08); font-size: 0.78rem; font-weight: 700; }
.fc-chip--reward { color: var(--pf-good); }
.fc-chip--energy { color: var(--pf-energy); }
.fc-chip--xp { color: var(--pf-gold); }
.fc-chip--charges { color: var(--pf-soft); font-weight: 500; }
.fc-details summary { color: var(--pf-muted); font-size: 0.78rem; cursor: pointer; }
.fc-actions { display: flex; flex-wrap: wrap; gap: 0.4rem; }
.fc-actions .pf-btn { white-space: nowrap; }
.fc-go { flex: 1 1 9rem; font-size: 1.02rem; }
.fc-actions .pf-btn--ghost { flex: 1 1 auto; }
.fc-note { margin: 0; color: var(--pf-muted); font-size: 0.78rem; }
@media (max-width: 420px) {
  .fc-crew { grid-template-columns: 1fr; }
}
</style>
