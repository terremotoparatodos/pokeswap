<template>
  <div class="cp" :class="{ 'cp--compact': surface.kind === 'closed' }" role="dialog" :aria-label="title" @click.self="emit('close')">
    <div class="cp-card">
      <header class="cp-head">
        <h2 class="cp-title">{{ title }}</h2>
        <span class="cp-tag">PLAYTEST</span>
        <button type="button" class="cp-x" :aria-label="`Cerrar ${title}`" @click="emit('close')">×</button>
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
import { computed, onMounted, onUnmounted } from 'vue'
import ClosedFeatureView from './ClosedFeatureView.vue'
import PlaytestShopView from './PlaytestShopView.vue'
import PokemonCenterView from './PokemonCenterView.vue'
import type { PlaytestSurface } from '../domain/cityFeatures'

// One frame for every door in the city, so a closed building and an open one
// feel like the same place rather than two different applications.
const props = defineProps<{ surface: PlaytestSurface }>()
const emit = defineEmits<{ close: [] }>()

// MOBILE-1: nothing in these surfaces is left half done by leaving (healing,
// buying and moving Pokémon apply at once), so the backdrop and Escape close
// them too, besides ×.
const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') emit('close') }
onMounted(() => window.addEventListener('keydown', onKeyDown))
onUnmounted(() => window.removeEventListener('keydown', onKeyDown))

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
  padding: calc(1rem + var(--safe-top, 0px)) calc(1rem + var(--safe-right, 0px)) calc(1rem + var(--safe-bottom, 0px)) calc(1rem + var(--safe-left, 0px));
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
  flex: none;
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
  width: 40px;
  height: 40px;
  border: 1px solid rgba(255, 255, 255, 0.22);
  border-radius: 8px;
  background: transparent;
  color: #dfe8ff;
  font-size: 1.5rem;
  line-height: 1;
  cursor: pointer;
}
.cp-body { flex: 1; min-height: 0; overflow-y: auto; padding: 0.9rem; }

/*
 * Phones (MOBILE-1). A building (Centro Pokémon, Tienda) is a sheet from the
 * bottom that takes what its content needs, up to ~three quarters of the
 * screen, with the world still showing above it; its header never scrolls.
 * A closed building is a short message: a small centred card.
 */
@media (max-width: 720px), (max-height: 500px) {
  .cp {
    place-items: end stretch;
    padding: calc(4rem + var(--safe-top, 0px)) var(--safe-right, 0px) 0 var(--safe-left, 0px);
    background: rgba(6, 10, 22, 0.45);
  }
  .cp-card {
    width: 100%;
    max-height: min(75dvh, 100%);
    border-width: 2px 0 0;
    border-radius: 18px 18px 0 0;
  }
  .cp-body { padding: 0.8rem 0.8rem calc(0.8rem + var(--safe-bottom, 0px)); overscroll-behavior: contain; }
  .cp--compact {
    place-items: center;
    padding: calc(1rem + var(--safe-top, 0px)) calc(1rem + var(--safe-right, 0px)) calc(1rem + var(--safe-bottom, 0px)) calc(1rem + var(--safe-left, 0px));
  }
  .cp--compact .cp-card { width: min(22rem, 100%); border-width: 2px; border-radius: 14px; }
  .cp--compact .cp-body { padding-bottom: 0.9rem; }
}
/* A landscape phone: a column on the right, the world on the left. */
@media (min-width: 721px) and (max-height: 500px) {
  .cp { place-items: stretch end; padding: var(--safe-top, 0px) var(--safe-right, 0px) 0 0; }
  .cp-card { width: min(28rem, 58vw); max-height: none; border-width: 0 0 0 2px; border-radius: 18px 0 0 0; }
  .cp--compact { place-items: center; }
  .cp--compact .cp-card { max-height: calc(100dvh - 2rem); border-width: 2px; border-radius: 14px; }
}
</style>
