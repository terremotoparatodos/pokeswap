<template>
  <div class="ts" :class="[`ts--${view?.health ?? 'none'}`, { 'ts--compact': compact }]">
    <template v-if="tool && view">
      <div class="ts-head">
        <ItemGlyph :item-id="tool.definition.itemId" :size="compact ? 18 : 22" />
        <span class="ts-name">{{ itemName(tool.definition.itemId) }}</span>
        <span class="pf-chip">T{{ tool.definition.tier }}</span>
      </div>
      <div
        class="ts-track"
        role="meter"
        :aria-valuenow="tool.instance.durability"
        aria-valuemin="0"
        :aria-valuemax="tool.instance.maxDurability"
        :aria-label="`Durabilidad ${tool.instance.durability} de ${tool.instance.maxDurability}`"
      >
        <span class="ts-fill" :style="{ width: `${(tool.instance.durability / tool.definition.maxDurability) * 100}%` }" />
        <span v-if="view.lifeRatio < 1" class="ts-lost" :style="{ left: `${view.lifeRatio * 100}%` }" title="Vida perdida en reparaciones" />
      </div>
      <p class="ts-foot">
        <span class="ts-health">{{ view.label }}</span>
        <span>{{ tool.instance.durability }} / {{ tool.instance.maxDurability }}</span>
      </p>
      <p v-if="!compact" class="ts-effect">
        Velocidad ×{{ tool.definition.speedMultiplier.toString().replace('.', ',') }}
        · +{{ Math.round(tool.definition.yieldBonus * 100) }} % unidad extra
        · {{ view.repairsLeft }} reparaciones restantes
      </p>
    </template>
    <p v-else class="ts-none">Sin {{ TOOL_KIND_LABEL[kind] }} · a mano solo en nodos T1</p>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { EquippedTool, ToolKind } from '../domain/types'
import { toolHealth } from '../ui/gearViews'
import { TOOL_KIND_LABEL } from '../ui/nodeStatus'
import { itemName } from '../ui/progressionView'
import ItemGlyph from './ItemGlyph.vue'

const props = withDefaults(defineProps<{ tool: EquippedTool | null; kind: ToolKind; compact?: boolean }>(), { compact: false })
const view = computed(() => props.tool ? toolHealth(props.tool.instance, props.tool.definition) : null)
</script>

<style scoped>
.ts { display: grid; gap: 0.3rem; min-width: 0; }
.ts-head { display: flex; align-items: center; gap: 0.4rem; min-width: 0; }
.ts-name { flex: 1; min-width: 0; overflow: hidden; font-weight: 700; text-overflow: ellipsis; white-space: nowrap; }
.ts-track { position: relative; height: 8px; border-radius: 999px; background: rgba(255, 255, 255, 0.1); overflow: hidden; }
.ts-fill { position: absolute; inset: 0 auto 0 0; background: var(--pf-good); transition: width 0.35s ease; }
.ts-lost { position: absolute; top: 0; right: 0; bottom: 0; background: repeating-linear-gradient(135deg, rgba(255, 122, 122, 0.55) 0 3px, transparent 3px 6px); }
.ts-foot { display: flex; justify-content: space-between; gap: 0.5rem; margin: 0; color: var(--pf-muted); font-size: 0.76rem; font-variant-numeric: tabular-nums; }
.ts-effect, .ts-none { margin: 0; color: var(--pf-muted); font-size: 0.76rem; }
.ts--worn .ts-fill { background: #d8d46a; }
.ts--critical .ts-fill { background: var(--pf-warn); }
.ts--critical .ts-health { color: var(--pf-warn); }
.ts--broken .ts-health,
.ts--retired .ts-health { color: var(--pf-bad); font-weight: 700; }
.ts--critical .ts-track { animation: ts-pulse 1.4s ease-in-out infinite; }
@keyframes ts-pulse { 50% { box-shadow: 0 0 0 2px rgba(255, 180, 84, 0.45); } }
</style>
