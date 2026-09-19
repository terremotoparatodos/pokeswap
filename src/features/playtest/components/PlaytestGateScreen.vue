<template>
  <div class="pt-gate">
    <div class="pt-gate-card">
      <p class="pt-gate-kicker">{{ label }}</p>

      <template v-if="access.status === 'checking'">
        <h1 class="pt-gate-title">Un segundo…</h1>
        <p class="pt-gate-body">Estamos viendo si el playtest está abierto.</p>
        <button type="button" class="pt-gate-btn pt-gate-btn--ghost" @click="emit('recheck')">
          Volver a chequear
        </button>
      </template>

      <template v-else-if="access.status === 'closed'">
        <h1 class="pt-gate-title">Playtest cerrado</h1>
        <p class="pt-gate-body">{{ access.message }}</p>
        <button type="button" class="pt-gate-btn pt-gate-btn--ghost" @click="emit('recheck')">
          Volver a chequear
        </button>
      </template>

      <template v-else>
        <h1 class="pt-gate-title">Código de acceso</h1>
        <p class="pt-gate-body">Lo decimos en el stream. Escribilo tal cual y entrás.</p>
        <form class="pt-gate-form" @submit.prevent="submit">
          <label class="pt-gate-label" for="pt-gate-code">Código</label>
          <input
            id="pt-gate-code"
            v-model="code"
            class="pt-gate-input"
            type="text"
            autocomplete="off"
            autocapitalize="none"
            spellcheck="false"
            maxlength="40"
          >
          <p v-if="access.wrongCode" class="pt-gate-error" role="alert">Ese código no es. Fijate en el stream.</p>
          <button type="submit" class="pt-gate-btn" :disabled="!code.trim()">Entrar</button>
        </form>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { buildLabel } from '../domain/buildIdentity'
import type { PlaytestAccess } from '../domain/playtestGate'
import { BUILD } from '../playtestBuild'

// The only thing a player sees when the playtest is not open to them. It says
// which build refused them, because that is the first thing worth knowing.
const props = defineProps<{ access: Exclude<PlaytestAccess, { status: 'off' } | { status: 'open' }> }>()
const emit = defineEmits<{ submit: [code: string]; recheck: [] }>()

const label = buildLabel(BUILD)
const code = ref('')

function submit(): void {
  const value = code.value.trim()
  if (value) emit('submit', value)
}

// `props` is read in the template; naming it here keeps the linter and the
// reader on the same page about where `access` comes from.
void props
</script>

<style scoped>
.pt-gate {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: grid;
  place-items: center;
  padding: 1rem;
  background: #0b1229;
  color: #dfe8ff;
  font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
}
.pt-gate-card {
  width: min(26rem, 100%);
  padding: 1.6rem 1.4rem;
  border: 2px solid #3a5fb8;
  border-radius: 16px;
  background: #101a36;
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.5);
  text-align: center;
}
.pt-gate-kicker {
  margin: 0 0 0.9rem;
  color: #f7d774;
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.pt-gate-title { margin: 0 0 0.6rem; font-size: 1.4rem; color: #fff; }
.pt-gate-body { margin: 0 0 1.1rem; font-size: 0.95rem; line-height: 1.5; opacity: 0.85; }
.pt-gate-form { display: grid; gap: 0.5rem; text-align: left; }
.pt-gate-label { font-size: 0.78rem; font-weight: 700; opacity: 0.75; }
.pt-gate-input {
  min-height: 46px;
  padding: 0 0.8rem;
  border: 2px solid #3a5fb8;
  border-radius: 10px;
  background: #0b1229;
  color: #fff;
  font: inherit;
  font-size: 1rem;
}
.pt-gate-error { margin: 0; color: #ff8f8f; font-size: 0.82rem; }
.pt-gate-btn {
  min-height: 46px;
  margin-top: 0.3rem;
  border: 2px solid #f0b429;
  border-radius: 10px;
  background: #f0b429;
  color: #101a36;
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}
.pt-gate-btn:disabled { opacity: 0.45; cursor: default; }
.pt-gate-btn--ghost { width: 100%; background: transparent; color: #f7d774; }
</style>
