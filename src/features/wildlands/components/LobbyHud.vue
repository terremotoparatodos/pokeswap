<template>
  <div class="wl-hud" aria-label="Estado de la exploración" :title="summary">
    <span class="wl-place">{{ hud.place }}</span>
    <span v-if="hud.areaKind === 'wild'" class="wl-coords">({{ hud.tx }}, {{ hud.ty }})</span>
    <span class="wl-sep" />
    <span class="wl-weather" :title="WEATHER_LABEL[hud.weather]">
      <svg v-if="hud.weather === 'clear'" viewBox="0 0 20 20" aria-hidden="true">
        <circle cx="10" cy="10" r="3.5" />
        <path d="M10 1.5v3M10 15.5v3M1.5 10h3M15.5 10h3M4 4l2 2M14 14l2 2M4 16l2-2M14 6l2-2" />
      </svg>
      <svg v-else viewBox="0 0 20 20" aria-hidden="true">
        <path d="M5.5 12.5a3.5 3.5 0 0 1 .4-7 4.5 4.5 0 0 1 8.6 1.2 3 3 0 0 1-.5 5.8z" />
        <path v-if="hud.weather === 'rain'" d="M7 15l-1 3M10.5 15l-1 3M14 15l-1 3" />
        <path v-else d="M7 16h.01M10.5 17.5h.01M14 16h.01" stroke-width="2.4" />
      </svg>
    </span>
    <span class="wl-sep wl-sep--phase" />
    <span class="wl-phase">{{ hud.phase }}</span>
    <template v-if="hud.areaKind === 'wild'">
      <span class="wl-sep wl-sep--crystals" />
      <span class="wl-crystals">{{ hud.crystals }} cristales</span>
    </template>
    <span class="wl-sep" />
    <button
      class="wl-hud-btn wl-home"
      :disabled="hud.traveling"
      :title="homeLabel"
      :aria-label="homeLabel"
      @click="emit('home')"
    >
      <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 9.5 10 3.5l7 6M5 8.5V16h10V8.5M8.5 16v-4h3v4" /></svg>
      <span class="wl-home-label">Ciudad</span>
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { WeatherKind } from '../engine/atmosphere'
import type { HudState } from '../engine/game'

// Status pill: where the player is, weather, time of day and the way home.
// A bottom pill on desktops; on phones (MOBILE-1) a small indicator under the
// minimap, keeping place, coordinates, weather and the way home. The time of
// day (the world's light already shows it) and the demo crystal count move to
// the tooltip, so nothing is lost.
const props = defineProps<{ hud: HudState }>()
const emit = defineEmits<{ home: [] }>()

const WEATHER_LABEL: Record<WeatherKind, string> = { clear: 'Despejado', rain: 'Lluvia', snow: 'Nieve' }
const homeLabel = computed(() => props.hud.areaKind === 'town' ? 'Reubicar en Ciudad Corazón' : 'Volver a Ciudad Corazón')
const summary = computed(() => {
  const h = props.hud
  const where = h.areaKind === 'wild' ? `${h.place} (${h.tx}, ${h.ty})` : h.place
  return [where, WEATHER_LABEL[h.weather], h.phase, h.areaKind === 'wild' ? `${h.crystals} cristales` : null].filter(Boolean).join(' · ')
})
</script>

<style scoped>
.wl-hud {
  position: absolute;
  bottom: calc(1.25rem + var(--safe-bottom, 0px));
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.55rem 1.25rem;
  border: 2px solid #3a5fb8;
  border-radius: 999px;
  background: rgba(16, 26, 54, 0.92);
  color: #fff;
  font-size: 1rem;
  white-space: nowrap;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
}
.wl-hud svg {
  width: 20px;
  height: 20px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.5;
  stroke-linecap: round;
}
.wl-hud-btn {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.wl-hud-btn:hover {
  color: #9fc0ff;
}
.wl-hud-btn:disabled {
  opacity: 0.5;
  cursor: default;
}
.wl-home {
  color: #ffd27a;
}
.wl-sep {
  width: 1px;
  height: 1.1rem;
  background: rgba(255, 255, 255, 0.25);
}
.wl-weather {
  display: flex;
  color: #dfe8ff;
}
.wl-phase {
  color: #c7d0e6;
}
.wl-crystals {
  color: #7fe3f5;
  font-weight: 600;
}

.wl-coords {
  font-variant-numeric: tabular-nums;
}
@media (max-width: 720px), (max-height: 500px) {
  /* A small indicator under the minimap, not a band across the bottom where
     thumbs and the chat, Skills and Correr buttons live. */
  .wl-hud {
    top: calc(0.75rem + 96px + 0.4rem + var(--safe-top, 0px));
    right: calc(0.75rem + var(--safe-right, 0px));
    bottom: auto;
    left: auto;
    transform: none;
    max-width: calc(100vw - 1.5rem - var(--safe-left, 0px) - var(--safe-right, 0px));
    gap: 0.35rem;
    padding: 0.15rem 0.2rem 0.15rem 0.55rem;
    border-width: 1px;
    background: rgba(16, 26, 54, 0.8);
    box-shadow: none;
    font-size: 0.72rem;
  }
  .wl-place { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .wl-coords { flex: none; color: #c7d0e6; }
  .wl-hud svg { width: 15px; height: 15px; }
  .wl-sep--phase, .wl-phase, .wl-sep--crystals, .wl-crystals, .wl-home-label { display: none; }
  /* The way home stays a real touch target. */
  .wl-home { justify-content: center; width: 30px; height: 30px; border-radius: 50%; }
}
</style>
