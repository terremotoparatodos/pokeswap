<template>
  <ul v-if="hints.length" class="wh" aria-label="Pistas de la zona" aria-live="polite">
    <li v-for="hint in hints" :key="hint.id" class="wh-row">
      <span class="wh-badge" :class="`wh-badge--${hint.tone}`">{{ hint.badge }}</span>
      <span class="wh-text">{{ hint.text }}</span>
    </li>
  </ul>
</template>

<script setup lang="ts">
import type { WorldHint } from './worldHints'

// One body for every world hint, just above the area pill, so they read as a
// list instead of cards piling up over the player.
defineProps<{ hints: readonly WorldHint[] }>()
</script>

<style scoped>
.wh {
  position: absolute;
  left: 50%;
  bottom: 5rem;
  z-index: 5;
  display: grid;
  gap: 0.3rem;
  width: max-content;
  max-width: min(30rem, calc(100% - 2rem));
  margin: 0;
  padding: 0.45rem 0.65rem;
  list-style: none;
  border: 2px solid #3a5fb8;
  border-radius: 12px;
  background: rgba(16, 26, 54, 0.92);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  color: #dfe8ff;
  font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
  font-size: 0.78rem;
  line-height: 1.35;
  transform: translateX(-50%);
  /* Guidance, not a control: taps fall through to the ground under it. */
  pointer-events: none;
}
.wh-row {
  display: grid;
  grid-template-columns: 4.6rem 1fr;
  align-items: baseline;
  gap: 0.45rem;
}
.wh-badge {
  padding: 0.05rem 0.35rem;
  border-radius: 5px;
  font-size: 0.66rem;
  font-weight: 800;
  text-align: center;
}
.wh-badge--dungeon { background: #f0b429; color: #101a36; }
.wh-badge--skills { background: #e03c3c; color: #fff; }

@media (max-width: 720px) {
  /* On a phone the chat and Pokédex buttons take a row above the area pill. */
  .wh { bottom: 7.6rem; width: calc(100% - 1.5rem); max-width: none; }
}
</style>
