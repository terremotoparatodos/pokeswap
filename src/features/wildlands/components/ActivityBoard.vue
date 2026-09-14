<template>
  <LobbyPanel title="Tablón de actividad" @close="emit('close')">
    <div class="ab">
      <p class="ab-status" :class="{ 'ab-status--live': connected }">
        {{ connected ? '● En vivo' : '○ Conectando…' }}
      </p>
      <p v-if="loadError" class="ab-empty" role="alert">No se pudo leer la actividad. Probá de nuevo en un rato.</p>
      <p v-else-if="!entries.length" class="ab-empty">Todavía no hay novedades.</p>
      <ul v-else class="ab-list">
        <li v-for="entry in entries" :key="entry.id" class="ab-item">
          <span class="ab-label">{{ entry.label }}</span>
          <span class="ab-pokemon">{{ entry.pokemon ?? 'PokeSwap' }}</span>
          <span class="ab-when">{{ entry.when }}</span>
        </li>
      </ul>
    </div>
  </LobbyPanel>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import type { BoardEntry } from '../lobby/plazaNotices'
import LobbyPanel from './LobbyPanel.vue'

// The board next to the Pokémon Center: recent activity_feed rows, read-only.
defineProps<{ entries: readonly BoardEntry[]; connected: boolean; loadError: boolean }>()
const emit = defineEmits<{ close: [] }>()

const onKeyDown = (e: KeyboardEvent) => {
  if (e.key === 'Escape') emit('close')
}
onMounted(() => window.addEventListener('keydown', onKeyDown))
onUnmounted(() => window.removeEventListener('keydown', onKeyDown))
</script>

<style scoped>
.ab {
  max-width: 520px;
  margin: 0 auto;
  padding: 0.75rem 1.25rem 0;
}

.ab-status {
  margin: 0 0 0.5rem;
  color: #6b7280;
  font-size: 0.8rem;
}
.ab-status--live {
  color: #2a9d8f;
}

.ab-empty {
  margin: 1.5rem 0;
  color: #6b7280;
  text-align: center;
}

.ab-list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.ab-item {
  display: flex;
  align-items: baseline;
  gap: 0.6rem;
  min-height: 44px;
  padding: 0.55rem 0;
  border-bottom: 1px solid #e5e7f0;
}

.ab-label {
  color: #c2410c;
  font-weight: 600;
}

.ab-pokemon {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ab-when {
  color: #6b7280;
  font-size: 0.8rem;
  white-space: nowrap;
}
</style>
