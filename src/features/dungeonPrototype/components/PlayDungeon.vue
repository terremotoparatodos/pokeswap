<script setup lang="ts">
// JUGAR DUNGEON — the Field Lab (D1.1).
//
// The world is the screen. This component owns the loop and the presentation;
// every rule lives in `domain/`. The technical controls moved into a collapsed
// DEV drawer at the bottom, where they cannot be mistaken for the game.

import { computed, onUnmounted, ref, shallowRef, triggerRef } from 'vue'
import BattleHud from './BattleHud.vue'
import DungeonStage from './DungeonStage.vue'
import DungeonCatalog from './DungeonCatalog.vue'
import DevTools, { type DevCommand } from './DevTools.vue'
import {
  BATTLE_ITEMS, buildParty, buildWild, combatantFor, FLOOR_LOOT, STARTING_INVENTORY,
} from '../data/runFixtures'
import { DUNGEON_DEFINITIONS, poolOf } from '../data/dungeonCatalog'
import { speciesById } from '../data/speciesFixtures'
import { tick, type BattleActor, type BattleEvent, type PreparedAction } from '../domain/battle'
import { createSpawn, formatCountdown, type DungeonDefinition } from '../domain/dungeonSpawn'
import { moveById } from '../domain/moves'
import { heal, isFainted, revive } from '../domain/party'
import { streamFor } from '../domain/rng'
import {
  act, advanceClock, atStairs, descend, endRun, engage, enterAntechamber, move,
  openChest, reachable, settleCombat, startBoss, startPlay, type PlaySession,
} from '../domain/playSession'
import { DungeonRenderer, type CombatantView, type RenderView } from '../render/dungeonRenderer'
import { preloadSpecies } from '../render/dungeonSprites'

const session = shallowRef<PlaySession | null>(null)
const stage = ref<InstanceType<typeof DungeonStage> | null>(null)
const bag = ref<Record<string, number>>({ ...STARTING_INVENTORY })
const players = ref(1)
const clockSpeed = ref(1)
/** A monotonic clock for the visuals: effects and the renderer share it. */
const clock = ref(0)
// The session is a shallowRef mutated in place, so a child that only holds it as
// a prop would never see its props change and would freeze on its first render.
// DEV TOOLS gets a redraw token instead: four times a second is enough for a
// debug readout and costs nothing next to the frame loop.
const devPulse = ref(0)
const devRev = computed(() => Math.floor(clock.value * 4) + devPulse.value)
const confirmRetreat = ref(false)
const toast = ref<{ title: string; body: string; tone: 'good' | 'bad' } | null>(null)

let frame = 0
let last = 0
let logCursor = 0

const stop = (): void => { if (frame) cancelAnimationFrame(frame); frame = 0 }
onUnmounted(stop)

// ── VFX: the log is the engine's truth; this turns it into something to watch ──

const worldOf = (tile: { x: number; y: number }) => DungeonRenderer.world(tile.x, tile.y)

function combatAnchor(live: PlaySession): { x: number; y: number } {
  const engaged = live.entities.find(entity => entity.id === live.engagedId)
  return engaged ? engaged.at : live.player
}

function spawnFor(event: BattleEvent, live: PlaySession): void {
  const view = stage.value
  if (!view) return
  const anchor = worldOf(combatAnchor(live))
  const ally = { x: anchor.x - 34, y: anchor.y + 14 }
  const foe = { x: anchor.x + 30, y: anchor.y - 6 }
  const fromAlly = event.actorId.startsWith('ally')
  const from = fromAlly ? ally : foe
  const to = fromAlly ? foe : ally
  const now = clock.value

  if (event.kind === 'move') {
    const match = /^(.+?):/.exec(event.text)
    const move = match ? Object.values(MOVE_LOOKUP).find(candidate => candidate.name === match[1]) : null
    const kind = event.text.includes('Protección absorbió') ? 'shieldBreak'
      : move?.category === 'special' ? 'special'
        : move?.category === 'status' ? (move.family === 'buff' ? 'buff' : move.family === 'protect' ? 'protect' : 'status')
          : 'physical'
    view.spawn({ kind, x: from.x, y: from.y - 12, toX: to.x, toY: to.y - 12, bornAt: now, life: 0.35 })
    const damage = /: (\d+) de daño/.exec(event.text)
    if (damage) {
      view.spawn({ kind: 'impact', x: to.x, y: to.y - 12, bornAt: now + 0.25, life: 0.3 })
      view.spawn({ kind: 'damage', text: `-${damage[1]}`, x: to.x, y: to.y - 18, bornAt: now + 0.25, life: 0.9 })
    }
  } else if (event.kind === 'boss') {
    if (event.text.includes('de daño')) {
      const amount = /: (\d+) de daño/.exec(event.text)
      view.spawn({ kind: 'aoe', x: ally.x + 10, y: ally.y - 10, bornAt: now, life: 0.45 })
      if (amount) view.spawn({ kind: 'damage', text: `-${amount[1]}`, x: ally.x, y: ally.y - 18, bornAt: now, life: 0.9 })
    }
  } else if (event.kind === 'status') {
    view.spawn({ kind: 'status', x: to.x, y: to.y - 14, toX: to.x, toY: to.y - 24, bornAt: now, life: 0.6 })
  } else if (event.kind === 'capture') {
    const ok = event.text.startsWith('¡Capturado')
    view.spawn({ kind: 'ballThrow', x: ally.x, y: ally.y - 10, toX: foe.x, toY: foe.y - 8, bornAt: now, life: 0.4 })
    view.spawn({ kind: ok ? 'capture' : 'captureFail', x: foe.x, y: foe.y - 8, bornAt: now + 0.4, life: 1.4 })
  } else if (event.kind === 'item') {
    const healed = /\+(\d+) HP/.exec(event.text)
    if (healed) view.spawn({ kind: 'heal', text: `+${healed[1]}`, x: ally.x, y: ally.y - 18, bornAt: now, life: 0.9 })
  } else if (event.kind === 'switch') {
    view.spawn({ kind: 'recall', x: ally.x, y: ally.y - 10, toX: ally.x, toY: ally.y - 10, bornAt: now, life: 0.4 })
    view.spawn({ kind: 'summon', x: ally.x, y: ally.y - 8, bornAt: now + 0.2, life: 0.5 })
  }
}

/** A tiny lookup so the log line can be matched back to the move that made it. */
const MOVE_LOOKUP = Object.fromEntries(
  ['tackle', 'flamethrower', 'iceBeam', 'thunderWave', 'toxic', 'confuseRay', 'quickAttack',
    'protect', 'swordsDance', 'growl', 'bodySlam', 'earthquake', 'hyperBeam']
    .map(id => [id, moveById(id)!]),
)

function drainLog(live: PlaySession): void {
  const log = live.battle?.log ?? []
  for (let i = logCursor; i < log.length; i++) spawnFor(log[i], live)
  logCursor = log.length
}

// ── Loop ───────────────────────────────────────────────────────────────────

function loop(now: number): void {
  const live = session.value
  if (!live) return
  const dt = Math.min(1 / 20, (now - last) / 1000)
  last = now
  if (dt > 0) {
    if (live.battle && live.battle.outcome === 'ongoing') {
      tick(live.battle, dt)
      live.boss?.update(live.battle, dt)
      drainLog(live)
    }
    if (live.battle && live.battle.outcome !== 'ongoing') {
      drainLog(live)
      const before = live.expedition.key.hasKey
      settleCombat(live, () => {
        const rng = streamFor(live.expedition.seed, 'drop', live.expedition.floor, live.log.length)
        const entry = FLOOR_LOOT.entries[rng.int(0, FLOOR_LOOT.entries.length - 1)]
        return rng.chance(0.6) ? [{ itemId: entry.itemId, quantity: entry.quantity }] : []
      })
      logCursor = 0
      announceRewards(live, before)
    }
    clock.value += dt
    advanceClock(live, dt * 1000 * clockSpeed.value)
    if (live.phase === 'ended' && !toast.value) announceEnding(live)
    triggerRef(session)
  }
  if (live.phase !== 'ended') frame = requestAnimationFrame(loop)
  else frame = 0
}

function announceRewards(live: PlaySession, hadKey: boolean): void {
  const view = stage.value
  const spot = worldOf(live.player)
  const latest = live.log[0] ?? ''
  if (view && latest.startsWith('Botín:')) {
    view.spawn({ kind: 'reward', text: latest.replace('Botín: ', ''), x: spot.x, y: spot.y - 26, bornAt: clock.value, life: 1.6 })
  }
  if (view && !hadKey && live.expedition.key.hasKey) {
    view.spawn({ kind: 'key', text: '🔑 Llave de piso', x: spot.x, y: spot.y - 40, bornAt: clock.value, life: 2 })
  }
}

/** Applies a DEV command. The session has one writer, and this is it. */
function runDev(command: DevCommand): void {
  const live = session.value
  if (!live) return
  if (command.kind === 'forceKey') {
    live.expedition = { ...live.expedition, key: { hasKey: true, defeatsWithoutKey: 0 } }
  } else if (command.kind === 'toStairs') {
    live.player = live.tiles.exit
  } else if (command.kind === 'skipToLast') {
    while (live.expedition.floor < live.expedition.floors) {
      live.expedition = { ...live.expedition, key: { hasKey: true, defeatsWithoutKey: 0 } }
      live.player = live.tiles.exit
      if (!descend(live)) break
    }
    live.player = live.tiles.exit
  } else if (command.kind === 'repopulate') {
    for (const entity of live.entities) entity.taken = false
  } else if (command.kind === 'clearFloor') {
    for (const entity of live.entities) if (entity.kind === 'encounter') entity.taken = true
  } else if (command.kind === 'setHp') {
    for (const member of live.expedition.party) member.hp = Math.max(1, Math.round(member.maxHp * command.fraction))
  } else if (command.kind === 'emptyPp') {
    for (const member of live.expedition.party) for (const moveId of member.moves) member.pp[moveId] = 0
  } else if (command.kind === 'addMinutes') {
    advanceClock(live, command.minutes * 60_000)
  }
  triggerRef(session)
}

function announceEnding(live: PlaySession): void {
  devPulse.value++ // the frame loop is about to stop: let DEV TOOLS redraw once more
  const outcome = live.result?.outcome
  if (live.expedition.status === 'wiped') {
    toast.value = {
      title: 'EQUIPO DEBILITADO',
      body: 'Perdiste el botín conseguido en esta Dungeon. Volvés al Centro Pokémon más cercano.',
      tone: 'bad',
    }
  } else if (live.lastMinutes <= 0) {
    toast.value = {
      title: 'LA DUNGEON SE CERRÓ',
      body: 'Extracción automática: el botín y las capturas quedan asegurados. Un combate sin terminar no paga.',
      tone: 'good',
    }
  } else if (outcome === 'EXTRACTED') {
    const loot = Object.entries(live.result?.extractedLoot ?? {}).map(([id, n]) => `${id} ×${n}`).join(', ')
    toast.value = {
      title: 'EXTRACCIÓN COMPLETA',
      body: `Asegurado: ${loot || 'nada'} · ${live.result?.extractedCaptures.length ?? 0} capturas.`,
      tone: 'good',
    }
  }
}

// ── Entering ───────────────────────────────────────────────────────────────

function begin(definition: DungeonDefinition, minutes: number): void {
  stop()
  bag.value = { ...STARTING_INVENTORY }
  toast.value = null
  logCursor = 0
  const now = Date.now()
  const spawn = createSpawn({
    spawnId: `spawn-${now}`, definition,
    position: { tx: 0, ty: 0, areaId: 'pradera' },
    now, minutes, seed: Math.floor(Math.random() * 100000),
  })
  const pool = poolOf(definition)
  preloadSpecies([...pool, ...buildParty().map(member => member.speciesId)])
  session.value = startPlay({
    definition, spawn, party: buildParty(), inventory: STARTING_INVENTORY, pool, now,
  })
  last = performance.now()
  frame = requestAnimationFrame(loop)
}

// ── Exploration ────────────────────────────────────────────────────────────

function step(dx: number, dy: number): void {
  const live = session.value
  if (live && move(live, dx, dy)) triggerRef(session)
}

const nearby = computed(() => (session.value ? reachable(session.value) : []))
const onStairs = computed(() => (session.value ? atStairs(session.value) : false))
const doorOpen = computed(() => session.value?.expedition.key.hasKey ?? false)

function interact(entityId: string): void {
  const live = session.value
  if (!live) return
  const entity = live.entities.find(candidate => candidate.id === entityId)
  if (!entity) return
  if (entity.kind === 'chest') {
    const spot = worldOf(entity.at)
    openChest(live, entityId, () => {
      const rng = streamFor(live.expedition.seed, 'chest', entityId)
      const pick = FLOOR_LOOT.entries[rng.int(0, FLOOR_LOOT.entries.length - 1)]
      return [{ itemId: pick.itemId, quantity: pick.quantity }]
    })
    stage.value?.spawn({ kind: 'reward', text: live.log[0]?.split(': ')[1] ?? 'Cofre', x: spot.x, y: spot.y - 24, bornAt: clock.value, life: 1.6 })
  } else {
    // The encounter starts the way it should look: a ball, then our Pokémon.
    const anchor = worldOf(entity.at)
    engage(live, entityId, {
      makeWild: (speciesId, level) => buildWild(speciesId, level),
      makeCombatant: pokemon => combatantFor(pokemon),
      battleItems: BATTLE_ITEMS,
    })
    logCursor = live.battle?.log.length ?? 0
    stage.value?.spawn({ kind: 'ballThrow', x: anchor.x - 40, y: anchor.y + 10, toX: anchor.x - 34, toY: anchor.y + 6, bornAt: clock.value, life: 0.4 })
    stage.value?.spawn({ kind: 'summon', x: anchor.x - 34, y: anchor.y + 6, bornAt: clock.value + 0.4, life: 0.5 })
  }
  triggerRef(session)
}

function useStairs(): void {
  const live = session.value
  if (!live) return
  if (live.expedition.floor >= live.expedition.floors) enterAntechamber(live)
  else if (descend(live)) stage.value?.clearVfx()
  triggerRef(session)
}

// ── Combat ─────────────────────────────────────────────────────────────────

const battle = computed(() => session.value?.battle ?? null)
const bench = computed(() => session.value?.battle?.bench.p1 ?? [])

function choose(actorId: string, action: PreparedAction): void {
  const live = session.value
  if (!live || !live.battle) return
  if (action.kind === 'item') {
    if ((bag.value[action.itemId] ?? 0) <= 0) return
    bag.value[action.itemId] -= 1
  }
  if (actorId === 'ally-0') act(live, action)
  else {
    const actor = live.battle.actors.find(candidate => candidate.id === actorId)
    if (actor) actor.prepared = action
  }
  triggerRef(session)
}

// ── View for the renderer ──────────────────────────────────────────────────

const combatantView = (actor: BattleActor, alpha: boolean): CombatantView => ({
  id: actor.id,
  speciesId: actor.combatant.pokemon.speciesId,
  side: actor.side,
  hpFraction: Math.max(0, actor.combatant.pokemon.hp / actor.combatant.pokemon.maxHp),
  fainted: isFainted(actor.combatant.pokemon),
  scale: actor.side === 'enemy' && alpha ? 2 : 1,
  aura: actor.side === 'enemy' && alpha,
  shield: actor.shield,
})

const view = computed<RenderView | null>(() => {
  const live = session.value
  if (!live) return null
  const isBoss = live.phase === 'boss'
  const telegraph = live.battle?.telegraph
    ? {
      name: live.battle.telegraph.name,
      progress: Math.max(0, Math.min(1, 1 - (live.battle.telegraph.endsAt - live.battle.seconds) / 2.8)),
    }
    : null
  return {
    tiles: live.tiles,
    entities: live.entities,
    player: { x: live.player.x, y: live.player.y, dir: 'down', moving: false },
    seconds: clock.value,
    combat: live.battle
      ? {
        allies: live.battle.actors.filter(actor => actor.side === 'ally').map(actor => combatantView(actor, isBoss)),
        enemies: live.battle.actors.filter(actor => actor.side === 'enemy').map(actor => combatantView(actor, isBoss)),
        at: combatAnchor(live),
        telegraph,
      }
      : null,
    busyIds: [],
    dimmed: live.phase === 'antechamber' || live.phase === 'ended',
  }
})

// ── Party, items, endings ──────────────────────────────────────────────────

const party = computed(() => session.value?.expedition.party ?? [])
const healthy = computed(() => party.value.filter(member => !isFainted(member)).length)
const countdown = computed(() => (session.value ? formatCountdown(session.value.spawn, session.value.now) : '—'))
const lootCount = computed(() => Object.values(session.value?.expedition.expeditionLoot ?? {}).reduce((a, b) => a + b, 0))

function quickItem(kind: 'potion' | 'revive'): void {
  const live = session.value
  if (!live || (bag.value[kind] ?? 0) <= 0) return
  const target = kind === 'potion'
    ? live.expedition.party.find(member => !isFainted(member) && member.hp < member.maxHp)
    : live.expedition.party.find(isFainted)
  if (!target) return
  bag.value[kind] -= 1
  const spot = worldOf(live.player)
  if (kind === 'potion') {
    const healed = heal(target, 40)
    stage.value?.spawn({ kind: 'heal', text: `+${healed}`, x: spot.x, y: spot.y - 24, bornAt: clock.value, life: 1 })
  } else {
    revive(target, 0.5)
    stage.value?.spawn({ kind: 'summon', x: spot.x, y: spot.y - 10, bornAt: clock.value, life: 0.6 })
  }
  triggerRef(session)
}

function finish(kind: 'retreat' | 'wipe'): void {
  const live = session.value
  if (!live) return
  confirmRetreat.value = false
  endRun(live, kind)
  stop()
  announceEnding(live)
  triggerRef(session)
}

function launchBoss(): void {
  const live = session.value
  if (!live) return
  const anchor = worldOf(live.player)
  if (startBoss(live, {
    makeWild: (speciesId, level) => buildWild(speciesId, level),
    makeCombatant: pokemon => combatantFor(pokemon),
    battleItems: BATTLE_ITEMS,
    players: players.value,
  })) {
    logCursor = live.battle?.log.length ?? 0
    stage.value?.spawn({ kind: 'summon', x: anchor.x - 34, y: anchor.y + 14, bornAt: clock.value, life: 0.6 })
    stage.value?.spawn({ kind: 'summon', x: anchor.x - 56, y: anchor.y + 24, bornAt: clock.value + 0.15, life: 0.6 })
  }
  triggerRef(session)
}

const restart = (): void => { stop(); session.value = null; toast.value = null }
</script>

<template>
  <!-- Choosing where to go: a catalog of entrances, not a form. -->
  <DungeonCatalog v-if="!session" v-model:players="players" :definitions="DUNGEON_DEFINITIONS" @enter="begin" />

  <div v-else class="pd">
    <!-- Expedition HUD: small, over the world, never covering the middle. -->
    <div class="pd-hud">
      <span class="pd-floor">PISO {{ session.expedition.floor }}/{{ session.expedition.floors }}</span>
      <span class="pd-tier">TIER {{ session.definition.tier }}</span>
      <span class="pd-time" :class="{ 'pd-time--urgent': session.lastMinutes <= 5 }">{{ countdown }}</span>
      <span class="pd-key" :class="{ 'pd-key--on': doorOpen }">🔑 {{ doorOpen ? 'CONSEGUIDA' : '—' }}</span>
      <span class="pd-loot">◈ {{ lootCount }}</span>
      <span class="pd-party">{{ healthy }}/{{ party.length }}</span>
    </div>

    <DungeonStage ref="stage" :view="view" :pad="session.phase === 'exploring'" class="pd-stage" @step="step">
      <!-- Contextual actions float over the world, right where the player looks. -->
      <div v-if="session.phase === 'exploring'" class="pd-context">
        <button
          v-for="entity in nearby" :key="entity.id" type="button" class="pd-cta"
          @click="interact(entity.id)"
        >
          <template v-if="entity.kind === 'chest'">▣ Abrir cofre</template>
          <template v-else-if="entity.kind === 'lucky'">✦ {{ speciesById(entity.speciesId ?? 0)?.name }} · con suerte</template>
          <template v-else-if="entity.isAlpha">★ Enfrentar al Alpha</template>
          <template v-else>⚔ {{ speciesById(entity.speciesId ?? 0)?.name }} Nv. {{ entity.level }}</template>
        </button>
        <button
          v-if="onStairs" type="button" class="pd-cta"
          :class="{ 'pd-cta--locked': !doorOpen && session.expedition.floor < session.expedition.floors }"
          @click="useStairs"
        >
          <template v-if="session.expedition.floor >= session.expedition.floors">⇩ Antecámara del Alpha</template>
          <template v-else-if="doorOpen">⇩ Bajar · ABIERTA</template>
          <template v-else>⛔ BLOQUEADA · falta la llave</template>
        </button>
      </div>

      <!-- Antechamber: a real room, with the door and the danger showing. -->
      <div v-if="session.phase === 'antechamber'" class="pd-overlay">
        <div class="pd-sheet">
          <h2>ANTECÁMARA</h2>
          <p class="pd-warn">Detrás de esa puerta hay un Alpha. Acá no se cura nada.</p>
          <ul class="pd-party-list">
            <li v-for="member in party" :key="member.instanceId" :class="{ 'pd-down': isFainted(member) }">
              <strong>{{ speciesById(member.speciesId)?.name }}</strong>
              <span>Nv. {{ member.level }}</span>
              <span class="pd-mini"><i :style="{ width: `${Math.max(0, (member.hp / member.maxHp) * 100)}%` }" /></span>
              <span>{{ Math.max(0, member.hp) }}/{{ member.maxHp }}</span>
            </li>
          </ul>
          <p class="pd-note">
            Poción ×{{ bag.potion ?? 0 }} · Revivir ×{{ bag.revive ?? 0 }} · Éter ×{{ bag.ether ?? 0 }} ·
            Ball ×{{ bag.poke_ball ?? 0 }} · quedan {{ countdown }} · listos {{ players }}/{{ players }}
          </p>
          <div class="pd-row">
            <button type="button" class="pd-go" @click="launchBoss">ENTRAR</button>
            <button type="button" class="pd-alt" @click="confirmRetreat = true">Retirarse</button>
          </div>
        </div>
      </div>

      <!-- Endings -->
      <div v-if="toast" class="pd-overlay">
        <div class="pd-sheet" :class="`pd-sheet--${toast.tone}`">
          <h2>{{ toast.title }}</h2>
          <p>{{ toast.body }}</p>
          <button type="button" class="pd-go" @click="restart">Volver al catálogo</button>
        </div>
      </div>

      <div v-if="confirmRetreat" class="pd-overlay">
        <div class="pd-sheet">
          <h2>¿Abandonar la Dungeon?</h2>
          <p>Asegurás todo el botín y las capturas de esta expedición. La próxima vez empezás en el piso 1.</p>
          <div class="pd-row">
            <button type="button" class="pd-go" @click="finish('retreat')">Sí, salir</button>
            <button type="button" class="pd-alt" @click="confirmRetreat = false">Seguir explorando</button>
          </div>
        </div>
      </div>
    </DungeonStage>

    <!-- Combat HUD, or the exploration bar. Never both. -->
    <BattleHud
      v-if="battle && battle.outcome === 'ongoing'"
      :battle="battle" :bag="bag" :bench="bench" :items="BATTLE_ITEMS"
      @choose="choose"
    />
    <div v-else-if="session.phase === 'exploring'" class="pd-bar">
      <button type="button" class="pd-tool" :disabled="(bag.potion ?? 0) <= 0" @click="quickItem('potion')">
        <span class="pd-dot pd-dot--potion" /> Poción <em>×{{ bag.potion ?? 0 }}</em>
      </button>
      <button type="button" class="pd-tool" :disabled="(bag.revive ?? 0) <= 0" @click="quickItem('revive')">
        <span class="pd-dot pd-dot--revive" /> Revivir <em>×{{ bag.revive ?? 0 }}</em>
      </button>
      <button type="button" class="pd-tool" @click="confirmRetreat = true">↩ Retirarse</button>
    </div>

    <DevTools
      v-model:clock-speed="clockSpeed" v-model:players="players" :rev="devRev" :session="session"
      @command="runDev" @wipe="finish('wipe')" @restart="restart"
    />
  </div>
</template>

<style scoped>
.pd { display: grid; gap: 8px; }
.pd-stage { height: min(52vh, 470px); }

.pd-hud {
  display: flex; flex-wrap: wrap; gap: 6px; align-items: center;
  padding: 6px 8px; border: 1px solid #2b3a5e; border-radius: 10px;
  background: #101729; font-size: 0.72rem; font-weight: 700; letter-spacing: 0.02em;
}
.pd-floor { color: #ffd27a; }
.pd-tier, .pd-loot, .pd-party { color: #93a2c6; }
.pd-time { margin-left: auto; font-variant-numeric: tabular-nums; }
.pd-time--urgent { color: #ff8a8a; }
.pd-key { color: #6b7ba8; }
.pd-key--on { color: #ffd27a; }

.pd-context { position: absolute; right: 10px; bottom: 10px; display: grid; gap: 6px; justify-items: end; }
.pd-cta {
  min-height: 44px; padding: 8px 12px; border: 1px solid #ffd27a; border-radius: 10px;
  background: rgba(23, 32, 56, 0.94); color: #ffd27a; font: inherit; font-weight: 700; cursor: pointer;
}
.pd-cta--locked { border-color: #6b7ba8; color: #93a2c6; }

.pd-overlay {
  position: absolute; inset: 0; display: grid; place-items: center;
  padding: 12px; background: rgba(6, 9, 20, 0.72);
}
.pd-sheet {
  width: min(420px, 100%); padding: 14px; border: 1px solid #3a4767; border-radius: 12px;
  background: #121a2e; text-align: left;
}
.pd-sheet h2 { margin: 0 0 6px; font-size: 1rem; letter-spacing: 0.04em; }
.pd-sheet--bad { border-color: #7a2d2d; }
.pd-sheet--bad h2 { color: #ff8a8a; }
.pd-sheet--good h2 { color: #7ee2a8; }
.pd-warn { margin: 0 0 8px; color: #ff9f7a; font-size: 0.8rem; }
.pd-note { margin: 8px 0; font-size: 0.72rem; color: #93a2c6; }
.pd-party-list { display: grid; gap: 4px; margin: 0; padding: 0; list-style: none; font-size: 0.76rem; }
.pd-party-list li { display: grid; grid-template-columns: 1fr auto 60px auto; gap: 6px; align-items: center; }
.pd-down { opacity: 0.5; color: #ff8a8a; }
.pd-mini { position: relative; height: 6px; border-radius: 999px; background: #0f1730; overflow: hidden; }
.pd-mini i { position: absolute; inset: 0 auto 0 0; display: block; background: #7ee2a8; }
.pd-row { display: flex; gap: 8px; }
.pd-go {
  flex: 1; min-height: 44px; border: none; border-radius: 10px;
  background: #ffd27a; color: #221a06; font: inherit; font-weight: 800; cursor: pointer;
}
.pd-alt {
  flex: 1; min-height: 44px; border: 1px solid #3a4767; border-radius: 10px;
  background: transparent; color: #e8eeff; font: inherit; cursor: pointer;
}

.pd-bar { display: flex; flex-wrap: wrap; gap: 6px; }
.pd-tool {
  display: flex; gap: 6px; align-items: center; min-height: 44px; padding: 6px 12px;
  border: 1px solid #2b3a5e; border-radius: 10px; background: #1f2b49; color: #e8eeff;
  font: inherit; cursor: pointer;
}
.pd-tool em { font-style: normal; color: #93a2c6; }
.pd-tool:disabled { opacity: 0.4; cursor: not-allowed; }
.pd-dot { width: 12px; height: 12px; border-radius: 50%; }
.pd-dot--potion { background: #ff7a9f; }
.pd-dot--revive { background: #ffd27a; }

@media (max-width: 420px) {
  .pd-stage { height: 42vh; }
}
</style>
