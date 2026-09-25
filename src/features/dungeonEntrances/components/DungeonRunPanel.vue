<template>
  <div class="dr" role="dialog" aria-label="Dungeon">
    <header class="dr-bar">
      <span class="dr-tag">DUNGEON PLAYTEST</span>
      <span class="dr-name">{{ entrance.definition.name }}</span>
      <span class="dr-warn">El progreso y las recompensas de la Dungeon pueden no persistir.</span>
      <button type="button" class="dr-close" aria-label="Salir de la Dungeon" @click="leave">Salir</button>
    </header>

    <div class="dr-body">
      <component
        :is="PlayDungeon"
        ref="runRef"
        :auto-start="{ definitionId: entrance.definition.definitionId, minutes }"
        :starting-party="party"
        :inventory="inventory"
        @exit="emit('close', $event)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { defineAsyncComponent, ref } from 'vue'
import { minutesLeft } from '../../dungeonPrototype/domain/dungeonSpawn'
import type { PokemonInstance } from '../../dungeonPrototype/domain/party'
import type { AreaEntrance } from '../domain/entranceSpawns'

// The bridge between a cave in WildLands and the approved Dungeon prototype.
//
// It deliberately says what it is. D1.2.4 is a client prototype: capture, loot
// and expedition progress live in the browser's memory and the real thing will
// be server-authoritative (DUNGEON_PROTOTYPE_INTEGRATION.md §4). A player who
// loses a run to a refresh should have been told beforehand, so the header
// tells them.
const props = defineProps<{
  entrance: AreaEntrance
  /** The party that walks in. Absent leaves the prototype on its own fixtures. */
  party?: readonly PokemonInstance[] | null
  inventory?: Readonly<Record<string, number>> | null
}>()
/** The party comes back out worn, which is what gives the Centro Pokémon a job. */
const emit = defineEmits<{ close: [party?: readonly PokemonInstance[] | null] }>()

// The expedition inherits the spawn's remaining clock, not a fresh timer:
// "if forty seven minutes are left when you walk in, forty seven minutes is
// what you get" (dungeonSpawn.ts). Rounded up so walking in never grants zero.
const minutes = Math.max(1, Math.ceil(minutesLeft(props.entrance.spawn, Date.now())))

const PlayDungeon = defineAsyncComponent(() => import('../../dungeonPrototype/components/PlayDungeon.vue'))

const runRef = ref<{ leave(): void } | null>(null)

/**
 * The header's own Salir asks the run to leave rather than closing over it.
 *
 * Closing directly worked and quietly dropped the party's wear on the floor —
 * and since this button is the exit most players will reach for, the Pokémon
 * Center was left with nothing to heal. The run hands its party back; this only
 * asks.
 */
function leave(): void {
  if (runRef.value) runRef.value.leave()
  else emit('close', null)
}
</script>

<style scoped>
.dr {
  position: fixed;
  inset: 0;
  /* Full screen: its bar and body stay clear of the notch and home indicator. */
  padding: var(--safe-top, 0px) var(--safe-right, 0px) var(--safe-bottom, 0px) var(--safe-left, 0px);
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

@media (max-width: 720px), (max-height: 500px) {
  .dr-warn { display: none; }
}
</style>
