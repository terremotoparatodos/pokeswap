<template>
  <div class="ch" :class="{ 'ch--open': chat.open.value }">
    <!-- The button that opens the chat also closes it (MOBILE-1); the panel's × is the alternative. -->
    <button
      type="button"
      class="ch-tab"
      :class="{ 'ch-tab--on': chat.open.value }"
      :aria-label="chat.open.value ? 'Cerrar el chat' : unreadLabel"
      :aria-expanded="chat.open.value"
      aria-controls="chat-panel"
      @click="toggle"
    >
      <span aria-hidden="true">💬</span>
      <span class="ch-tab-text">Chat</span>
      <span v-if="chat.unread.value && !chat.open.value" class="ch-badge">{{ chat.unread.value > 99 ? '99+' : chat.unread.value }}</span>
    </button>

    <section v-if="chat.open.value" id="chat-panel" class="ch-panel" aria-label="Chat de la zona">
      <header class="ch-head">
        <strong class="ch-title">Chat · {{ areaLabel }}</strong>
        <button type="button" class="ch-x" aria-label="Cerrar el chat" @click="close">×</button>
      </header>

      <ol ref="logRef" class="ch-log" aria-live="polite">
        <li v-if="!chat.lines.value.length" class="ch-empty">
          Nadie dijo nada todavía por acá.
        </li>
        <li v-for="line in chat.lines.value" :key="line.id" class="ch-line">
          <time class="ch-time">{{ formatTime(line.at) }}</time>
          <span class="ch-who">{{ line.username }}:</span>
          <span class="ch-text">{{ line.text }}</span>
        </li>
      </ol>

      <form class="ch-form" @submit.prevent="submit">
        <input
          v-model="draft"
          class="ch-input"
          type="text"
          :maxlength="MAX_CHAT_LENGTH"
          :disabled="!chat.canSend.value"
          :placeholder="placeholder"
          autocomplete="off"
          enterkeyhint="send"
          aria-label="Escribí un mensaje"
          @keydown.stop="onInputKey"
          @blur="settleViewport"
        >
        <button type="submit" class="ch-send" :disabled="!chat.canSend.value || !draft.trim()">Enviar</button>
      </form>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import { MAX_CHAT_LENGTH, formatTime } from '../domain/chatLine'
import { useChat } from '../state/useChat'
import { trackKeyboardInset } from './keyboardInset'

// A log, a box and Enter — the Habbo shape, not a social network. Every line on
// screen came back from the server, including your own, so what you read is
// what the room actually accepted.
//
// `@keydown.stop` on the input matters more than it looks: WildLands listens
// for WASD on the document, and without it typing "was" walks the player away
// while you are mid-sentence.

const AREA_LABELS: Readonly<Record<string, string>> = {
  'ciudad-corazon': 'Ciudad Corazón',
  pradera: 'Pradera Brisa',
}

const chat = useChat()
// The host hides the world hint tray while the open panel owns that corner.
const emit = defineEmits<{ open: [open: boolean] }>()
const draft = ref('')
const logRef = ref<HTMLElement | null>(null)

const areaLabel = computed(() => {
  const id = chat.areaId.value
  return id ? AREA_LABELS[id] ?? id : 'conectando…'
})

const placeholder = computed(() => {
  if (chat.access.value === 'guest') return 'Entrá con tu cuenta para escribir'
  return chat.canSend.value ? 'Escribí y Enter' : 'Conectando…'
})

const unreadLabel = computed(() =>
  chat.unread.value ? `Abrir el chat, ${chat.unread.value} mensajes sin leer` : 'Abrir el chat')

function openChat(): void {
  chat.open.value = true
  chat.markRead()
}

function close(): void {
  chat.open.value = false
}

function toggle(): void {
  if (chat.open.value) close()
  else openChat()
}

/** Escape inside the box closes the chat; every other key stays out of the game. */
function onInputKey(event: KeyboardEvent): void {
  if (event.key === 'Escape') close()
}

// iOS may pan the page to reveal a focused input even though the page itself
// never scrolls; put it back when the keyboard goes away.
function settleViewport(): void {
  if (window.scrollX || window.scrollY) window.scrollTo(0, 0)
}

defineExpose({ close })

function submit(): void {
  if (chat.send(draft.value)) draft.value = ''
}

/** Follow the conversation, the way a chat window is expected to. */
async function scrollToEnd(): Promise<void> {
  await nextTick()
  const log = logRef.value
  if (log) log.scrollTop = log.scrollHeight
}

watch(() => chat.lines.value.length, () => {
  if (chat.open.value) void scrollToEnd()
})
let stopKeyboard: (() => void) | null = null
watch(chat.open, isOpen => {
  if (isOpen) {
    chat.markRead()
    void scrollToEnd()
    stopKeyboard ??= trackKeyboardInset()
  } else {
    stopKeyboard?.()
    stopKeyboard = null
  }
}, { immediate: true })
// Immediate: the open state is shared, so the panel can mount already open.
watch(chat.open, isOpen => emit('open', isOpen), { immediate: true })
onUnmounted(() => {
  stopKeyboard?.()
  emit('open', false)
})
</script>

<style scoped>
/* The tab stays where it is; the panel opens above it (MOBILE-1). */
.ch {
  position: fixed;
  left: calc(1rem + var(--safe-left, 0px));
  bottom: calc(1rem + var(--safe-bottom, 0px));
  z-index: 30;
  font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
}

.ch-tab {
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
/* Open: the button reads as pressed, and pressing it again closes. */
.ch-tab--on {
  border-color: #8fb0ff;
  background: #3a5fb8;
  color: #fff;
  box-shadow: 0 0 0 3px rgba(143, 176, 255, 0.35);
}
.ch-badge {
  min-width: 20px;
  padding: 0 0.3rem;
  border-radius: 999px;
  background: #e03c3c;
  color: #fff;
  font-size: 0.68rem;
  text-align: center;
}

.ch-panel {
  position: fixed;
  left: calc(1rem + var(--safe-left, 0px));
  /* Above the tab column (chat, Skills above it), which stays reachable. */
  bottom: calc(4rem + 40px + 0.5rem + var(--safe-bottom, 0px));
  display: flex;
  flex-direction: column;
  width: min(23rem, calc(100vw - 2rem));
  height: min(19rem, 45dvh);
  border: 2px solid #3a5fb8;
  border-radius: 12px;
  background: rgba(12, 20, 42, 0.95);
  color: #dfe8ff;
  box-shadow: 0 12px 34px rgba(0, 0, 0, 0.45);
  overflow: hidden;
}

.ch-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.35rem 0.4rem 0.35rem 0.7rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.12);
}
.ch-title { font-size: 0.8rem; }
.ch-x {
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

.ch-log {
  flex: 1;
  min-height: 0;
  margin: 0;
  padding: 0.4rem 0.6rem;
  list-style: none;
  overflow-y: auto;
  font-size: 0.82rem;
  line-height: 1.4;
  overscroll-behavior: contain;
}
.ch-empty { opacity: 0.5; }
.ch-line { margin-bottom: 0.15rem; word-break: break-word; }
.ch-time { margin-right: 0.3rem; opacity: 0.4; font-size: 0.7rem; }
.ch-who { margin-right: 0.25rem; color: #f7d774; font-weight: 700; }

.ch-form {
  display: flex;
  gap: 0.35rem;
  padding: 0.4rem;
  border-top: 1px solid rgba(255, 255, 255, 0.12);
}
.ch-input {
  flex: 1;
  min-width: 0;
  min-height: 38px;
  padding: 0 0.55rem;
  border: 2px solid #2b3f70;
  border-radius: 9px;
  background: #0b1229;
  color: #fff;
  font: inherit;
  font-size: 0.85rem;
}
.ch-input:disabled { opacity: 0.5; }
.ch-send {
  min-height: 38px;
  padding: 0 0.7rem;
  border: 2px solid #3a5fb8;
  border-radius: 9px;
  background: #3a5fb8;
  color: #fff;
  font: inherit;
  font-size: 0.8rem;
  font-weight: 700;
  cursor: pointer;
}
.ch-send:disabled { opacity: 0.45; cursor: default; }

/* iOS zooms the page into any focused field under 16 px. */
@media (pointer: coarse) {
  .ch-input { font-size: 16px; }
}

@media (max-width: 720px), (max-height: 500px) {
  /* The lobby HUD owns the bottom centre and is nearly full width on a phone,
     so the chat tab sits in a row above it rather than under it. */
  .ch { left: calc(0.6rem + var(--safe-left, 0px)); bottom: calc(4.6rem + var(--safe-bottom, 0px)); }
  .ch-tab-text { display: none; }
  /* A sheet across the phone above the tab row, never more than about a third
     of the screen: the game is the thing. With the keyboard up it rides just
     above the keyboard instead, input included. */
  .ch-panel {
    left: calc(0.6rem + var(--safe-left, 0px));
    right: calc(0.6rem + var(--safe-right, 0px));
    width: auto;
    bottom: max(calc(4.6rem + 40px + 0.5rem + var(--safe-bottom, 0px)), calc(var(--keyboard-inset, 0px) + 0.4rem));
    height: min(15rem, 38dvh, calc(var(--visible-height, 100dvh) - 1rem));
  }
}

/* A landscape phone is wide but short: a column on the left, not a band across the world. */
@media (min-width: 721px) and (max-height: 500px) {
  .ch-panel {
    right: auto;
    width: min(24rem, 48vw);
  }
}
</style>
