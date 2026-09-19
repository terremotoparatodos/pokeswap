<template>
  <div class="dr" role="dialog" aria-label="Dungeon">
    <header class="dr-bar">
      <span class="dr-tag">DUNGEON PLAYTEST</span>
      <span class="dr-name">{{ entrance.definition.name }}</span>
      <span class="dr-warn">El progreso y las recompensas de la Dungeon pueden no persistir.</span>
      <button type="button" class="dr-close" aria-label="Salir de la Dungeon" @click="emit('close')">Salir</button>
    </header>

    <div class="dr-body">
      <component
        :is="PlayDungeon"
        :auto-start="{ definitionId: entrance.definition.definitionId, minutes }"
        @exit="emit('close')"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { defineAsyncComponent } from 'vue'
import { minutesLeft } from '../../dungeonPrototype/domain/dungeonSpawn'
import type { AreaEntrance } from '../domain/entranceSpawns'

// The bridge between a cave in WildLands and the approved Dungeon prototype.
//
// It deliberately says what it is. D1.2.4 is a client prototype: capture, loot
// and expedition progress live in the browser's memory and the real thing will
// be server-authoritative (DUNGEON_PROTOTYPE_INTEGRATION.md §4). A player who
// loses a run to a refresh should have been told beforehand, so the header
// tells them.
const props = defineProps<{ entrance: AreaEntrance }>()
const emit = defineEmits<{ close: [] }>()

// The expedition inherits the spawn's remaining clock, not a fresh timer:
// "if forty seven minutes are left when you walk in, forty seven minutes is
// what you get" (dungeonSpawn.ts). Rounded up so walking in never grants zero.
const minutes = Math.max(1, Math.ceil(minutesLeft(props.entrance.spawn, Date.now())))

const PlayDungeon = defineAsyncComponent(() => import('../../dungeonPrototype/components/PlayDungeon.vue'))
</script>

<style scoped>
.dr {
  position: fixed;
  inset: 0;
  z-index: 40;
  display: flex;
  flex-direction: column;
  background: #05070c;
  font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
}

.dr-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  padding: 0.45rem 0.7rem;
  border-bottom: 2px solid #3a5fb8;
  background: #101a36;
  color: #dfe8ff;
  font-size: 0.78rem;
}
.dr-tag {
  padding: 0.1rem 0.4rem;
  border-radius: 5px;
  background: #f0b429;
  color: #101a36;
  font-size: 0.68rem;
  font-weight: 800;
  letter-spacing: 0.05em;
}
.dr-name { font-weight: 700; }
.dr-warn { flex: 1 1 12rem; opacity: 0.6; font-size: 0.72rem; }
.dr-close {
  min-height: 34px;
  padding: 0 0.8rem;
  border: 2px solid #3a5fb8;
  border-radius: 8px;
  background: transparent;
  color: #dfe8ff;
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}

.dr-body { position: relative; flex: 1; min-height: 0; overflow: hidden; }

@media (max-width: 720px) {
  .dr-warn { display: none; }
}
</style>
