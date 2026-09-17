<script setup lang="ts">
// Choosing an entrance (D1.1 §31).
//
// A card per dungeon, the way the player will see them in the overworld: name,
// category, tier, floors, biome and how long this appearance has left. The
// technical parameters live in the DEV drawer, not here.

import { computed, ref } from 'vue'
import { poolOf } from '../data/dungeonCatalog'
import { speciesById } from '../data/speciesFixtures'
import { DEFAULT_DUNGEON_MINUTES, type DungeonDefinition } from '../domain/dungeonSpawn'
import { THEME_LOOK } from '../domain/floorTiles'

const props = defineProps<{ definitions: readonly DungeonDefinition[]; players: number }>()
const emit = defineEmits<{
  (event: 'enter', definition: DungeonDefinition, minutes: number): void
  (event: 'update:players', value: number): void
}>()

const minutes = ref(DEFAULT_DUNGEON_MINUTES)
const selected = ref(props.definitions[0]?.definitionId ?? '')

const CATEGORY_LABEL: Record<string, string> = { type: 'TYPE', generation: 'GENERATION', special: 'SPECIAL' }

const cards = computed(() => props.definitions.map(definition => {
  const pool = poolOf(definition).map(id => speciesById(id)?.name).filter(Boolean)
  const detail = definition.pool.kind === 'type' ? definition.pool.types.join(' / ').toUpperCase()
    : definition.pool.kind === 'generation' ? definition.pool.regions.join(' / ').toUpperCase()
      : definition.pool.label.toUpperCase()
  return {
    definition,
    detail,
    biome: THEME_LOOK[definition.theme]?.name ?? definition.theme,
    accent: THEME_LOOK[definition.theme]?.accent ?? '#6b7a99',
    sample: pool.slice(0, 5).join(' · '),
    pool: pool.length,
  }
}))

const pick = (definition: DungeonDefinition): void => { selected.value = definition.definitionId }
const enter = (definition: DungeonDefinition): void => emit('enter', definition, minutes.value)
</script>

<template>
  <div class="dc">
    <header class="dc-head">
      <h2>Entradas activas</h2>
      <p>Las Dungeons aparecen en WildLands por un rato. Cuando el reloj llega a cero, cierran.</p>
    </header>

    <div class="dc-grid">
      <article
        v-for="card in cards" :key="card.definition.definitionId"
        class="dc-card" :class="{ 'dc-card--on': selected === card.definition.definitionId }"
        :style="{ '--accent': card.accent }"
        @click="pick(card.definition)"
      >
        <div class="dc-art" :style="{ background: `linear-gradient(160deg, ${card.accent}, #121a2e 70%)` }">
          <span class="dc-tier">TIER {{ card.definition.tier }}</span>
        </div>
        <h3>{{ card.definition.name }}</h3>
        <p class="dc-tags">
          <span class="dc-cat">{{ CATEGORY_LABEL[card.definition.category] }}</span>
          <span>· {{ card.detail }}</span>
        </p>
        <p class="dc-meta">{{ card.definition.floors }} pisos · {{ card.biome }} · {{ card.pool }} especies</p>
        <p class="dc-sample">{{ card.sample }}</p>
        <button type="button" class="dc-enter" @click.stop="enter(card.definition)">ENTRAR</button>
      </article>
    </div>

    <div class="dc-row">
      <label>Duración de esta aparición
        <input v-model.number="minutes" type="number" min="1" max="240">
        <em>minutos</em>
      </label>
      <label>Jugadores simulados
        <input :value="players" type="number" min="1" max="4" @input="emit('update:players', Number(($event.target as HTMLInputElement).value))">
      </label>
    </div>
  </div>
</template>

<style scoped>
.dc { display: grid; gap: 12px; }
.dc-head h2 { margin: 0; font-size: 1.05rem; }
.dc-head p { margin: 4px 0 0; font-size: 0.78rem; color: #93a2c6; }
.dc-grid { display: grid; gap: 10px; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }
.dc-card {
  display: grid; gap: 4px; padding: 10px; cursor: pointer;
  border: 1px solid #2b3a5e; border-radius: 12px; background: #141c31;
}
.dc-card--on { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent) inset; }
.dc-art { position: relative; height: 74px; border-radius: 8px; }
.dc-tier {
  position: absolute; right: 8px; bottom: 6px; padding: 2px 8px; border-radius: 999px;
  background: rgba(8, 12, 24, 0.8); font-size: 0.66rem; font-weight: 800; letter-spacing: 0.06em;
}
.dc-card h3 { margin: 6px 0 0; font-size: 0.95rem; }
.dc-tags { margin: 0; font-size: 0.72rem; color: #93a2c6; }
.dc-cat { color: var(--accent); font-weight: 800; letter-spacing: 0.06em; }
.dc-meta { margin: 0; font-size: 0.72rem; color: #93a2c6; }
.dc-sample { margin: 0; font-size: 0.68rem; color: #6b7ba8; }
.dc-enter {
  margin-top: 6px; min-height: 44px; border: none; border-radius: 10px;
  background: #ffd27a; color: #221a06; font: inherit; font-weight: 800; cursor: pointer;
}
.dc-row { display: flex; flex-wrap: wrap; gap: 12px; font-size: 0.75rem; color: #93a2c6; }
.dc-row label { display: flex; gap: 6px; align-items: center; }
.dc-row input {
  width: 74px; padding: 6px 8px; border: 1px solid #2b3a5e; border-radius: 8px;
  background: #0f1730; color: #e8eeff; font: inherit;
}
.dc-row em { font-style: normal; }
</style>
