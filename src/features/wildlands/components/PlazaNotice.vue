<template>
  <transition name="pn-fade">
    <p v-if="text" class="pn" role="status">{{ text }}</p>
  </transition>
</template>

<script setup lang="ts">
// Discreet toast for plaza news (activity, your Pokémon changing owner). Plain text only.
defineProps<{ text: string | null }>()
</script>

<style scoped>
.pn {
  position: absolute;
  top: calc(4.5rem + var(--safe-top, 0px));
  left: calc(1rem + var(--safe-left, 0px));
  z-index: 4;
  max-width: min(320px, calc(100% - 2rem));
  margin: 0;
  padding: 0.45rem 0.8rem;
  border-left: 3px solid #ffd27a;
  border-radius: 8px;
  background: rgba(16, 26, 54, 0.85);
  color: #e8eeff;
  font-size: 0.85rem;
  pointer-events: none;
}

.pn-fade-enter-active,
.pn-fade-leave-active {
  transition: opacity 0.25s, transform 0.25s;
}
.pn-fade-enter-from,
.pn-fade-leave-to {
  opacity: 0;
  transform: translateX(-6px);
}

@media (max-width: 720px), (max-height: 500px) {
  .pn {
    top: calc(3.9rem + var(--safe-top, 0px));
    left: calc(0.75rem + var(--safe-left, 0px));
    font-size: 0.8rem;
  }
}
</style>
