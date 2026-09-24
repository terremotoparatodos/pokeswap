<template>
  <aside class="pp" aria-label="Captura de rendimiento (PERF-1)">
    <header>
      <b>PERF-1</b>
      <span :class="{ rec: recording }">{{ recording ? `● ${scenarioLabel} ${elapsed}s` : 'detenido' }}</span>
    </header>
    <div class="row">
      <input v-model="label" aria-label="Etiqueta" placeholder="etiqueta (p. ej. pc-144hz)" :disabled="recording">
      <select v-model="scenario" aria-label="Escenario" :disabled="recording">
        <option value="">manual</option>
        <option v-for="option in scenarios" :key="option.id" :value="option.id">{{ option.id }}</option>
      </select>
    </div>
    <div class="row">
      <button type="button" @click="toggle">{{ recording ? 'Detener' : 'Iniciar' }}</button>
      <button type="button" :disabled="recording || !captured" @click="send">Enviar a PC</button>
      <button type="button" :disabled="recording || !captured" @click="download">Descargar</button>
    </div>
    <dl v-if="live">
      <dt>cadencia</dt><dd>{{ live.cadence }}</dd>
      <dt>intervalo p50/p95/p99</dt><dd>{{ live.interval }}</dd>
      <dt>tarde / &gt;50 ms</dt><dd>{{ live.late }}</dd>
      <dt>cámara despareja</dt><dd>{{ live.uneven }}</dd>
      <dt>remotos · saltos · esperas</dt><dd>{{ live.remote }}</dd>
      <dt>sprites fallback→hoja / vuelta</dt><dd>{{ live.sprites }}</dd>
    </dl>
    <p v-if="status" class="status">{{ status }}</p>
  </aside>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import type { PerfSession } from './perfSession'
import { SCENARIOS } from './scenarioDriver'

const props = defineProps<{ session: PerfSession; autoScenario?: string | null; autoLabel?: string | null }>()

const scenarios = Object.values(SCENARIOS)
const label = ref(props.autoLabel ?? '')
const scenario = ref(props.autoScenario ?? '')
const recording = ref(false)
const captured = ref<Record<string, unknown> | null>(null)
const status = ref('')
const startedAt = ref(0)
const now = ref(0)
const live = ref<Record<string, string> | null>(null)
let timer: ReturnType<typeof setInterval> | null = null

const elapsed = computed(() => Math.round((now.value - startedAt.value) / 1000))
const scenarioLabel = computed(() => scenario.value || 'manual')

function refresh(): void {
  now.value = performance.now()
  const s = props.session
  if (recording.value && !s.isRecording) finish()
  if (!s.isRecording && !captured.value) return
  const pacing = s.pacing.report()
  const motion = s.motion.report()
  const remote = s.remote.report()
  live.value = {
    cadence: `${pacing.cadence.observedHz} Hz${pacing.cadence.nominalHz ? ` (${pacing.cadence.nominalHz})` : ''}`,
    interval: `${pacing.intervalMs.p50} / ${pacing.intervalMs.p95} / ${pacing.intervalMs.p99} ms`,
    late: `${pacing.latePercent}% · ${pacing.over50ms}`,
    uneven: `${motion.unevenPercent}% · ${motion.stalledFrames} quietos`,
    remote: `${remote.lifecycle.maxConcurrent} · ${remote.motion.snaps} · ${remote.motion.stopAndGo}`,
    sprites: `${remote.sprites.fallbackToSheet} / ${remote.sprites.sheetToFallback}`,
  }
}

function toggle(): void {
  if (recording.value) { props.session.stop(); finish(); return }
  captured.value = null
  status.value = ''
  props.session.start(label.value || 'sin-etiqueta', scenario.value || null)
  startedAt.value = performance.now()
  recording.value = true
}

function finish(): void {
  recording.value = false
  captured.value = props.session.export()
  status.value = 'Captura lista.'
  if (props.autoScenario) void send()
}

async function send(): Promise<void> {
  if (!captured.value) return
  status.value = 'Enviando…'
  try {
    const response = await fetch('/__perf/report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(captured.value) })
    status.value = response.ok ? `Guardado en la PC: ${(await response.json()).saved}` : `La PC respondió ${response.status}`
  } catch (error) {
    status.value = `No se pudo enviar: ${error instanceof Error ? error.message : String(error)}`
  }
}

function download(): void {
  if (!captured.value) return
  const blob = new Blob([JSON.stringify(captured.value, null, 2)], { type: 'application/json' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = `perf-${label.value || 'captura'}-${scenario.value || 'manual'}.json`
  link.click()
  URL.revokeObjectURL(link.href)
}

onMounted(() => {
  timer = setInterval(refresh, 500)
  // ?perfScenario=… starts by itself once the world is running.
  if (props.autoScenario) setTimeout(toggle, 1500)
})
onUnmounted(() => { if (timer) clearInterval(timer) })
</script>

<style scoped>
.pp {
  position: absolute; left: 8px; bottom: 8px; z-index: 40; width: min(320px, calc(100vw - 16px));
  padding: 8px 10px; border-radius: 10px; background: rgba(10, 16, 34, 0.86); color: #eef3ff;
  font: 12px/1.35 system-ui, sans-serif; pointer-events: auto;
}
header { display: flex; justify-content: space-between; margin-bottom: 6px; }
.rec { color: #ff7b7b; }
.row { display: flex; gap: 6px; margin-bottom: 6px; }
.row input, .row select { flex: 1; min-width: 0; font: inherit; }
button { flex: 1; font: inherit; padding: 4px 6px; }
dl { display: grid; grid-template-columns: auto 1fr; gap: 2px 8px; margin: 0; }
dt { opacity: 0.7; }
dd { margin: 0; font-variant-numeric: tabular-nums; }
.status { margin: 6px 0 0; opacity: 0.85; word-break: break-all; }
</style>
