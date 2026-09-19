<template>
  <span class="ml">
    <span class="ml-name">{{ name }}</span>
    <span class="ml-level">Nv. {{ member.level }}</span>
    <span class="ml-hp" :class="{ 'ml-hp--low': ratio <= 0.25, 'ml-hp--out': member.hp === 0 }">
      <span :style="{ width: `${Math.round(ratio * 100)}%` }" />
    </span>
    <span class="ml-num">{{ member.hp }}/{{ member.maxHp }}</span>
    <span v-if="member.status !== 'none'" class="ml-status">{{ STATUS_LABEL[member.status] }}</span>
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { speciesById } from '../../dungeonPrototype/data/speciesFixtures'
import type { PokemonInstance, StatusCondition } from '../../dungeonPrototype/domain/party'

// One Pokémon, one line: who, how strong, how hurt. The species name comes
// from the prototype's own fixtures, so nothing here invents a Pokédex.
const props = defineProps<{ member: PokemonInstance }>()

const STATUS_LABEL: Readonly<Record<StatusCondition, string>> = {
  none: '', burn: 'QMD', poison: 'PSN', paralysis: 'PAR', freeze: 'CON', sleep: 'DOR',
}

const name = computed(() => speciesById(props.member.speciesId)?.name ?? `#${props.member.speciesId}`)
const ratio = computed(() => Math.max(0, Math.min(1, props.member.hp / props.member.maxHp)))
</script>

<style scoped>
.ml {
  flex: 1;
  min-width: 0;
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
  gap: 0.1rem 0.4rem;
  font-size: 0.8rem;
}
.ml-name { font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ml-level { opacity: 0.55; font-size: 0.72rem; }
.ml-hp {
  grid-column: 1 / 3;
  height: 5px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.14);
  overflow: hidden;
}
.ml-hp span { display: block; height: 100%; background: #5fd39a; }
.ml-hp--low span { background: #f0b429; }
.ml-hp--out span { background: #e03c3c; }
.ml-num { grid-column: 1 / 3; font-size: 0.68rem; opacity: 0.5; font-variant-numeric: tabular-nums; }
.ml-status {
  grid-column: 1 / 3;
  justify-self: start;
  padding: 0 0.3rem;
  border-radius: 4px;
  background: #e0873c;
  color: #201004;
  font-size: 0.62rem;
  font-weight: 800;
}
</style>
