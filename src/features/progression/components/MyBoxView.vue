<template>
  <main class="box-view">
    <h2 class="box-title">Mi caja</h2>

    <p v-if="!user" class="box-unauth">
      Iniciá sesión para ver tus Pokémon.
    </p>

    <template v-else>
      <PlayerIdentitySection
        :user-id="user.id"
        :items="boxItems"
        :loading="boxLoading"
        :error="boxError"
      />

      <section class="profile-box">
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
    </template>
  </main>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { useAuth } from '../../auth/composables/useAuth'
import { useMyBox } from '../composables/useMyBox'
import { publish as marketPublish } from '../../market/api/marketApi'
import PlayerIdentitySection from '../../wildlands/components/PlayerIdentitySection.vue'

const { user } = useAuth()
const { items: boxItems, isLoading: boxLoading, error: boxError, load: loadBox, refresh: refreshBox } = useMyBox()

const publishingId  = ref<number | null>(null)
const publishPrice  = ref(0)
const isPublishing  = ref(false)
const publishError  = ref<string | null>(null)

onMounted(async () => {
  if (user.value) await loadBox(user.value.id)
})

watch(user, async (u) => {
  if (u) await loadBox(u.id)
})

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
</script>

<style scoped>
.box-view {
  max-width: 700px;
  margin: 2rem auto;
  padding: 0 1rem;
}

.box-title {
  margin-bottom: 1.5rem;
}

.box-unauth {
  opacity: 0.7;
}

.profile-error {
  color: #e63946;
  font-size: 0.875rem;
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
</style>
