<template>
  <img
    v-if="iconUrl"
    class="ig ig-pixel"
    :src="iconUrl"
    :width="size"
    :height="size"
    :alt="name"
    :title="name"
    draggable="false"
  >
  <span
    v-else
    class="ig"
    :class="[`ig--${tone}`, `ig--t${tier}`]"
    :style="{ width: `${size}px`, height: `${size}px`, fontSize: `${Math.round(size * 0.48)}px` }"
    :title="name"
    aria-hidden="true"
  >{{ name.charAt(0) }}</span>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { ITEM_BY_ID } from '../domain/catalog/items'
import { fishingResourceIconArt, ROD_ITEMS, rodIconArt, type RodTier } from '../art/fishingItems'
import { PICKAXE_ITEMS, pickaxeIconArt, resourceIconArt, type PickaxeTier, type ToolArtCondition } from '../art/miningItems'
import { toDataUrl } from '../art/pixelArt'

// Mining (R31-C1) and fishing (R31-C2) items use pixel icons; items without art keep the
// tier-ringed token until their profession gets its own kit.
const props = withDefaults(defineProps<{ itemId: string; size?: number; condition?: ToolArtCondition }>(), { size: 22, condition: 'ok' })

const PICKAXE_TIER = Object.fromEntries(Object.entries(PICKAXE_ITEMS).map(([tier, itemId]) => [itemId, Number(tier) as PickaxeTier]))
const ROD_TIER = Object.fromEntries(Object.entries(ROD_ITEMS).map(([tier, itemId]) => [itemId, Number(tier) as RodTier]))

const item = computed(() => ITEM_BY_ID.get(props.itemId))
const name = computed(() => item.value?.name ?? props.itemId)
const tier = computed(() => item.value?.tier ?? 1)
const iconUrl = computed(() => {
  const pickaxe = PICKAXE_TIER[props.itemId]
  const rod = ROD_TIER[props.itemId]
  const art = pickaxe ? pickaxeIconArt(pickaxe, props.condition)
    : rod ? rodIconArt(rod, props.condition)
      : resourceIconArt(props.itemId) ?? fishingResourceIconArt(props.itemId)
  return art ? toDataUrl(art, Math.max(1, Math.round(props.size / 16))) : null
})
const tone = computed(() => {
  const tags = item.value?.tags ?? []
  if (tags.includes('rare')) return 'rare'
  if (item.value?.kind === 'consumable') return 'potion'
  if (item.value?.kind === 'tool' || item.value?.kind === 'structure') return 'gear'
  if (tags.includes('metal')) return 'metal'
  if (tags.includes('wood')) return 'wood'
  if (tags.includes('aquatic')) return 'water'
  if (tags.includes('berry') || tags.includes('herb')) return 'plant'
  if (tags.includes('fuel')) return 'fuel'
  if (tags.includes('pveDrop')) return 'drop'
  return 'stone'
})
</script>

<style scoped>
.ig {
  display: inline-grid;
  flex: none;
  place-items: center;
  border-radius: 50%;
  color: #101a36;
  font-weight: 800;
  line-height: 1;
  box-shadow: inset 0 -3px 0 rgba(0, 0, 0, 0.25);
}
.ig-pixel { border-radius: 0; box-shadow: none; image-rendering: pixelated; object-fit: contain; }
.ig--stone { background: #b9b2a6; }
.ig--fuel { background: #6f6a66; color: #fff; }
.ig--metal { background: #c7d3e6; }
.ig--wood { background: #c08a55; }
.ig--water { background: #7fb8ff; }
.ig--plant { background: #8bd17c; }
.ig--potion { background: #f39ad8; }
.ig--gear { background: #ffd27a; }
.ig--drop { background: #9f8cff; }
.ig--rare { background: radial-gradient(circle at 35% 30%, #fff, #d0a8ff 60%, #8a5cd8); }
.ig--t2 { outline: 2px solid #9fc0ff; outline-offset: 1px; }
.ig--t3 { outline: 2px solid #ffd27a; outline-offset: 1px; }
</style>
