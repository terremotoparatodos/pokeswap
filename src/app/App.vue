<template>
  <div id="app-shell">
    <component :is="PlaytestShell" v-if="PlaytestShell">
      <router-view />
    </component>
    <router-view v-else />
  </div>
</template>

<script setup lang="ts">
import { defineAsyncComponent } from 'vue'
import { isPlaytest } from '../features/playtest/playtestBuild'

// Community Playtest 0.1 only. With the flag off this is `null`, the import is
// never reached, and the bundle is what it has always been.
const PlaytestShell = isPlaytest
  ? defineAsyncComponent(() => import('../features/playtest/components/PlaytestShell.vue'))
  : null
</script>

<style scoped>
#app-shell {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
}

</style>
