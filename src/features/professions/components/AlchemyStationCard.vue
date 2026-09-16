<template>
  <section class="as pf-card" :class="{ 'as--busy': phase === 'brewing' }">
    <header class="as-head">
      <div>
        <p class="pf-kicker">Mesa de Alquimia · Alquimia Nv. {{ level }}</p>
        <h3 class="as-title">{{ detail?.label ?? 'Recetas' }}</h3>
      </div>
      <button type="button" class="as-close" aria-label="Cerrar" :disabled="phase === 'brewing'" @click="$emit('close')">×</button>
    </header>

    <!-- Recipe browser: what I can make first, then what I am short of, then locked. -->
    <ul v-if="phase !== 'brewing'" class="as-list">
      <li v-for="entry in recipes" :key="entry.id">
        <button
          type="button"
          class="as-recipe"
          :class="[`as-recipe--${entry.availability}`, { 'as-recipe--on': entry.id === detail?.id }]"
          @click="$emit('select', entry.id)"
        >
          <ItemGlyph :item-id="entry.outputs[0].itemId" :size="20" />
          <span class="as-recipe-name">{{ entry.label }}</span>
          <span v-if="entry.recommended" class="as-tag as-tag--tip">Sugerida</span>
          <span v-else-if="entry.availability === 'locked'" class="as-tag as-tag--lock">Nv. {{ entry.requiredLevel }}</span>
          <span v-else-if="entry.availability === 'missing'" class="as-tag as-tag--miss">Faltan</span>
          <span v-else class="as-tag as-tag--ok">×{{ entry.maxCraftable }}</span>
        </button>
      </li>
    </ul>

    <template v-if="detail">
      <!-- Ingredients: need, have and where each one comes from. -->
      <ul class="as-ing">
        <li v-for="ingredient in detail.ingredients" :key="ingredient.itemId" :class="{ 'as-ing--short': ingredient.short }">
          <ItemGlyph :item-id="ingredient.itemId" :size="20" />
          <span class="as-ing-name">{{ ingredient.name }}</span>
          <span class="as-ing-from">{{ ingredient.originLabel }}</span>
          <span class="as-ing-count">{{ ingredient.have }}/{{ ingredient.need }}</span>
        </li>
      </ul>

      <p class="as-out">
        <ItemGlyph :item-id="detail.outputs[0].itemId" :size="20" />
        <span>Produce <strong>{{ detail.outputs[0].quantity }} × {{ detail.outputs[0].name }}</strong></span>
        <span class="as-secs">{{ detail.seconds }} s · sin energía</span>
      </p>

      <template v-if="phase === 'brewing'">
        <div class="as-progress" role="progressbar" :aria-valuenow="Math.round(progress * 100)" aria-valuemin="0" aria-valuemax="100">
          <span :style="{ width: `${Math.round(progress * 100)}%` }" />
        </div>
        <p class="as-busy-text">{{ brewLabel }}</p>
      </template>

      <template v-else>
        <div class="as-qty">
          <button type="button" class="as-step" :disabled="quantity <= 1" aria-label="Menos" @click="$emit('quantity', quantity - 1)">−</button>
          <output class="as-qty-value">{{ quantity }}</output>
          <button type="button" class="as-step" :disabled="quantity >= maxQuantity" aria-label="Más" @click="$emit('quantity', quantity + 1)">+</button>
          <button type="button" class="as-max" :disabled="maxQuantity <= 1" @click="$emit('quantity', maxQuantity)">Máx {{ maxQuantity }}</button>
        </div>

        <p v-if="detail.block.kind !== 'none'" class="as-block">{{ detail.block.text }}</p>

        <button type="button" class="pf-btn as-brew" :disabled="detail.block.kind !== 'none'" @click="$emit('brew')">
          {{ detail.block.kind === 'level' ? `Requiere Nv. ${detail.requiredLevel}` : detail.block.kind === 'missing' ? 'Faltan ingredientes' : `Preparar ${quantity}` }}
        </button>
      </template>

      <GatheringFeedback v-if="lines.length" :lines="lines" :rare="saved" banner="¡Tu Pokémon rindió el lote!" />
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { AlchemyPhase, BrewOutcome } from '../alchemy/useAlchemyController'
import type { AlchemyRecipeView } from '../alchemy/recipeBrowser'
import { craftingFeedback, type FeedbackLine } from '../ui/feedback'
import GatheringFeedback from './GatheringFeedback.vue'
import ItemGlyph from './ItemGlyph.vue'

// The bench panel (R31-C4): browse, understand the cost, choose how many, brew.
const props = defineProps<{
  recipes: readonly AlchemyRecipeView[]
  detail: AlchemyRecipeView | null
  phase: AlchemyPhase
  quantity: number
  maxQuantity: number
  level: number
  outcome: BrewOutcome | null
  /** 0..1 of the running brew, for the bar. */
  progress: number
}>()

defineEmits<{ select: [string]; quantity: [number]; brew: []; close: [] }>()

const REASON: Readonly<Record<string, string>> = {
  inventory_full: 'Inventario lleno · liberá espacio',
  missing_inputs: 'Faltan ingredientes',
  level_too_low: 'Nivel insuficiente',
  invalid_quantity: 'Cantidad inválida',
  unknown_recipe: 'Receta desconocida',
}

const saved = computed(() => (props.outcome?.ok ? props.outcome.result.savedInputs > 0 : false))

const lines = computed<readonly FeedbackLine[]>(() => {
  const outcome = props.outcome
  if (!outcome) return []
  if (!outcome.ok) return [{ text: REASON[outcome.reason] ?? 'No se pudo preparar', tone: 'warn' }]
  return craftingFeedback(outcome.result, 'alchemy', outcome.leveledUp, outcome.level)
})

const brewLabel = computed(() => {
  const name = props.detail?.outputs[0].name ?? 'la preparación'
  if (props.progress < 0.25) return `Cargando ingredientes…`
  if (props.progress < 0.75) return `Hirviendo ${name}…`
  return 'Embotellando…'
})
</script>

<style scoped>
.as { display: grid; gap: 0.5rem; padding: 0.7rem 0.8rem; }
.as-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 0.5rem; }
.as-title { margin: 0.1rem 0 0; font-size: 1rem; }
.as-close { min-width: 36px; min-height: 36px; border: none; background: transparent; color: var(--pf-soft); font-size: 1.3rem; line-height: 1; cursor: pointer; }
.as-close:disabled { opacity: 0.35; cursor: not-allowed; }
.as-list { display: grid; gap: 0.25rem; max-height: 148px; margin: 0; padding: 0; overflow-y: auto; list-style: none; }
.as-recipe { display: flex; align-items: center; gap: 0.45rem; width: 100%; min-height: 40px; padding: 0.2rem 0.5rem; border: 2px solid var(--pf-line); border-radius: 10px; background: var(--pf-navy-2); color: inherit; font: inherit; text-align: left; cursor: pointer; }
.as-recipe--on { border-color: var(--pf-gold); }
.as-recipe--locked { opacity: 0.55; }
.as-recipe-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.85rem; }
.as-tag { flex: none; padding: 0.05rem 0.4rem; border-radius: 999px; font-size: 0.7rem; font-weight: 700; }
.as-tag--ok { background: rgba(125, 211, 137, 0.18); color: #8bd17c; }
.as-tag--miss { background: rgba(255, 138, 128, 0.16); color: var(--pf-bad); }
.as-tag--lock { background: rgba(255, 210, 122, 0.16); color: var(--pf-gold); }
.as-tag--tip { background: var(--pf-gold); color: var(--pf-navy); }
.as-ing { display: grid; gap: 0.2rem; margin: 0; padding: 0; list-style: none; }
.as-ing li { display: flex; align-items: center; gap: 0.45rem; font-size: 0.84rem; }
.as-ing-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.as-ing-from { flex: none; padding: 0.05rem 0.4rem; border: 1px solid var(--pf-line); border-radius: 999px; color: var(--pf-muted); font-size: 0.68rem; }
.as-ing-count { flex: none; font-variant-numeric: tabular-nums; font-weight: 700; }
.as-ing--short .as-ing-count { color: var(--pf-bad); }
.as-out { display: flex; flex-wrap: wrap; align-items: center; gap: 0.4rem; margin: 0; font-size: 0.84rem; }
.as-secs { margin-left: auto; color: var(--pf-muted); font-size: 0.72rem; }
.as-qty { display: flex; align-items: center; gap: 0.4rem; }
.as-qty-value { min-width: 2.5ch; font-size: 1.15rem; font-weight: 800; text-align: center; }
.as-step, .as-max { min-width: 44px; min-height: 40px; border: 2px solid var(--pf-line); border-radius: 9px; background: var(--pf-navy-2); color: inherit; font: inherit; cursor: pointer; }
.as-max { margin-left: auto; padding: 0 0.6rem; }
.as-step:disabled, .as-max:disabled { opacity: 0.4; cursor: not-allowed; }
.as-block { margin: 0; color: var(--pf-bad); font-size: 0.8rem; }
.as-brew { width: 100%; }
.as-progress { height: 8px; border: 1px solid var(--pf-line); border-radius: 999px; overflow: hidden; background: var(--pf-navy-2); }
.as-progress span { display: block; height: 100%; background: linear-gradient(90deg, #d2436b, #ffc35e); transition: width 0.1s linear; }
.as-busy-text { margin: 0; color: var(--pf-soft); font-size: 0.82rem; }
</style>
