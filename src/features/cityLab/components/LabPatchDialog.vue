<script setup lang="ts">
// City Mapping Lab — EXPORT / IMPORT PATCH. Plain text in, plain text out:
// copy, download or paste. Nothing is written to the repository.

import { ref } from 'vue'
import type { CityLab } from '../state/useCityLab'

const props = defineProps<{ lab: CityLab; kind: 'export' | 'import' }>()
const emit = defineEmits<{ close: [] }>()
const lab = props.lab

const text = ref(props.kind === 'export' ? lab.exportPatch() : '')
const message = ref<{ text: string; ok: boolean } | null>(null)

async function copy(): Promise<void> {
  try {
    await navigator.clipboard.writeText(text.value)
    message.value = { text: 'Copiado al portapapeles.', ok: true }
  } catch {
    message.value = { text: 'El navegador no dejó copiar: seleccioná el texto y copialo a mano.', ok: false }
  }
}

function download(): void {
  const blob = new Blob([text.value], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'ciudad-corazon.city-patch.json'
  a.click()
  URL.revokeObjectURL(url)
}

async function pickFile(e: Event): Promise<void> {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (file) text.value = await file.text()
}

function load(): void {
  const result = lab.importPatch(text.value)
  message.value = { text: result.message, ok: result.ok }
  if (result.ok && !result.message.includes('conflictos')) emit('close')
}
</script>

<template>
  <div class="dlg-backdrop" @click.self="emit('close')">
    <div class="dlg" role="dialog" aria-modal="true">
      <header>
        <strong>{{ kind === 'export' ? 'EXPORT PATCH' : 'IMPORT PATCH' }}</strong>
        <button type="button" @click="emit('close')">✕</button>
      </header>
      <p v-if="kind === 'export'" class="note">
        Diferencias respecto de la baseline ({{ lab.summary.value }}). No se aplica a producción: es para revisión humana.
      </p>
      <p v-else class="note">
        Pegá un patch exportado o elegí el archivo. Reemplaza la working copy por <em>baseline + patch</em> (se puede deshacer).
        <input type="file" accept=".json,application/json" @change="pickFile">
      </p>
      <textarea v-model="text" spellcheck="false" :readonly="kind === 'export'" />
      <p v-if="message" class="msg" :class="{ bad: !message.ok }">{{ message.text }}</p>
      <footer>
        <template v-if="kind === 'export'">
          <button type="button" @click="copy">Copiar</button>
          <button type="button" @click="download">Descargar .json</button>
        </template>
        <button v-else type="button" class="accent" :disabled="!text.trim()" @click="load">Importar</button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.dlg-backdrop { position: fixed; inset: 0; z-index: 20; display: grid; place-items: center; background: rgba(0, 0, 0, 0.55); }
.dlg { display: flex; flex-direction: column; gap: 8px; width: min(820px, 92vw); max-height: 86vh; padding: 12px; border-radius: 10px; background: #141a2b; color: #dfe7ff; font: 13px system-ui, sans-serif; }
header, footer { display: flex; align-items: center; gap: 8px; }
header button { margin-left: auto; }
.note { margin: 0; color: #aab4d4; }
textarea { flex: 1; min-height: 340px; padding: 8px; border: 1px solid #34406a; border-radius: 6px; background: #0b0f1a; color: #cfe0ff; font: 12px ui-monospace, monospace; resize: vertical; }
.msg { margin: 0; white-space: pre-wrap; color: #7dea9a; }
.msg.bad { color: #ff8a8a; }
button { padding: 5px 10px; border: 1px solid #34406a; border-radius: 6px; background: #1d2540; color: #dfe7ff; cursor: pointer; }
button.accent { background: #2e6b3e; border-color: #4ea566; }
button:disabled { opacity: 0.4; }
</style>
