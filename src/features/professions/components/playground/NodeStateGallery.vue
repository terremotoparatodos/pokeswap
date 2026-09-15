<template>
  <section class="gal pf-card">
    <header>
      <p class="pf-kicker">Estados de nodo · {{ node.name }}</p>
      <p class="gal-hint">Referencia visual de todos los estados. Para vivirlos en el panel, usá los controles.</p>
    </header>
    <ul class="gal-grid">
      <li v-for="entry in entries" :key="entry.status" class="gal-card" :class="`gal--${entry.view.tone}`">
        <code>{{ entry.status }}</code>
        <strong>{{ entry.view.title }}</strong>
        <small>{{ entry.view.detail || '—' }}</small>
        <span class="gal-act">{{ entry.view.canAct ? 'Acción habilitada' : 'Acción bloqueada' }}</span>
      </li>
    </ul>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { GatheringNodeDefinition } from '../../domain/types'
import { describeNodeStatus, type NodeStatus } from '../../ui/nodeStatus'

const props = defineProps<{ node: GatheringNodeDefinition; level: number }>()

const ALL_STATUSES: readonly NodeStatus[] = [
  'available', 'in_progress', 'success', 'rare_drop', 'cooldown',
  'locked_level', 'locked_access', 'wrong_biome', 'no_tool', 'tool_tier', 'tool_broken',
  'no_energy', 'depleted', 'inventory_full',
]

const entries = computed(() => ALL_STATUSES.map(status => ({
  status,
  view: describeNodeStatus(status, { node: props.node, level: props.level, respawnInSeconds: 95, energyNeeded: props.node.energyCost, energyHave: 4 }),
})))
</script>

<style scoped>
.gal { display: grid; gap: 0.6rem; padding: 1rem; }
.gal-hint { margin: 0.2rem 0 0; color: var(--pf-muted); font-size: 0.8rem; }
.gal-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 0.5rem; margin: 0; padding: 0; list-style: none; }
.gal-card { display: grid; gap: 0.2rem; padding: 0.6rem; border-left: 4px solid var(--pf-line); border-radius: 8px; background: var(--pf-navy-2); }
.gal-card code { color: var(--pf-muted); font-size: 0.7rem; }
.gal-card small, .gal-act { color: var(--pf-muted); font-size: 0.74rem; }
.gal--ready { border-left-color: var(--pf-good); }
.gal--good { border-left-color: var(--pf-good); }
.gal--busy { border-left-color: var(--pf-soft); }
.gal--rare { border-left-color: var(--pf-rare); }
.gal--blocked { border-left-color: var(--pf-bad); }
.gal--warn { border-left-color: var(--pf-warn); }
</style>
