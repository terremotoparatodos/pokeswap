<template>
  <div class="cp" role="dialog" :aria-label="title">
    <div class="cp-card">
      <header class="cp-head">
        <h2 class="cp-title">{{ title }}</h2>
        <span class="cp-tag">PLAYTEST</span>
        <button type="button" class="cp-x" aria-label="Cerrar" @click="emit('close')">×</button>
      </header>

      <div class="cp-body">
        <PokemonCenterView v-if="surface.kind === 'centro'" />
        <PlaytestShopView v-else-if="surface.kind === 'tienda'" />
        <ClosedFeatureView v-else :title="surface.title" :reason="surface.reason" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import ClosedFeatureView from './ClosedFeatureView.vue'
import PlaytestShopView from './PlaytestShopView.vue'
import PokemonCenterView from './PokemonCenterView.vue'
import type { PlaytestSurface } from '../domain/cityFeatures'

// One frame for every door in the city, so a closed building and an open one
// feel like the same place rather than two different applications.
const props = defineProps<{ surface: PlaytestSurface }>()
const emit = defineEmits<{ close: [] }>()

const title = computed(() => {
  if (props.surface.kind === 'centro') return 'Centro Pokémon'
  if (props.surface.kind === 'tienda') return 'Tienda'
  return props.surface.title
})
</script>

<style scoped>
.cp {
  position: fixed;
  inset: 0;
  z-index: 35;
  display: grid;
  place-items: center;
  padding: 1rem;
  background: rgba(6, 10, 22, 0.75);
  font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
}
.cp-card {
  display: flex;
  flex-direction: column;
  width: min(34rem, 100%);
  max-height: min(40rem, calc(100dvh - 2rem));
  border: 2px solid #3a5fb8;
  border-radius: 14px;
  background: #101a36;
  color: #dfe8ff;
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.5);
  overflow: hidden;
}
.cp-head {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.6rem 0.5rem 0.6rem 0.9rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.12);
}
.cp-title { margin: 0; font-size: 1.05rem; }
.cp-tag {
  padding: 0.1rem 0.4rem;
  border-radius: 5px;
  background: #f0b429;
  color: #101a36;
  font-size: 0.62rem;
  font-weight: 800;
  letter-spacing: 0.05em;
}
.cp-x {
  margin-left: auto;
  width: 34px;
  height: 34px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: #dfe8ff;
  font-size: 1.5rem;
  line-height: 1;
  cursor: pointer;
}
.cp-body { flex: 1; min-height: 0; overflow-y: auto; padding: 0.9rem; }

@media (max-width: 720px) {
  .cp { padding: 0.5rem; }
  .cp-card { max-height: calc(100dvh - 1rem); }
}
</style>
