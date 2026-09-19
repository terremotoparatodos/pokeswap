<template>
  <div class="pt-banner" :class="{ 'pt-banner--open': expanded }">
    <button
      type="button"
      class="pt-banner-pill"
      :aria-expanded="expanded"
      aria-controls="pt-banner-card"
      @click="expanded = !expanded"
    >
      <span class="pt-banner-dot" aria-hidden="true" />
      <span class="pt-banner-label">{{ label }}</span>
    </button>

    <div v-if="expanded" id="pt-banner-card" class="pt-banner-card" role="note">
      <p class="pt-banner-lead">Esto es una versión temporal de prueba.</p>
      <ul class="pt-banner-list">
        <li>Van a aparecer bugs. Es lo que venimos a ver.</li>
        <li>El progreso de esta build <strong>se borra</strong> al cerrar el playtest.</li>
        <li>Nada de lo que hagas acá afecta tu cuenta ni tus Pokémon reales.</li>
        <li>Si algo se rompe o no se entiende, usá <strong>Reportar bug</strong>.</li>
      </ul>
      <p class="pt-banner-build">{{ label }} · {{ builtAt }}</p>
      <button type="button" class="pt-banner-ok" @click="dismiss">Entendido</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { buildLabel } from '../domain/buildIdentity'
import { BUILD } from '../playtestBuild'

// The signal has to be visible without being in the way: a pill that always
// says which build this is, and a card the player reads once and collapses.
const SEEN_KEY = 'pokeswap.playtest.bannerSeen'

const label = buildLabel(BUILD)
const builtAt = BUILD.builtAt === 'unknown' ? 'sin fecha' : BUILD.builtAt.slice(0, 16).replace('T', ' ')
const expanded = ref(false)

function dismiss(): void {
  expanded.value = false
  try {
    sessionStorage.setItem(SEEN_KEY, '1')
  } catch {
    // Storage blocked: the card simply opens again next load.
  }
}

onMounted(() => {
  try {
    expanded.value = sessionStorage.getItem(SEEN_KEY) !== '1'
  } catch {
    expanded.value = true
  }
})
</script>

<style scoped>
.pt-banner {
  position: fixed;
  top: 0.5rem;
  left: 50%;
  z-index: 60;
  display: grid;
  justify-items: center;
  gap: 0.4rem;
  transform: translateX(-50%);
  font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
  pointer-events: none;
}
.pt-banner > * { pointer-events: auto; }

.pt-banner-pill {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  min-height: 28px;
  padding: 0 0.7rem;
  border: 2px solid #f0b429;
  border-radius: 999px;
  background: rgba(16, 26, 54, 0.92);
  color: #f7d774;
  font: inherit;
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  white-space: nowrap;
  cursor: pointer;
}
.pt-banner-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #f0b429;
}

.pt-banner-card {
  width: min(24rem, calc(100vw - 1.5rem));
  padding: 0.8rem 0.95rem;
  border: 2px solid #f0b429;
  border-radius: 12px;
  background: rgba(12, 20, 42, 0.97);
  color: #dfe8ff;
  font-size: 0.85rem;
  line-height: 1.45;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45);
}
.pt-banner-lead { margin: 0 0 0.5rem; font-weight: 700; color: #fff; }
.pt-banner-list { margin: 0; padding-left: 1.1rem; display: grid; gap: 0.25rem; }
.pt-banner-build { margin: 0.6rem 0 0.5rem; font-size: 0.72rem; opacity: 0.65; }
.pt-banner-ok {
  width: 100%;
  min-height: 40px;
  border: 2px solid #f0b429;
  border-radius: 9px;
  background: #f0b429;
  color: #101a36;
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}

@media (max-width: 720px) {
  .pt-banner { top: 0.4rem; }
  .pt-banner-pill { font-size: 0.65rem; min-height: 24px; }
}
</style>
