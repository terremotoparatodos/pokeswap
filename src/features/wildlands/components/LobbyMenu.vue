<template>
  <div class="lm">
    <div class="lm-bar">
      <button
        class="lm-toggle"
        :aria-expanded="open"
        aria-controls="lobby-menu"
        @click="emit('update:open', !open)"
      >
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 5.5h14M3 10h14M3 14.5h14" /></svg>
        Menú
      </button>
      <button v-if="inventory" type="button" class="lm-toggle lm-inventory" @click="emit('inventory')">
        🎒 Mochila
      </button>
      <span v-if="profile" class="lm-tokens" :title="`${formatTokens(profile.tokens)} tokens`">
        <span class="lm-coin" aria-hidden="true" />
        {{ formatTokens(profile.tokens) }}
        <span class="lm-sr">tokens</span>
      </span>
    </div>

    <div v-if="open" class="lm-backdrop" @click.self="emit('update:open', false)">
      <nav id="lobby-menu" ref="sheetRef" class="lm-sheet" aria-label="Menú de PokeSwap" tabindex="-1">
        <ul class="lm-list">
          <li v-for="item in items" :key="item.id">
            <button class="lm-item" @click="choose(item.id)">
              <span class="lm-item-title">{{ item.title }}</span>
              <span v-if="item.building" class="lm-item-place">{{ item.building }}</span>
            </button>
          </li>
          <li>
            <button class="lm-item lm-item--activity" @click="showActivity">
              <span class="lm-item-title">Actividad</span>
              <span class="lm-item-place">Tablón junto al Centro Pokémon</span>
            </button>
          </li>
        </ul>

        <div class="lm-session">
          <span v-if="isLoading" class="lm-muted">Cargando sesión…</span>
          <template v-else-if="profile">
            <span class="lm-user">{{ profile.username }}</span>
            <span class="lm-muted">{{ formatTokens(profile.tokens) }} tokens</span>
            <button class="lm-btn" :disabled="signingOut" @click="signOut">Salir</button>
          </template>
          <template v-else>
            <span class="lm-muted">Sin sesión</span>
            <button class="lm-btn lm-btn--primary" @click="emit('signIn')">Ingresar</button>
          </template>
        </div>
        <div class="lm-motion">
          <span>Movimiento</span>
          <button class="lm-btn" :aria-pressed="reducedMotion" @click="emit('update:reducedMotion', !reducedMotion)">
            {{ reducedMotion ? 'Reducido' : 'Completo' }}
          </button>
        </div>
      </nav>
    </div>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useAuth } from '../../auth/composables/useAuth'
import { logout } from '../../auth/api/authApi'
import { devWarn } from '../../../shared/utils/devTools'
import { HEARTHOME } from '../areas/atlas'
import { LOBBY_FEATURE_IDS, LOBBY_FEATURES, type LobbyFeature } from '../lobby/features'

// Shortcut to every PokeSwap function, plus the session. Tokens are shown read-only.
const props = withDefaults(defineProps<{ open: boolean; reducedMotion?: boolean; inventory?: boolean }>(), {
  reducedMotion: false,
  inventory: false,
})
const emit = defineEmits<{
  'update:open': [open: boolean]
  'update:reducedMotion': [reduced: boolean]
  select: [feature: LobbyFeature]
  activity: []
  inventory: []
  signIn: []
}>()

const { profile, isLoading } = useAuth()
const signingOut = ref(false)
const sheetRef = ref<HTMLElement | null>(null)

const items = LOBBY_FEATURE_IDS.map(id => ({
  id,
  title: LOBBY_FEATURES[id].title,
  building: HEARTHOME.buildings.find(b => b.feature === id)?.name ?? null,
}))

const onKeyDown = (e: KeyboardEvent) => {
  if (e.key === 'Escape' && props.open) emit('update:open', false)
}
onMounted(() => window.addEventListener('keydown', onKeyDown))
onUnmounted(() => window.removeEventListener('keydown', onKeyDown))
watch(() => props.open, open => {
  if (open) void nextTick(() => sheetRef.value?.querySelector<HTMLButtonElement>('.lm-item')?.focus())
})

function formatTokens(tokens: number | null | undefined): string {
  return (tokens ?? 0).toLocaleString('es-AR')
}

function choose(feature: LobbyFeature): void {
  emit('update:open', false)
  emit('select', feature)
}

function showActivity(): void {
  emit('update:open', false)
  emit('activity')
}

async function signOut(): Promise<void> {
  signingOut.value = true
  try {
    await logout()
    emit('update:open', false)
  } catch (error) {
    devWarn('[lobby] sign out failed', error)
  } finally {
    signingOut.value = false
  }
}
</script>

<style scoped>
.lm-bar {
  position: absolute;
  top: 1rem;
  left: 1rem;
  z-index: 5;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.lm-toggle,
.lm-tokens {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  min-height: 44px;
  padding: 0 1rem;
  border: 2px solid #3a5fb8;
  border-radius: 999px;
  background: rgba(16, 26, 54, 0.92);
  color: #fff;
  font: inherit;
  font-size: 0.95rem;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.35);
}
.lm-toggle {
  cursor: pointer;
  font-weight: 600;
}
.lm-toggle:hover,
.lm-toggle[aria-expanded='true'] {
  background: #1d2c58;
}
.lm-inventory { border-color: #d79b32; color: #ffe0a0; }
.lm-toggle svg {
  width: 18px;
  height: 18px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
}
.lm-tokens {
  padding: 0 0.85rem;
  color: #ffd27a;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.lm-coin {
  width: 12px;
  height: 12px;
  border: 2px solid #b8862b;
  border-radius: 50%;
  background: #ffd27a;
}
.lm-sr {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}

.lm-backdrop {
  position: absolute;
  inset: 0;
  z-index: 15;
}

.lm-sheet {
  position: absolute;
  top: 4.25rem;
  left: 1rem;
  width: 280px;
  max-height: calc(100% - 5.5rem);
  overflow-y: auto;
  border: 2px solid #3a5fb8;
  border-radius: 14px;
  background: rgba(16, 26, 54, 0.97);
  color: #fff;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45);
}

.lm-list {
  margin: 0;
  padding: 0.4rem;
  list-style: none;
}
.lm-item {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.75rem;
  width: 100%;
  min-height: 44px;
  padding: 0.55rem 0.8rem;
  border: 0;
  border-radius: 10px;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.lm-item:hover,
.lm-item:focus-visible {
  background: rgba(159, 192, 255, 0.14);
}
.lm-item-title {
  font-weight: 600;
}
.lm-item-place {
  color: #9fb2da;
  font-size: 0.8rem;
}

.lm-session {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35rem 0.75rem;
  padding: 0.75rem 1.2rem 0.9rem;
  border-top: 1px solid rgba(255, 255, 255, 0.15);
}
.lm-motion {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.55rem 1.2rem 0.9rem;
  color: #9fb2da;
  font-size: 0.85rem;
}
.lm-motion .lm-btn { margin-left: 0; }
.lm-user {
  font-weight: 700;
}
.lm-muted {
  color: #9fb2da;
  font-size: 0.85rem;
}
.lm-btn {
  min-height: 36px;
  margin-left: auto;
  padding: 0 0.95rem;
  border: 1px solid rgba(255, 255, 255, 0.4);
  border-radius: 8px;
  background: transparent;
  color: #fff;
  font: inherit;
  font-size: 0.85rem;
  cursor: pointer;
}
.lm-btn--primary {
  border-color: #ffd27a;
  background: #ffd27a;
  color: #101a36;
  font-weight: 700;
}
.lm-btn:disabled {
  opacity: 0.5;
}

@media (max-width: 720px) {
  .lm-bar {
    top: 0.75rem;
    left: 0.75rem;
  }
  .lm-toggle,
  .lm-tokens {
    font-size: 0.85rem;
  }
  .lm-toggle { padding: 0 0.75rem; }
  .lm-inventory { font-size: 0.8rem; }
  .lm-sheet {
    top: auto;
    right: 0;
    bottom: 0;
    left: 0;
    width: auto;
    max-height: 80dvh;
    border-width: 2px 0 0;
    border-radius: 18px 18px 0 0;
    padding-bottom: env(safe-area-inset-bottom);
  }
  .lm-backdrop {
    background: rgba(8, 12, 28, 0.35);
  }
}
</style>
