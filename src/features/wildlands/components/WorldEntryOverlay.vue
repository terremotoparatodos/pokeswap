<template>
  <div
    v-if="message"
    ref="rootRef"
    class="wl-entry"
    :class="{ 'wl-entry--scene': state.sceneShown }"
    :role="actionable ? 'alert' : 'status'"
    :aria-busy="waiting ? 'true' : undefined"
    aria-labelledby="wl-entry-text"
    data-testid="world-entry"
  >
    <div class="wl-entry-box">
      <p id="wl-entry-text" ref="messageRef" class="wl-entry-text" :tabindex="state.phase === 'replaced' ? -1 : undefined">{{ message }}</p>
      <button v-if="state.phase === 'connection-error'" ref="retryRef" type="button" class="wl-entry-retry" @click="emit('retry')">Reintentar</button>
      <button v-else-if="state.phase === 'replaced'" ref="takeoverRef" type="button" class="wl-entry-retry" data-testid="world-entry-takeover" @click="emit('takeover')">Jugar acá</button>
    </div>
  </div>
</template>

<script setup lang="ts">
// PRESENCE UX-1: what covers the world while the server has not placed the
// player yet. Before the first reveal it is opaque (nothing is drawn under
// it); afterwards it dims the last frame, which stays frozen underneath.
// While it shows, what it covers is inert (entryInert.ts; only the sign-in
// dialog stays usable) and the keyboard lands on the overlay itself: the
// retry button, or the replaced message (WORLD LOCATION-4: its «Jugar acá»
// button is the only way to take the session back; nothing does it on its own).
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { WorldEntryState } from '../multiplayer/domain/worldEntry'
import { KEEP_INTERACTIVE, inertSiblings } from './entryInert'

const props = defineProps<{ state: WorldEntryState }>()
const emit = defineEmits<{ retry: []; takeover: [] }>()

const rootRef = ref<HTMLElement | null>(null)
const messageRef = ref<HTMLElement | null>(null)
const retryRef = ref<HTMLButtonElement | null>(null)
const takeoverRef = ref<HTMLButtonElement | null>(null)

const waiting = computed(() => props.state.phase === 'connecting' || props.state.phase === 'reconnecting')
const actionable = computed(() => props.state.phase === 'connection-error' || props.state.phase === 'replaced')
const message = computed(() => {
  switch (props.state.phase) {
    case 'connecting': return 'Entrando al mundo…'
    case 'reconnecting': return 'Reconectando…'
    case 'connection-error': return props.state.failed === 'reconnect' ? 'No pudimos reconectar.' : 'No pudimos entrar al mundo.'
    case 'replaced': return 'Tu sesión se abrió en otra pestaña o dispositivo.'
    default: return null
  }
})

let release: (() => void) | null = null
function uncover(): void {
  release?.()
  release = null
}
// After the DOM update, so the root exists when shown and is gone when hidden.
watch(rootRef, root => {
  uncover()
  if (root) release = inertSiblings(root)
}, { flush: 'post' })
function focusFor(phase: WorldEntryState['phase']): void {
  // Someone typing in the sign-in dialog keeps their place.
  if (document.activeElement?.closest(`[${KEEP_INTERACTIVE}]`)) return
  if (phase === 'connection-error') retryRef.value?.focus()
  else if (phase === 'replaced') messageRef.value?.focus()
}
watch(() => props.state.phase, focusFor, { flush: 'post' })
onMounted(() => focusFor(props.state.phase))
onBeforeUnmount(uncover)
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
.wl-entry-text:focus {
  outline: none;
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
