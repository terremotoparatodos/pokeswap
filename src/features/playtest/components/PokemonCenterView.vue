<template>
  <div class="pc">
    <section class="pc-heal">
      <p class="pc-heal-text">
        <template v-if="store.hurt.value">Tu equipo está golpeado. Acá se cura, gratis.</template>
        <template v-else>Tu equipo está en perfecto estado.</template>
      </p>
      <button type="button" class="pc-heal-btn" @click="store.heal()">Curar equipo</button>
    </section>

    <p v-if="store.notice.value" class="pc-notice" role="status">{{ store.notice.value }}</p>

    <div class="pc-cols">
      <section class="pc-col">
        <h3 class="pc-col-title">Equipo <span>({{ store.party.value.length }}/{{ MAX_PARTY }})</span></h3>
        <ul class="pc-list">
          <li v-for="member in store.party.value" :key="member.instanceId" class="pc-row">
            <MemberLine :member="member" />
            <button
              type="button"
              class="pc-move"
              :disabled="store.party.value.length <= 1"
              @click="store.sendToBox(member.instanceId)"
            >A la caja</button>
          </li>
        </ul>
      </section>

      <section class="pc-col">
        <h3 class="pc-col-title">Cajas <span>({{ store.box.value.length }})</span></h3>
        <ul class="pc-list">
          <li v-if="!store.box.value.length" class="pc-empty">No hay nadie en las cajas.</li>
          <li v-for="member in store.box.value" :key="member.instanceId" class="pc-row">
            <MemberLine :member="member" />
            <button
              type="button"
              class="pc-move"
              :disabled="store.party.value.length >= MAX_PARTY"
              @click="store.addToParty(member.instanceId)"
            >Al equipo</button>
          </li>
        </ul>
      </section>
    </div>

    <p class="pc-rule">
      PLAYTEST RULE · la curación es gratis y sin espera, y este equipo vive sólo en esta pestaña.
    </p>
  </div>
</template>

<script setup lang="ts">
import { onUnmounted } from 'vue'
import MemberLine from './MemberLine.vue'
import { MAX_PARTY } from '../../dungeonPrototype/domain/party'
import { usePlaytestStore } from '../state/usePlaytestStore'

// Two columns and two buttons. Not the PC Boxes of a real Pokémon game, and
// not trying to be: what we want to watch is whether people find the Centro,
// understand that it heals, and manage to put a sixth Pokémon in their party.
//
// The refusals are the interesting part — a seventh member and an empty party
// are both blocked in the domain (`playtestRoster.ts`), and the buttons simply
// say so by being disabled.
const store = usePlaytestStore()

onUnmounted(() => store.clearNotice())
</script>

<style scoped>
.pc { display: grid; gap: 0.7rem; }

.pc-heal {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.6rem;
  padding: 0.7rem 0.8rem;
  border: 2px solid #3f7d5a;
  border-radius: 10px;
  background: rgba(63, 125, 90, 0.18);
}
.pc-heal-text { flex: 1 1 12rem; margin: 0; font-size: 0.88rem; }
.pc-heal-btn {
  min-height: 42px;
  padding: 0 1rem;
  border: 2px solid #5fd39a;
  border-radius: 9px;
  background: #5fd39a;
  color: #08210f;
  font: inherit;
  font-weight: 800;
  cursor: pointer;
}

.pc-notice {
  margin: 0;
  padding: 0.45rem 0.6rem;
  border-radius: 8px;
  background: rgba(240, 180, 41, 0.15);
  color: #f7d774;
  font-size: 0.82rem;
}

.pc-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 0.7rem; }
.pc-col-title { margin: 0 0 0.4rem; font-size: 0.85rem; }
.pc-col-title span { opacity: 0.55; font-weight: 500; }
.pc-list { display: grid; gap: 0.35rem; margin: 0; padding: 0; list-style: none; }
.pc-empty { opacity: 0.5; font-size: 0.82rem; }
.pc-row {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.4rem 0.5rem;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.04);
}
.pc-move {
  flex: none;
  min-height: 34px;
  padding: 0 0.55rem;
  border: 2px solid #3a5fb8;
  border-radius: 8px;
  background: transparent;
  color: #dfe8ff;
  font: inherit;
  font-size: 0.72rem;
  font-weight: 700;
  cursor: pointer;
}
.pc-move:disabled { opacity: 0.35; cursor: default; }

.pc-rule { margin: 0.2rem 0 0; font-size: 0.72rem; opacity: 0.45; }

@media (max-width: 620px) {
  .pc-cols { grid-template-columns: 1fr; }
}
</style>
