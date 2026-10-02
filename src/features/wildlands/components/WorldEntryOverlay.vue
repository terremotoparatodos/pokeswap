<template>
  <div
    v-if="message"
    class="wl-entry"
    :class="{ 'wl-entry--scene': state.sceneShown }"
    :role="actionable ? 'alert' : 'status'"
    :aria-busy="waiting ? 'true' : undefined"
    data-testid="world-entry"
  >
    <div class="wl-entry-box">
      <p class="wl-entry-text">{{ message }}</p>
      <button v-if="state.phase === 'connection-error'" type="button" class="wl-entry-retry" @click="emit('retry')">Reintentar</button>
    </div>
  </div>
</template>

<script setup lang="ts">
// PRESENCE UX-1: what covers the world while the server has not placed the
// player yet. Before the first reveal it is opaque (nothing is drawn under
// it); afterwards it dims the last frame, which stays frozen underneath.
import { computed } from 'vue'
import type { WorldEntryState } from '../multiplayer/domain/worldEntry'

const props = defineProps<{ state: WorldEntryState }>()
const emit = defineEmits<{ retry: [] }>()

const waiting = computed(() => props.state.phase === 'connecting' || props.state.phase === 'reconnecting')
const actionable = computed(() => props.state.phase === 'connection-error' || props.state.phase === 'replaced')
const message = computed(() => {
  switch (props.state.phase) {
    case 'connecting': return 'Entrando al mundo…'
    case 'reconnecting': return 'Reconectando…'
    case 'connection-error': return props.state.failed === 'reconnect' ? 'No pudimos reconectar.' : 'No pudimos entrar al mundo.'
    case 'replaced': return 'Tu sesión se abrió en otra pestaña.'
    default: return null
  }
})
</script>

<style scoped>
.wl-entry {
  position: absolute;
  inset: 0;
  /* Above the world HUD (≤ 35), below the playtest bug button (60) and the auth modal. */
  z-index: 50;
  display: grid;
  place-items: center;
  background: #0f1a33;
  color: #dfe8ff;
  /* It takes every pointer: nothing under it can be clicked while it shows. */
  pointer-events: auto;
}
.wl-entry--scene {
  background: rgba(15, 26, 51, 0.72);
}
.wl-entry-box {
  display: grid;
  justify-items: center;
  gap: 0.9rem;
  padding: 0 1rem;
  text-align: center;
}
.wl-entry-text {
  margin: 0;
  font-size: 1.1rem;
  letter-spacing: 0.03em;
}
.wl-entry-retry {
  min-width: 44px;
  min-height: 44px;
  padding: 0.55rem 1.3rem;
  border: 2px solid #3a5fb8;
  border-radius: 10px;
  background: #1c2f63;
  color: #fff;
  font: inherit;
  cursor: pointer;
}
.wl-entry-retry:hover,
.wl-entry-retry:focus-visible {
  background: #2a448c;
  outline: 2px solid #dfe8ff;
  outline-offset: 2px;
}
</style>
