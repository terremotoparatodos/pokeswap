<template>
  <aside class="ph" :class="healthClass" aria-label="Rendimiento del playtest" title="La latencia es una medición HTTP aproximada al servidor realtime.">
    <span><b>{{ fps }}</b> FPS</span>
    <span><b>{{ frameMs.toFixed(1) }}</b> ms frame</span>
    <span><b>{{ pingLabel }}</b> red</span>
  </aside>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'

defineProps<{ fps: number; frameMs: number }>()

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
  top: 9.75rem;
  right: 1rem;
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
.ph--good { border-left-color: #57d68d; }
.ph--warn { border-left-color: #f0b429; }
.ph--bad { border-left-color: #ef6b6b; }
.ph--unknown { opacity: .72; }
@media (max-width: 720px) {
  .ph { top: 7.4rem; right: .75rem; min-width: 86px; padding: .32rem .45rem; font-size: .58rem; }
}
</style>
