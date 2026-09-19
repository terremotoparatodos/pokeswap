<template>
  <div class="sk">
    <button
      v-if="!open"
      type="button"
      class="sk-tab"
      :aria-label="`Abrir habilidades, nivel total ${totalLevel}`"
      @click="open = true"
    >
      <span aria-hidden="true">📘</span>
      <span class="sk-tab-text">Skills</span>
      <span class="sk-total">{{ totalLevel }}</span>
    </button>

    <section v-else class="sk-panel pf" aria-label="Habilidades">
      <header class="sk-head">
        <strong class="sk-title">Habilidades</strong>
        <span class="sk-sum">Nivel total <strong>{{ totalLevel }}</strong></span>
        <button type="button" class="sk-x" aria-label="Cerrar habilidades" @click="open = false">−</button>
      </header>

      <ul class="sk-list">
        <li v-for="skill in skills" :key="skill.id" class="sk-row" :class="`sk-row--${skill.id}`">
          <span class="sk-icon" aria-hidden="true">{{ ICON[skill.id] }}</span>
          <span class="sk-name">{{ skill.name }}</span>
          <span class="sk-level">{{ skill.level }}<small>/{{ skill.maxLevel }}</small></span>
          <span
            class="sk-bar"
            role="progressbar"
            :aria-label="skill.name"
            :aria-valuenow="Math.round(skill.progress * 100)"
            aria-valuemin="0"
            aria-valuemax="100"
          >
            <span :style="{ width: `${Math.round(skill.progress * 100)}%` }" />
          </span>
          <span class="sk-xp">
            <template v-if="skill.levelSpan">{{ skill.levelXp.toLocaleString('es') }} / {{ skill.levelSpan.toLocaleString('es') }} XP</template>
            <template v-else>máximo</template>
          </span>
          <span v-if="skill.next" class="sk-next">Nv. {{ skill.next.level }} · {{ skill.next.name }}</span>
        </li>
      </ul>

      <footer class="sk-foot">
        <span class="sk-energy" :title="`Energía ${energy.current} de ${energy.max}`">
          ⚡ {{ energy.current }} / {{ energy.max }}
        </span>
        <span class="sk-note">PLAYTEST · el progreso de esta build no se guarda</span>
      </footer>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { ENERGY_CONFIG, PROFESSIONS } from '../domain/catalog/professions'
import { PROFESSION_IDS, type ProfessionId } from '../domain/types'
import { demoMaxEnergy } from '../demo/demoSession'
import type { ProfessionDemoSession } from '../demo/useProfessionDemo'
import { energyView } from '../ui/gearViews'
import { progressionView } from '../ui/progressionView'
import './professions.css'

// The Old School RuneScape idea, not its interface: one line per skill, the
// level, the bar, and what the next level opens. Four professions, because
// four is what this game has — Construction is reserved and not productive, so
// it is not listed. Nothing is invented here: the levels, the curve and the
// unlocks all come from the R31-A catalogs through `progressionView`.
//
// The session is local and non-persistent (`demoSession.ts`), which is exactly
// what a playtest wants and exactly what the footer says out loud.
const props = defineProps<{ session: ProfessionDemoSession }>()

const ICON: Readonly<Record<ProfessionId, string>> = {
  mining: '⛏', woodcutting: '🪓', fishing: '🎣', alchemy: '🧪',
}

const open = ref(false)
const state = computed(() => props.session.state.value)

const skills = computed(() => PROFESSION_IDS.map(id => {
  const view = progressionView(id, state.value.xp[id], 1)
  return { id, name: PROFESSIONS[id].name, ...view, next: view.upcoming[0] ?? null }
}))

const totalLevel = computed(() => skills.value.reduce((sum, skill) => sum + skill.level, 0))
const energy = computed(() => energyView(state.value.energy, demoMaxEnergy(state.value), ENERGY_CONFIG))
</script>

<style scoped>
.sk {
  position: fixed;
  left: 1rem;
  bottom: 4rem;
  z-index: 29;
  font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
}

.sk-tab {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  min-height: 40px;
  padding: 0 0.8rem;
  border: 2px solid var(--pf-gold, #ffd27a);
  border-radius: 999px;
  background: rgba(16, 26, 54, 0.92);
  color: var(--pf-gold, #ffd27a);
  font: inherit;
  font-size: 0.78rem;
  font-weight: 700;
  cursor: pointer;
}
.sk-total {
  min-width: 22px;
  padding: 0 0.3rem;
  border-radius: 999px;
  background: var(--pf-gold, #ffd27a);
  color: #101a36;
  font-size: 0.7rem;
  text-align: center;
}

.sk-panel {
  width: min(23rem, calc(100vw - 2rem));
  max-height: min(22rem, 55dvh);
  overflow-y: auto;
  padding: 0.6rem 0.7rem;
  border: 2px solid var(--pf-gold, #ffd27a);
  border-radius: 12px;
  background: rgba(12, 20, 42, 0.96);
  color: #dfe8ff;
  box-shadow: 0 12px 34px rgba(0, 0, 0, 0.45);
}

.sk-head { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.5rem; }
.sk-title { font-size: 0.9rem; }
.sk-sum { margin-left: auto; font-size: 0.75rem; opacity: 0.7; }
.sk-sum strong { color: var(--pf-gold, #ffd27a); }
.sk-x {
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: #dfe8ff;
  font-size: 1.2rem;
  line-height: 1;
  cursor: pointer;
}

.sk-list { display: grid; gap: 0.5rem; margin: 0; padding: 0; list-style: none; }
.sk-row {
  display: grid;
  grid-template-columns: 1.4rem 1fr auto;
  align-items: center;
  gap: 0.15rem 0.45rem;
  padding: 0.35rem 0.45rem;
  border-left: 4px solid rgba(255, 255, 255, 0.15);
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.04);
}
.sk-row--mining { border-left-color: var(--pf-mining, #b8bbc2); }
.sk-row--woodcutting { border-left-color: var(--pf-woodcutting, #8c5a33); }
.sk-row--fishing { border-left-color: var(--pf-fishing, #46b3d6); }
.sk-row--alchemy { border-left-color: var(--pf-alchemy, #9a62d6); }

.sk-icon { font-size: 1rem; }
.sk-name { font-size: 0.85rem; font-weight: 600; }
.sk-level { color: var(--pf-gold, #ffd27a); font-weight: 800; font-variant-numeric: tabular-nums; }
.sk-level small { font-weight: 500; opacity: 0.5; }
.sk-bar {
  grid-column: 2 / 4;
  height: 7px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.12);
  overflow: hidden;
}
.sk-bar span { display: block; height: 100%; background: linear-gradient(90deg, #d9a93f, var(--pf-gold, #ffd27a)); }
.sk-xp { grid-column: 2 / 4; font-size: 0.7rem; opacity: 0.6; font-variant-numeric: tabular-nums; }
.sk-next { grid-column: 2 / 4; font-size: 0.7rem; opacity: 0.45; }

.sk-foot {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 0.3rem;
  margin-top: 0.6rem;
  padding-top: 0.5rem;
  border-top: 1px solid rgba(255, 255, 255, 0.12);
  font-size: 0.7rem;
}
.sk-energy { color: var(--pf-energy, #7fd7ff); font-weight: 700; }
.sk-note { opacity: 0.45; }

@media (max-width: 720px) {
  .sk { left: 0.6rem; bottom: 3.4rem; }
  .sk-tab-text { display: none; }
  .sk-panel { width: calc(100vw - 1.2rem); max-height: 45dvh; }
}
</style>
