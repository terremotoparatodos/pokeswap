<template>
  <div class="ch" :class="{ 'ch--open': chat.open.value }">
    <button
      v-if="!chat.open.value"
      type="button"
      class="ch-tab"
      :aria-label="unreadLabel"
      @click="openChat"
    >
      <span aria-hidden="true">💬</span>
      <span class="ch-tab-text">Chat</span>
      <span v-if="chat.unread.value" class="ch-badge">{{ chat.unread.value > 99 ? '99+' : chat.unread.value }}</span>
    </button>

    <section v-else class="ch-panel" aria-label="Chat de la zona">
      <header class="ch-head">
        <strong class="ch-title">Chat · {{ areaLabel }}</strong>
        <button type="button" class="ch-x" aria-label="Cerrar el chat" @click="chat.open.value = false">−</button>
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
          aria-label="Escribí un mensaje"
          @keydown.stop
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
watch(chat.open, isOpen => {
  if (isOpen) {
    chat.markRead()
    void scrollToEnd()
  }
})
// Immediate: the open state is shared, so the panel can mount already open.
watch(chat.open, isOpen => emit('open', isOpen), { immediate: true })
onUnmounted(() => emit('open', false))
</script>

<style scoped>
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
  padding: 0.35rem 0.5rem 0.35rem 0.7rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.12);
}
.ch-title { font-size: 0.8rem; }
.ch-x {
  width: 30px;
  height: 30px;
  border: 0;
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

@media (max-width: 720px), (max-height: 500px) {
  /* The lobby HUD owns the bottom centre and is nearly full width on a phone,
     so the chat tab sits in a row above it rather than under it. */
  .ch { left: calc(0.6rem + var(--safe-left, 0px)); bottom: calc(4.6rem + var(--safe-bottom, 0px)); }
  .ch-tab-text { display: none; }
  /* Never more than a third of a phone screen: the game is the thing. */
  .ch-panel { height: min(15rem, 38dvh); width: calc(100vw - 1.2rem); }
}
</style>
