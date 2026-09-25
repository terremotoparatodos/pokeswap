<template>
  <div class="pt-bug">
    <!-- MOBILE-1: the chip that opens the form also closes it; × is the alternative. -->
    <button
      type="button"
      class="pt-bug-fab"
      :class="{ 'pt-bug-fab--on': open }"
      :aria-label="open ? 'Cerrar el reporte' : 'Reportar un bug o algo confuso'"
      :aria-expanded="open"
      @click="open ? (open = false) : openForm()"
    >
      <span aria-hidden="true">🐞</span>
      <span class="pt-bug-fab-text">Reportar</span>
    </button>

    <div v-if="open" class="pt-bug-card" role="dialog" aria-label="Reportar">
      <div class="pt-bug-head">
        <strong>Contanos qué pasó</strong>
        <button type="button" class="pt-bug-x" aria-label="Cerrar" @click="open = false">×</button>
      </div>

      <div class="pt-bug-cats" role="radiogroup" aria-label="Tipo de reporte">
        <button
          v-for="option in BUG_CATEGORIES"
          :key="option"
          type="button"
          role="radio"
          :aria-checked="category === option"
          class="pt-bug-cat"
          :class="{ 'pt-bug-cat--on': category === option }"
          @click="category = option"
        >{{ CATEGORY_LABEL[option] }}</button>
      </div>

      <textarea
        v-model="text"
        class="pt-bug-text"
        rows="4"
        :maxlength="MAX_REPORT_LENGTH"
        placeholder="Qué estabas haciendo y qué pasó."
      />

      <p class="pt-bug-meta">{{ metaLine }}</p>
      <p class="pt-bug-note">Se copia al portapapeles. No incluye tu sesión ni tus datos de cuenta.</p>

      <button type="button" class="pt-bug-send" @click="copy">
        {{ copied ? '¡Copiado! Pegalo en el chat' : 'Copiar reporte' }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { trackKeyboardInset } from '../../../shared/ui/keyboardInset'
import {
  BUG_CATEGORIES, CATEGORY_LABEL, MAX_REPORT_LENGTH, buildBugReport, formatBugReport, type BugCategory,
} from '../domain/bugReport'
import { buildLabel } from '../domain/buildIdentity'
import { BUILD } from '../playtestBuild'
import { usePlaytestContext } from '../state/playtestContext'

// Clipboard is the whole delivery mechanism, on purpose: a report endpoint is a
// write path, and a two-hour playtest does not need one. The player pastes it
// into the stream chat, which is where we are already watching.
const context = usePlaytestContext()
const open = ref(false)
const category = ref<BugCategory>('BUG')
const text = ref('')
const copied = ref(false)

const metaLine = computed(() => {
  const place = context.area.value === null
    ? 'fuera del mundo'
    : `${context.area.value} (${context.tx.value ?? '—'}, ${context.ty.value ?? '—'})`
  return `${buildLabel(BUILD)} · ${place}`
})

function openForm(): void {
  open.value = true
  copied.value = false
}

// The form rides above the iOS keyboard (shared with the chat); Escape closes it.
const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') open.value = false }
let stopKeyboard: (() => void) | null = null
watch(open, isOpen => {
  if (isOpen) {
    stopKeyboard ??= trackKeyboardInset()
    window.addEventListener('keydown', onKeyDown)
  } else {
    stopKeyboard?.(); stopKeyboard = null
    window.removeEventListener('keydown', onKeyDown)
  }
})
onUnmounted(() => {
  stopKeyboard?.()
  window.removeEventListener('keydown', onKeyDown)
})

async function copy(): Promise<void> {
  const report = buildBugReport({
    category: category.value,
    text: text.value,
    buildLabel: buildLabel(BUILD),
    area: context.area.value,
    tx: context.tx.value,
    ty: context.ty.value,
    surface: context.surface.value,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    userAgent: navigator.userAgent,
    at: Date.now(),
  })
  const serialized = formatBugReport(report)
  try {
    await navigator.clipboard.writeText(serialized)
  } catch {
    // Clipboard refused (insecure context, permission). Fall back to a
    // selection the player can copy by hand rather than losing the report.
    window.prompt('Copiá este reporte:', serialized)
  }
  copied.value = true
  text.value = ''
}
</script>

<style scoped>
.pt-bug {
  position: fixed;
  right: calc(1rem + var(--safe-right, 0px));
  bottom: calc(1rem + var(--safe-bottom, 0px));
  z-index: 60;
  font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
}

.pt-bug-fab {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  min-height: 40px;
  padding: 0 0.8rem;
  border: 2px solid #3a5fb8;
  border-radius: 999px;
  background: rgba(16, 26, 54, 0.92);
  color: #dfe8ff;
  font: inherit;
  font-size: 0.78rem;
  font-weight: 700;
  cursor: pointer;
}

/* Open: the chip reads as pressed, and pressing it again closes. */
.pt-bug-fab--on {
  border-color: #8fb0ff;
  background: #3a5fb8;
  color: #fff;
}

/* The card opens above the chip, which stays where it is. */
.pt-bug-card {
  position: absolute;
  right: 0;
  bottom: calc(100% + 0.5rem);
  width: min(22rem, calc(100vw - 1.5rem));
  max-height: calc(100dvh - 5rem - var(--safe-top, 0px) - var(--safe-bottom, 0px));
  overflow-y: auto;
  padding: 0.85rem;
  border: 2px solid #3a5fb8;
  border-radius: 12px;
  background: rgba(12, 20, 42, 0.97);
  color: #dfe8ff;
  font-size: 0.85rem;
  box-shadow: 0 12px 34px rgba(0, 0, 0, 0.45);
}
.pt-bug-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.6rem; }
.pt-bug-x {
  width: 36px;
  height: 36px;
  border: 1px solid rgba(255, 255, 255, 0.22);
  border-radius: 8px;
  background: transparent;
  color: #dfe8ff;
  font-size: 1.3rem;
  line-height: 1;
  cursor: pointer;
}
.pt-bug-cats { display: grid; gap: 0.3rem; margin-bottom: 0.55rem; }
.pt-bug-cat {
  min-height: 36px;
  padding: 0 0.6rem;
  border: 2px solid #2b3f70;
  border-radius: 9px;
  background: transparent;
  color: #dfe8ff;
  font: inherit;
  font-size: 0.8rem;
  text-align: left;
  cursor: pointer;
}
.pt-bug-cat--on { border-color: #f0b429; color: #f7d774; }
.pt-bug-text {
  width: 100%;
  padding: 0.5rem;
  border: 2px solid #2b3f70;
  border-radius: 9px;
  background: #0b1229;
  color: #fff;
  font: inherit;
  font-size: 0.85rem;
  resize: vertical;
}
.pt-bug-meta { margin: 0.45rem 0 0.2rem; font-size: 0.7rem; opacity: 0.6; word-break: break-word; }
.pt-bug-note { margin: 0 0 0.55rem; font-size: 0.7rem; opacity: 0.5; }
.pt-bug-send {
  width: 100%;
  min-height: 42px;
  border: 2px solid #f0b429;
  border-radius: 9px;
  background: #f0b429;
  color: #101a36;
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}

@media (max-width: 720px), (max-height: 500px) {
  /* The lobby HUD is nearly full width on a phone and reaches this corner, so
     the button joins the row above it rather than sitting on top of it. */
  .pt-bug { right: calc(0.6rem + var(--safe-right, 0px)); bottom: calc(0.75rem + var(--safe-bottom, 0px)); }
  .pt-bug-fab-text { display: none; }
  .pt-bug-fab { min-height: 38px; width: 38px; justify-content: center; padding: 0; }
}

/* iOS zooms the page into any focused field under 16 px. */
@media (pointer: coarse) {
  .pt-bug-text { font-size: 16px; }
}
/* Phones: a sheet across the screen above the chip, and above the keyboard while typing. */
@media (max-width: 720px), (max-height: 500px) {
  .pt-bug-card {
    position: fixed;
    left: calc(0.6rem + var(--safe-left, 0px));
    right: calc(0.6rem + var(--safe-right, 0px));
    bottom: max(calc(0.75rem + 38px + 0.5rem + var(--safe-bottom, 0px)), calc(var(--keyboard-inset, 0px) + 0.4rem));
    width: auto;
    max-height: calc(var(--visible-height, 100dvh) - 1rem - var(--safe-top, 0px));
    box-sizing: border-box;
  }
}
@media (min-width: 721px) and (max-height: 500px) {
  .pt-bug-card { left: auto; width: min(22rem, 48vw); }
}
</style>
