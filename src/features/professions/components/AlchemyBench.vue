<template>
  <section class="ab pf-card">
    <nav class="ab-tabs" aria-label="Profesión de la receta">
      <button
        v-for="id in TAB_ORDER"
        :key="id"
        type="button"
        class="ab-tab"
        :class="{ 'ab-tab--on': id === profession }"
        @click="selectProfession(id)"
      >
        {{ PROFESSIONS[id].name }} <small>Nv. {{ demoLevel(state, id) }}</small>
      </button>
    </nav>

    <div class="ab-layout">
      <ul class="ab-list">
        <li v-for="view in views" :key="view.id">
          <RecipeCard :view="view" :selected="view.id === selectedId" @click="select(view.id)" />
        </li>
      </ul>

      <article v-if="detail" class="ab-detail">
        <header>
          <p class="pf-kicker">{{ detail.station }} · requiere Nv. {{ detail.requiredLevel }}</p>
          <h3>{{ detail.title }}</h3>
        </header>

        <h4>Ingredientes</h4>
        <ul class="ab-ingredients">
          <li v-for="ingredient in detail.ingredients" :key="ingredient.itemId" :class="{ 'ab-missing': ingredient.missing > 0 }">
            <ItemGlyph :item-id="ingredient.itemId" />
            <span class="ab-name">{{ ingredient.name }}</span>
            <span class="ab-count">{{ ingredient.have }} / {{ ingredient.need }}</span>
          </li>
        </ul>

        <h4>Produce</h4>
        <ul class="ab-ingredients">
          <li v-for="output in detail.outputs" :key="output.itemId">
            <ItemGlyph :item-id="output.itemId" />
            <span class="ab-name">{{ output.name }}</span>
            <span class="ab-count">×{{ output.quantity }}</span>
          </li>
        </ul>

        <p class="ab-cost">
          Energía: 0 — el procesado no consume energía (R31-A, decisión D7). Tiempo en estación pública: {{ detail.seconds }} s.
        </p>

        <div class="ab-qty">
          <button type="button" class="ab-step" :disabled="quantity <= 1" aria-label="Menos" @click="quantity--">−</button>
          <output>{{ quantity }}</output>
          <button type="button" class="ab-step" :disabled="quantity >= maxQuantity" aria-label="Más" @click="quantity++">+</button>
          <button type="button" class="ab-max" :disabled="maxQuantity <= 1" @click="quantity = maxQuantity">Máx. {{ detail.maxCraftable }}</button>
        </div>

        <button type="button" class="pf-btn ab-craft" :disabled="detail.availability !== 'ready'" @click="craft">
          {{ detail.availability === 'locked' ? `Requiere Nv. ${detail.requiredLevel}` : detail.availability === 'missing' ? 'Faltan ingredientes' : `Crear ${quantity}` }}
        </button>
        <GatheringFeedback v-if="feedback.length" :lines="feedback" />
      </article>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'
import { PROFESSIONS } from '../domain/catalog/professions'
import { RECIPES } from '../domain/catalog/recipes'
import type { ProfessionId } from '../domain/types'
import { demoCounts, demoLevel } from '../demo/demoSession'
import type { ProfessionDemoSession } from '../demo/useProfessionDemo'
import { craftingFeedback, type FeedbackLine } from '../ui/feedback'
import { recipeView } from '../ui/recipeView'
import GatheringFeedback from './GatheringFeedback.vue'
import ItemGlyph from './ItemGlyph.vue'
import RecipeCard from './RecipeCard.vue'

// Crafting bench: Alchemy first, the same view serves refining recipes of every profession.
const props = defineProps<{ session: ProfessionDemoSession }>()

const TAB_ORDER: readonly ProfessionId[] = ['alchemy', 'mining', 'woodcutting', 'fishing']
const AVAILABILITY_ORDER = { ready: 0, missing: 1, locked: 2 } as const

const state = computed(() => props.session.state.value)
const profession = ref<ProfessionId>('alchemy')
const selectedId = ref<string | null>(null)
const quantity = ref(1)
const feedback = shallowRef<readonly FeedbackLine[]>([])

const views = computed(() => RECIPES
  .filter(recipe => recipe.profession === profession.value)
  .map(recipe => recipeView(recipe, demoCounts(state.value), demoLevel(state.value, recipe.profession)))
  .sort((a, b) => AVAILABILITY_ORDER[a.availability] - AVAILABILITY_ORDER[b.availability] || a.requiredLevel - b.requiredLevel))

const selectedRecipe = computed(() => RECIPES.find(recipe => recipe.id === (selectedId.value ?? views.value[0]?.id)))
const maxQuantity = computed(() => Math.max(1, detailBase.value?.maxCraftable ?? 1))
const detailBase = computed(() => selectedRecipe.value
  ? recipeView(selectedRecipe.value, demoCounts(state.value), demoLevel(state.value, selectedRecipe.value.profession))
  : null)
const detail = computed(() => selectedRecipe.value
  ? recipeView(selectedRecipe.value, demoCounts(state.value), demoLevel(state.value, selectedRecipe.value.profession), quantity.value)
  : null)

watch(maxQuantity, max => { if (quantity.value > max) quantity.value = max })

function selectProfession(id: ProfessionId): void {
  profession.value = id
  selectedId.value = null
  quantity.value = 1
  feedback.value = []
}

function select(id: string): void {
  selectedId.value = id
  quantity.value = 1
  feedback.value = []
}

function craft(): void {
  const recipe = selectedRecipe.value
  if (!recipe) return
  const outcome = props.session.craft(recipe.id, quantity.value)
  if (outcome.ok) {
    feedback.value = craftingFeedback(outcome.result, recipe.profession, outcome.leveledUp, demoLevel(outcome.state, recipe.profession))
  } else {
    feedback.value = [{ text: outcome.reason === 'inventory_full' ? 'Inventario lleno' : 'No se pudo crear', tone: 'warn' }]
  }
  quantity.value = 1
}
</script>

<style scoped>
.ab { display: grid; gap: 0.75rem; padding: 1rem; }
.ab-tabs { display: flex; flex-wrap: wrap; gap: 0.4rem; }
.ab-tab { min-height: 40px; padding: 0 0.8rem; border: 2px solid var(--pf-line); border-radius: 999px; background: transparent; color: var(--pf-soft); font: inherit; cursor: pointer; }
.ab-tab small { color: var(--pf-muted); }
.ab-tab--on { border-color: var(--pf-gold); background: var(--pf-gold); color: var(--pf-navy); font-weight: 700; }
.ab-tab--on small { color: var(--pf-navy); }
.ab-layout { display: grid; grid-template-columns: minmax(220px, 1fr) 1.3fr; gap: 1rem; }
.ab-list { display: grid; align-content: start; gap: 0.4rem; max-height: 460px; margin: 0; padding: 0; overflow-y: auto; list-style: none; }
.ab-detail { display: grid; align-content: start; gap: 0.45rem; }
.ab-detail h3 { margin: 0.1rem 0 0; }
.ab-detail h4 { margin: 0.35rem 0 0; color: var(--pf-soft); font-size: 0.85rem; }
.ab-ingredients { display: grid; gap: 0.3rem; margin: 0; padding: 0; list-style: none; }
.ab-ingredients li { display: flex; align-items: center; gap: 0.5rem; }
.ab-name { flex: 1; }
.ab-count { font-variant-numeric: tabular-nums; font-weight: 700; }
.ab-missing .ab-count { color: var(--pf-bad); }
.ab-cost { margin: 0.3rem 0; color: var(--pf-muted); font-size: 0.78rem; }
.ab-qty { display: flex; align-items: center; gap: 0.5rem; }
.ab-qty output { min-width: 2ch; font-size: 1.2rem; font-weight: 800; text-align: center; }
.ab-step, .ab-max { min-width: 44px; min-height: 40px; border: 2px solid var(--pf-line); border-radius: 9px; background: var(--pf-navy-2); color: inherit; font: inherit; cursor: pointer; }
.ab-step:disabled, .ab-max:disabled { opacity: 0.4; cursor: not-allowed; }
.ab-craft { width: 100%; }
@media (max-width: 720px) {
  .ab-layout { grid-template-columns: 1fr; }
  .ab-list { max-height: 240px; }
}
</style>
