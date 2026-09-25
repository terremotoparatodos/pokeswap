<template>
  <section class="bag skx" aria-label="Mochila" role="dialog">
    <header class="bag-head">
      <strong>🎒 Mochila</strong>
      <button type="button" aria-label="Cerrar mochila" @click="emit('close')">×</button>
    </header>
    <div v-if="supplyList.length" class="bag-supplies">
      <span v-for="supply in supplyList" :key="supply.id">{{ supply.label }} ×{{ supply.quantity }}</span>
    </div>
    <p v-if="!items.length" class="bag-empty">Todavía no juntaste nada. Acercate a un árbol o a una roca.</p>
    <ul v-else class="bag-items">
      <li v-for="item in items" :key="item.id" class="bag-item" :title="item.purpose">
        <MaterialIcon :item-id="item.id" :size="24" />
        <span class="bag-name">{{ item.name }}</span>
        <span class="bag-qty">×{{ item.quantity }}</span>
        <span class="bag-purpose">{{ item.purpose }}</span>
      </li>
    </ul>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { MATERIALS } from '../domain/materials'
import MaterialIcon from './MaterialIcon.vue'
import './skills.css'

// Materials in catalog order (by skill, then grade), each with the one line
// that says what it is for. Dungeon supplies ride along because the playtest
// has one bag.
const props = defineProps<{
  inventory: Readonly<Record<string, number>>
  supplies?: Readonly<Record<string, number>>
}>()
const emit = defineEmits<{ close: [] }>()

const SUPPLY_LABEL: Readonly<Record<string, string>> = { poke_ball: 'Poké Ball', potion: 'Poción', revive: 'Revivir', ether: 'Éter' }

const items = computed(() => MATERIALS
  .filter(material => (props.inventory[material.id] ?? 0) > 0)
  .map(material => ({ id: material.id, name: material.name, purpose: material.purpose, quantity: props.inventory[material.id] })))

const supplyList = computed(() => Object.entries(props.supplies ?? {})
  .filter(([, quantity]) => quantity > 0)
  .map(([id, quantity]) => ({ id, quantity, label: SUPPLY_LABEL[id] ?? id })))
</script>

<style scoped>
.bag {
  position: absolute;
  top: calc(4.5rem + var(--safe-top, 0px));
  left: calc(1rem + var(--safe-left, 0px));
  z-index: 16;
  display: grid;
  gap: 0.55rem;
  width: min(420px, calc(100% - 2rem));
  max-height: calc(100dvh - 9rem);
  padding: 0.75rem;
  overflow-y: auto;
  box-sizing: border-box;
  border: 2px solid var(--skx-gold);
  border-radius: 12px;
  background: rgba(12, 20, 42, 0.97);
  box-shadow: 0 12px 30px rgba(0, 0, 0, 0.48);
}
.bag-head { display: flex; align-items: center; justify-content: space-between; color: var(--skx-gold); }
.bag-head button { width: 36px; height: 36px; border: 1px solid rgba(255, 255, 255, 0.25); border-radius: 8px; background: transparent; color: #fff; font: inherit; font-size: 1.3rem; cursor: pointer; }
.bag-supplies { display: flex; flex-wrap: wrap; gap: 0.3rem; }
.bag-supplies span { padding: 0.15rem 0.5rem; border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 999px; color: var(--skx-soft); font-size: 0.72rem; }
.bag-empty { margin: 0; color: var(--skx-soft); font-size: 0.8rem; opacity: 0.75; }
.bag-items { display: grid; gap: 0.35rem; margin: 0; padding: 0; list-style: none; }
.bag-item { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 0 0.5rem; padding: 0.3rem 0.45rem; border-radius: 8px; background: rgba(255, 255, 255, 0.05); }
.bag-name { font-size: 0.85rem; font-weight: 600; }
.bag-qty { color: var(--skx-gold); font-weight: 800; font-variant-numeric: tabular-nums; }
.bag-purpose { grid-column: 2 / 4; color: var(--skx-muted); font-size: 0.7rem; }

@media (max-width: 720px), (max-height: 500px) {
  .bag {
    top: calc(4.2rem + var(--safe-top, 0px));
    left: calc(0.75rem + var(--safe-left, 0px));
    width: calc(100% - 1.5rem - var(--safe-left, 0px) - var(--safe-right, 0px));
    max-height: calc(100dvh - 8.5rem - var(--safe-top, 0px) - var(--safe-bottom, 0px));
  }
}
</style>
