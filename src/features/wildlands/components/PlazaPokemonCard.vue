<template>
  <div class="pc-backdrop" @click.self="emit('close')">
    <section class="pc-card" role="dialog" aria-modal="true" :aria-label="card.name">
      <header class="pc-head">
        <h2 class="pc-name">{{ card.name }}</h2>
        <span v-if="card.mine" class="pc-mine">Tuyo</span>
        <button class="pc-close" aria-label="Cerrar" @click="emit('close')">
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 5l10 10M15 5 5 15" /></svg>
        </button>
      </header>
      <dl v-if="card.owned" class="pc-facts">
        <dt>Dueño</dt>
        <dd class="pc-owner">{{ card.ownerUsername ?? 'Entrenador anónimo' }}</dd>
        <dt>Precio</dt>
        <dd class="pc-price">{{ card.price.toLocaleString('es-AR') }} tokens</dd>
      </dl>
      <p v-else class="pc-muted">Ya no tiene dueño.</p>
      <button class="pc-market" @click="emit('market')">Ver en el Mercado</button>
    </section>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import type { PlazaCard } from '../lobby/usePlazaData'

// Card for an owned Pokémon tapped in the plaza. Data comes from the live slots,
// so owner and price update while it is open. Usernames are untrusted text.
defineProps<{ card: PlazaCard }>()
const emit = defineEmits<{ close: []; market: [] }>()

const onKeyDown = (e: KeyboardEvent) => {
  if (e.key === 'Escape') emit('close')
}
onMounted(() => window.addEventListener('keydown', onKeyDown))
onUnmounted(() => window.removeEventListener('keydown', onKeyDown))
</script>

<style scoped>
.pc-backdrop {
  position: absolute;
  inset: 0;
  z-index: 12;
}

.pc-card {
  position: absolute;
  left: 50%;
  bottom: 5.5rem;
  box-sizing: border-box;
  width: min(340px, calc(100% - 1.5rem));
  padding: 0.85rem 1rem 1rem;
  border: 2px solid #3a5fb8;
  border-radius: 14px;
  background: rgba(16, 26, 54, 0.96);
  color: #fff;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45);
  transform: translateX(-50%);
}

.pc-head {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.pc-name {
  flex: 1;
  margin: 0;
  overflow: hidden;
  font-size: 1.1rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pc-mine {
  padding: 0.1rem 0.5rem;
  border-radius: 999px;
  background: #ffd23f;
  color: #101a36;
  font-size: 0.75rem;
  font-weight: 700;
}

.pc-close {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  margin: -0.5rem -0.6rem -0.5rem 0;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: inherit;
  cursor: pointer;
}
.pc-close:hover,
.pc-close:focus-visible {
  background: rgba(255, 255, 255, 0.12);
}
.pc-close svg {
  width: 18px;
  height: 18px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
}

.pc-facts {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0.3rem 0.9rem;
  margin: 0.6rem 0 0.9rem;
}
.pc-facts dt {
  color: #9fb2da;
  font-size: 0.85rem;
}
.pc-facts dd {
  margin: 0;
  overflow-wrap: anywhere;
}
.pc-price {
  color: #ffd27a;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.pc-muted {
  margin: 0.6rem 0 0.9rem;
  color: #9fb2da;
}

.pc-market {
  width: 100%;
  min-height: 44px;
  border: 0;
  border-radius: 10px;
  background: #ffd27a;
  color: #101a36;
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}
</style>
