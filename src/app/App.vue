<template>
  <div id="app-shell">
    <header class="app-nav">
      <router-link class="app-logo" to="/">PokeSwap</router-link>
      <nav class="app-nav-links">
        <router-link to="/map">Mapa</router-link>
        <router-link to="/swap">Swap</router-link>
        <router-link to="/market">Mercado</router-link>
        <router-link to="/pokedex">Pokédex</router-link>
        <router-link to="/profile">Perfil</router-link>
      </nav>
      <div class="app-nav-auth">
        <span v-if="isLoading" class="app-nav-loading">…</span>
        <template v-else-if="profile">
          <span class="app-nav-username">{{ profile.username }}</span>
          <button class="app-nav-btn" @click="handleSignOut">Salir</button>
        </template>
        <button v-else class="app-nav-btn" @click="showAuth = true">Ingresar</button>
      </div>
    </header>

    <router-view />

    <AuthModal :open="showAuth" @close="showAuth = false" />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useAuth } from '../features/auth/composables/useAuth'
import { supabase } from '../shared/api/supabase'
import AuthModal from '../features/auth/components/AuthModal.vue'

const { isLoading, profile } = useAuth()
const showAuth = ref(false)

async function handleSignOut() {
  await supabase.auth.signOut()
}
</script>

<style scoped>
#app-shell {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
}

.app-nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.75rem 1.25rem;
  background: #1a1a2e;
  color: #fff;
}

.app-logo {
  font-weight: 700;
  font-size: 1.2rem;
  letter-spacing: 0.05em;
  color: #fff;
  text-decoration: none;
}

.app-nav-auth {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.app-nav-loading {
  opacity: 0.5;
}

.app-nav-username {
  font-size: 0.9rem;
  opacity: 0.85;
}

.app-nav-btn {
  padding: 0.35rem 0.85rem;
  border: 1px solid rgba(255, 255, 255, 0.4);
  background: transparent;
  color: #fff;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.85rem;
}

.app-nav-btn:hover {
  background: rgba(255, 255, 255, 0.1);
}

.app-nav-links {
  display: flex;
  gap: 1rem;
}

.app-nav-links a {
  color: rgba(255, 255, 255, 0.8);
  text-decoration: none;
  font-size: 0.9rem;
}

.app-nav-links a.router-link-active {
  color: #fff;
  font-weight: 600;
}
</style>
