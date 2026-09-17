<script setup lang="ts">
// The battlefield, drawn in the world rather than on a separate battle screen:
// the player's Pokémon stands on the left, the rival on the right, both on the
// same ground. The Alpha is simply drawn bigger, with a red aura.
//
// Placeholder art on purpose (§37): coloured discs and a pulse, enough to judge
// scale, aura and readability without a production asset pass.

import { computed } from 'vue'
import { speciesById } from '../data/speciesFixtures'
import { barOf, speedOf, type BattleActor } from '../domain/battle'
import { isFainted } from '../domain/party'

const props = defineProps<{
  allies: readonly BattleActor[]
  enemies: readonly BattleActor[]
  /** Visual scale of the enemy; 2 for an Alpha. */
  enemyScale?: number
  aura?: boolean
  seconds: number
  /** A Boss Skill being announced, so the player can decide before it lands. */
  telegraph?: { readonly skillId: string; readonly name: string; readonly endsAt: number } | null
}>()

const warning = computed(() => {
  const telegraph = props.telegraph
  if (!telegraph) return null
  const left = Math.max(0, telegraph.endsAt - props.seconds)
  return { name: telegraph.name, left, ratio: Math.max(0, Math.min(1, 1 - left / 2.8)) }
})

const scale = computed(() => props.enemyScale ?? 1)
/** A slow pulse so the aura reads as "dangerous" without an animation library. */
const pulse = computed(() => 1 + Math.sin(props.seconds * 2.4) * 0.08)

const nameOf = (actor: BattleActor) => speciesById(actor.combatant.pokemon.speciesId)?.name ?? '???'
const hpFraction = (actor: BattleActor) => actor.combatant.pokemon.hp / actor.combatant.pokemon.maxHp
const colourOf = (actor: BattleActor) => (actor.side === 'ally' ? '#7ee2a8' : '#ff9f7a')
</script>

<template>
  <div class="bf">
    <svg viewBox="0 0 420 180" width="100%" role="img" aria-label="Campo de combate">
      <ellipse cx="210" cy="150" rx="200" ry="26" fill="#1b2744" />

      <g v-for="(actor, i) in enemies" :key="actor.id" :transform="`translate(${300 + i * 46}, ${104 - i * 10})`">
        <ellipse :rx="22 * scale" :ry="7 * scale" cy="34" fill="#0b1020" opacity="0.5" />
        <circle
          v-if="aura" :r="30 * scale * pulse" cy="6"
          fill="none" stroke="#ff4d4d" :stroke-width="3" :opacity="0.55"
        />
        <circle
          v-if="aura" :r="38 * scale * pulse" cy="6"
          fill="none" stroke="#ff4d4d" stroke-width="1.5" :opacity="0.25"
        />
        <circle :r="20 * scale" cy="6" :fill="colourOf(actor)" :opacity="isFainted(actor.combatant.pokemon) ? 0.25 : 1" />
        <text y="52" text-anchor="middle" font-size="11" fill="#e8eeff">{{ nameOf(actor) }}</text>
      </g>

      <g v-for="(actor, i) in allies" :key="actor.id" :transform="`translate(${100 - i * 46}, ${112 + i * 12})`">
        <ellipse rx="20" ry="6" cy="30" fill="#0b1020" opacity="0.5" />
        <circle r="18" cy="4" :fill="colourOf(actor)" :opacity="isFainted(actor.combatant.pokemon) ? 0.25 : 1" />
        <!-- Protect: a ring per remaining charge, so the shield is readable. -->
        <circle
          v-if="actor.shield > 0" r="24" cy="4"
          fill="none" stroke="#8ec7ff" :stroke-width="actor.shield" opacity="0.9"
        />
        <text v-if="actor.shield > 0" y="-20" text-anchor="middle" font-size="10" fill="#8ec7ff">
          ◈{{ actor.shield }}
        </text>
        <text y="48" text-anchor="middle" font-size="11" fill="#e8eeff">{{ nameOf(actor) }}</text>
      </g>

      <!-- Boss Skill telegraph: name, countdown and a bar that fills as it lands. -->
      <g v-if="warning">
        <rect x="90" y="8" width="240" height="26" rx="6" fill="#3a0f14" stroke="#ff4d4d" />
        <rect x="92" y="28" :width="236 * warning.ratio" height="4" fill="#ff4d4d" />
        <text x="210" y="25" text-anchor="middle" font-size="12" fill="#ffd0d0">
          ⚠ {{ warning.name }} · {{ warning.left.toFixed(1) }} s
        </text>
      </g>
    </svg>

    <div class="bf-bars">
      <div v-for="actor in [...allies, ...enemies]" :key="actor.id" class="bf-row">
        <span class="bf-name">
          {{ nameOf(actor) }}
          <em>Nv. {{ actor.combatant.pokemon.level }} · vel {{ speedOf(actor) }}</em>
        </span>
        <span class="bf-meter bf-meter--hp">
          <i :style="{ width: `${Math.max(0, hpFraction(actor)) * 100}%` }" />
        </span>
        <span class="bf-meter bf-meter--bar">
          <i :style="{ width: `${barOf(actor) * 100}%` }" />
        </span>
        <span class="bf-hp">
          {{ Math.max(0, actor.combatant.pokemon.hp) }}/{{ actor.combatant.pokemon.maxHp }}
          <em v-if="actor.combatant.pokemon.status !== 'none'">{{ actor.combatant.pokemon.status }}</em>
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.bf-bars { display: grid; gap: 6px; margin-top: 8px; }
.bf-row { display: grid; grid-template-columns: minmax(90px, 1fr) 2fr 2fr auto; gap: 8px; align-items: center; font-size: 0.78rem; }
.bf-name em, .bf-hp em { display: block; font-size: 0.68rem; font-style: normal; color: #93a2c6; }
.bf-meter { position: relative; height: 9px; border-radius: 999px; background: #0f1730; overflow: hidden; }
.bf-meter i { position: absolute; inset: 0 auto 0 0; display: block; border-radius: 999px; }
.bf-meter--hp i { background: #7ee2a8; }
.bf-meter--bar i { background: #ffd27a; }
.bf-hp { min-width: 72px; text-align: right; }
@media (max-width: 420px) {
  .bf-row { grid-template-columns: 1fr 1fr; }
}
</style>
