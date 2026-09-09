<template>
  <main class="swap-view">
    <h2 class="swap-title">PokeSwap</h2>

    <p v-if="!user" class="swap-unauth">
      Iniciá sesión para hacer un swap.
    </p>

    <template v-else>
      <!-- Action -->
      <section class="swap-action">
        <template v-if="!canSwap">
          <p class="swap-cooldown-msg" aria-live="polite">
            Cooldown: <strong>{{ formattedCooldown }}</strong>
          </p>
          <button
            class="swap-btn swap-btn--skip"
            :disabled="isSkipping"
            @click="handleSkip"
          >
            {{ isSkipping ? 'Procesando…' : 'Saltar cooldown (1.000 tokens)' }}
          </button>
        </template>

        <button
          v-else
          class="swap-btn"
          :disabled="isSwapping"
          @click="handleSwap"
        >
          {{ isSwapping ? 'Swapping…' : '¡Hacer Swap!' }}
        </button>

        <p v-if="swapError" class="swap-error" role="alert">{{ swapError }}</p>
      </section>

      <!-- Last result -->
      <section v-if="lastResult" class="swap-result">
        <h3>Último resultado</h3>
        <p>Entregaste: <strong>#{{ lastResult.pokemon_given_id }}</strong></p>
        <p>
          Recibiste: <strong>#{{ lastResult.pokemon_received_id }}</strong>
          <span v-if="lastResult.was_shiny" class="swap-shiny"> ✨ ¡Shiny!</span>
        </p>
        <p>Rareza: <span class="swap-rarity">{{ lastResult.rarity }}</span></p>
      </section>

      <!-- History -->
      <section class="swap-history">
        <h3>Historial</h3>
        <p v-if="historyLoading">Cargando…</p>
        <ul v-else-if="history.length" class="swap-history-list">
          <li v-for="entry in history" :key="entry.id" class="swap-history-item">
            <span class="swap-history-trade">
              #{{ entry.pokemon_given_id }} → #{{ entry.pokemon_received_id }}
              <span v-if="entry.was_shiny" class="swap-shiny"> ✨</span>
            </span>
            <time class="swap-history-date">{{ formatDate(entry.created_at) }}</time>
          </li>
        </ul>
        <p v-else>No hay swaps todavía.</p>
      </section>
    </template>
  </main>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useAuth } from '../../auth/composables/useAuth'
import { useSwap } from '../composables/useSwap'
import type { SwapResult } from '../api/swapApi'

const { user, profile } = useAuth()
const {
  canSwap,
  secondsRemaining,
  isSwapping,
  history,
  historyLoading,
  syncCooldown,
  executeSwap,
  skipCooldown,
  loadHistory,
} = useSwap()

const lastResult = ref<SwapResult | null>(null)
const swapError  = ref<string | null>(null)
const isSkipping = ref(false)

// Sync cooldown from profile so the composable starts accurate without an
// extra network call (as documented in useSwap consumers note).
watch(profile, (p) => syncCooldown(p?.swap_cooldown_until ?? null), { immediate: true })

// Tick every second so formattedCooldown re-evaluates while on cooldown.
const _tick = ref(0)
let _timer: ReturnType<typeof setInterval> | null = null

onMounted(() => {
  _timer = setInterval(() => { _tick.value++ }, 1000)
  loadHistory()
})
onUnmounted(() => { if (_timer) clearInterval(_timer) })

const formattedCooldown = computed(() => {
  _tick.value // reactive dependency — forces re-evaluation each second
  const s = secondsRemaining.value
  if (s <= 0) return '0s'
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h) return `${h}h ${m}m`
  if (m) return `${m}m ${sec}s`
  return `${sec}s`
})

function formatDate(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleString('es-AR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}

async function handleSwap(): Promise<void> {
  swapError.value = null
  try {
    lastResult.value = await executeSwap()
    await loadHistory()
  } catch (e) {
    swapError.value = e instanceof Error ? e.message : 'Error al hacer swap'
  }
}

async function handleSkip(): Promise<void> {
  isSkipping.value = true
  swapError.value = null
  try {
    await skipCooldown()
  } catch (e) {
    swapError.value = e instanceof Error ? e.message : 'Error al saltar cooldown'
  } finally {
    isSkipping.value = false
  }
}
</script>

<style scoped>
.swap-view {
  max-width: 600px;
  margin: 2rem auto;
  padding: 0 1rem;
}

.swap-title {
  margin-bottom: 1.5rem;
}

.swap-unauth {
  opacity: 0.7;
}

.swap-action {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.75rem;
  margin-bottom: 2rem;
}

.swap-btn {
  padding: 0.6rem 1.5rem;
  font-size: 1rem;
  font-weight: 600;
  border: none;
  border-radius: 6px;
  background: #e63946;
  color: #fff;
  cursor: pointer;
}

.swap-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.swap-btn--skip {
  background: transparent;
  border: 1px solid currentColor;
  color: inherit;
  font-weight: 400;
  font-size: 0.875rem;
}

.swap-cooldown-msg {
  font-size: 0.95rem;
}

.swap-error {
  color: #e63946;
  font-size: 0.875rem;
}

.swap-result {
  background: rgba(0, 0, 0, 0.05);
  border-radius: 8px;
  padding: 1rem 1.25rem;
  margin-bottom: 2rem;
}

.swap-result h3 {
  margin-top: 0;
  margin-bottom: 0.5rem;
}

.swap-shiny {
  color: #f4a261;
}

.swap-rarity {
  text-transform: capitalize;
}

.swap-history h3 {
  margin-bottom: 0.75rem;
}

.swap-history-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.swap-history-item {
  display: flex;
  justify-content: space-between;
  font-size: 0.9rem;
  padding: 0.3rem 0;
  border-bottom: 1px solid rgba(0, 0, 0, 0.08);
}

.swap-history-date {
  opacity: 0.5;
  font-size: 0.8rem;
}
</style>
