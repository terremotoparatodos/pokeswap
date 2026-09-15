<template>
  <div class="gf" :class="{ 'gf--rare': rare }" role="status" aria-live="polite">
    <p v-if="rare" class="gf-banner">¡Hallazgo especial!</p>
    <ul>
      <li v-for="(line, index) in lines" :key="`${line.text}-${index}`" :class="`gf--${line.tone}`" :style="{ animationDelay: `${index * 70}ms` }">
        <ItemGlyph v-if="line.itemId" :item-id="line.itemId" :size="18" />
        {{ line.text }}
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import type { FeedbackLine } from '../ui/feedback'
import ItemGlyph from './ItemGlyph.vue'

withDefaults(defineProps<{ lines: readonly FeedbackLine[]; rare?: boolean }>(), { rare: false })
</script>

<style scoped>
.gf { padding: 0.6rem 0.75rem; border-radius: 10px; background: rgba(255, 255, 255, 0.06); }
.gf ul { display: flex; flex-wrap: wrap; gap: 0.35rem 0.9rem; margin: 0; padding: 0; list-style: none; }
.gf li { display: inline-flex; align-items: center; gap: 0.3rem; font-weight: 700; animation: gf-pop 0.35s ease-out both; }
.gf--item { color: var(--pf-good); }
.gf--rare { color: var(--pf-rare); }
.gf--xp { color: var(--pf-gold); }
.gf--energy { color: var(--pf-energy); font-weight: 500; }
.gf--wear { color: var(--pf-muted); font-weight: 500; }
.gf--level { color: #fff; text-shadow: 0 0 8px rgba(255, 210, 122, 0.9); }
.gf--warn { color: var(--pf-warn); }
.gf.gf--rare { background: radial-gradient(circle at 50% 0%, rgba(208, 168, 255, 0.35), rgba(255, 255, 255, 0.05) 70%); box-shadow: 0 0 0 2px rgba(208, 168, 255, 0.6); animation: gf-glow 1.2s ease-in-out 2; }
.gf-banner { margin: 0 0 0.35rem; color: var(--pf-rare); font-size: 0.8rem; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; }
@keyframes gf-pop { from { opacity: 0; transform: translateY(6px) scale(0.96); } }
@keyframes gf-glow { 50% { box-shadow: 0 0 18px 4px rgba(208, 168, 255, 0.7); } }
</style>
