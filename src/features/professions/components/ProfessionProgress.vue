<template>
  <section class="pg pf-card" :class="`pg--${profession}`">
    <header class="pg-head">
      <span class="pg-level"><small>Nv.</small>{{ view.level }}</span>
      <div class="pg-id">
        <p class="pf-kicker">Profesión</p>
        <h3>{{ PROFESSIONS[profession].name }}</h3>
        <div class="pg-bar" role="progressbar" :aria-valuenow="Math.round(view.progress * 100)" aria-valuemin="0" aria-valuemax="100">
          <span :style="{ width: `${view.progress * 100}%` }" />
        </div>
        <p class="pg-xp">
          <template v-if="view.levelSpan">{{ view.levelXp.toLocaleString('es') }} / {{ view.levelSpan.toLocaleString('es') }} XP · faltan {{ (view.levelSpan - view.levelXp).toLocaleString('es') }}</template>
          <template v-else>Nivel máximo</template>
        </p>
      </div>
    </header>

    <h4>Próximo</h4>
    <ol v-if="view.upcoming.length" class="pg-list">
      <li v-for="entry in view.upcoming" :key="entry.id" :class="`pg-entry--${entry.status}`">
        <span class="pg-at">Nv. {{ entry.level }}</span>
        <span class="pg-kind">{{ KIND_LABEL[entry.kind] }}</span>
        <span class="pg-name">{{ entry.name }}</span>
        <span class="pf-chip" :class="`pg-status--${entry.status}`">{{ entry.status === 'defined' ? 'Definido' : 'Idea futura' }}</span>
      </li>
    </ol>
    <p v-else class="pg-note">No quedan desbloqueos definidos.</p>

    <details class="pg-done">
      <summary>Ya desbloqueado ({{ view.unlocked.length }})</summary>
      <ul class="pg-list">
        <li v-for="entry in view.unlocked" :key="entry.id">
          <span class="pg-at">Nv. {{ entry.level }}</span>
          <span class="pg-kind">{{ KIND_LABEL[entry.kind] }}</span>
          <span class="pg-name">{{ entry.name }}</span>
        </li>
      </ul>
    </details>
    <p class="pg-note">"Definido" viene del catálogo de R31-A; los valores siguen sujetos a balance en R31-C.</p>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { PROFESSIONS } from '../domain/catalog/professions'
import type { ProfessionId } from '../domain/types'
import { progressionView, type UnlockKind } from '../ui/progressionView'

const props = defineProps<{ profession: ProfessionId; xp: number }>()

const KIND_LABEL: Readonly<Record<UnlockKind, string>> = {
  node: 'Nodo', recipe: 'Receta', tool: 'Herramienta', milestone: 'Hito', specialization: 'Especialización',
}

const view = computed(() => progressionView(props.profession, props.xp))
</script>

<style scoped>
.pg { display: grid; gap: 0.6rem; padding: 1rem; border-left-width: 6px; }
.pg--mining { border-left-color: var(--pf-mining); }
.pg--woodcutting { border-left-color: var(--pf-woodcutting); }
.pg--fishing { border-left-color: var(--pf-fishing); }
.pg--alchemy { border-left-color: var(--pf-alchemy); }
.pg-head { display: flex; align-items: center; gap: 0.9rem; }
.pg-level { display: grid; place-items: center; width: 64px; height: 64px; flex: none; border: 3px solid var(--pf-gold); border-radius: 50%; color: var(--pf-gold); font-size: 1.6rem; font-weight: 800; line-height: 1; }
.pg-level small { font-size: 0.65rem; font-weight: 600; }
.pg-id { flex: 1; min-width: 0; }
.pg-id h3 { margin: 0.1rem 0 0.35rem; }
.pg-bar { height: 10px; border-radius: 999px; background: rgba(255, 255, 255, 0.1); overflow: hidden; }
.pg-bar span { display: block; height: 100%; background: linear-gradient(90deg, #d9a93f, var(--pf-gold)); }
.pg-xp { margin: 0.3rem 0 0; color: var(--pf-muted); font-size: 0.78rem; font-variant-numeric: tabular-nums; }
h4 { margin: 0.2rem 0 0; color: var(--pf-soft); font-size: 0.85rem; }
.pg-list { display: grid; gap: 0.3rem; margin: 0; padding: 0; list-style: none; }
.pg-list li { display: grid; grid-template-columns: 3.4rem 6.5rem 1fr auto; align-items: center; gap: 0.5rem; font-size: 0.84rem; }
.pg-at { color: var(--pf-gold); font-weight: 700; }
.pg-kind { color: var(--pf-muted); }
.pg-entry--future .pg-name { color: var(--pf-muted); font-style: italic; }
.pg-status--future { border: 1px dashed var(--pf-warn); background: transparent; color: var(--pf-warn); }
.pg-done summary { color: var(--pf-muted); font-size: 0.82rem; cursor: pointer; }
.pg-done .pg-list { margin-top: 0.4rem; }
.pg-note { margin: 0; color: var(--pf-muted); font-size: 0.74rem; }
@media (max-width: 520px) {
  .pg-list li { grid-template-columns: 3.2rem 1fr; }
  .pg-kind, .pg-list .pf-chip { display: none; }
}
</style>
