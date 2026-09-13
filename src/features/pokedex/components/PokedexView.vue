<template>
  <main class="pokedex-view">
    <h2 class="pokedex-title">Pokédex</h2>

    <p v-if="!user" class="pokedex-unauth">
      Iniciá sesión para ver tu Pokédex.
    </p>

    <template v-else>
      <p v-if="isLoading" class="pokedex-loading">Cargando…</p>
      <p v-else-if="loadError" class="pokedex-error" role="alert">{{ loadError }}</p>

      <template v-else>
        <p class="pokedex-count">
          <strong>{{ registered.length }}</strong>
          Pokémon registrados
        </p>

        <div v-if="registered.length" class="pokedex-grid">
          <article
            v-for="entry in registered"
            :key="entry.pokemon.id"
            class="pokedex-card"
          >
            <img
              v-if="entry.pokemon.sprite_url"
              :src="entry.pokemon.sprite_url"
              :alt="entry.pokemon.name_es"
              class="pokedex-sprite"
              loading="lazy"
            />
            <div v-else class="pokedex-sprite pokedex-sprite--placeholder">
              #{{ entry.pokemon.id }}
            </div>

            <p class="pokedex-name">{{ entry.pokemon.name_es }}</p>

            <div class="pokedex-types">
              <span class="pokedex-type" :class="`type--${entry.pokemon.type1}`">
                {{ entry.pokemon.type1 }}
              </span>
              <span
                v-if="entry.pokemon.type2"
                class="pokedex-type"
                :class="`type--${entry.pokemon.type2}`"
              >
                {{ entry.pokemon.type2 }}
              </span>
            </div>

            <time class="pokedex-date">{{ formatDate(entry.registeredAt) }}</time>
          </article>
        </div>

        <p v-else class="pokedex-empty">
          Todavía no registraste ningún Pokémon. ¡Hacé un swap!
        </p>
      </template>
    </template>
  </main>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useAuth } from '../../auth/composables/useAuth'
import { loadPokedexEntries } from '../api/pokedexApi'
import { listPokemon } from '../../pokemon/api/pokemonApi'
import type { Pokemon, PokedexEntry } from '../../../shared/types/database'

const { user } = useAuth()

const entries    = ref<PokedexEntry[]>([])
const pokemon    = ref<Pokemon[]>([])
const isLoading  = ref(false)
const loadError  = ref<string | null>(null)

const registered = computed(() => {
  const idToEntry = new Map(entries.value.map((e) => [e.pokemon_id, e]))
  return pokemon.value
    .filter((p) => idToEntry.has(p.id))
    .map((p) => ({ pokemon: p, registeredAt: idToEntry.get(p.id)!.registered_at }))
})

onMounted(async () => {
  if (!user.value) return
  isLoading.value = true
  loadError.value = null
  try {
    ;[entries.value, pokemon.value] = await Promise.all([
      loadPokedexEntries(user.value.id),
      listPokemon(),
    ])
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : 'Error al cargar la Pokédex'
  } finally {
    isLoading.value = false
  }
})

function formatDate(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('es-AR', {
    day: '2-digit', month: '2-digit', year: '2-digit',
  })
}
</script>

<style scoped>
.pokedex-view {
  max-width: 900px;
  margin: 2rem auto;
  padding: 0 1rem;
}

.pokedex-title {
  margin-bottom: 1rem;
}

.pokedex-unauth,
.pokedex-loading,
.pokedex-empty {
  opacity: 0.65;
}

.pokedex-error {
  color: #e63946;
  font-size: 0.875rem;
}

.pokedex-count {
  margin-bottom: 1.25rem;
  font-size: 0.9rem;
  opacity: 0.7;
}

.pokedex-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 0.75rem;
}

.pokedex-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.3rem;
  padding: 0.75rem 0.5rem;
  border-radius: 8px;
  border: 1px solid rgba(0, 0, 0, 0.08);
  background: rgba(0, 0, 0, 0.02);
  text-align: center;
}

.pokedex-sprite {
  width: 64px;
  height: 64px;
  object-fit: contain;
  image-rendering: pixelated;
}

.pokedex-sprite--placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.75rem;
  opacity: 0.4;
  border: 1px dashed rgba(0,0,0,0.2);
  border-radius: 4px;
}

.pokedex-name {
  font-size: 0.8rem;
  font-weight: 600;
  text-transform: capitalize;
  margin: 0;
}

.pokedex-types {
  display: flex;
  gap: 0.25rem;
  flex-wrap: wrap;
  justify-content: center;
}

.pokedex-type {
  font-size: 0.65rem;
  padding: 0.1rem 0.4rem;
  border-radius: 3px;
  text-transform: capitalize;
  color: #fff;
  background: #888;
}

/* Type colors — mirrors Pokémon type palette */
.type--fire    { background: #f08030; }
.type--water   { background: #6890f0; }
.type--grass   { background: #78c850; }
.type--electric{ background: #f8d030; color: #333; }
.type--psychic { background: #f85888; }
.type--ice     { background: #98d8d8; color: #333; }
.type--dragon  { background: #7038f8; }
.type--dark    { background: #705848; }
.type--fairy   { background: #ee99ac; color: #333; }
.type--normal  { background: #a8a878; }
.type--fighting{ background: #c03028; }
.type--poison  { background: #a040a0; }
.type--ground  { background: #e0c068; color: #333; }
.type--flying  { background: #a890f0; }
.type--bug     { background: #a8b820; }
.type--rock    { background: #b8a038; }
.type--ghost   { background: #705898; }
.type--steel   { background: #b8b8d0; color: #333; }

.pokedex-date {
  font-size: 0.7rem;
  opacity: 0.45;
}
</style>
