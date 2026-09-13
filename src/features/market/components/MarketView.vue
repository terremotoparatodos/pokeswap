<template>
  <main class="market-view">
    <h2 class="market-title">Mercado</h2>

    <p v-if="isLoading" class="market-loading">Cargando listados…</p>
    <p v-else-if="error" class="market-error" role="alert">{{ error }}</p>

    <template v-else>
      <!-- Publish section (auth only) -->
      <section v-if="userId" class="market-publish">
        <h3>Publicar un Pokémon</h3>

        <p v-if="boxLoading" class="market-box-loading">Cargando tus Pokémon…</p>
        <p v-else-if="!availableToSell.length" class="market-box-empty">
          No tenés Pokémon disponibles para vender.
        </p>

        <form v-else class="market-publish-form" @submit.prevent="handlePublish">
          <select v-model="publishPokemonId" class="market-publish-select" :disabled="isPublishing">
            <option :value="null" disabled>Elegí un Pokémon</option>
            <option
              v-for="item in availableToSell"
              :key="item.slot.pokemon_id"
              :value="item.slot.pokemon_id"
            >
              {{ item.pokemon.name_es }} (⚡{{ item.slot.energy ?? 0 }})
            </option>
          </select>

          <input
            v-model.number="publishPrice"
            class="market-publish-price"
            type="number"
            min="1"
            placeholder="Precio en tokens"
            :disabled="isPublishing"
          />

          <button
            class="market-btn market-btn--publish"
            type="submit"
            :disabled="isPublishing || !publishPokemonId || publishPrice < 1"
          >
            {{ isPublishing ? '…' : 'Publicar' }}
          </button>
        </form>

        <p v-if="publishError" class="market-error market-action-error" role="alert">
          {{ publishError }}
        </p>
        <p v-if="publishSuccess" class="market-success" role="status">
          ¡Publicado! El listado ya está en el mercado.
        </p>
      </section>

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
              <td class="market-pokemon">
                <div class="market-pokemon-cell">
                  <img
                    v-if="pokemonMap.get(listing.pokemon_id)?.sprite_url"
                    :src="pokemonMap.get(listing.pokemon_id)!.sprite_url!"
                    :alt="pokemonMap.get(listing.pokemon_id)!.name_es"
                    class="market-pokemon-sprite"
                  />
                  <span>{{ pokemonMap.get(listing.pokemon_id)?.name_es ?? `#${listing.pokemon_id}` }}</span>
                </div>
              </td>
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
import { ref, computed, onMounted, watch } from 'vue'
import { useAuth } from '../../auth/composables/useAuth'
import { useMarket } from '../composables/useMarket'
import { useMyBox } from '../../progression/composables/useMyBox'
import { publish as marketPublish } from '../api/marketApi'
import { listPokemon } from '../../pokemon/api/pokemonApi'
import type { Pokemon } from '../../../shared/types/database'

const { user } = useAuth()
const { listings, isLoading, error, load, buy, cancel } = useMarket()
const { items: boxItems, isLoading: boxLoading, load: loadBox, refresh: refreshBox } = useMyBox()

const userId      = computed(() => user.value?.id ?? null)
const pendingId   = ref<string | null>(null)
const actionError = ref<string | null>(null)

const pokemonMap = ref<Map<number, Pokemon>>(new Map())

const publishPokemonId = ref<number | null>(null)
const publishPrice     = ref(0)
const isPublishing     = ref(false)
const publishError     = ref<string | null>(null)
const publishSuccess   = ref(false)

// Only unlocked slots can be listed
const availableToSell = computed(() =>
  boxItems.value.filter(item => !item.slot.is_locked),
)

onMounted(async () => {
  const [, allPokemon] = await Promise.all([load(), listPokemon()])
  pokemonMap.value = new Map(allPokemon.map(p => [p.id, p]))
  if (user.value) await loadBox(user.value.id)
})

watch(user, async (u) => {
  if (u) await loadBox(u.id)
})

async function handleBuy(listingId: string): Promise<void> {
  pendingId.value   = listingId
  actionError.value = null
  try {
    await buy(listingId)
    await refreshBox()
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
    await refreshBox()
  } catch (e) {
    actionError.value = e instanceof Error ? e.message : 'Error al cancelar'
  } finally {
    pendingId.value = null
  }
}

async function handlePublish(): Promise<void> {
  if (!publishPokemonId.value || publishPrice.value < 1) return
  isPublishing.value  = true
  publishError.value  = null
  publishSuccess.value = false
  try {
    await marketPublish(publishPokemonId.value, publishPrice.value)
    publishPokemonId.value = null
    publishPrice.value = 0
    publishSuccess.value = true
    await Promise.all([load(), refreshBox()])
  } catch (e) {
    publishError.value = e instanceof Error ? e.message : 'Error al publicar'
  } finally {
    isPublishing.value = false
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

.market-pokemon-cell {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.market-pokemon-sprite {
  width: 32px;
  height: 32px;
  image-rendering: pixelated;
  flex-shrink: 0;
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

/* Publish section */
.market-publish {
  border: 1px solid rgba(0, 0, 0, 0.1);
  border-radius: 8px;
  padding: 1rem 1.25rem;
  margin-bottom: 2rem;
  background: rgba(0, 0, 0, 0.02);
}

.market-publish h3 {
  margin: 0 0 0.75rem;
  font-size: 1rem;
}

.market-box-loading,
.market-box-empty {
  font-size: 0.875rem;
  opacity: 0.65;
}

.market-publish-form {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
  align-items: center;
}

.market-publish-select {
  padding: 0.4rem 0.6rem;
  border: 1px solid rgba(0, 0, 0, 0.2);
  border-radius: 4px;
  font-size: 0.875rem;
  flex: 1;
  min-width: 160px;
}

.market-publish-price {
  padding: 0.4rem 0.6rem;
  border: 1px solid rgba(0, 0, 0, 0.2);
  border-radius: 4px;
  font-size: 0.875rem;
  width: 140px;
}

.market-btn--publish {
  background: #e07020;
  color: #fff;
  padding: 0.4rem 1rem;
}

.market-success {
  color: #2a9d8f;
  font-size: 0.875rem;
  margin-top: 0.5rem;
}
</style>
