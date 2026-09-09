<template>
  <main class="market-view">
    <h2 class="market-title">Mercado</h2>

    <p v-if="isLoading" class="market-loading">Cargando listados…</p>
    <p v-else-if="error" class="market-error" role="alert">{{ error }}</p>

    <template v-else>
      <p v-if="!listings.length" class="market-empty">
        No hay listados activos en este momento.
      </p>

      <div v-else class="market-table-wrap">
        <table class="market-table">
          <thead>
            <tr>
              <th>Pokémon</th>
              <th>Vendedor</th>
              <th>Precio</th>
              <th>Vence</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="listing in listings" :key="listing.id" class="market-row">
              <td class="market-pokemon">#{{ listing.pokemon_id }}</td>
              <td class="market-seller">{{ listing.seller_username }}</td>
              <td class="market-price">{{ listing.price_tokens.toLocaleString('es-AR') }} tokens</td>
              <td class="market-expires">{{ formatDate(listing.expires_at) }}</td>
              <td class="market-actions">
                <!-- Own listing: cancel -->
                <button
                  v-if="listing.seller_id === userId"
                  class="market-btn market-btn--cancel"
                  :disabled="pendingId === listing.id"
                  @click="handleCancel(listing.id)"
                >
                  {{ pendingId === listing.id ? '…' : 'Cancelar' }}
                </button>

                <!-- Other listing: buy (auth required) -->
                <template v-else>
                  <button
                    v-if="userId"
                    class="market-btn market-btn--buy"
                    :disabled="pendingId === listing.id"
                    @click="handleBuy(listing.id)"
                  >
                    {{ pendingId === listing.id ? '…' : 'Comprar' }}
                  </button>
                  <span v-else class="market-auth-hint">Iniciá sesión</span>
                </template>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <p v-if="actionError" class="market-error market-action-error" role="alert">
        {{ actionError }}
      </p>
    </template>
  </main>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useAuth } from '../../auth/composables/useAuth'
import { useMarket } from '../composables/useMarket'

const { user } = useAuth()
const { listings, isLoading, error, load, buy, cancel } = useMarket()

const userId     = computed(() => user.value?.id ?? null)
const pendingId  = ref<string | null>(null)
const actionError = ref<string | null>(null)

onMounted(load)

async function handleBuy(listingId: string): Promise<void> {
  pendingId.value   = listingId
  actionError.value = null
  try {
    await buy(listingId)
  } catch (e) {
    actionError.value = e instanceof Error ? e.message : 'Error al comprar'
  } finally {
    pendingId.value = null
  }
}

async function handleCancel(listingId: string): Promise<void> {
  pendingId.value   = listingId
  actionError.value = null
  try {
    await cancel(listingId)
  } catch (e) {
    actionError.value = e instanceof Error ? e.message : 'Error al cancelar'
  } finally {
    pendingId.value = null
  }
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('es-AR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}
</script>

<style scoped>
.market-view {
  max-width: 800px;
  margin: 2rem auto;
  padding: 0 1rem;
}

.market-title {
  margin-bottom: 1.5rem;
}

.market-loading,
.market-empty {
  opacity: 0.65;
}

.market-error {
  color: #e63946;
  font-size: 0.875rem;
}

.market-action-error {
  margin-top: 0.75rem;
}

.market-table-wrap {
  overflow-x: auto;
}

.market-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.9rem;
}

.market-table th {
  text-align: left;
  padding: 0.5rem 0.75rem;
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  opacity: 0.55;
  border-bottom: 1px solid rgba(0, 0, 0, 0.1);
}

.market-row td {
  padding: 0.6rem 0.75rem;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
  vertical-align: middle;
}

.market-pokemon {
  font-weight: 600;
}

.market-price {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.market-expires {
  opacity: 0.55;
  white-space: nowrap;
  font-size: 0.8rem;
}

.market-actions {
  text-align: right;
  white-space: nowrap;
}

.market-btn {
  padding: 0.3rem 0.8rem;
  font-size: 0.82rem;
  font-weight: 600;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

.market-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.market-btn--buy {
  background: #2a9d8f;
  color: #fff;
}

.market-btn--cancel {
  background: transparent;
  border: 1px solid currentColor;
  color: inherit;
  font-weight: 400;
}

.market-auth-hint {
  font-size: 0.8rem;
  opacity: 0.5;
}
</style>
