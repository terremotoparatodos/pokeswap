<template>
  <div class="sg">
    <!-- The real world underneath, so a surface is judged against what it covers. -->
    <WildlandsView />
    <CityPanel v-if="city" :surface="city" @close="closed = true" />
    <DungeonRunPanel v-if="entrance" :entrance="entrance" @close="closed = true" />
    <p v-if="closed" class="sg-closed">cerrado</p>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'
import WildlandsView from '../../wildlands/components/WildlandsView.vue'
import CityPanel from '../../playtest/components/CityPanel.vue'
import DungeonRunPanel from '../../dungeonEntrances/components/DungeonRunPanel.vue'
import { areaEntrances } from '../../dungeonEntrances/domain/entranceSpawns'
import type { PlaytestSurface } from '../../playtest/domain/cityFeatures'

// MOBILE-1, development builds only: the playtest's building and dungeon
// surfaces live behind the playtest gate, so this page mounts them over the
// real world for layout checks on phone viewports (scripts/perf/mobile-shots.mjs).
//   /dev/superficies?s=centro | tienda | cerrado | dungeon
// Nothing here is reachable from a production build (see app/router/routes.ts).
const route = useRoute()
const which = computed(() => String(route.query.s ?? 'centro'))
const closed = ref(false)

const city = computed<PlaytestSurface | null>(() => {
  if (closed.value) return null
  if (which.value === 'centro') return { kind: 'centro' }
  if (which.value === 'tienda') return { kind: 'tienda' }
  if (which.value === 'cerrado') return { kind: 'closed', title: 'Mercado', reason: 'El Mercado abre después del playtest.' }
  return null
})

const entrance = computed(() => {
  if (closed.value || which.value !== 'dungeon') return null
  const open = { isSolid: () => false, isWater: () => false, isTaken: () => false }
  return areaEntrances({ areaId: 'pradera', origin: { tx: 0, ty: 0 }, seed: 1, port: open, now: Date.now() })[0] ?? null
})
</script>

<style scoped>
.sg { position: relative; }
.sg-closed { position: fixed; top: 0; left: 0; margin: 0; padding: 2px 6px; background: #000; color: #fff; font: 12px monospace; }
</style>
