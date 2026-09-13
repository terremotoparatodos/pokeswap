<template>
  <aside class="wl-help">
    <p class="wl-help-title">WildLands · desarrollo</p>
    <ul>
      <li><b>Click</b> para caminar · click en alguien para hablarle</li>
      <li>Click en un edificio para entrar · puertas de la ciudad → mundos</li>
      <li><kbd>WASD</kbd>/<kbd>↑↓←→</kbd> también mueven · <kbd>Shift</kbd> correr</li>
      <li><kbd>E</kbd> interactuar · <kbd>G</kbd> grilla · <kbd>N</kbd> +3 h · <kbd>V</kbd> cámara</li>
    </ul>
    <p class="wl-help-perf">{{ fps }} fps · {{ frameMs }} ms/frame</p>
  </aside>
</template>

<script setup lang="ts">
// Controls and frame timing for development builds only (the view mounts it behind isDev).
defineProps<{ fps: number; frameMs: number }>()
</script>

<style scoped>
.wl-help {
  position: absolute;
  top: 4.5rem;
  left: 1rem;
  padding: 0.55rem 0.8rem;
  border-radius: 10px;
  background: rgba(16, 26, 54, 0.78);
  color: #dfe8ff;
  font-size: 0.78rem;
  line-height: 1.6;
  pointer-events: none;
}
.wl-help-title {
  margin: 0 0 0.15rem;
  font-weight: 700;
  color: #fff;
}
.wl-help-perf {
  margin: 0.2rem 0 0;
  font-variant-numeric: tabular-nums;
  opacity: 0.6;
}
.wl-help ul {
  margin: 0;
  padding: 0;
  list-style: none;
}
kbd {
  padding: 0 0.3rem;
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-bottom-width: 2px;
  border-radius: 4px;
  font-family: inherit;
  font-size: 0.72rem;
}

@media (max-width: 720px) {
  .wl-help { display: none; }
}
</style>
