<template>
  <div class="sk skx">
    <!-- The button that opens Skills also closes it (MOBILE-1); the header's × is the alternative. -->
    <button
      type="button"
      class="sk-tab"
      :class="{ 'sk-tab--on': open }"
      :aria-label="open ? 'Cerrar Skills' : `Abrir Skills, nivel total ${total}`"
      :aria-expanded="open"
      aria-controls="skills-panel"
      @click="open = !open"
    >
      <span aria-hidden="true">📘</span>
      <span class="sk-tab-text">Skills</span>
      <span class="sk-total">{{ total }}</span>
    </button>

    <section v-if="open" id="skills-panel" class="sk-panel" aria-label="Skills">
      <header class="sk-head">
        <strong class="sk-title">Skills</strong>
        <span class="sk-sum">Nivel total <strong>{{ total }}</strong></span>
        <button type="button" class="sk-x" aria-label="Cerrar Skills" @click="open = false">×</button>
      </header>

      <div class="sk-scroll">
        <ul class="sk-list">
          <li v-for="row in rows" :key="row.id" class="sk-row" :class="`sk-row--${row.id}`">
            <button
              type="button"
              class="sk-summary"
              :aria-expanded="expanded === row.id"
              :aria-controls="`sk-road-${row.id}`"
              @click="expanded = expanded === row.id ? null : row.id"
            >
              <span class="sk-icon" aria-hidden="true">{{ row.icon }}</span>
              <span class="sk-name">{{ row.name }}</span>
              <span class="sk-level">{{ row.level }}</span>
              <span
                class="sk-bar"
                role="progressbar"
                :aria-label="`${row.name}, progreso al nivel ${row.level + 1}`"
                :aria-valuenow="Math.round(row.fraction * 100)"
                aria-valuemin="0"
                aria-valuemax="100"
              >
                <span :style="{ width: `${Math.round(row.fraction * 100)}%` }" />
              </span>
              <span class="sk-xp">
                <template v-if="!row.atCap">{{ row.intoLevel.toLocaleString('es') }} / {{ row.span.toLocaleString('es') }} XP</template>
                <template v-else>Nivel máximo de esta versión</template>
              </span>
              <span v-if="row.next" class="sk-next">Próximo · Nv {{ row.next.level }} · {{ row.next.title }}</span>
            </button>

            <div v-if="expanded === row.id" :id="`sk-road-${row.id}`" class="sk-road">
              <p v-if="best(row.id)" class="sk-best">
                Mejor de tu equipo: <strong>{{ best(row.id)!.name }}</strong>
                <span class="sk-stars" :aria-label="`aptitud ${best(row.id)!.aptitude} de 5`">{{ stars(best(row.id)!.aptitude) }}</span>
              </p>
              <ol class="sk-steps">
                <li v-for="entry in row.roadmap" :key="entry.id" class="sk-step" :class="`sk-step--${entry.status}`">
                  <span class="sk-step-lv">{{ entry.level }}</span>
                  <span class="sk-step-title">{{ entry.title }}</span>
                  <span class="sk-step-detail">{{ entry.detail }}</span>
                </li>
              </ol>
            </div>
          </li>
        </ul>

        <footer class="sk-foot">
          <span class="sk-note">PLAYTEST · el progreso de esta build no se guarda</span>
        </footer>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { aptitudeStars, type Aptitude } from '../domain/aptitude/aptitudeScale'
import type { SkillId } from '../domain/skills'
import type { WorkerRef } from '../ui/workerRef'
import { bestWorker, skillRows, totalLevel } from '../ui/skillsView'
import './skills.css'

// The OSRS idea, not its interface: one line per skill — level, bar, what
// the next level opens. Tapping a skill shows its roadmap and which of your
// Pokémon is best at it. Three skills, because three is what the game has.
const props = defineProps<{
  xp: Readonly<Record<SkillId, number>>
  workers: readonly WorkerRef[]
}>()

const open = ref(false)
const expanded = ref<SkillId | null>(null)
// The host keeps Chat, Skills and the bag from piling up over the world.
const emit = defineEmits<{ open: [open: boolean] }>()
watch(open, value => emit('open', value))
onUnmounted(() => { if (open.value) emit('open', false) })
defineExpose({ close: () => { open.value = false } })

const rows = computed(() => skillRows(props.xp))
const total = computed(() => totalLevel(rows.value))
const best = (skill: SkillId) => bestWorker(props.workers, skill)
const stars = (value: Aptitude) => aptitudeStars(value)
</script>

<style scoped>
.sk {
  position: fixed;
  left: calc(1rem + var(--safe-left, 0px));
  bottom: calc(4rem + var(--safe-bottom, 0px));
  z-index: 29;
  font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
}

.sk-tab {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  min-height: 40px;
  padding: 0 0.8rem;
  border: 2px solid var(--skx-gold);
  border-radius: 999px;
  background: rgba(16, 26, 54, 0.92);
  color: var(--skx-gold);
  font: inherit;
  font-size: 0.78rem;
  font-weight: 700;
  cursor: pointer;
}
.sk-tab--on { background: var(--skx-gold); color: #101a36; box-shadow: 0 0 0 3px rgba(255, 210, 122, 0.35); }
.sk-tab--on .sk-total { background: #101a36; color: var(--skx-gold); }
.sk-total { min-width: 22px; padding: 0 0.3rem; border-radius: 999px; background: var(--skx-gold); color: #101a36; font-size: 0.7rem; text-align: center; }

/* A window of its own above the tab, inside the screen, header always on top. */
.sk-panel {
  position: fixed;
  left: calc(1rem + var(--safe-left, 0px));
  bottom: calc(4rem + 40px + 0.5rem + var(--safe-bottom, 0px));
  display: flex;
  flex-direction: column;
  width: min(26rem, calc(100vw - 2rem));
  max-height: min(36rem, calc(100dvh - 4rem - 40px - 0.5rem - 6rem - var(--safe-top, 0px) - var(--safe-bottom, 0px)));
  overflow: hidden;
  border: 2px solid var(--skx-gold);
  border-radius: 12px;
  background: rgba(12, 20, 42, 0.96);
  color: var(--skx-soft);
  box-shadow: 0 12px 34px rgba(0, 0, 0, 0.45);
}
.sk-head { display: flex; flex: none; align-items: center; gap: 0.5rem; padding: 0.45rem 0.45rem 0.45rem 0.8rem; border-bottom: 1px solid rgba(255, 255, 255, 0.12); }
.sk-scroll { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 0.6rem 0.7rem; }
.sk-title { font-size: 0.9rem; }
.sk-sum { margin-left: auto; font-size: 0.75rem; opacity: 0.7; }
.sk-sum strong { color: var(--skx-gold); }
.sk-x { width: 36px; height: 36px; border: 1px solid rgba(255, 255, 255, 0.22); border-radius: 8px; background: transparent; color: var(--skx-soft); font-size: 1.2rem; line-height: 1; cursor: pointer; }

.sk-list { display: grid; gap: 0.5rem; margin: 0; padding: 0; list-style: none; }
.sk-row { border-left: 4px solid rgba(255, 255, 255, 0.15); border-radius: 6px; background: rgba(255, 255, 255, 0.04); }
.sk-row--woodcutting { border-left-color: var(--skx-woodcutting); }
.sk-row--mining { border-left-color: var(--skx-mining); }
.sk-row--farming { border-left-color: var(--skx-farming); }

.sk-summary {
  display: grid;
  grid-template-columns: 1.4rem 1fr auto;
  align-items: center;
  gap: 0.15rem 0.45rem;
  width: 100%;
  padding: 0.45rem 0.5rem;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.sk-icon { font-size: 1rem; }
.sk-name { font-size: 0.88rem; font-weight: 700; }
.sk-level { color: var(--skx-gold); font-size: 1.05rem; font-weight: 800; font-variant-numeric: tabular-nums; }
.sk-bar { grid-column: 2 / 4; height: 7px; border-radius: 999px; background: rgba(255, 255, 255, 0.12); overflow: hidden; }
.sk-bar span { display: block; height: 100%; background: linear-gradient(90deg, #d9a93f, var(--skx-gold)); }
.sk-xp { grid-column: 2 / 4; font-size: 0.7rem; opacity: 0.6; font-variant-numeric: tabular-nums; }
.sk-next { grid-column: 2 / 4; color: var(--skx-soft); font-size: 0.74rem; }

.sk-road { padding: 0 0.5rem 0.5rem 2.2rem; }
.sk-best { margin: 0 0 0.4rem; font-size: 0.74rem; opacity: 0.85; }
.sk-stars { margin-left: 0.3rem; color: var(--skx-gold); letter-spacing: 0.05em; }
.sk-steps { display: grid; gap: 0.2rem; margin: 0; padding: 0; list-style: none; }
.sk-step { display: grid; grid-template-columns: 1.8rem 1fr; gap: 0 0.4rem; font-size: 0.74rem; }
.sk-step-lv { grid-row: span 2; color: var(--skx-muted); font-weight: 700; font-variant-numeric: tabular-nums; text-align: right; }
.sk-step-title { font-weight: 600; }
.sk-step-detail { opacity: 0.6; font-size: 0.68rem; }
.sk-step--unlocked { opacity: 0.55; }
.sk-step--unlocked .sk-step-lv::after { content: ' ✓'; color: var(--skx-good); }
.sk-step--next .sk-step-lv, .sk-step--next .sk-step-title { color: var(--skx-gold); }
.sk-step--locked { opacity: 0.8; }

.sk-foot { margin-top: 0.6rem; padding-top: 0.5rem; border-top: 1px solid rgba(255, 255, 255, 0.12); font-size: 0.7rem; }
.sk-note { opacity: 0.45; }

@media (max-width: 720px), (max-height: 500px) {
  /* Beside the chat tab, not above it (MOBILE-1). */
  .sk { left: calc(4.4rem + var(--safe-left, 0px)); bottom: calc(0.75rem + var(--safe-bottom, 0px)); }
  .sk-tab-text { display: none; }
  .sk-panel {
    left: calc(0.6rem + var(--safe-left, 0px));
    right: calc(0.6rem + var(--safe-right, 0px));
    width: auto;
    bottom: calc(0.75rem + 40px + 0.5rem + var(--safe-bottom, 0px));
    max-height: calc(100dvh - 0.75rem - 40px - 0.5rem - 7rem - var(--safe-top, 0px) - var(--safe-bottom, 0px));
  }
}
@media (min-width: 721px) and (max-height: 500px) {
  .sk-panel { right: auto; width: min(24rem, 48vw); }
}
</style>
