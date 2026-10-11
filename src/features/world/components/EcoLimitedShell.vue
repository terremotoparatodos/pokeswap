<template>
  <div class="eco-limited-shell">
    <header class="eco-limited-header">
      <span>ECO · prueba limitada · sin recompensas</span>
      <button v-if="user" type="button" @click="signOut">Salir</button>
      <span v-if="logoutFailed" role="alert">No se pudo cerrar sesión. Reintentá.</span>
    </header>
    <div v-if="mountWorld" :key="`${user?.id}:${attempt}`" :inert="phase !== 'ready' ? true : undefined">
      <slot />
    </div>
    <section v-if="!user || phase !== 'ready'" class="eco-limited-entry" aria-live="polite">
      <h1>ECO · acceso limitado</h1>
      <p v-if="isLoading">Cargando sesión…</p>
      <template v-else-if="!user">
        <p>Ingresá con tu cuenta autorizada para participar.</p>
        <button type="button" @click="authOpen = true">Ingresar</button>
      </template>
      <template v-else-if="phase === 'denied'">
        <p>Esta cuenta no tiene acceso a la prueba limitada.</p>
        <button type="button" @click="retry">Comprobar de nuevo</button>
      </template>
      <p v-else-if="phase === 'expired'">La ventana de prueba terminó. La sesión está cerrada.</p>
      <template v-else>
        <p>Esperando la admisión del servidor. La sesión aún no está lista.</p>
        <button type="button" @click="retry">Reintentar conexión</button>
      </template>
    </section>
    <AuthModal :open="authOpen" :login-only="true" @close="authOpen = false" @success="authOpen = false" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useAuth } from '../../auth/composables/useAuth'
import { logout } from '../../auth/api/authApi'
import AuthModal from '../../auth/components/AuthModal.vue'
import { limitedEntry } from '../state/limitedEntry'

const { user, isLoading } = useAuth()
const phase = limitedEntry.phase
const authOpen = ref(false)
const attempt = ref(0)
const logoutFailed = ref(false)
const mountWorld = computed(() => !isLoading.value && !!user.value && (phase.value === 'connecting' || phase.value === 'ready'))
watch(() => user.value?.id, () => { limitedEntry.reset(); attempt.value++ }, { immediate: true })
function retry(): void { limitedEntry.reset(); attempt.value++ }
async function signOut(): Promise<void> {
  logoutFailed.value = false
  try { await logout() } catch { logoutFailed.value = true }
}
</script>

<style scoped>
.eco-limited-header { position: fixed; z-index: 80; top: 0; left: 0; right: 0; display: flex; gap: 1rem; align-items: center; padding: .5rem 1rem; background: #152a38; color: #fff; }
.eco-limited-entry { position: fixed; z-index: 90; inset: 3rem 0 0; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 1rem; text-align: center; background: #152a38; color: #fff; }
button { padding: .5rem 1rem; cursor: pointer; }
</style>
