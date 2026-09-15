<template>
  <section class="player-settings" aria-labelledby="player-settings-title">
    <div class="player-settings-heading">
      <div>
        <h3 id="player-settings-title">Jugador</h3>
        <p>Elegí cómo te acompañamos en Ciudad Corazón y los mundos.</p>
      </div>
      <button class="player-settings-reset" type="button" @click="settings.reset()">Restablecer</button>
    </div>

    <fieldset class="player-settings-group">
      <legend>Personaje</legend>
      <div class="player-character-list">
        <button
          v-for="character in PLAYER_CHARACTERS"
          :key="character.id"
          class="player-character"
          :class="{ 'player-character--selected': selectedCharacter === character.id }"
          type="button"
          :aria-pressed="selectedCharacter === character.id"
          @click="settings.setCharacter(character.id)"
        >
          <span class="player-character-sprite" :style="characterPreview(character)" aria-hidden="true" />
          <span>{{ character.label }}</span>
        </button>
      </div>
    </fieldset>

    <fieldset class="player-settings-group">
      <legend>Acompañante</legend>
      <p v-if="loading" class="player-settings-status">Cargando tu caja…</p>
      <p v-else-if="error" class="player-settings-error" role="alert">{{ error }}</p>
      <div v-else class="player-companion-list">
        <button
          class="player-companion player-companion--none"
          :class="{ 'player-companion--selected': selectedCompanion === null }"
          type="button"
          :aria-pressed="selectedCompanion === null"
          @click="settings.setCompanion(null)"
        >
          <span class="player-companion-empty" aria-hidden="true">—</span>
          <span>Sin acompañante</span>
        </button>
        <button
          v-for="item in items"
          :key="item.slot.pokemon_id"
          class="player-companion"
          :class="{ 'player-companion--selected': selectedCompanion === item.slot.pokemon_id }"
          type="button"
          :disabled="item.slot.is_locked === true"
          :aria-pressed="selectedCompanion === item.slot.pokemon_id"
          @click="settings.setCompanion(item.slot.pokemon_id)"
        >
          <img v-if="item.pokemon.sprite_url" :src="item.pokemon.sprite_url" :alt="item.pokemon.name_es" />
          <span v-else class="player-companion-empty" aria-hidden="true">#{{ item.pokemon.id }}</span>
          <span>{{ item.pokemon.name_es }}</span>
          <small v-if="item.slot.is_locked">En el mercado</small>
        </button>
      </div>
    </fieldset>
  </section>
</template>

<script setup lang="ts">
import { computed, watch } from 'vue'
import type { CSSProperties } from 'vue'
import type { SlotWithPokemon } from '../../pokemon/api/pokemonApi'
import { PLAYER_CHARACTERS, type PlayerCharacter } from '../identity/playerCharacters'
import { usePlayerPreferencesStore } from '../identity/playerPreferencesStore'

const props = defineProps<{
  userId: string
  items: readonly SlotWithPokemon[]
  loading: boolean
  error: string | null
}>()

const settings = usePlayerPreferencesStore()
watch(() => props.userId, userId => settings.activate(userId), { immediate: true })

const selectedCharacter = computed(() => settings.preferences.value.characterId)
const selectedCompanion = computed(() => settings.preferences.value.companionPokemonId)

function characterPreview(character: PlayerCharacter): CSSProperties {
  return {
    backgroundImage: `url(${character.sheetUrl})`,
    backgroundSize: `${character.columns * 100}% 400%`,
    backgroundPosition: '0 0',
  }
}
</script>

<style scoped>
.player-settings {
  margin-bottom: 1.5rem;
  padding: 1rem;
  border: 1px solid rgba(0, 0, 0, 0.12);
  border-radius: 12px;
  background: rgba(58, 95, 184, 0.06);
}

.player-settings-heading {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1rem;
}

.player-settings-heading h3,
.player-settings-heading p {
  margin: 0;
}

.player-settings-heading p {
  margin-top: 0.25rem;
  font-size: 0.82rem;
  opacity: 0.68;
}

.player-settings-reset {
  padding: 0.35rem 0.55rem;
  border: 1px solid currentColor;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  cursor: pointer;
}

.player-settings-group {
  min-width: 0;
  margin: 0 0 1rem;
  padding: 0;
  border: 0;
}

.player-settings-group:last-child { margin-bottom: 0; }

.player-settings-group legend {
  margin-bottom: 0.5rem;
  padding: 0;
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  opacity: 0.62;
}

.player-character-list,
.player-companion-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(118px, 1fr));
  gap: 0.55rem;
}

.player-character,
.player-companion {
  min-width: 0;
  min-height: 74px;
  padding: 0.55rem;
  border: 2px solid transparent;
  border-radius: 9px;
  background: rgba(255, 255, 255, 0.72);
  color: inherit;
  cursor: pointer;
  font: inherit;
}

.player-character {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  text-align: left;
}

.player-character--selected,
.player-companion--selected {
  border-color: #3a5fb8;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.7);
}

.player-character-sprite {
  width: 48px;
  height: 48px;
  flex: 0 0 48px;
  background-repeat: no-repeat;
  image-rendering: pixelated;
}

.player-companion {
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr);
  align-items: center;
  text-align: left;
}

.player-companion img,
.player-companion-empty {
  grid-row: 1 / span 2;
  width: 40px;
  height: 40px;
  object-fit: contain;
  image-rendering: pixelated;
}

.player-companion-empty {
  display: grid;
  place-items: center;
  opacity: 0.5;
}

.player-companion span:not(.player-companion-empty) {
  overflow: hidden;
  font-size: 0.8rem;
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.player-companion small {
  font-size: 0.68rem;
  opacity: 0.65;
}

.player-companion:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.player-settings-status,
.player-settings-error {
  margin: 0;
  font-size: 0.85rem;
}

.player-settings-status { opacity: 0.65; }
.player-settings-error { color: #e63946; }

@media (max-width: 480px) {
  .player-settings { padding: 0.8rem; }
  .player-settings-heading { align-items: center; }
  .player-character-list,
  .player-companion-list { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
</style>
