<template>
  <div class="lp-backdrop" @click.self="emit('close')">
    <section
      ref="sheetRef"
      class="lp-sheet"
      role="dialog"
      aria-modal="true"
      :aria-label="title"
      tabindex="-1"
    >
      <header class="lp-head">
        <span class="lp-grip" aria-hidden="true" />
        <h2 class="lp-title">{{ title }}</h2>
        <button class="lp-close" aria-label="Cerrar y volver a la ciudad" @click="emit('close')">
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 5l10 10M15 5 5 15" /></svg>
        </button>
      </header>
      <div class="lp-body">
        <slot />
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'

// Feature panel over the town: a centred dialog on desktop, a bottom sheet on phones.
defineProps<{ title: string }>()
const emit = defineEmits<{ close: [] }>()

const sheetRef = ref<HTMLElement | null>(null)
let returnFocus: HTMLElement | null = null

onMounted(() => {
  returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  sheetRef.value?.focus()
})

onUnmounted(() => {
  returnFocus?.focus()
})
</script>

<style scoped>
.lp-backdrop {
  position: absolute;
  inset: 0;
  z-index: 20;
  display: grid;
  place-items: center;
  padding: calc(1.5rem + var(--safe-top, 0px)) calc(1.5rem + var(--safe-right, 0px)) calc(1.5rem + var(--safe-bottom, 0px)) calc(1.5rem + var(--safe-left, 0px));
  background: rgba(8, 12, 28, 0.45);
}

.lp-sheet {
  display: flex;
  flex-direction: column;
  width: min(760px, 100%);
  max-height: 86dvh;
  border: 2px solid #3a5fb8;
  border-radius: 16px;
  background: #fbfcff;
  color: #1a1a2e;
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.45);
  overflow: hidden;
  outline: none;
  user-select: text;
}

.lp-head {
  position: relative;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.7rem 0.75rem 0.7rem 1.25rem;
  background: #101a36;
  color: #fff;
}

.lp-grip {
  display: none;
}

.lp-title {
  flex: 1;
  margin: 0;
  font-size: 1.1rem;
  letter-spacing: 0.02em;
}

.lp-close {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: inherit;
  cursor: pointer;
}
.lp-close:hover,
.lp-close:focus-visible {
  background: rgba(255, 255, 255, 0.12);
}
.lp-close svg {
  width: 20px;
  height: 20px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
}

.lp-body {
  flex: 1;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding-bottom: 1rem;
}

/* Feature views were laid out as pages: the panel header already names them. */
.lp-body :deep(main) {
  margin: 1rem auto 0;
}
.lp-body :deep(main > h2:first-child) {
  display: none;
}

@media (max-width: 720px), (max-height: 500px) {
  .lp-backdrop {
    place-items: end stretch;
    padding: 0;
  }
  .lp-sheet {
    width: 100%;
    max-height: 88dvh;
    border-width: 2px 0 0;
    border-radius: 18px 18px 0 0;
  }
  .lp-head {
    padding-top: 1rem;
  }
  .lp-grip {
    display: block;
    position: absolute;
    top: 0.4rem;
    left: 50%;
    width: 40px;
    height: 4px;
    border-radius: 2px;
    background: rgba(255, 255, 255, 0.35);
    transform: translateX(-50%);
  }
  .lp-body {
    padding-bottom: calc(1rem + env(safe-area-inset-bottom));
  }
}
</style>
