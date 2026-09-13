<template>
  <main class="dungeon-view">
    <h2 class="dungeon-title">Dungeon</h2>

    <p v-if="!user" class="dungeon-unauth">
      Iniciá sesión para entrar al dungeon.
    </p>

    <template v-else>

      <!-- IDLE: Pokémon selector -->
      <section v-if="phase === 'idle'" class="dungeon-idle">
        <p class="dungeon-hint">
          Elegí un Pokémon (mínimo {{ DUNGEON_ENERGY_COST }} de energía).
        </p>

        <p v-if="slotsLoading" class="dungeon-loading-slots">Cargando Pokémon…</p>
        <p v-else-if="!eligibleSlots.length" class="dungeon-no-slots">
          Ningún Pokémon tiene energía suficiente.
        </p>

        <ul v-else class="dungeon-slot-list">
          <li
            v-for="item in eligibleSlots"
            :key="item.slot.pokemon_id"
            class="dungeon-slot-item"
            :class="{ 'dungeon-slot-item--selected': selectedPokemonId === item.slot.pokemon_id }"
            @click="selectedPokemonId = item.slot.pokemon_id"
          >
            <img
              v-if="item.pokemon?.sprite_url"
              :src="item.pokemon.sprite_url"
              :alt="item.pokemon?.name_es"
              class="dungeon-slot-sprite"
            />
            <span class="dungeon-slot-name">
              {{ item.pokemon?.name_es ?? `#${item.slot.pokemon_id}` }}
            </span>
            <span class="dungeon-slot-energy">⚡ {{ item.slot.energy }}</span>
          </li>
        </ul>

        <button
          class="dungeon-btn dungeon-btn--enter"
          :disabled="!selectedPokemonId"
          @click="handleEnter"
        >
          Entrar al dungeon
        </button>

        <p v-if="error" class="dungeon-error" role="alert">{{ error }}</p>
      </section>

      <!-- STARTING -->
      <section v-else-if="phase === 'starting'" class="dungeon-phase">
        <p class="dungeon-loading">Preparando dungeon…</p>
      </section>

      <!-- COMBAT -->
      <section v-else-if="phase === 'combat'" class="dungeon-phase">
        <p v-if="!combat" class="dungeon-loading">Simulando combate…</p>

        <template v-else>
          <p class="dungeon-combat-result" :class="combat.won ? 'won' : 'lost'">
            {{ combat.won ? '¡Victoria!' : 'Derrota' }}
          </p>

          <ol class="dungeon-rounds">
            <li v-for="r in combat.rounds" :key="r.round" class="dungeon-round">
              <span class="dungeon-round-num">Ronda {{ r.round }}</span>
              <span class="dungeon-round-atk">Atacaste: {{ r.playerDamage }} dmg</span>
              <span class="dungeon-round-def">Recibiste: {{ r.enemyDamage }} dmg</span>
            </li>
          </ol>

          <p class="dungeon-advisory">
            XP estimada: <strong>{{ combat.xpEarned }}</strong> ·
            Tokens estimados: <strong>{{ combat.tokensEarned }}</strong>
          </p>

          <p v-if="error" class="dungeon-error" role="alert">{{ error }}</p>

          <button
            class="dungeon-btn dungeon-btn--submit"
            @click="handleSubmit"
          >
            Guardar resultado
          </button>
        </template>
      </section>

      <!-- SUBMITTING -->
      <section v-else-if="phase === 'submitting'" class="dungeon-phase">
        <p class="dungeon-loading">Guardando resultado…</p>
      </section>

      <!-- RESULT -->
      <section v-else-if="phase === 'result' && result" class="dungeon-result">
        <p class="dungeon-result-title">
          {{ result.combat.won ? '¡Dungeon completado!' : 'Dungeon terminado' }}
        </p>

        <ul class="dungeon-result-stats">
          <li>
            <span class="dungeon-result-label">XP ganada</span>
            <span class="dungeon-result-value">+{{ result.newXp - (result.newXp - result.combat.xpEarned) }}</span>
          </li>
          <li v-if="result.leveledUp" class="dungeon-levelup">
            ¡Subiste al nivel {{ result.newLevel }}!
          </li>
          <li>
            <span class="dungeon-result-label">Tokens</span>
            <span class="dungeon-result-value">+{{ result.tokensAwarded }}</span>
          </li>
          <li>
            <span class="dungeon-result-label">Balance</span>
            <span class="dungeon-result-value">{{ result.newBalance.toLocaleString('es-AR') }}</span>
          </li>
        </ul>

        <button class="dungeon-btn" @click="handleReset">
          Intentar de nuevo
        </button>
      </section>

    </template>
  </main>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useAuth } from '../../auth/composables/useAuth'
import { useDungeon } from '../composables/useDungeon'
import { runCombat, DUNGEON_ENERGY_COST } from '../engine/combat'
import { listOwnedSlots, listPokemon } from '../../pokemon/api/pokemonApi'
import type { Slot, Pokemon } from '../../../shared/types/database'

const { user } = useAuth()
const { phase, combat, result, error, enterDungeon, finishRun, reset } = useDungeon()

const selectedPokemonId = ref<number | null>(null)
const slotsLoading      = ref(false)
const ownedSlots        = ref<Slot[]>([])
const pokemonMap        = ref<Map<number, Pokemon>>(new Map())

const eligibleSlots = computed(() =>
  ownedSlots.value
    .filter((s) => (s.energy ?? 0) >= DUNGEON_ENERGY_COST)
    .map((s) => ({ slot: s, pokemon: pokemonMap.value.get(s.pokemon_id) ?? null })),
)

onMounted(async () => {
  if (!user.value) return
  slotsLoading.value = true
  try {
    const [slots, pokemon] = await Promise.all([
      listOwnedSlots(user.value.id),
      listPokemon(),
    ])
    ownedSlots.value = slots
    pokemonMap.value = new Map(pokemon.map((p) => [p.id, p]))
  } finally {
    slotsLoading.value = false
  }
})

async function handleEnter(): Promise<void> {
  if (!selectedPokemonId.value) return
  await enterDungeon(selectedPokemonId.value)
  if (phase.value === 'combat') {
    // Run combat simulation immediately after entering
    await finishRun(runCombat(1))
  }
}

async function handleSubmit(): Promise<void> {
  if (!combat.value) return
  await finishRun(combat.value)
}

function handleReset(): void {
  selectedPokemonId.value = null
  reset()
}
</script>

<style scoped>
.dungeon-view {
  max-width: 600px;
  margin: 2rem auto;
  padding: 0 1rem;
}

.dungeon-title {
  margin-bottom: 1.5rem;
}

.dungeon-unauth,
.dungeon-loading,
.dungeon-loading-slots,
.dungeon-no-slots {
  opacity: 0.65;
}

.dungeon-hint {
  margin-bottom: 1rem;
  font-size: 0.9rem;
  opacity: 0.7;
}

.dungeon-phase {
  margin-top: 1rem;
}

.dungeon-error {
  color: #e63946;
  font-size: 0.875rem;
  margin: 0.5rem 0;
}

/* Slot list */
.dungeon-slot-list {
  list-style: none;
  padding: 0;
  margin: 0 0 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.dungeon-slot-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.5rem 0.75rem;
  border: 1px solid rgba(0, 0, 0, 0.1);
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.1s;
}

.dungeon-slot-item:hover {
  background: rgba(0, 0, 0, 0.04);
}

.dungeon-slot-item--selected {
  border-color: #e63946;
  background: rgba(230, 57, 70, 0.06);
}

.dungeon-slot-sprite {
  width: 36px;
  height: 36px;
  object-fit: contain;
  image-rendering: pixelated;
}

.dungeon-slot-name {
  flex: 1;
  font-size: 0.9rem;
  text-transform: capitalize;
}

.dungeon-slot-energy {
  font-size: 0.8rem;
  opacity: 0.65;
}

/* Buttons */
.dungeon-btn {
  padding: 0.6rem 1.4rem;
  font-size: 0.95rem;
  font-weight: 600;
  border: none;
  border-radius: 6px;
  background: #e63946;
  color: #fff;
  cursor: pointer;
  margin-top: 0.5rem;
}

.dungeon-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.dungeon-btn--submit {
  background: #2a9d8f;
}

/* Combat */
.dungeon-combat-result {
  font-size: 1.3rem;
  font-weight: 700;
  margin-bottom: 1rem;
}

.dungeon-combat-result.won  { color: #2a9d8f; }
.dungeon-combat-result.lost { color: #e63946; }

.dungeon-rounds {
  padding-left: 1.25rem;
  margin: 0 0 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.dungeon-round {
  display: flex;
  gap: 1rem;
  font-size: 0.85rem;
  opacity: 0.8;
}

.dungeon-round-num {
  font-weight: 600;
  min-width: 5rem;
}

.dungeon-advisory {
  font-size: 0.9rem;
  margin-bottom: 1rem;
  opacity: 0.75;
}

/* Result */
.dungeon-result {
  margin-top: 1rem;
}

.dungeon-result-title {
  font-size: 1.25rem;
  font-weight: 700;
  margin-bottom: 1rem;
}

.dungeon-result-stats {
  list-style: none;
  padding: 0;
  margin: 0 0 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.dungeon-result-stats li {
  display: flex;
  justify-content: space-between;
  font-size: 0.9rem;
}

.dungeon-result-label {
  opacity: 0.6;
}

.dungeon-result-value {
  font-weight: 600;
}

.dungeon-levelup {
  color: #f4a261;
  font-weight: 700;
  font-size: 1rem;
}
</style>
