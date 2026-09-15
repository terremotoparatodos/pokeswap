<template>
  <div
    class="em"
    :class="{ 'em--compact': compact }"
    role="meter"
    :aria-valuenow="current"
    aria-valuemin="0"
    :aria-valuemax="max"
    :aria-label="`Energía ${current} de ${max}`"
  >
    <div class="em-head">
      <span class="em-label">Energía</span>
      <span class="em-value">{{ current }}<small> / {{ max }}</small></span>
    </div>
    <div class="em-track">
      <span class="em-fill" :class="{ 'em-fill--short': short }" :style="{ width: pct(current) }" />
      <span v-if="cost && !short" class="em-cost" :style="{ left: pct(current - cost), width: pct(cost) }" />
    </div>
    <p class="em-foot">
      <span v-if="cost">Esta acción: −{{ cost }}</span>
      <span v-if="rested > 0" class="em-rested">Descanso +{{ restedBonus }} % XP</span>
      <span v-else-if="!compact && minutesToFull > 0">Se llena en {{ formatMinutes(minutesToFull) }}</span>
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { ENERGY_CONFIG } from '../domain/catalog/professions'

// Calm meter: the cost of the next action is previewed as a lighter slice,
// so the player sees what they spend before confirming.
const props = withDefaults(defineProps<{
  current: number
  max: number
  rested?: number
  cost?: number | null
  minutesToFull?: number
  compact?: boolean
}>(), { rested: 0, cost: null, minutesToFull: 0, compact: false })

const restedBonus = Math.round(ENERGY_CONFIG.restedXpBonus * 100)
const short = computed(() => props.cost !== null && props.cost > props.current)
const pct = (value: number) => `${Math.max(0, Math.min(100, (value / Math.max(1, props.max)) * 100))}%`

function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  const rest = minutes % 60
  return rest ? `${Math.floor(minutes / 60)} h ${rest} min` : `${minutes / 60} h`
}
</script>

<style scoped>
.em { display: grid; gap: 0.3rem; }
.em-head { display: flex; justify-content: space-between; align-items: baseline; gap: 0.5rem; }
.em-label { color: var(--pf-energy); font-size: 0.78rem; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; }
.em-value { font-weight: 700; font-variant-numeric: tabular-nums; }
.em-value small { color: var(--pf-muted); font-weight: 400; }
.em-track { position: relative; height: 10px; border-radius: 999px; background: rgba(255, 255, 255, 0.1); overflow: hidden; }
.em-fill { position: absolute; inset: 0 auto 0 0; border-radius: inherit; background: linear-gradient(90deg, #3fb6d3, var(--pf-energy)); transition: width 0.35s ease; }
.em-fill--short { background: var(--pf-warn); }
.em-cost { position: absolute; top: 0; bottom: 0; background: repeating-linear-gradient(135deg, rgba(255, 255, 255, 0.85) 0 4px, rgba(255, 255, 255, 0.45) 4px 8px); }
.em-foot { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 0.25rem 0.75rem; margin: 0; min-height: 1em; color: var(--pf-muted); font-size: 0.76rem; }
.em-rested { color: var(--pf-rare); }
.em--compact .em-track { height: 8px; }
</style>
