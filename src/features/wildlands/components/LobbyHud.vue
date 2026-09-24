<template>
  <div class="wl-hud" aria-label="Estado de la exploración">
    <span class="wl-place">
      {{ hud.place }}<template v-if="hud.areaKind === 'wild'"> ({{ hud.tx }}, {{ hud.ty }})</template>
    </span>
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
    <span class="wl-sep" />
    <span class="wl-phase">{{ hud.phase }}</span>
    <template v-if="hud.areaKind === 'wild'">
      <span class="wl-sep" />
      <span class="wl-crystals">{{ hud.crystals }} cristales</span>
    </template>
    <span class="wl-sep" />
    <button
      class="wl-hud-btn wl-home"
      :disabled="hud.traveling"
      :title="hud.areaKind === 'town' ? 'Reubicar en Ciudad Corazón' : 'Volver a Ciudad Corazón'"
      @click="emit('home')"
    >
      <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 9.5 10 3.5l7 6M5 8.5V16h10V8.5M8.5 16v-4h3v4" /></svg>
      Ciudad
    </button>
  </div>
</template>

<script setup lang="ts">
import type { WeatherKind } from '../engine/atmosphere'
import type { HudState } from '../engine/game'

// Bottom status pill: where the player is, weather, time of day and (in worlds) the way home.
defineProps<{ hud: HudState }>()
const emit = defineEmits<{ home: [] }>()

const WEATHER_LABEL: Record<WeatherKind, string> = { clear: 'Despejado', rain: 'Lluvia', snow: 'Nieve' }
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

@media (max-width: 720px), (max-height: 500px) {
  .wl-hud { font-size: 0.8rem; gap: 0.5rem; padding: 0.45rem 0.9rem; }
}
</style>
