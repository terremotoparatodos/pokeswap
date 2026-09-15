<template>
  <section class="inv pf-card" :class="{ 'inv--compact': compact, 'inv--full': isFull }" aria-label="Mochila">
    <header class="inv-head">
      <div>
        <p class="pf-kicker">Mochila · demo local</p>
        <h3>{{ used }} / {{ state.bag.capacity }} espacios</h3>
      </div>
      <span v-if="isFull" class="inv-full-chip">Llena · los stacks abiertos aún aceptan</span>
    </header>

    <div class="inv-equipment" aria-label="Equipo">
      <button
        v-for="kind in TOOL_KINDS"
        :key="kind"
        type="button"
        class="inv-equip"
        :class="{ 'inv-equip--broken': tools[kind]?.health === 'broken' || tools[kind]?.health === 'retired' }"
        :title="tools[kind] ? `${tools[kind]!.name} · ${tools[kind]!.label}` : `Sin ${TOOL_KIND_LABEL[kind]}`"
        @click="selected = null"
      >
        <template v-if="tools[kind]">
          <ItemGlyph :item-id="tools[kind]!.itemId" :size="compact ? 24 : 32" :condition="tools[kind]!.condition" />
          <span class="inv-dur"><span :style="{ width: `${tools[kind]!.ratio * 100}%` }" /></span>
        </template>
        <span v-else class="inv-equip-empty">{{ TOOL_KIND_LABEL[kind] }}</span>
      </button>
    </div>

    <ol class="inv-grid">
      <li v-for="(slot, index) in state.bag.slots" :key="`${index}-${flashFor(index)}`">
        <button
          type="button"
          class="inv-slot"
          :class="slotClasses(slot, index)"
          :aria-label="slot ? `${itemName(slot.itemId)}, ${slot.quantity}` : 'Espacio vacío'"
          :aria-pressed="selected === index"
          @click="selected = slot ? (selected === index ? null : index) : null"
        >
          <template v-if="slot">
            <ItemGlyph :item-id="slot.itemId" :size="compact ? 24 : 32" />
            <span v-if="rules.maxStack(slot.itemId) > 1" class="inv-qty">{{ slot.quantity }}</span>
            <span v-if="rules.maxStack(slot.itemId) > 1" class="inv-stack"><span :style="{ width: `${(slot.quantity / rules.maxStack(slot.itemId)) * 100}%` }" /></span>
          </template>
        </button>
      </li>
    </ol>

    <div v-if="detail" class="inv-detail" role="status">
      <ItemGlyph :item-id="detail.itemId" :size="40" />
      <div class="inv-detail-body">
        <strong>{{ itemName(detail.itemId) }}</strong>
        <small v-if="detail.tool">{{ detail.tool.durability }} / {{ detail.tool.maxDurability }} durabilidad · no se apila</small>
        <small v-else>{{ detail.quantity }} / {{ detail.max }} en este stack · {{ STACK_LABEL[detail.stackClass] }}<template v-if="detail.quantity >= detail.max"> · stack completo</template></small>
        <small>Total en la mochila: {{ countItem(state.bag, detail.itemId) }}</small>
      </div>
      <div class="inv-detail-actions">
        <button v-if="detail.tool" type="button" class="pf-btn" @click="equip">Equipar</button>
        <button type="button" class="pf-btn pf-btn--ghost" @click="discard">Descartar</button>
      </div>
    </div>

    <div v-if="state.pending.length" class="inv-pending">
      <span>No entró:</span>
      <span v-for="stack in state.pending" :key="stack.itemId" class="inv-pending-item"><ItemGlyph :item-id="stack.itemId" :size="18" /> {{ stack.quantity }}</span>
      <button type="button" class="pf-btn pf-btn--ghost" @click="collect">Recoger</button>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { TOOL_BY_ID } from '../domain/catalog/tools'
import type { ToolKind } from '../domain/types'
import { collectPendingDemo, demoRules, discardDemoSlot, equipFromBag } from '../demo/demoSession'
import type { ProfessionDemoSession } from '../demo/useProfessionDemo'
import { countItem, freeSlots, usedSlots, type ItemSlot, type Placement } from '../inventory/slotInventory'
import { stackClassOf, type StackClass } from '../inventory/stackRules'
import { rarityOfItem } from '../mining/miningRarity'
import type { ToolArtCondition } from '../art/miningItems'
import { toolHealth } from '../ui/gearViews'
import { TOOL_KIND_LABEL } from '../ui/nodeStatus'
import { itemName } from '../ui/progressionView'
import ItemGlyph from './ItemGlyph.vue'

// Slot + stack inventory. Tap-first: details open on tap (no hover needed).
const props = withDefaults(defineProps<{ session: ProfessionDemoSession; highlight?: readonly Placement[]; compact?: boolean }>(), {
  highlight: () => [],
  compact: false,
})

const TOOL_KINDS: readonly ToolKind[] = ['pickaxe', 'axe', 'rod', 'sickle']
const STACK_LABEL: Readonly<Record<StackClass, string>> = {
  basic: 'recurso básico', uncommon: 'recurso poco común', rare: 'recurso raro', refined: 'refinado', consumable: 'consumible', unique: 'objeto único',
}

const state = computed(() => props.session.state.value)
const rules = computed(() => demoRules(state.value))
const used = computed(() => usedSlots(state.value.bag))
const isFull = computed(() => freeSlots(state.value.bag) === 0)
const selected = ref<number | null>(null)

const tools = computed(() => Object.fromEntries(TOOL_KINDS.map(kind => {
  const instance = state.value.tools[kind]
  const definition = instance ? TOOL_BY_ID.get(instance.itemId) : undefined
  if (!instance || !definition) return [kind, null]
  const health = toolHealth(instance, definition)
  const condition: ToolArtCondition = health.health === 'retired' ? 'retired' : health.health === 'broken' ? 'broken' : 'ok'
  return [kind, { itemId: instance.itemId, name: itemName(instance.itemId), ratio: instance.durability / definition.maxDurability, label: health.label, health: health.health, condition }]
})) as Record<ToolKind, { itemId: string; name: string; ratio: number; label: string; health: string; condition: ToolArtCondition } | null>)

const flashes = computed(() => new Map(props.highlight.map(placement => [placement.slot, placement])))
let version = 0
const flashFor = (index: number) => (flashes.value.has(index) ? `f${++version}` : 's')

function slotClasses(slot: ItemSlot | null, index: number): string[] {
  if (!slot) return ['inv-slot--empty']
  const classes = [`inv-slot--${rarityOfItem(slot.itemId)}`]
  if (slot.quantity >= rules.value.maxStack(slot.itemId) && rules.value.maxStack(slot.itemId) > 1) classes.push('inv-slot--capped')
  if (selected.value === index) classes.push('inv-slot--selected')
  const flash = flashes.value.get(index)
  if (flash) classes.push(flash.filledStack ? 'inv-slot--filled' : flash.newStack ? 'inv-slot--new' : 'inv-slot--added')
  return classes
}

const detail = computed(() => {
  const index = selected.value
  const slot = index === null ? null : state.value.bag.slots[index]
  if (!slot) return null
  return {
    itemId: slot.itemId, quantity: slot.quantity, max: rules.value.maxStack(slot.itemId), stackClass: stackClassOf(slot.itemId),
    tool: slot.instanceId ? state.value.spareTools[slot.instanceId] ?? null : null,
  }
})

function equip(): void {
  if (selected.value === null) return
  const index = selected.value
  props.session.update(value => equipFromBag(value, index))
}

function discard(): void {
  if (selected.value === null) return
  const index = selected.value
  props.session.update(value => discardDemoSlot(value, index))
  selected.value = null
}

function collect(): void {
  props.session.update(value => collectPendingDemo(value).state)
}
</script>

<style scoped>
.inv { display: grid; gap: 0.6rem; padding: 0.9rem; }
.inv-head { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 0.4rem; }
.inv-head h3 { margin: 0.1rem 0 0; font-size: 1rem; }
.inv-full-chip { padding: 0.15rem 0.55rem; border-radius: 999px; background: rgba(255, 180, 84, 0.18); color: var(--pf-warn); font-size: 0.74rem; }
.inv-equipment { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0.35rem; }
.inv-equip { position: relative; display: grid; place-items: center; min-height: 50px; padding: 0.25rem; border: 2px solid var(--pf-gold); border-radius: 10px; background: rgba(255, 210, 122, 0.08); color: inherit; font: inherit; cursor: default; }
.inv-equip--broken { border-color: var(--pf-bad); }
.inv-equip-empty { color: var(--pf-muted); font-size: 0.7rem; }
.inv-dur { position: absolute; left: 6px; right: 6px; bottom: 4px; height: 3px; border-radius: 2px; background: rgba(255, 255, 255, 0.15); overflow: hidden; }
.inv-dur span { display: block; height: 100%; background: var(--pf-good); }
.inv-equip--broken .inv-dur span { background: var(--pf-bad); }
.inv-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(50px, 1fr)); gap: 0.3rem; margin: 0; padding: 0; list-style: none; }
.inv-slot { position: relative; display: grid; place-items: center; width: 100%; aspect-ratio: 1; padding: 0; border: 2px solid #26386c; border-radius: 8px; background: #0d1631; color: inherit; font: inherit; cursor: pointer; }
.inv-slot--empty { cursor: default; background: repeating-linear-gradient(135deg, #0d1631 0 6px, #0f1936 6px 12px); }
.inv-slot--uncommon { border-color: #b45f2c; }
.inv-slot--rare { border-color: #dca521; }
.inv-slot--special { border-color: #9a62d6; box-shadow: inset 0 0 8px rgba(154, 98, 214, 0.45); }
.inv-slot--selected { outline: 2px solid #fff; outline-offset: 1px; }
.inv-slot--capped::after { content: ''; position: absolute; top: 3px; left: 3px; width: 5px; height: 5px; border-radius: 50%; background: var(--pf-gold); }
.inv-qty { position: absolute; right: 3px; bottom: 5px; font-size: 0.72rem; font-weight: 800; text-shadow: 0 1px 0 #000, 0 0 3px #000; font-variant-numeric: tabular-nums; }
.inv-stack { position: absolute; left: 4px; right: 4px; bottom: 2px; height: 2px; background: rgba(255, 255, 255, 0.12); }
.inv-stack span { display: block; height: 100%; background: var(--pf-soft); }
.inv-slot--added { animation: inv-bump 0.45s ease-out; }
.inv-slot--new { animation: inv-new 0.7s ease-out; }
.inv-slot--filled { animation: inv-filled 0.9s ease-out; }
@keyframes inv-bump { 40% { transform: scale(1.08); border-color: #fff; } }
@keyframes inv-new { 0% { transform: scale(0.6); opacity: 0.2; } 60% { transform: scale(1.1); box-shadow: 0 0 10px #fff; } }
@keyframes inv-filled { 30% { transform: scale(1.12); box-shadow: 0 0 12px var(--pf-gold); border-color: var(--pf-gold); } }
.inv-detail { display: grid; grid-template-columns: auto 1fr; gap: 0.6rem; align-items: center; padding: 0.55rem; border-radius: 10px; background: var(--pf-navy-2); }
.inv-detail-body { display: grid; gap: 0.1rem; }
.inv-detail-body small { color: var(--pf-muted); font-size: 0.76rem; }
.inv-detail-actions { display: flex; grid-column: 1 / -1; gap: 0.4rem; }
.inv-detail-actions .pf-btn { min-height: 38px; }
.inv-pending { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; padding: 0.45rem 0.6rem; border: 1px dashed var(--pf-warn); border-radius: 10px; color: var(--pf-warn); font-size: 0.82rem; }
.inv-pending-item { display: inline-flex; align-items: center; gap: 0.2rem; color: var(--pf-ink); }
.inv-pending .pf-btn { min-height: 34px; margin-left: auto; }
.inv--compact { padding: 0.65rem; gap: 0.45rem; }
.inv--compact .inv-grid { grid-template-columns: repeat(6, 1fr); }
.inv--compact .inv-equip { min-height: 40px; }
@media (max-width: 520px) {
  .inv-grid { grid-template-columns: repeat(6, 1fr); }
}
</style>
