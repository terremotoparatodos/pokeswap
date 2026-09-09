<template>
  <main class="profile-view">
    <h2 class="profile-title">Perfil</h2>

    <p v-if="!user" class="profile-unauth">
      Iniciá sesión para ver tu perfil.
    </p>

    <template v-else-if="profile">
      <!-- Stats -->
      <section class="profile-stats">
        <div class="profile-stat">
          <span class="profile-stat-label">Usuario</span>
          <span class="profile-stat-value">{{ profile.username }}</span>
        </div>
        <div class="profile-stat">
          <span class="profile-stat-label">Tokens</span>
          <span class="profile-stat-value profile-stat-tokens">
            {{ displayTokens.toLocaleString('es-AR') }}
          </span>
        </div>
      </section>

      <!-- Collect passive tokens -->
      <section class="profile-collect">
        <button
          class="profile-btn"
          :disabled="isCollecting"
          @click="handleCollect"
        >
          {{ isCollecting ? 'Recolectando…' : 'Recolectar tokens pasivos' }}
        </button>
        <p v-if="lastDelta !== null" class="profile-collect-msg" role="status">
          {{ lastDelta > 0 ? `+${lastDelta.toLocaleString('es-AR')} tokens` : 'Sin tokens nuevos todavía' }}
        </p>
        <p v-if="collectError" class="profile-error" role="alert">{{ collectError }}</p>
      </section>

      <!-- Token ledger -->
      <section class="profile-ledger">
        <h3>Últimas transacciones</h3>
        <p v-if="ledgerLoading">Cargando…</p>
        <ul v-else-if="ledger.length" class="profile-ledger-list">
          <li
            v-for="entry in ledger"
            :key="entry.id"
            class="profile-ledger-item"
          >
            <span
              class="profile-ledger-amount"
              :class="entry.amount >= 0 ? 'positive' : 'negative'"
            >
              {{ entry.amount >= 0 ? '+' : '' }}{{ entry.amount.toLocaleString('es-AR') }}
            </span>
            <span class="profile-ledger-reason">{{ entry.reason }}</span>
            <time class="profile-ledger-date">{{ formatDate(entry.created_at) }}</time>
          </li>
        </ul>
        <p v-else>No hay transacciones todavía.</p>
      </section>
    </template>

    <p v-else-if="isLoading">Cargando perfil…</p>
  </main>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useAuth } from '../../auth/composables/useAuth'
import { collectPassiveTokens, getTokenLedger } from '../api/progressionApi'
import type { TokenLedgerEntry } from '../../../shared/types/database'

const { user, profile, isLoading } = useAuth()

const isCollecting = ref(false)
const lastDelta    = ref<number | null>(null)
const collectError = ref<string | null>(null)

const ledger        = ref<TokenLedgerEntry[]>([])
const ledgerLoading = ref(false)

// Reflect the balance update from the collect response without a full profile reload.
const _balanceDelta = ref(0)
const displayTokens = computed(() => (profile.value?.tokens ?? 0) + _balanceDelta.value)

onMounted(async () => {
  if (user.value) await loadLedger()
})

async function loadLedger(): Promise<void> {
  ledgerLoading.value = true
  try {
    const all = await getTokenLedger()
    ledger.value = all.slice(0, 20)
  } catch {
    // Non-critical — show empty list
  } finally {
    ledgerLoading.value = false
  }
}

async function handleCollect(): Promise<void> {
  isCollecting.value = true
  collectError.value = null
  lastDelta.value = null
  try {
    const { delta, new_balance } = await collectPassiveTokens()
    lastDelta.value = delta
    // Patch display balance until next auth refresh
    _balanceDelta.value = new_balance - (profile.value?.tokens ?? 0)
    await loadLedger()
  } catch (e) {
    collectError.value = e instanceof Error ? e.message : 'Error al recolectar tokens'
  } finally {
    isCollecting.value = false
  }
}

function formatDate(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleString('es-AR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}
</script>

<style scoped>
.profile-view {
  max-width: 600px;
  margin: 2rem auto;
  padding: 0 1rem;
}

.profile-title {
  margin-bottom: 1.5rem;
}

.profile-unauth {
  opacity: 0.7;
}

.profile-stats {
  display: flex;
  gap: 2rem;
  margin-bottom: 2rem;
}

.profile-stat {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.profile-stat-label {
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  opacity: 0.55;
}

.profile-stat-value {
  font-size: 1.4rem;
  font-weight: 700;
}

.profile-stat-tokens {
  color: #f4a261;
}

.profile-collect {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.6rem;
  margin-bottom: 2rem;
}

.profile-btn {
  padding: 0.6rem 1.25rem;
  font-size: 0.95rem;
  font-weight: 600;
  border: none;
  border-radius: 6px;
  background: #457b9d;
  color: #fff;
  cursor: pointer;
}

.profile-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.profile-collect-msg {
  font-size: 0.9rem;
  color: #f4a261;
}

.profile-error {
  color: #e63946;
  font-size: 0.875rem;
}

.profile-ledger h3 {
  margin-bottom: 0.75rem;
}

.profile-ledger-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
}

.profile-ledger-item {
  display: grid;
  grid-template-columns: 6rem 1fr auto;
  align-items: center;
  gap: 0.5rem;
  padding: 0.35rem 0;
  border-bottom: 1px solid rgba(0, 0, 0, 0.07);
  font-size: 0.875rem;
}

.profile-ledger-amount {
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.profile-ledger-amount.positive { color: #2a9d8f; }
.profile-ledger-amount.negative { color: #e63946; }

.profile-ledger-reason {
  opacity: 0.75;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.profile-ledger-date {
  opacity: 0.45;
  font-size: 0.78rem;
  white-space: nowrap;
}
</style>
