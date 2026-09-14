<template>
  <div class="wc-backdrop" @click.self="emit('close')">
    <section class="wc-card" role="dialog" aria-modal="true" :aria-label="pokemon.name_es">
      <header>
        <div>
          <p class="wc-kicker">Pokémon salvaje</p>
          <h2>{{ pokemon.name_es }}</h2>
        </div>
        <button aria-label="Cerrar" @click="emit('close')">×</button>
      </header>
      <p class="wc-types">{{ pokemon.type1 }}<template v-if="pokemon.type2"> · {{ pokemon.type2 }}</template></p>
      <p class="wc-copy">Está libre ahora. Esta ficha es informativa: explorar el mundo no realiza intercambios, compras ni capturas.</p>
      <div class="wc-actions">
        <button @click="emit('feature', 'pokedex')">Abrir Pokédex</button>
        <button @click="emit('feature', 'mercado')">Ver Mercado</button>
        <button @click="emit('feature', 'swap')">Ir a Swap</button>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import type { PokedexEntry } from '../engine/population'
import type { LobbyFeature } from '../lobby/features'

defineProps<{ pokemon: PokedexEntry }>()
const emit = defineEmits<{ close: []; feature: [feature: LobbyFeature] }>()
const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') emit('close') }
onMounted(() => window.addEventListener('keydown', onKeyDown))
onUnmounted(() => window.removeEventListener('keydown', onKeyDown))
</script>

<style scoped>
.wc-backdrop { position: absolute; inset: 0; z-index: 12; }
.wc-card { position: absolute; left: 50%; bottom: 5.5rem; box-sizing: border-box; width: min(360px, calc(100% - 1.5rem)); padding: 1rem; border: 2px solid #3a5fb8; border-radius: 14px; background: rgba(16, 26, 54, .96); color: #fff; box-shadow: 0 12px 32px rgba(0,0,0,.45); transform: translateX(-50%); }
header { display: flex; justify-content: space-between; gap: .75rem; } h2, p { margin: 0; } h2 { font-size: 1.2rem; } header button { width: 44px; height: 44px; border: 0; border-radius: 50%; background: transparent; color: inherit; font-size: 2rem; cursor: pointer; }
.wc-kicker { color: #9fb2da; font-size: .78rem; text-transform: uppercase; letter-spacing: .06em; }.wc-types { margin-top: .5rem; color: #ffd27a; text-transform: capitalize; }.wc-copy { margin-top: .75rem; color: #dce6ff; line-height: 1.4; }.wc-actions { display: grid; gap: .5rem; margin-top: 1rem; }.wc-actions button { min-height: 44px; border: 0; border-radius: 9px; background: #ffd27a; color: #101a36; font: inherit; font-weight: 700; cursor: pointer; }.wc-actions button + button { background: #dfe8ff; }
</style>
