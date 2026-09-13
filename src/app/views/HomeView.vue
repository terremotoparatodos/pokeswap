<template>
  <main class="home">
    <h2>Bienvenido a PokeSwap</h2>
    <p v-if="isLoading">Cargando…</p>
    <p v-else-if="profile">Hola, {{ profile.username }}</p>
    <p v-else>Iniciá sesión para empezar.</p>
  </main>
</template>

<script setup lang="ts">
import { useAuth } from '../../features/auth/composables/useAuth'

const { isLoading, profile } = useAuth()
</script>
