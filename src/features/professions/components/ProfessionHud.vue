<template>
  <div class="ph pf-card" aria-label="Estado de profesión">
    <span class="ph-prof" :class="`ph-prof--${profession}`">
      {{ PROFESSIONS[profession].name }} <strong>{{ progress.level }}</strong>
      <span class="ph-xp"><span :style="{ width: `${progress.progress * 100}%` }" /></span>
    </span>
    <span class="ph-sep" />
    <span class="ph-energy" :title="`Energía ${energy.current} de ${energy.max}`">
      <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M11 2 4 11h5l-1 7 7-9h-5z" /></svg>
      {{ energy.current }}
    </span>
    <template v-if="health">
      <span class="ph-sep" />
      <span class="ph-tool" :class="`ph-tool--${health.health}`" :title="health.label">
        <span class="ph-dot" /> {{ tool!.instance.durability }}
      </span>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { ENERGY_CONFIG, PROFESSIONS } from '../domain/catalog/professions'
import type { ProfessionId } from '../domain/types'
import { demoMaxEnergy, demoTool } from '../demo/demoSession'
import type { ProfessionDemoSession } from '../demo/useProfessionDemo'
import { energyView, toolHealth } from '../ui/gearViews'
import { progressionView } from '../ui/progressionView'

// Compact pill in the style of LobbyHud: profession level, energy and tool health.
const props = defineProps<{ session: ProfessionDemoSession; profession: ProfessionId }>()

const state = computed(() => props.session.state.value)
const progress = computed(() => progressionView(props.profession, state.value.xp[props.profession], 0))
const energy = computed(() => energyView(state.value.energy, demoMaxEnergy(state.value), ENERGY_CONFIG))
const tool = computed(() => demoTool(state.value, props.profession))
const health = computed(() => tool.value ? toolHealth(tool.value.instance, tool.value.definition) : null)
</script>

<style scoped>
.ph { display: inline-flex; align-items: center; gap: 0.6rem; padding: 0.45rem 0.9rem; border-radius: 999px; font-size: 0.88rem; white-space: nowrap; }
.ph-prof { display: inline-flex; align-items: center; gap: 0.35rem; }
.ph-prof strong { color: var(--pf-gold); }
.ph-xp { width: 44px; height: 5px; border-radius: 999px; background: rgba(255, 255, 255, 0.15); overflow: hidden; }
.ph-xp span { display: block; height: 100%; background: var(--pf-gold); }
.ph-sep { width: 1px; height: 1rem; background: rgba(255, 255, 255, 0.25); }
.ph-energy { display: inline-flex; align-items: center; gap: 0.2rem; color: var(--pf-energy); font-weight: 700; }
.ph-energy svg { width: 16px; height: 16px; fill: currentColor; }
.ph-tool { display: inline-flex; align-items: center; gap: 0.3rem; color: var(--pf-soft); }
.ph-dot { width: 9px; height: 9px; border-radius: 50%; background: var(--pf-good); }
.ph-tool--worn .ph-dot { background: #d8d46a; }
.ph-tool--critical .ph-dot { background: var(--pf-warn); }
.ph-tool--broken .ph-dot, .ph-tool--retired .ph-dot { background: var(--pf-bad); }
</style>
