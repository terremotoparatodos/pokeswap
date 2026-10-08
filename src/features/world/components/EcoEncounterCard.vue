<template>
  <!-- Space and Enter on the card's own controls belong to them, not to the map's keyboard (which listens on
       window and would otherwise turn Space into «interact»); with focus elsewhere the map still walks. -->
  <section class="eco-card" role="dialog" :aria-label="`${name}, Pokémon salvaje`" @keydown.space.stop @keydown.enter.stop>
    <header>
      <EcoSprite :species-id="speciesId" facing="down" :size="64" :label="name" />
      <div class="eco-card__title">
        <p class="eco-card__kicker">Pokémon salvaje · combate de prueba</p>
        <h2>{{ name }}</h2>
        <p class="eco-card__id">{{ ecoShortId(encounterId) }}</p>
      </div>
      <button class="eco-card__close" aria-label="Cerrar" @click="emit('close')">×</button>
    </header>
    <p class="eco-card__state" :class="`eco-card__state--${state.kind}`" role="status">{{ state.text }}</p>
    <button class="eco-card__fight" :disabled="state.kind !== 'free'" @click="emit('engage', encounterId)">Combatir</button>
    <p class="eco-card__note">Combate de prueba con un Pikachu sintético: sin captura ni recompensas.</p>
  </section>
</template>

<script setup lang="ts">
// ECO-PRESENTATION-1 (experimental, development builds only): what the player tapped on the map —
// this exact individual (its encounter id), its species, whether it can be fought now, and why not.
// The availability shown is the server's last word (busy) plus the distance it will check; the
// server still decides when «Combatir» is pressed.
import { computed, onMounted, onUnmounted } from 'vue'
import type { EcoEncounter } from '../../../../services/realtime/src/world/worldProtocol.js'
import { ECO_ENGAGE_RANGE } from '../../../../services/realtime/src/world/worldProtocol.js'
import { ecoShortId } from '../domain/ecoBattleText'
import EcoSprite from './EcoSprite.vue'

const props = defineProps<{
  encounterId: string
  /** Null when the server's list no longer has it (retired, or out of view). */
  encounter: EcoEncounter | null
  speciesId: number
  name: string
  tx: number
  ty: number
}>()
const emit = defineEmits<{ close: []; engage: [encounterId: string] }>()

const state = computed((): { kind: 'free' | 'busy' | 'far' | 'gone'; text: string } => {
  const e = props.encounter
  if (!e) return { kind: 'gone', text: 'Ya no está aquí.' }
  if (e.busy) return { kind: 'busy', text: 'Ocupado: otro entrenador lo está combatiendo.' }
  const distance = Math.max(Math.abs(e.tx - props.tx), Math.abs(e.ty - props.ty))
  if (distance > ECO_ENGAGE_RANGE) return { kind: 'far', text: `Lejos: estás a ${distance} casillas. Acercate a ${ECO_ENGAGE_RANGE} o menos.` }
  return { kind: 'free', text: 'Libre: podés combatirlo.' }
})

const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') emit('close') }
onMounted(() => window.addEventListener('keydown', onKeyDown))
onUnmounted(() => window.removeEventListener('keydown', onKeyDown))
</script>

<style scoped>
.eco-card { position: absolute; left: 50%; bottom: 5.5rem; z-index: 12; box-sizing: border-box; width: min(360px, calc(100% - 1.5rem)); padding: .9rem 1rem 1rem; border: 2px solid #3a5fb8; border-radius: 14px; background: rgba(16, 26, 54, .96); color: #fff; box-shadow: 0 12px 32px rgba(0,0,0,.45); transform: translateX(-50%); }
header { display: flex; align-items: center; gap: .75rem; }
.eco-card__title { flex: 1; min-width: 0; }
h2, p { margin: 0; }
h2 { font-size: 1.2rem; }
.eco-card__kicker { color: #9fb2da; font-size: .72rem; text-transform: uppercase; letter-spacing: .06em; }
.eco-card__id { color: #9fb2da; font-size: .75rem; overflow-wrap: anywhere; }
.eco-card__close { align-self: flex-start; width: 44px; height: 44px; border: 0; border-radius: 50%; background: transparent; color: inherit; font-size: 2rem; cursor: pointer; }
.eco-card__state { margin-top: .75rem; padding: .5rem .65rem; border-radius: 8px; background: rgba(255,255,255,.07); color: #dce6ff; line-height: 1.35; }
.eco-card__state--free { color: #9ff0b8; }
.eco-card__state--busy, .eco-card__state--far, .eco-card__state--gone { color: #ffd27a; }
.eco-card__fight { width: 100%; min-height: 44px; margin-top: .75rem; border: 0; border-radius: 9px; background: #ffd27a; color: #101a36; font: inherit; font-weight: 700; cursor: pointer; }
.eco-card__fight:disabled { background: #34404b; color: #c9d3da; cursor: default; }
.eco-card__note { margin-top: .6rem; color: #9fb2da; font-size: .8rem; }
</style>
