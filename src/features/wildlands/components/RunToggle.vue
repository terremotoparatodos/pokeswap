<template>
  <button
    type="button"
    class="wl-run"
    :class="{ 'wl-run--on': active }"
    :aria-pressed="active ? 'true' : 'false'"
    :aria-label="active ? 'Correr activado. Tocá para caminar' : 'Correr desactivado. Tocá para correr'"
    @click="emit('update:active', !active)"
  >
    <span aria-hidden="true">🏃</span>
    <span class="wl-run-text">{{ active ? 'Corriendo' : 'Correr' }}</span>
  </button>
</template>

<script setup lang="ts">
// MOBILE-1: tap-to-walk has no key to hold, so running is a mode. It feeds the
// same gait as Shift (engine KeyboardInput.runMode); touch screens only.
defineProps<{ active: boolean }>()
const emit = defineEmits<{ 'update:active': [active: boolean] }>()
</script>

<style scoped>
.wl-run {
  display: none;
}

/* Keyboards run with Shift; the toggle is for touch screens. */
@media (pointer: coarse) {
  .wl-run {
    position: absolute;
    /* Bottom right, in the thumb's reach, one row above the bug-report chip. */
    right: calc(0.6rem + var(--safe-right, 0px));
    bottom: calc(0.75rem + 38px + 0.5rem + var(--safe-bottom, 0px));
    /* Under profession action cards (z 14): a temporary card covers the mode, never the reverse. */
    z-index: 13;
    display: flex;
    align-items: center;
    gap: 0.3rem;
    min-height: 44px;
    padding: 0 0.85rem;
    border: 2px solid #3a5fb8;
    border-radius: 999px;
    background: rgba(16, 26, 54, 0.92);
    color: #dfe8ff;
    font: 700 0.78rem/1 system-ui, -apple-system, 'Segoe UI', sans-serif;
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;
    cursor: pointer;
  }
  /* On: unmistakable, and pressing it again walks. */
  .wl-run--on {
    border-color: #ffd27a;
    background: #f0b429;
    color: #101a36;
    box-shadow: 0 0 0 3px rgba(255, 210, 122, 0.35);
  }
}
</style>
