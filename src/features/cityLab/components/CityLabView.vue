<script setup lang="ts">
// City Mapping Lab — /dev/city-lab (DEV only; production never registers the route).
//
// EDIT → PLAY → EDIT → EXPORT on a working copy of Ciudad Corazón. The real
// town definition is read, never written: the output is a patch for review.

import { onUnmounted, ref } from 'vue'
import { useCityLab } from '../state/useCityLab'
import LabFindings from './LabFindings.vue'
import LabInspector from './LabInspector.vue'
import LabPalette from './LabPalette.vue'
import LabPatchDialog from './LabPatchDialog.vue'
import LabStage from './LabStage.vue'
import LabToolbar from './LabToolbar.vue'
import TreeCompare from './TreeCompare.vue'

const lab = useCityLab()
// DEV probe for console QA, like the dungeon lab's `window.__dungeon`: /dev/city-lab only exists in development.
if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__cityLab = lab
const stage = ref<InstanceType<typeof LabStage> | null>(null)
const dialog = ref<'export' | 'import' | null>(null)
const comparing = ref(false)

function focus(tx: number, ty: number): void {
  stage.value?.focus({ tx, ty })
}

function onZoom(action: 'in' | 'out' | 'reset' | 'fit'): void {
  const s = stage.value
  if (!s) return
  if (action === 'in') s.zoomIn()
  else if (action === 'out') s.zoomOut()
  else if (action === 'reset') s.zoomReset()
  else s.fitCity()
}

function reset(): void {
  const what = lab.dirty.value ? `Se pierden todos los cambios (${lab.summary.value}) y el LOCAL DRAFT.` : 'No hay cambios.'
  if (window.confirm(`RESET TO BASELINE\n\n${what}\nLa ciudad del repo no se toca. ¿Continuar?`)) lab.resetToBaseline()
}

onUnmounted(() => lab.dispose())
</script>

<template>
  <div class="lab">
    <LabToolbar :lab="lab" @export="dialog = 'export'" @import="dialog = 'import'" @reset="reset" @compare="comparing = true" @zoom="onZoom" />

    <div v-if="lab.pendingDraft.value" class="draft">
      Hay un <strong>LOCAL DRAFT</strong> de este navegador ({{ new Date(lab.pendingDraft.value.savedAt).toLocaleString() }}).
      No es un patch exportado ni se guarda en ningún lado más.
      <button type="button" @click="lab.restoreDraft()">Recuperar</button>
      <button type="button" @click="lab.discardDraft()">Descartar</button>
    </div>

    <div class="body" :class="{ 'body--play': lab.mode.value === 'play' }">
      <LabPalette v-if="lab.mode.value === 'edit'" :lab="lab" />
      <div class="center">
        <LabStage ref="stage" :lab="lab" class="viewport" />
        <LabFindings :lab="lab" @focus="focus" />
      </div>
      <LabInspector v-if="lab.mode.value === 'edit'" :lab="lab" @focus="focus" />
    </div>

    <footer class="status">
      <span class="mode" :class="lab.mode.value">{{ lab.mode.value === 'edit' ? 'EDIT' : 'PLAY' }}</span>
      <span class="summary" :title="lab.summary.value">Working copy: {{ lab.summary.value }}</span>
      <span class="draftinfo">{{ lab.draftSavedAt.value ? `LOCAL DRAFT guardado ${new Date(lab.draftSavedAt.value).toLocaleTimeString()}` : 'LOCAL DRAFT: vacío' }}</span>
      <span v-if="lab.hover.value" class="coords">tx {{ lab.hover.value.tx }} · ty {{ lab.hover.value.ty }}</span>
      <span v-if="lab.status.value" class="msg" :class="lab.status.value.tone">{{ lab.status.value.text }}</span>
    </footer>

    <LabPatchDialog v-if="dialog" :lab="lab" :kind="dialog" @close="dialog = null" />
    <TreeCompare v-if="comparing" :clock="lab.clock.value" @close="comparing = false" />
  </div>
</template>

<style scoped>
.lab { display: flex; flex-direction: column; height: 100vh; background: #0b0f1a; color: #dfe7ff; }
.draft { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 6px 12px; background: #3b2f0c; color: #ffe7a3; font: 12px system-ui, sans-serif; }
.draft button { padding: 3px 8px; border: 1px solid #a0822c; border-radius: 6px; background: #5a4612; color: #fff; cursor: pointer; }
.body { flex: 1; display: grid; grid-template-columns: 230px 1fr 280px; min-height: 0; }
.body--play { grid-template-columns: 1fr; }
.center { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
.viewport { flex: 1; }
.status { display: flex; gap: 14px; align-items: center; padding: 5px 12px; background: #141a2b; border-top: 1px solid #2a3350; font: 12px system-ui, sans-serif; white-space: nowrap; overflow: hidden; }
.mode { padding: 1px 8px; border-radius: 4px; font-weight: 700; }
.mode.edit { background: #3c5bd6; }
.mode.play { background: #2e8b4a; }
.summary { color: #aab4d4; overflow: hidden; text-overflow: ellipsis; max-width: 32%; }
.draftinfo { color: #d9b650; }
.coords { font-family: ui-monospace, monospace; color: #cfe0ff; }
.msg { overflow: hidden; text-overflow: ellipsis; }
.msg.ok { color: #7dea9a; }
.msg.warn { color: #ffc14d; }
.msg.error { color: #ff8a8a; }
@media (max-width: 900px) {
  .body { grid-template-columns: 1fr; }
  .body > aside { display: none; }
}
</style>
