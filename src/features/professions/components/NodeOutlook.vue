<template>
  <dl class="no">
    <div class="no-row no-row--reward">
      <dt>Recompensa</dt>
      <dd>
        <span class="no-primary">
          <ItemGlyph :item-id="preview.primaryItemId" />
          {{ itemName(preview.primaryItemId) }} ×{{ preview.minUnits }}<template v-if="preview.maxUnits > preview.minUnits">–{{ preview.maxUnits }}</template>
        </span>
        <span v-if="preview.extraUnitChance > 0" class="pf-chip">{{ chance(preview.extraUnitChance) }} de +1</span>
        <span v-if="preview.criticalChance > 0" class="pf-chip no-rare">{{ chance(preview.criticalChance) }} de ×2</span>
        <ul v-if="preview.secondary.length" class="no-secondary">
          <li v-for="odds in preview.secondary" :key="odds.itemId" :class="{ 'no-rare': odds.rare }">
            <ItemGlyph :item-id="odds.itemId" :size="16" />
            {{ itemName(odds.itemId) }} <small>{{ chance(odds.chance) }}</small>
          </li>
        </ul>
      </dd>
    </div>

    <div class="no-row">
      <dt>Energía</dt>
      <dd>
        <strong>−{{ format(preview.energySpent) }}</strong>
        <details class="no-why">
          <summary>¿Por qué?</summary>
          <p>Base del nodo: {{ breakdown.base }}</p>
          <p v-if="breakdown.pokemonSaving > 0">Tu Pokémon: −{{ percent(breakdown.pokemonSaving) }}</p>
          <p v-if="breakdown.levelSaving > 0">Tu nivel: −{{ percent(breakdown.levelSaving) }}</p>
          <p v-if="breakdown.floorApplied">Se aplicó el mínimo del 60 % del coste base.</p>
          <p v-if="!breakdown.pokemonSaving && !breakdown.levelSaving">Sin reducciones todavía.</p>
        </details>
      </dd>
    </div>

    <div class="no-row">
      <dt>Herramienta</dt>
      <dd>
        <template v-if="preview.bareHands">A mano: sin desgaste, 50 % más lento</template>
        <template v-else>
          <strong>−{{ preview.durabilityPoints }}</strong>
          <small v-if="preview.durabilityPoints > 1"> nodo de tier superior</small>
          <small v-if="preview.toolCareChance > 0"> · {{ chance(preview.toolCareChance) }} de evitarlo</small>
        </template>
      </dd>
    </div>

    <div class="no-row">
      <dt>Experiencia</dt>
      <dd><strong>+{{ preview.xp }}</strong><small v-if="rested"> incluye descanso</small></dd>
    </div>

    <div class="no-row">
      <dt>Duración</dt>
      <dd>{{ format(preview.actionSeconds) }} s <small>(acelerado en la demo)</small></dd>
    </div>
  </dl>
</template>

<script setup lang="ts">
import type { GatheringPreview } from '../domain/gathering'
import type { EnergyCostBreakdown } from '../ui/gearViews'
import { itemName } from '../ui/progressionView'
import ItemGlyph from './ItemGlyph.vue'

// Everything here comes from previewGathering: the numbers match what the resolver will apply.
defineProps<{ preview: GatheringPreview; breakdown: EnergyCostBreakdown; rested: boolean }>()

const format = (value: number) => String(Math.round(value * 100) / 100).replace('.', ',')
const percent = (value: number) => `${Math.round(value * 100)} %`
const chance = (value: number) => value < 0.01 ? `${(value * 100).toFixed(1).replace('.', ',')} %` : percent(value)
</script>

<style scoped>
.no { display: grid; gap: 0.1rem; margin: 0; }
.no-row { display: grid; grid-template-columns: 6.5rem 1fr; gap: 0.5rem; padding: 0.4rem 0; border-bottom: 1px solid rgba(255, 255, 255, 0.07); font-size: 0.88rem; }
.no-row dt { color: var(--pf-muted); }
.no-row dd { display: flex; flex-wrap: wrap; align-items: center; gap: 0.35rem 0.5rem; margin: 0; }
.no-row small { color: var(--pf-muted); }
.no-primary { display: inline-flex; align-items: center; gap: 0.35rem; font-weight: 700; }
.no-secondary { display: flex; flex-wrap: wrap; gap: 0.3rem 0.75rem; width: 100%; margin: 0; padding: 0; list-style: none; color: var(--pf-soft); font-size: 0.8rem; }
.no-secondary li { display: inline-flex; align-items: center; gap: 0.3rem; }
.no-rare { color: var(--pf-rare); }
.no-why { width: 100%; color: var(--pf-muted); font-size: 0.78rem; }
.no-why summary { cursor: pointer; }
.no-why p { margin: 0.2rem 0 0; }
</style>
