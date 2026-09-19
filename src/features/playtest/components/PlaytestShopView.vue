<template>
  <div class="sh">
    <header class="sh-top">
      <p class="sh-lead">Herramientas básicas y Poké Balls malas. Lo justo para que nadie se quede afuera.</p>
      <p class="sh-purse">{{ store.coins.value }} <span>{{ COIN_NAME }}</span></p>
    </header>

    <p v-if="store.notice.value" class="sh-notice" role="status">{{ store.notice.value }}</p>

    <ul class="sh-list">
      <li v-for="entry in SHOP_ENTRIES" :key="entry.id" class="sh-row">
        <span class="sh-id">
          <strong>{{ entry.name }}</strong>
          <small>{{ entry.note }}</small>
        </span>
        <span class="sh-price">{{ entry.price }}</span>
        <button
          type="button"
          class="sh-buy"
          :disabled="isOwned(entry.id) || store.coins.value < entry.price"
          @click="store.purchase(entry.id)"
        >
          {{ isOwned(entry.id) ? 'Comprado' : 'Comprar' }}
        </button>
      </li>
    </ul>

    <section class="sh-bag">
      <h3 class="sh-bag-title">En la mochila</h3>
      <p class="sh-bag-line">
        <span v-for="(quantity, itemId) in store.supplies.value" :key="itemId" class="sh-chip">
          {{ SUPPLY_LABEL[itemId] ?? itemId }} ×{{ quantity }}
        </span>
      </p>
      <p class="sh-bag-line">
        <span v-if="!store.tools.value.length" class="sh-none">Sin herramientas — podés recolectar a mano, más lento.</span>
        <span v-for="itemId in store.tools.value" :key="itemId" class="sh-chip sh-chip--tool">{{ TOOL_LABEL[itemId] ?? itemId }}</span>
      </p>
    </section>

    <p class="sh-rule">
      PLAYTEST VALUES · las fichas no son tokens, no se ganan jugando y desaparecen al cerrar la pestaña.
      Stock infinito.
    </p>
  </div>
</template>

<script setup lang="ts">
import { onUnmounted } from 'vue'
import { COIN_NAME, SHOP_ENTRIES } from '../domain/playtestShop'
import { usePlaytestStore } from '../state/usePlaytestStore'

// The safety net, and the one place a playtester spends anything. It is
// deliberately not an economy: there is no way to earn, no stock and no
// selling, because two hours of watching people mine is worth more than two
// hours of watching a market find its price.
const store = usePlaytestStore()

const SUPPLY_LABEL: Readonly<Record<string, string>> = {
  poke_ball: 'Poké Ball', potion: 'Poción', revive: 'Revivir', ether: 'Éter',
}
const TOOL_LABEL: Readonly<Record<string, string>> = {
  stone_pickaxe: 'Pico de piedra', stone_axe: 'Hacha de piedra',
  stone_sickle: 'Hoz de piedra', basic_rod: 'Caña básica',
}

const isOwned = (entryId: string): boolean => store.purchased.value.includes(entryId)

onUnmounted(() => store.clearNotice())
</script>

<style scoped>
.sh { display: grid; gap: 0.7rem; }

.sh-top { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; }
.sh-lead { flex: 1 1 14rem; margin: 0; font-size: 0.85rem; opacity: 0.8; }
.sh-purse { margin: 0; color: #f7d774; font-size: 1.15rem; font-weight: 800; font-variant-numeric: tabular-nums; }
.sh-purse span { font-size: 0.72rem; font-weight: 600; opacity: 0.7; }

.sh-notice {
  margin: 0;
  padding: 0.45rem 0.6rem;
  border-radius: 8px;
  background: rgba(240, 180, 41, 0.15);
  color: #f7d774;
  font-size: 0.82rem;
}

.sh-list { display: grid; gap: 0.4rem; margin: 0; padding: 0; list-style: none; }
.sh-row {
  display: grid;
  grid-template-columns: 1fr auto auto;
  align-items: center;
  gap: 0.6rem;
  padding: 0.5rem 0.6rem;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 9px;
  background: rgba(255, 255, 255, 0.04);
}
.sh-id { display: grid; min-width: 0; }
.sh-id strong { font-size: 0.88rem; }
.sh-id small { font-size: 0.72rem; opacity: 0.55; }
.sh-price { color: #f7d774; font-weight: 800; font-variant-numeric: tabular-nums; }
.sh-buy {
  min-height: 38px;
  padding: 0 0.75rem;
  border: 2px solid #3a5fb8;
  border-radius: 8px;
  background: #3a5fb8;
  color: #fff;
  font: inherit;
  font-size: 0.76rem;
  font-weight: 700;
  cursor: pointer;
}
.sh-buy:disabled { opacity: 0.4; cursor: default; }

.sh-bag { padding-top: 0.5rem; border-top: 1px solid rgba(255, 255, 255, 0.12); }
.sh-bag-title { margin: 0 0 0.35rem; font-size: 0.8rem; }
.sh-bag-line { display: flex; flex-wrap: wrap; gap: 0.3rem; margin: 0 0 0.3rem; }
.sh-chip {
  padding: 0.1rem 0.45rem;
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 999px;
  font-size: 0.72rem;
}
.sh-chip--tool { border-color: #f0b429; color: #f7d774; }
.sh-none { font-size: 0.75rem; opacity: 0.5; }

.sh-rule { margin: 0; font-size: 0.72rem; opacity: 0.45; line-height: 1.4; }

@media (max-width: 620px) {
  .sh-row { grid-template-columns: 1fr auto; }
  .sh-buy { grid-column: 1 / 3; }
}
</style>
