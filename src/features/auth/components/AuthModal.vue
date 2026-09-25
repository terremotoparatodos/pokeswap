<template>
  <div v-if="open" class="auth-overlay" @click.self="onBackdrop">
    <div class="auth-modal" role="dialog" aria-modal="true" aria-label="Autenticación">

      <button class="auth-close" @click="emit('close')" aria-label="Cerrar">✕</button>

      <!-- Google -->
      <button class="auth-btn-google" @click="handleGoogle">
        <span class="auth-google-icon" aria-hidden="true">G</span>
        Continuar con Google
      </button>

      <div class="auth-divider">── o con email ──</div>

      <!-- Tabs -->
      <div v-if="tab !== 'forgot'" class="auth-tabs">
        <button :class="['auth-tab', tab === 'login' && 'active']" @click="tab = 'login'">Ingresar</button>
        <button :class="['auth-tab', tab === 'signup' && 'active']" @click="tab = 'signup'">Registrarse</button>
      </div>

      <!-- LOGIN -->
      <form v-if="tab === 'login'" @submit.prevent="handleLogin" class="auth-form">
        <input
          v-model="loginField"
          type="text"
          class="auth-input"
          placeholder="Email o nombre de usuario"
          autocomplete="username"
          required
        />
        <input
          v-model="loginPassword"
          type="password"
          class="auth-input"
          placeholder="Contraseña"
          autocomplete="current-password"
          required
        />
        <button type="submit" class="auth-btn" :disabled="busy">
          {{ busy ? 'Ingresando…' : 'Ingresar' }}
        </button>
        <button type="button" class="auth-link" @click="tab = 'forgot'">
          ¿Olvidaste tu contraseña?
        </button>
      </form>

      <!-- SIGNUP -->
      <form v-else-if="tab === 'signup'" @submit.prevent="handleSignup" class="auth-form">
        <input
          :value="signupUsername"
          @input="onUsernameInput"
          type="text"
          class="auth-input"
          placeholder="Nombre de usuario"
          autocomplete="username"
          required
        />
        <p v-if="usernameError" class="auth-field-error" role="alert">{{ usernameError }}</p>
        <input
          v-model="signupEmail"
          type="email"
          class="auth-input"
          placeholder="Email"
          autocomplete="email"
          required
        />
        <input
          v-model="signupPassword"
          type="password"
          class="auth-input"
          placeholder="Contraseña (mín. 6 caracteres)"
          autocomplete="new-password"
          required
        />
        <button type="submit" class="auth-btn" :disabled="busy">
          {{ busy ? 'Creando cuenta…' : 'Registrarse' }}
        </button>
      </form>

      <!-- FORGOT -->
      <form v-else-if="tab === 'forgot'" @submit.prevent="handleReset" class="auth-form">
        <p class="auth-hint">Ingresá tu email y te mandamos un link para resetear la contraseña.</p>
        <input
          v-model="resetEmail"
          type="email"
          class="auth-input"
          placeholder="Email"
          autocomplete="email"
          required
        />
        <button type="submit" class="auth-btn" :disabled="busy">
          {{ busy ? 'Enviando…' : 'Enviar link' }}
        </button>
        <button type="button" class="auth-link" @click="tab = 'login'">← Volver al login</button>
      </form>

      <p v-if="error" class="auth-error" role="alert">{{ error }}</p>

    </div>
  </div>
</template>

<script setup lang="ts">
import { onUnmounted, ref, watch } from 'vue'
import { trackKeyboardInset } from '../../../shared/ui/keyboardInset'
import { loginWithEmail, loginWithGoogle, signUp, resetPassword } from '../api/authApi'
import { validateUsername, normalizeUsernameInput } from '../utils/username'

const props = defineProps<{ open: boolean; initialTab?: 'login' | 'signup' }>()
const emit = defineEmits<{ close: []; success: [] }>()

type Tab = 'login' | 'signup' | 'forgot'
const tab = ref<Tab>(props.initialTab ?? 'login')
watch(() => props.initialTab, (t) => { if (t) tab.value = t })
watch(() => props.open, (v) => { if (v) { error.value = ''; tab.value = props.initialTab ?? 'login' } })

const busy = ref(false)
const error = ref('')

// Login
const loginField = ref('')
const loginPassword = ref('')

// Signup
const signupUsername = ref('')
const signupEmail = ref('')
const signupPassword = ref('')
const usernameError = ref('')

function onUsernameInput(e: Event) {
  const raw = (e.target as HTMLInputElement).value
  signupUsername.value = normalizeUsernameInput(raw)
  usernameError.value = validateUsername(signupUsername.value) ?? ''
}

// Reset
const resetEmail = ref('')

// MOBILE-1: tapping outside must not throw away what was typed. With the form
// empty it closes; otherwise only ×, Escape or finishing does.
function onBackdrop(): void {
  const typed = [loginField, loginPassword, signupUsername, signupEmail, signupPassword, resetEmail].some(field => field.value.trim())
  if (!typed) emit('close')
}
const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') emit('close') }
// The form rides above the iOS keyboard (shared with the chat).
let stopKeyboard: (() => void) | null = null
watch(() => props.open, isOpen => {
  if (isOpen) {
    stopKeyboard ??= trackKeyboardInset()
    window.addEventListener('keydown', onKeyDown)
  } else {
    stopKeyboard?.(); stopKeyboard = null
    window.removeEventListener('keydown', onKeyDown)
  }
}, { immediate: true })
onUnmounted(() => {
  stopKeyboard?.()
  window.removeEventListener('keydown', onKeyDown)
})

async function handleGoogle() {
  try {
    error.value = ''
    await loginWithGoogle()
  } catch (e) {
    error.value = (e as Error).message
  }
}

async function handleLogin() {
  if (busy.value) return
  error.value = ''
  busy.value = true
  try {
    await loginWithEmail(loginField.value.trim(), loginPassword.value)
    emit('success')
    emit('close')
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    busy.value = false
  }
}

async function handleSignup() {
  if (busy.value) return
  error.value = ''
  const validationError = validateUsername(signupUsername.value)
  if (validationError) { usernameError.value = validationError; return }
  if (signupPassword.value.length < 6) { error.value = 'La contraseña necesita al menos 6 caracteres'; return }
  busy.value = true
  try {
    const { needsConfirmation } = await signUp(signupUsername.value, signupEmail.value.trim(), signupPassword.value)
    if (needsConfirmation) {
      error.value = ''
      // Surface confirmation message as non-error feedback
      alert('¡Cuenta creada! Revisá tu email para confirmarla.')
    }
    emit('success')
    emit('close')
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    busy.value = false
  }
}

async function handleReset() {
  if (busy.value) return
  error.value = ''
  busy.value = true
  try {
    await resetPassword(resetEmail.value.trim())
    alert('✓ Link enviado. Revisá tu bandeja de entrada.')
    tab.value = 'login'
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    busy.value = false
  }
}
</script>

<style scoped>
.auth-overlay {
  position: fixed;
  inset: 0;
  /* Centred in what the keyboard leaves visible, inside the safe areas. */
  box-sizing: border-box;
  padding: calc(0.5rem + var(--safe-top, 0px)) calc(0.5rem + var(--safe-right, 0px)) max(calc(0.5rem + var(--safe-bottom, 0px)), var(--keyboard-inset, 0px)) calc(0.5rem + var(--safe-left, 0px));
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.auth-modal {
  position: relative;
  background: var(--bg, #1a1a2e);
  border: 1px solid var(--border, rgba(255, 255, 255, 0.12));
  border-radius: 12px;
  padding: 28px 24px 24px;
  width: min(360px, 92vw);
  max-height: 100%;
  overflow-y: auto;
  overscroll-behavior: contain;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 12px;
  color: var(--text, #e8e8e8);
}

.auth-close {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 40px;
  height: 40px;
  background: none;
  border: none;
  border-radius: 8px;
  color: var(--text-dim, #888);
  font-size: 18px;
  cursor: pointer;
  padding: 0;
}

.auth-btn-google {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 10px 16px;
  border-radius: 6px;
  border: 1px solid var(--border, rgba(255, 255, 255, 0.2));
  background: var(--surface, rgba(255, 255, 255, 0.04));
  color: var(--text, #e8e8e8);
  cursor: pointer;
  font-size: 13px;
  transition: background 0.15s;
}
.auth-btn-google:hover { background: var(--surface-hover, rgba(255, 255, 255, 0.08)); }

.auth-google-icon {
  font-weight: 700;
  color: #4285f4;
}

.auth-divider {
  text-align: center;
  font-size: 11px;
  color: var(--text-dim, #888);
}

.auth-tabs {
  display: flex;
  gap: 4px;
}

.auth-tab {
  flex: 1;
  padding: 8px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-dim, #888);
  cursor: pointer;
  font-size: 12px;
  transition: background 0.15s, color 0.15s;
}
.auth-tab.active {
  background: rgba(240, 180, 80, 0.12);
  color: var(--text, #e8e8e8);
}

.auth-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.auth-input {
  padding: 9px 12px;
  border-radius: 6px;
  border: 1px solid var(--border, rgba(255, 255, 255, 0.15));
  background: var(--input-bg, rgba(255, 255, 255, 0.05));
  color: var(--text, #e8e8e8);
  font-size: 13px;
  outline: none;
  transition: border-color 0.15s;
}
.auth-input:focus { border-color: var(--accent, #c080f0); }

.auth-btn {
  padding: 10px;
  border-radius: 6px;
  border: none;
  background: var(--accent, #c080f0);
  color: #fff;
  font-size: 13px;
  cursor: pointer;
  transition: opacity 0.15s;
}
.auth-btn:disabled { opacity: 0.6; cursor: not-allowed; }

.auth-link {
  background: none;
  border: none;
  color: var(--text-dim, #888);
  font-size: 11px;
  cursor: pointer;
  text-align: center;
  padding: 2px;
}
.auth-link:hover { color: var(--text, #e8e8e8); }

.auth-hint {
  font-size: 11px;
  color: var(--text-dim, #888);
  text-align: center;
  line-height: 1.5;
  margin: 0;
}

.auth-field-error,
.auth-error {
  font-size: 11px;
  color: #e08080;
  margin: 0;
}

/* iOS zooms the page into any focused field under 16 px. */
@media (pointer: coarse) {
  .auth-input { font-size: 16px; }
}
</style>
