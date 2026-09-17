<script setup lang="ts">
// Dev-only shell for the Dungeon/PvE prototype (/dev/dungeon).
//
// One standalone page with a lab per system. It owns nothing but the tab: each
// lab holds its own state so switching away and back is a clean restart.

import { ref } from 'vue'
import AlphaBossLab from './AlphaBossLab.vue'
import BattleLab from './BattleLab.vue'
import CaptureLab from './CaptureLab.vue'
import ExpeditionLab from './ExpeditionLab.vue'
import GeneratorLab from './GeneratorLab.vue'

type Tab = 'generator' | 'battle' | 'capture' | 'expedition' | 'alpha'

const TABS: Readonly<Record<Tab, string>> = {
  generator: 'Generador',
  battle: 'Combate realtime',
  capture: 'Captura',
  expedition: 'Expedición',
  alpha: 'Alpha Boss',
}

const tab = ref<Tab>('generator')
</script>

<template>
  <div class="dp">
    <header class="dp-head">
      <div>
        <p class="dp-kicker">Herramienta interna · solo en desarrollo</p>
        <h1>Dungeon / PvE Prototype</h1>
      </div>
      <span class="dp-badge">Prototipo local · nada se guarda ni se envía</span>
    </header>

    <nav class="dp-tabs" aria-label="Laboratorios">
      <button
        v-for="(label, id) in TABS"
        :key="id"
        type="button"
        :class="{ 'dp-tab--on': tab === id }"
        @click="tab = id as Tab"
      >{{ label }}</button>
    </nav>

    <main class="dp-main">
      <GeneratorLab v-if="tab === 'generator'" />
      <BattleLab v-else-if="tab === 'battle'" />
      <CaptureLab v-else-if="tab === 'capture'" />
      <ExpeditionLab v-else-if="tab === 'expedition'" />
      <AlphaBossLab v-else />
    </main>
  </div>
</template>

<style>
/* Scoped to this prototype on purpose: it borrows no styles from other features. */
.dp {
  --dp-bg: #0d1326;
  --dp-panel: #172038;
  --dp-line: #2b3a5e;
  --dp-text: #e8eeff;
  --dp-dim: #93a2c6;
  --dp-accent: #ffd27a;
  --dp-danger: #ff6b6b;
  --dp-ok: #7ee2a8;
  min-height: 100vh;
  padding: 16px;
  background: var(--dp-bg);
  color: var(--dp-text);
  font-family: system-ui, sans-serif;
}
.dp-head { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; justify-content: space-between; }
.dp-head h1 { margin: 2px 0 0; font-size: 1.5rem; }
.dp-kicker { margin: 0; font-size: 0.7rem; letter-spacing: 0.08em; text-transform: uppercase; color: var(--dp-dim); }
.dp-badge { padding: 6px 10px; border-radius: 999px; background: #3b1b24; color: #ffb4b4; font-size: 0.75rem; font-weight: 700; }
.dp-tabs { display: flex; flex-wrap: wrap; gap: 8px; margin: 14px 0; }
.dp-tabs button {
  padding: 8px 14px; border: 1px solid var(--dp-line); border-radius: 999px;
  background: transparent; color: var(--dp-text); font: inherit; font-weight: 600; cursor: pointer;
}
.dp-tab--on { background: var(--dp-accent); border-color: var(--dp-accent) !important; color: #221a06 !important; }
.dp-card { padding: 14px; border: 1px solid var(--dp-line); border-radius: 12px; background: var(--dp-panel); }
.dp-grid { display: grid; gap: 14px; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); }
.dp-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.dp-field { display: flex; flex-direction: column; gap: 4px; font-size: 0.8rem; color: var(--dp-dim); }
.dp-field select, .dp-field input {
  padding: 6px 8px; border: 1px solid var(--dp-line); border-radius: 8px;
  background: #0f1730; color: var(--dp-text); font: inherit;
}
.dp-btn {
  padding: 8px 12px; border: 1px solid var(--dp-line); border-radius: 8px;
  background: #1f2b49; color: var(--dp-text); font: inherit; font-weight: 600; cursor: pointer;
}
.dp-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.dp-btn--go { background: var(--dp-accent); border-color: var(--dp-accent); color: #221a06; }
.dp-note { margin: 6px 0 0; font-size: 0.78rem; color: var(--dp-dim); }
.dp-tag { padding: 2px 8px; border-radius: 999px; background: #22304f; font-size: 0.72rem; font-weight: 700; }
.dp-log { max-height: 190px; overflow: auto; margin: 0; padding-left: 18px; font-size: 0.78rem; color: var(--dp-dim); }
h2 { margin: 0 0 8px; font-size: 1rem; }
h3 { margin: 12px 0 6px; font-size: 0.85rem; color: var(--dp-dim); text-transform: uppercase; letter-spacing: 0.06em; }
@media (max-width: 420px) {
  .dp { padding: 12px; }
  .dp-head h1 { font-size: 1.2rem; }
}
</style>
