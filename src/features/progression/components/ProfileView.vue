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

      <!-- My Pokémon (Box) -->
      <section class="profile-box">
        <h3>Mis Pokémon</h3>

        <p v-if="boxLoading" class="profile-box-loading">Cargando…</p>
        <p v-else-if="boxError" class="profile-error" role="alert">{{ boxError }}</p>
        <p v-else-if="!boxItems.length" class="profile-box-empty">
          Todavía no tenés ningún Pokémon. ¡Hacé un swap!
        </p>

        <ul v-else class="profile-box-grid">
          <li
            v-for="item in boxItems"
            :key="item.slot.pokemon_id"
            class="profile-box-card"
            :class="{ 'profile-box-card--locked': item.slot.is_locked }"
          >
            <img
              v-if="item.pokemon.sprite_url"
              :src="item.pokemon.sprite_url"
              :alt="item.pokemon.name_es"
              class="profile-box-sprite"
            />
            <div v-else class="profile-box-sprite profile-box-sprite--placeholder">
              #{{ item.pokemon.id }}
            </div>

            <p class="profile-box-name">{{ item.pokemon.name_es }}</p>

            <div class="profile-box-types">
              <span class="profile-box-type">{{ item.pokemon.type1 }}</span>
              <span v-if="item.pokemon.type2" class="profile-box-type">{{ item.pokemon.type2 }}</span>
            </div>

            <p class="profile-box-energy">⚡ {{ item.slot.energy ?? 0 }}</p>

            <p v-if="item.slot.is_locked" class="profile-box-locked">En el mercado</p>

            <template v-else>
              <!-- Inline publish form -->
              <template v-if="publishingId === item.slot.pokemon_id">
                <input
                  v-model.number="publishPrice"
                  class="profile-box-price-input"
                  type="number"
                  min="1"
                  placeholder="Precio (tokens)"
                  :disabled="isPublishing"
                />
                <div class="profile-box-publish-actions">
                  <button
                    class="profile-box-btn profile-box-btn--confirm"
                    :disabled="isPublishing || publishPrice < 1"
                    @click="handlePublish(item.slot.pokemon_id)"
                  >
                    {{ isPublishing ? '…' : 'Publicar' }}
                  </button>
                  <button
                    class="profile-box-btn profile-box-btn--cancel"
                    :disabled="isPublishing"
                    @click="publishingId = null"
                  >
                    Cancelar
                  </button>
                </div>
                <p v-if="publishError" class="profile-error" role="alert">{{ publishError }}</p>
              </template>

              <button
                v-else
                class="profile-box-btn profile-box-btn--sell"
                @click="startPublish(item.slot.pokemon_id)"
              >
                Vender
              </button>
            </template>
          </li>
        </ul>
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
import { ref, computed, onMounted, watch } from 'vue'
import { useAuth } from '../../auth/composables/useAuth'
import { collectPassiveTokens, getTokenLedger } from '../api/progressionApi'
import { useMyBox } from '../composables/useMyBox'
import { publish as marketPublish } from '../../market/api/marketApi'
import type { TokenLedgerEntry } from '../../../shared/types/database'

const { user, profile, isLoading } = useAuth()
const { items: boxItems, isLoading: boxLoading, error: boxError, load: loadBox, refresh: refreshBox } = useMyBox()

const isCollecting = ref(false)
const lastDelta    = ref<number | null>(null)
const collectError = ref<string | null>(null)

const ledger        = ref<TokenLedgerEntry[]>([])
const ledgerLoading = ref(false)

const publishingId  = ref<number | null>(null)
const publishPrice  = ref(0)
const isPublishing  = ref(false)
const publishError  = ref<string | null>(null)

const _balanceDelta = ref(0)
const displayTokens = computed(() => (profile.value?.tokens ?? 0) + _balanceDelta.value)

onMounted(async () => {
  if (user.value) {
    await Promise.all([loadLedger(), loadBox(user.value.id)])
  }
})

watch(user, async (u) => {
  if (u) await Promise.all([loadLedger(), loadBox(u.id)])
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
    _balanceDelta.value = new_balance - (profile.value?.tokens ?? 0)
    await loadLedger()
  } catch (e) {
    collectError.value = e instanceof Error ? e.message : 'Error al recolectar tokens'
  } finally {
    isCollecting.value = false
  }
}

function startPublish(pokemonId: number): void {
  publishingId.value = pokemonId
  publishPrice.value = 0
  publishError.value = null
}

async function handlePublish(pokemonId: number): Promise<void> {
  if (publishPrice.value < 1) return
  isPublishing.value = true
  publishError.value = null
  try {
    await marketPublish(pokemonId, publishPrice.value)
    publishingId.value = null
    await refreshBox()
  } catch (e) {
    publishError.value = e instanceof Error ? e.message : 'Error al publicar'
  } finally {
    isPublishing.value = false
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
  max-width: 700px;
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

/* Box */
.profile-box {
  margin-bottom: 2.5rem;
}

.profile-box h3 {
  margin-bottom: 1rem;
}

.profile-box-loading,
.profile-box-empty {
  opacity: 0.65;
  font-size: 0.9rem;
}

.profile-box-grid {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
  gap: 0.75rem;
}

.profile-box-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.3rem;
  padding: 0.75rem 0.5rem;
  border: 1px solid rgba(0, 0, 0, 0.1);
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.03);
  text-align: center;
}

.profile-box-card--locked {
  opacity: 0.6;
}

.profile-box-sprite {
  width: 64px;
  height: 64px;
  image-rendering: pixelated;
}

.profile-box-sprite--placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.75rem;
  opacity: 0.5;
}

.profile-box-name {
  font-size: 0.8rem;
  font-weight: 600;
  margin: 0;
}

.profile-box-types {
  display: flex;
  gap: 0.25rem;
  flex-wrap: wrap;
  justify-content: center;
}

.profile-box-type {
  font-size: 0.65rem;
  padding: 1px 5px;
  border-radius: 3px;
  background: rgba(0, 0, 0, 0.12);
  text-transform: capitalize;
}

.profile-box-energy {
  font-size: 0.75rem;
  opacity: 0.7;
  margin: 0;
}

.profile-box-locked {
  font-size: 0.7rem;
  opacity: 0.7;
  font-style: italic;
  margin: 0;
}

.profile-box-price-input {
  width: 100%;
  padding: 0.3rem 0.4rem;
  font-size: 0.8rem;
  border: 1px solid rgba(0, 0, 0, 0.2);
  border-radius: 4px;
  text-align: center;
}

.profile-box-publish-actions {
  display: flex;
  gap: 0.25rem;
  width: 100%;
}

.profile-box-btn {
  font-size: 0.75rem;
  padding: 0.35rem 0.5rem;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  flex: 1;
}

.profile-box-btn--sell {
  background: #e07020;
  color: #fff;
  width: 100%;
  flex: none;
}

.profile-box-btn--confirm {
  background: #2a9d8f;
  color: #fff;
}

.profile-box-btn--cancel {
  background: rgba(0, 0, 0, 0.1);
}

.profile-box-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Ledger */
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
