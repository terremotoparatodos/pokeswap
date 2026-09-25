<template>
  <section v-if="hints.length && open" class="wh" :aria-label="title">
    <header class="wh-head">
      <strong class="wh-title">{{ title }}</strong>
      <button type="button" class="wh-x" aria-label="Cerrar la ayuda" @click="open = false">×</button>
    </header>
    <ul class="wh-list" aria-live="polite">
      <li v-for="hint in hints" :key="hint.id" class="wh-row">
        <span class="wh-badge" :class="`wh-badge--${hint.tone}`">{{ hint.badge }}</span>
        <span class="wh-text">{{ hint.text }}</span>
      </li>
    </ul>
    <button type="button" class="wh-ok" @click="open = false">Entendido</button>
  </section>
  <button
    v-else-if="hints.length"
    type="button"
    class="wh-chip"
    :aria-label="`Ver la ayuda: ${title}`"
    @click="open = true"
  >
    ?
  </button>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import type { WorldHint } from './worldHints'

// One body for every world hint, so they read as a list instead of cards
// piling up over the player.
//
// MOBILE-1: the hints are guidance for an area ("hay cuevas cerca", where
// Skills work), shown every time the player is in the wild. They used to be
// a band nobody could dismiss. Now they are a small card with a title, ×
// and Entendido; once closed, a "?" brings them back. Closing lasts while the
// world is open (this component lives as long as it): guidance a reload
// shows again, not a preference written to storage.
const props = defineProps<{ hints: readonly WorldHint[] }>()

const open = ref(true)
const title = computed(() => props.hints.map(hint => hint.badge).join(' y '))
</script>

<style scoped>
.wh {
  position: absolute;
  left: 50%;
  bottom: calc(5rem + var(--safe-bottom, 0px));
  z-index: 5;
  display: grid;
  gap: 0.35rem;
  width: max-content;
  max-width: min(30rem, calc(100% - 2rem));
  margin: 0;
  padding: 0.35rem 0.4rem 0.5rem 0.65rem;
  border: 2px solid #3a5fb8;
  border-radius: 12px;
  background: rgba(16, 26, 54, 0.92);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  color: #dfe8ff;
  font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
  font-size: 0.78rem;
  line-height: 1.35;
  transform: translateX(-50%);
}
.wh-head { display: flex; align-items: center; gap: 0.5rem; }
.wh-title { flex: 1; font-size: 0.82rem; }
.wh-x {
  flex: none;
  width: 32px;
  height: 32px;
  border: 1px solid rgba(255, 255, 255, 0.25);
  border-radius: 8px;
  background: transparent;
  color: #fff;
  font: inherit;
  font-size: 1.2rem;
  line-height: 1;
  cursor: pointer;
}
.wh-list { display: grid; gap: 0.3rem; margin: 0; padding: 0 0.25rem 0 0; list-style: none; }
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
.wh-ok {
  justify-self: end;
  min-height: 36px;
  margin-right: 0.25rem;
  padding: 0 1rem;
  border: 0;
  border-radius: 9px;
  background: #3a5fb8;
  color: #fff;
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}
.wh-chip {
  position: absolute;
  left: 50%;
  bottom: calc(5rem + var(--safe-bottom, 0px));
  z-index: 5;
  width: 36px;
  height: 36px;
  border: 2px solid #3a5fb8;
  border-radius: 50%;
  background: rgba(16, 26, 54, 0.92);
  color: #dfe8ff;
  font: 700 1rem/1 system-ui, -apple-system, 'Segoe UI', sans-serif;
  transform: translateX(-50%);
  cursor: pointer;
}

@media (max-width: 720px), (max-height: 500px) {
  /* A small card above the tab row on the left, clear of Correr on the right;
     closed, a "?" chip in the same corner. */
  .wh {
    left: calc(0.6rem + var(--safe-left, 0px));
    bottom: calc(0.75rem + 44px + 0.5rem + var(--safe-bottom, 0px));
    width: auto;
    max-width: min(19rem, calc(100vw - 1.2rem - 8.5rem - var(--safe-left, 0px) - var(--safe-right, 0px)));
    /* Whatever the menu row leaves free; it scrolls only past that. */
    max-height: calc(100dvh - 0.75rem - 44px - 0.5rem - 3.75rem - var(--safe-top, 0px) - var(--safe-bottom, 0px));
    overflow-y: auto;
    transform: none;
    gap: 0.25rem;
    font-size: 0.72rem;
  }
  /* Badge and text in one flow: fewer lines, same words. */
  .wh-row { display: block; }
  .wh-badge { display: inline-block; margin-right: 0.35rem; }
  .wh-list { gap: 0.25rem; }
  .wh-ok { min-height: 32px; padding: 0 0.85rem; }
  .wh-x { width: 30px; height: 30px; }
  .wh-chip {
    left: calc(0.6rem + var(--safe-left, 0px));
    bottom: calc(0.75rem + 44px + 0.5rem + var(--safe-bottom, 0px));
    transform: none;
  }
}
</style>
