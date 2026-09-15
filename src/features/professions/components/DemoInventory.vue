<template>
  <section class="inv pf-card">
    <header class="inv-head">
      <div>
        <p class="pf-kicker">Inventario de demostración</p>
        <h3>{{ used }} / {{ capacity }} unidades</h3>
      </div>
      <span class="pf-chip">Local · no es el inventario real</span>
    </header>
    <div class="inv-bar" role="meter" :aria-valuenow="used" aria-valuemin="0" :aria-valuemax="capacity">
      <span :class="{ 'inv-bar--full': used >= capacity }" :style="{ width: `${Math.min(100, (used / capacity) * 100)}%` }" />
    </div>
    <p v-if="!groups.length" class="inv-empty">Vacío. Recolectá algo.</p>
    <div v-for="group in groups" :key="group.kind" class="inv-group">
      <h4>{{ KIND_LABEL[group.kind] }}</h4>
      <ul>
        <li v-for="entry in group.items" :key="entry.itemId" :title="entry.name">
          <ItemGlyph :item-id="entry.itemId" :size="30" />
          <span class="inv-qty">{{ entry.quantity }}</span>
          <span class="inv-name">{{ entry.name }}</span>
        </li>
      </ul>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { ITEM_BY_ID } from '../domain/catalog/items'
import type { Inventory, ItemKind } from '../domain/types'
import { itemCount } from '../demo/demoSession'
import ItemGlyph from './ItemGlyph.vue'

const props = defineProps<{ inventory: Inventory; capacity: number }>()

const KIND_LABEL: Readonly<Record<ItemKind, string>> = {
  raw: 'Recursos', refined: 'Refinados', tool: 'Herramientas', consumable: 'Consumibles', structure: 'Estructuras',
}
const KIND_ORDER: readonly ItemKind[] = ['raw', 'refined', 'consumable', 'tool', 'structure']

const used = computed(() => itemCount(props.inventory))
const groups = computed(() => KIND_ORDER
  .map(kind => ({
    kind,
    items: Object.entries(props.inventory)
      .filter(([itemId, quantity]) => quantity > 0 && (ITEM_BY_ID.get(itemId)?.kind ?? 'raw') === kind)
      .map(([itemId, quantity]) => ({ itemId, quantity, name: ITEM_BY_ID.get(itemId)?.name ?? itemId }))
      .sort((a, b) => a.name.localeCompare(b.name, 'es')),
  }))
  .filter(group => group.items.length))
</script>

<style scoped>
.inv { display: grid; gap: 0.6rem; padding: 1rem; }
.inv-head { display: flex; justify-content: space-between; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
.inv-head h3 { margin: 0.1rem 0 0; }
.inv-bar { height: 8px; border-radius: 999px; background: rgba(255, 255, 255, 0.1); overflow: hidden; }
.inv-bar span { display: block; height: 100%; background: var(--pf-soft); }
.inv-bar .inv-bar--full { background: var(--pf-warn); }
.inv-empty { margin: 0; color: var(--pf-muted); }
.inv-group h4 { margin: 0.2rem 0 0.4rem; color: var(--pf-soft); font-size: 0.85rem; }
.inv-group ul { display: grid; grid-template-columns: repeat(auto-fill, minmax(92px, 1fr)); gap: 0.4rem; margin: 0; padding: 0; list-style: none; }
.inv-group li { position: relative; display: grid; justify-items: center; gap: 0.2rem; padding: 0.5rem 0.3rem; border-radius: 10px; background: var(--pf-navy-2); }
.inv-qty { position: absolute; top: 0.25rem; right: 0.4rem; font-weight: 800; font-size: 0.8rem; }
.inv-name { overflow: hidden; max-width: 100%; color: var(--pf-muted); font-size: 0.7rem; text-align: center; text-overflow: ellipsis; white-space: nowrap; }
</style>
