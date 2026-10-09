<template>
  <!-- Not modal and not interactive: it takes no focus, holds nothing and leaves on its own. -->
  <aside class="ebt" role="status" aria-live="polite">
    <b class="ebt-title">{{ title }}</b>
    <span class="ebt-detail">{{ detail }}</span>
  </aside>
</template>

<script setup lang="ts">
// ECO-BATTLE-ENDING-1 (experimental, development builds only): how the owner's test battle ended,
// as a brief notice. The end is the server's; this only names it, and the player already has the
// map back. Nothing here is a reward: when drops or XP exist (another delivery) they can be listed
// here; until then it shows only the result.
defineProps<{ title: string; detail: string }>()
</script>

<style scoped>
.ebt {
  position: absolute; top: 3.25rem; left: 50%; transform: translateX(-50%); z-index: 30;
  display: flex; flex-direction: column; gap: 2px; max-width: min(92vw, 360px); padding: 8px 14px;
  border-radius: 9px; background: rgba(16, 26, 54, 0.92); color: #eef3ff; box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);
  pointer-events: none; text-align: center; animation: ebt-in 0.18s ease-out;
}
.ebt-title { font-size: 0.98rem; color: #ffd27a; }
.ebt-detail { font-size: 0.8rem; opacity: 0.9; }
@keyframes ebt-in { from { opacity: 0; transform: translate(-50%, -6px); } to { opacity: 1; transform: translate(-50%, 0); } }
@media (prefers-reduced-motion: reduce) { .ebt { animation: none; } }
</style>
