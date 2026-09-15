<template>
  <ul class="cb" :class="{ 'cb--compact': compact }">
    <li
      v-for="rating in ratings"
      :key="rating.id"
      class="cb-row"
      :class="{ 'cb-row--top': rating.id === highlight }"
      :title="rating.hint"
    >
      <span class="cb-label">{{ rating.label }}</span>
      <span class="cb-pips" role="img" :aria-label="`${rating.label}: ${rating.rating} de ${MAX_RATING}`">
        <span v-for="n in MAX_RATING" :key="n" class="cb-pip" :class="{ 'cb-pip--on': n <= rating.rating }" />
      </span>
      <span v-if="!compact" class="cb-detail">{{ rating.lines.map(line => line.text).join(' · ') || '—' }}</span>
    </li>
  </ul>
</template>

<script setup lang="ts">
import { MAX_RATING, type CapabilityId, type CapabilityRating } from '../ui/capabilities'

// Summary (segments) plus exact effect text: readable at a glance, auditable in detail.
withDefaults(defineProps<{ ratings: readonly CapabilityRating[]; highlight?: CapabilityId | null; compact?: boolean }>(), {
  highlight: null,
  compact: false,
})
</script>

<style scoped>
.cb { display: grid; gap: 0.35rem; margin: 0; padding: 0; list-style: none; }
.cb-row { display: grid; grid-template-columns: 7.5rem auto 1fr; align-items: center; gap: 0.6rem; font-size: 0.85rem; }
.cb-row--top .cb-label { color: var(--pf-gold); font-weight: 700; }
.cb-label { color: var(--pf-soft); }
.cb-pips { display: inline-flex; gap: 3px; }
.cb-pip { width: 14px; height: 8px; border-radius: 2px; background: rgba(255, 255, 255, 0.14); }
.cb-pip--on { background: var(--pf-soft); }
.cb-row--top .cb-pip--on { background: var(--pf-gold); }
.cb-detail { overflow: hidden; color: var(--pf-muted); font-size: 0.76rem; text-overflow: ellipsis; white-space: nowrap; }
.cb--compact .cb-row { grid-template-columns: 6.5rem auto; font-size: 0.78rem; }
.cb--compact .cb-pip { width: 10px; height: 6px; }
@media (max-width: 520px) {
  .cb-row { grid-template-columns: 6.5rem auto; }
  .cb-detail { grid-column: 1 / -1; white-space: normal; }
}
</style>
