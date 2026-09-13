<template>
  <div id="app-shell">
    <!-- The lobby HUD is the navigation; standalone pages only need a way back. -->
    <router-link v-if="route.meta.standalone" class="app-back" to="/">← Ciudad</router-link>
    <router-view />
  </div>
</template>

<script setup lang="ts">
import { useRoute } from 'vue-router'

const route = useRoute()
</script>

<style scoped>
#app-shell {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
}

.app-back {
  position: fixed;
  top: 0.75rem;
  left: 0.75rem;
  z-index: 10;
  padding: 0.45rem 0.9rem;
  border: 2px solid #3a5fb8;
  border-radius: 999px;
  background: rgba(16, 26, 54, 0.92);
  color: #fff;
  font-size: 0.9rem;
  text-decoration: none;
}
</style>
