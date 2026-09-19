<template>
  <div class="cf">
    <p class="cf-headline">{{ CLOSED_HEADLINE }}</p>
    <p class="cf-reason">{{ reason }}</p>
    <p class="cf-where">Lo que sí está abierto: el <strong>Centro Pokémon</strong>, la <strong>Tienda</strong>, WildLands y las cuevas.</p>
  </div>
</template>

<script setup lang="ts">
import { CLOSED_HEADLINE } from '../domain/cityFeatures'

// A closed door that says nothing is a bug report. This is the alternative:
// the building is still there, the click still does something, and the player
// is told what it would have been and where to go instead.
defineProps<{ title: string; reason: string }>()
</script>

<style scoped>
.cf { display: grid; gap: 0.6rem; padding: 1rem 0.4rem; text-align: center; }
.cf-headline { margin: 0; color: #f7d774; font-size: 1rem; font-weight: 700; }
.cf-reason { margin: 0; font-size: 0.92rem; line-height: 1.5; opacity: 0.85; }
.cf-where { margin: 0.4rem 0 0; font-size: 0.82rem; opacity: 0.6; }
</style>
