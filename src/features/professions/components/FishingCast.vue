<template>
  <div class="fc" :class="`fc--${fishing.phase}`">
    <div class="fc-water" aria-hidden="true">
      <span class="fc-ripple" />
      <span class="fc-bobber" />
    </div>
    <p class="fc-hint" role="status">{{ HINT[fishing.phase] }}</p>
    <button v-if="fishing.phase === 'waiting' || fishing.phase === 'bite'" class="pf-btn fc-reel" @click="reel">¡Recoger!</button>
    <button v-else class="pf-btn" :disabled="disabled" @click="cast">{{ fishing.phase === 'idle' ? 'Lanzar caña' : 'Lanzar de nuevo' }}</button>
  </div>
</template>

<script setup lang="ts">
import { onUnmounted, shallowRef } from 'vue'
import { createSeededRandom } from '../domain/rng'
import { castLine, IDLE_FISHING, reelLine, tickFishing, type FishingPhase } from '../ui/fishingSession'

// Fishing identity: wait for the bite and react. The catch itself still uses
// the shared gathering resolver through the parent panel.
defineProps<{ disabled: boolean }>()
const emit = defineEmits<{ caught: []; escaped: [] }>()

const HINT: Readonly<Record<FishingPhase, string>> = {
  idle: 'Lanzá y esperá a que pique',
  waiting: 'Esperando… no recojas antes de tiempo',
  bite: '¡Pica! Recogé ya',
  caught: '¡Lo sacaste!',
  escaped: 'Se escapó · no gastaste energía',
}

const random = createSeededRandom(Date.now() >>> 0)
const fishing = shallowRef(IDLE_FISHING)
let timer: ReturnType<typeof setInterval> | null = null

function stop(): void {
  if (timer) clearInterval(timer)
  timer = null
}

function cast(): void {
  fishing.value = castLine(Date.now(), random)
  stop()
  timer = setInterval(() => {
    const next = tickFishing(fishing.value, Date.now())
    if (next.phase === fishing.value.phase) return
    fishing.value = next
    if (next.phase === 'escaped') {
      stop()
      emit('escaped')
    }
  }, 50)
}

function reel(): void {
  fishing.value = reelLine(fishing.value, Date.now())
  stop()
  if (fishing.value.phase === 'caught') emit('caught')
  else emit('escaped')
}

onUnmounted(stop)
</script>

<style scoped>
.fc { display: grid; grid-template-columns: 64px 1fr auto; align-items: center; gap: 0.75rem; width: 100%; }
.fc-water { position: relative; height: 48px; border-radius: 10px; background: linear-gradient(#3b7fd6, #1f4f9c); overflow: hidden; }
.fc-bobber { position: absolute; left: 50%; top: 45%; width: 12px; height: 12px; border-radius: 50%; background: linear-gradient(#ff5a5a 50%, #fff 50%); transform: translate(-50%, -50%); }
.fc-ripple { position: absolute; left: 50%; top: 55%; width: 26px; height: 8px; border: 2px solid rgba(255, 255, 255, 0.5); border-radius: 50%; transform: translate(-50%, -50%); opacity: 0; }
.fc--waiting .fc-bobber { animation: fc-float 1.6s ease-in-out infinite; }
.fc--bite .fc-bobber { animation: fc-bite 0.18s linear infinite; }
.fc--bite .fc-ripple { opacity: 1; animation: fc-ripple 0.5s ease-out infinite; }
.fc--caught .fc-bobber { top: 20%; }
.fc-hint { margin: 0; color: var(--pf-soft); font-size: 0.88rem; }
.fc--bite .fc-hint { color: var(--pf-gold); font-weight: 800; }
.fc--escaped .fc-hint { color: var(--pf-warn); }
.fc-reel { background: var(--pf-soft); }
.fc--bite .fc-reel { background: var(--pf-gold); animation: fc-hot 0.4s ease-in-out infinite; }
@keyframes fc-float { 50% { transform: translate(-50%, -30%); } }
@keyframes fc-bite { 50% { transform: translate(-50%, 0%); } }
@keyframes fc-ripple { to { width: 44px; height: 14px; opacity: 0; } }
@keyframes fc-hot { 50% { transform: scale(1.05); } }
@media (max-width: 520px) {
  .fc { grid-template-columns: 56px 1fr; }
  .fc .pf-btn { grid-column: 1 / -1; }
}
</style>
