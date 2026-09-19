<template>
  <PlaytestGateScreen
    v-if="blocked"
    :access="blocked"
    @submit="gate.submit($event)"
    @recheck="gate.recheck()"
  />
  <template v-else>
    <slot />
    <PlaytestBanner />
    <BugReportButton />
  </template>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue'
import BugReportButton from './BugReportButton.vue'
import PlaytestBanner from './PlaytestBanner.vue'
import PlaytestGateScreen from './PlaytestGateScreen.vue'
import { usePlaytestGate } from '../state/usePlaytestGate'

// Everything that only exists during Community Playtest 0.1 hangs here, so
// `App.vue` stays the few lines it has always been (AGENTS §6, §24).
//
// The gate wraps the slot rather than sitting beside it: when the playtest is
// closed the application below is never mounted, so a closed playtest cannot
// connect a socket, read a profile or start a world.
const gate = usePlaytestGate()

/** What stands between the player and the game, or null when nothing does. */
const blocked = computed(() => {
  const access = gate.access.value
  return access.status === 'open' || access.status === 'off' ? null : access
})

onMounted(() => gate.start())
onUnmounted(() => gate.stop())
</script>
