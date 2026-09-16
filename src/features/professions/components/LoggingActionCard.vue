<template>
  <section class="lc pf-card" :class="[`lc--${statusView.tone}`, `lc--${phase}`]" role="dialog" :aria-label="node.name">
    <header class="lc-head">
      <ItemGlyph :item-id="node.drops.primary.itemId" :size="32" />
      <div class="lc-title">
        <p class="pf-kicker">Tala Nv. {{ level }} · requiere {{ node.requiredLevel }}</p>
        <h2>{{ node.name }}</h2>
      </div>
      <button v-if="phase !== 'chopping'" type="button" class="lc-close" aria-label="Cerrar" @click="emit('close')">×</button>
    </header>

    <p v-if="phase !== 'chopping'" class="lc-status" role="status">
      <strong>{{ statusView.title }}</strong><span v-if="statusView.detail"> · {{ statusView.detail }}</span>
    </p>
    <p v-else class="lc-status lc-status--busy" role="status"><strong>Talando…</strong><span class="lc-dots" aria-hidden="true"><i /><i /><i /></span></p>

    <div v-if="phase !== 'chopping'" class="lc-crew">
      <div class="lc-worker">
        <template v-if="worker && summary">
          <PokemonPortrait :species-id="worker.speciesId" :name="worker.name" :size="36" />
          <div><strong>{{ worker.name }}</strong><small>{{ summary.specialty.label }} {{ '●'.repeat(summary.specialty.rating) }}</small></div>
        </template>
        <small v-else>Sin Pokémon · sin bonus</small>
      </div>
      <div class="lc-tool" :class="tool ? `lc-tool--${toolView?.health}` : 'lc-tool--none'">
        <template v-if="tool && toolView">
          <ItemGlyph :item-id="tool.definition.itemId" :size="32" :condition="toolView.health === 'retired' ? 'retired' : toolView.health === 'broken' ? 'broken' : 'ok'" />
          <div>
            <small>{{ toolView.label }}</small>
            <span class="lc-dur"><span :style="{ width: `${(tool.instance.durability / tool.definition.maxDurability) * 100}%` }" /></span>
          </div>
        </template>
        <small v-else>Sin hacha</small>
      </div>
    </div>

    <ul v-if="check.ok && phase === 'idle'" class="lc-chips">
      <li class="lc-chip lc-chip--reward"><ItemGlyph :item-id="check.preview.primaryItemId" :size="16" /> ×{{ check.preview.minUnits }}<template v-if="check.preview.extraUnitChance > 0">–{{ check.preview.maxUnits + 1 }}</template></li>
      <li class="lc-chip lc-chip--energy">−{{ Math.round(check.preview.energySpent) }} energía</li>
      <li v-if="!check.preview.bareHands" class="lc-chip">−{{ check.preview.durabilityPoints }} durab.</li>
      <li class="lc-chip lc-chip--xp">+{{ check.preview.xp }} XP</li>
      <li class="lc-chip lc-chip--charges">{{ chargesLabel }}</li>
    </ul>

    <GatheringFeedback
      v-if="phase === 'result' && lines.length"
      :lines="lines"
      :rare="rarity === 'rare' || rarity === 'special'"
      :banner="rarity === 'special' ? '¡Hallazgo especial!' : '¡Buena madera!'"
    />

    <details v-if="check.ok && phase === 'idle'" class="lc-details">
      <summary>Ver detalle</summary>
      <NodeOutlook :preview="check.preview" :breakdown="breakdown" :rested="state.energy.rested > 0" />
    </details>

    <footer v-if="phase !== 'chopping'" class="lc-actions">
      <button type="button" class="pf-btn lc-chop" :disabled="!statusView.canAct" @click="emit('chop')">
        {{ phase === 'result' ? 'Seguir talando' : 'Talar' }}
      </button>
      <button v-if="canRepair" type="button" class="pf-btn pf-btn--ghost" @click="repair">Reparar</button>
      <button v-if="state.pending.length" type="button" class="pf-btn pf-btn--ghost" @click="collect">Recoger pendientes</button>
    </footer>
    <p v-if="note" class="lc-note">{{ note }}</p>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { ENERGY_CONFIG } from '../domain/catalog/professions'
import {
  collectPendingDemo, demoAffinity, demoLevel, demoTool, demoWorker, inspectDemoNode, type DemoGatherOutcome, type DemoNodeTarget,
} from '../demo/demoSession'
import type { ProfessionDemoSession } from '../demo/useProfessionDemo'
import type { LoggingPhase } from '../logging/useLoggingController'
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

// Compact world card for logging. While the axe swings it collapses to its
// header and a status pill, so the tree, the axe and the leaves stay visible.
const props = defineProps<{ session: ProfessionDemoSession; target: DemoNodeTarget; phase: LoggingPhase; outcome: DemoGatherOutcome | null }>()
const emit = defineEmits<{ chop: []; close: [] }>()

const state = computed(() => props.session.state.value)
const node = computed(() => props.target.node)
const level = computed(() => demoLevel(state.value, 'woodcutting'))
const worker = computed(() => demoWorker(state.value, 'woodcutting'))
const affinity = computed(() => demoAffinity(state.value, 'woodcutting'))
const summary = computed(() => affinity.value ? summarizeWorker(affinity.value) : null)
const tool = computed(() => demoTool(state.value, 'woodcutting'))
const toolView = computed(() => tool.value ? toolHealth(tool.value.instance, tool.value.definition) : null)
const inspection = computed(() => inspectDemoNode(state.value, props.target))
const check = computed(() => inspection.value.check)
const breakdown = computed(() => energyCostBreakdown(node.value, affinity.value?.bonuses.energySaving ?? 0, level.value, ENERGY_CONFIG))
const statusView = computed(() => describeNodeStatus(resolveNodeStatus({ ...inspection.value, phase: 'idle' }), {
  node: node.value, level: level.value, respawnInSeconds: inspection.value.respawnInSeconds,
  energyNeeded: breakdown.value.final, energyHave: state.value.energy.current,
}))
/** The tree only falls on the last charge, so the card says how much is left. */
const chargesLabel = computed(() => inspection.value.remainingCharges <= 1
  ? 'Último corte: cae el árbol'
  : `Quedan ${inspection.value.remainingCharges} cortes`)
const canRepair = computed(() => props.phase !== 'chopping' && !!tool.value && tool.value.instance.durability < tool.value.instance.maxDurability)

const lines = computed(() => {
  const outcome = props.outcome
  if (!outcome?.ok) return []
  return [
    ...gatheringFeedback(outcome.result, { profession: 'woodcutting', leveledUp: outcome.leveledUp, newLevel: level.value, toolBroke: outcome.toolBroke, hasTool: tool.value !== null }),
    ...inventoryFeedback(outcome.placements, outcome.overflow),
  ]
})
const rarity = computed(() => props.outcome?.ok ? outcomeRarity(props.outcome.result) : 'common')

const note = ref('')
function repair(): void {
  const outcome = props.session.repair('woodcutting')
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
.lc { display: grid; gap: 0.5rem; width: 100%; padding: 0.75rem 0.85rem; border-top: 4px solid var(--pf-woodcutting); }
.lc-head { display: flex; align-items: center; gap: 0.6rem; }
.lc-title { flex: 1; min-width: 0; }
.lc-title h2 { margin: 0.05rem 0 0; font-size: 1.05rem; }
.lc-close { width: 40px; height: 40px; margin: -0.35rem -0.4rem 0 0; border: 0; border-radius: 50%; background: transparent; color: inherit; font-size: 1.6rem; cursor: pointer; }
.lc-status { display: flex; align-items: center; gap: 0.3rem; margin: 0; padding: 0.35rem 0.55rem; border-radius: 8px; background: rgba(255, 255, 255, 0.07); font-size: 0.84rem; }
.lc--ready .lc-status { color: var(--pf-good); }
.lc--blocked .lc-status { color: var(--pf-bad); }
.lc--warn .lc-status { color: var(--pf-warn); }
.lc-status--busy { color: var(--pf-gold) !important; }
.lc-dots { display: inline-flex; gap: 3px; }
.lc-dots i { width: 5px; height: 5px; border-radius: 1px; background: var(--pf-gold); animation: lc-dot 0.9s infinite; }
.lc-dots i:nth-child(2) { animation-delay: 0.15s; }
.lc-dots i:nth-child(3) { animation-delay: 0.3s; }
@keyframes lc-dot { 50% { transform: translateY(-3px); } }
.lc-crew { display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; }
.lc-worker, .lc-tool { display: flex; align-items: center; gap: 0.45rem; min-width: 0; }
.lc-worker div, .lc-tool div { display: grid; min-width: 0; flex: 1; }
.lc-worker small, .lc-tool small { color: var(--pf-muted); font-size: 0.74rem; }
.lc-worker small { color: var(--pf-gold); }
.lc-dur { display: block; height: 5px; margin-top: 2px; border-radius: 3px; background: rgba(255, 255, 255, 0.12); overflow: hidden; }
.lc-dur span { display: block; height: 100%; background: var(--pf-good); }
.lc-tool--worn .lc-dur span { background: #d8d46a; }
.lc-tool--critical .lc-dur span { background: var(--pf-warn); }
.lc-tool--broken small, .lc-tool--retired small { color: var(--pf-bad); font-weight: 700; }
.lc-chips { display: flex; flex-wrap: wrap; gap: 0.3rem; margin: 0; padding: 0; list-style: none; }
.lc-chip { display: inline-flex; align-items: center; gap: 0.25rem; padding: 0.15rem 0.5rem; border-radius: 999px; background: rgba(255, 255, 255, 0.08); font-size: 0.78rem; font-weight: 700; }
.lc-chip--reward { color: var(--pf-good); }
.lc-chip--energy { color: var(--pf-energy); }
.lc-chip--xp { color: var(--pf-gold); }
.lc-chip--charges { color: var(--pf-soft); font-weight: 500; }
.lc-details summary { color: var(--pf-muted); font-size: 0.78rem; cursor: pointer; }
.lc-actions { display: flex; flex-wrap: wrap; gap: 0.4rem; }
.lc-actions .pf-btn { white-space: nowrap; }
.lc-chop { flex: 1 1 9rem; font-size: 1.02rem; }
.lc-actions .pf-btn--ghost { flex: 1 1 auto; }
.lc-note { margin: 0; color: var(--pf-muted); font-size: 0.78rem; }
@media (max-width: 420px) {
  .lc-crew { grid-template-columns: 1fr; }
}
</style>
