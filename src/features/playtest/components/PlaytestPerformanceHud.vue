<template>
  <aside class="ph" :class="[healthClass, { 'ph--min': !expanded }]" aria-label="Rendimiento del playtest" title="La latencia es una medición HTTP aproximada al servidor realtime.">
    <!-- MOBILE-1: one line by default on a phone; tapping it opens every metric. -->
    <button type="button" class="ph-toggle" :aria-expanded="expanded" @click="toggle">
      <template v-if="expanded">PERF ▾</template>
      <template v-else>PERF · <b>{{ fps }}</b> fps · <b>{{ frameP95Ms.toFixed(1) }}</b> ms · <b>{{ remoteActors }}</b> rem</template>
    </button>
    <template v-if="expanded">
    <span><b>{{ fps }}</b> FPS</span>
    <span><b>{{ frameMs.toFixed(1) }}</b> ms promedio</span>
    <span><b>{{ frameP95Ms.toFixed(1) }}</b> ms p95</span>
    <span><b>{{ frameP99Ms.toFixed(1) }}</b> ms p99</span>
    <span><b>{{ frameMaxMs.toFixed(1) }}</b> ms máx</span>
    <span><b>{{ longFramePercent }}</b>% &gt;33 ms</span>
    <span><b>{{ remoteActors }}</b> remotos</span>
    <span><b>{{ remoteUpdatesPerSecond.toFixed(1) }}</b> upd/s</span>
    <span><b>{{ groundComposeMs.toFixed(1) }}</b> ms suelo</span>
    <span><b>{{ groundProjectMs.toFixed(1) }}</b> ms proyección</span>
    <span><b>{{ actorCollectMs.toFixed(1) }}</b> ms collect</span>
    <span><b>{{ actorSortMs.toFixed(1) }}</b> ms sort</span>
    <span><b>{{ spriteDrawMs.toFixed(1) }}</b> ms sprites</span>
    <span><b>{{ lightingMs.toFixed(1) }}</b> ms luz</span>
    <span><b>{{ loadedChunks }}</b> chunks vivos</span>
    <span><b>{{ generatedChunks }}</b>/<b>{{ evictedChunks }}</b> gen/evict</span>
    <span><b>{{ lastChunkBuildMs.toFixed(1) }}</b>/<b>{{ maxChunkBuildMs.toFixed(1) }}</b> ms chunk últ/máx</span>
    <span><b>{{ pingLabel }}</b> HTTP</span>
    <template v-if="presence">
      <span title="Movimiento enviado → confirmado por el servidor"><b>{{ presence.rttMs.p50 }}</b>/<b>{{ presence.rttMs.p95 }}</b>/<b>{{ presence.rttMs.p99 }}</b>/<b>{{ presence.rttMs.max }}</b> ms RTT mov</span>
      <span><b>{{ presence.lastSent }}</b>/<b>{{ presence.lastAcked }}</b> seq env/conf</span>
      <span><b>{{ presence.reconciliations }}</b> reconc</span>
      <span><b>{{ presence.solidRecoveries }}</b> punto seguro</span>
      <span><b>{{ presence.rejections.rate }}</b>/<b>{{ presence.rejections.replay }}</b>/<b>{{ presence.rejections.other }}</b> rech ritmo/replay/otro</span>
      <span><b>{{ presence.placements }}</b>/<b>{{ presence.staleAcksIgnored }}</b> reubic/ack viejo</span>
      <span><b>{{ presence.disconnects }}</b> desconex</span>
    </template>
    </template>
  </aside>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import type { PresenceDiagnosticsSnapshot } from '../../wildlands/multiplayer/domain/presenceDiagnostics'

defineProps<{
  fps: number
  frameMs: number
  frameP95Ms: number
  frameP99Ms: number
  frameMaxMs: number
  longFramePercent: number
  remoteActors: number
  remoteUpdatesPerSecond: number
  groundComposeMs: number
  groundProjectMs: number
  actorCollectMs: number
  actorSortMs: number
  spriteDrawMs: number
  lightingMs: number
  loadedChunks: number
  generatedChunks: number
  evictedChunks: number
  lastChunkBuildMs: number
  maxChunkBuildMs: number
  presence?: PresenceDiagnosticsSnapshot | null
}>()

// Phones start folded: the full list covered a fifth of the screen. The choice
// is a per-device display preference, nothing more.
const EXPANDED_KEY = 'pokeswap:perf-hud-expanded'
function initialExpanded(): boolean {
  try {
    const saved = localStorage.getItem(EXPANDED_KEY)
    if (saved !== null) return saved === '1'
  } catch { /* storage unavailable: fall back to the screen size */ }
  return !(typeof matchMedia === 'function' && matchMedia('(max-width: 720px), (max-height: 500px)').matches)
}
const expanded = ref(initialExpanded())
function toggle(): void {
  expanded.value = !expanded.value
  try { localStorage.setItem(EXPANDED_KEY, expanded.value ? '1' : '0') } catch { /* preference not kept */ }
}

const realtimeUrl = import.meta.env.VITE_REALTIME_URL as string | undefined
const ping = ref<number | null>(null)
const failed = ref(false)
let timer: ReturnType<typeof setInterval> | null = null

const pingLabel = computed(() => failed.value ? 'sin dato' : ping.value === null ? '…' : `~${ping.value} ms`)
const healthClass = computed(() => {
  if (failed.value || ping.value === null) return 'ph--unknown'
  if (ping.value >= 250) return 'ph--bad'
  if (ping.value >= 120) return 'ph--warn'
  return 'ph--good'
})

function probeUrl(): string | null {
  if (!realtimeUrl) return null
  try {
    const url = new URL(realtimeUrl)
    url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:'
    url.pathname = '/'
    url.search = `?playtest_ping=${Date.now()}`
    return url.toString()
  } catch {
    return null
  }
}

async function measure(): Promise<void> {
  const url = probeUrl()
  if (!url || document.visibilityState === 'hidden') return
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 4000)
  const started = performance.now()
  try {
    // A no-cors GET resolves even when the service's root answers opaquely. It
    // measures the network path only and never carries auth or writes state.
    await fetch(url, { method: 'GET', mode: 'no-cors', cache: 'no-store', signal: controller.signal })
    ping.value = Math.round(performance.now() - started)
    failed.value = false
  } catch {
    failed.value = true
  } finally {
    clearTimeout(timeout)
  }
}

onMounted(() => {
  void measure()
  timer = setInterval(() => void measure(), 10_000)
})
onUnmounted(() => { if (timer) clearInterval(timer) })
</script>

<style scoped>
.ph {
  position: fixed;
  top: calc(9.75rem + var(--safe-top, 0px));
  right: calc(1rem + var(--safe-right, 0px));
  z-index: 60;
  display: grid;
  gap: 0.12rem;
  min-width: 94px;
  padding: 0.42rem 0.55rem;
  border: 1px solid rgba(255,255,255,.24);
  border-left: 3px solid #92a0bf;
  border-radius: 9px;
  background: rgba(9, 15, 30, .86);
  color: #cbd5ed;
  font: 600 0.64rem/1.25 system-ui, sans-serif;
  font-variant-numeric: tabular-nums;
  pointer-events: none;
}
.ph b { color: #fff; }
.ph-toggle {
  justify-self: start;
  margin: 0 0 0.1rem;
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  letter-spacing: 0.02em;
  cursor: pointer;
  pointer-events: auto;
}
.ph--min { min-width: 0; padding: 0.3rem 0.5rem; }
.ph--min .ph-toggle { margin: 0; white-space: nowrap; }
/* The toggle is the only part that takes taps; the list lets them through to the world. */
.ph-toggle::after { content: ''; position: absolute; inset: -6px; }
.ph-toggle { position: relative; }
.ph--good { border-left-color: #57d68d; }
.ph--warn { border-left-color: #f0b429; }
.ph--bad { border-left-color: #ef6b6b; }
.ph--unknown { opacity: .72; }
@media (max-width: 720px), (max-height: 500px) {
  /* Under the minimap and the area indicator. */
  .ph { top: calc(0.75rem + 96px + 0.4rem + 32px + 0.35rem + var(--safe-top, 0px)); right: calc(.75rem + var(--safe-right, 0px)); min-width: 86px; padding: .32rem .45rem; font-size: .58rem; }
  .ph--min { min-width: 0; }
}
</style>
