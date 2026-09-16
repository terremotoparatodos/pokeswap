// Fishing controller: connects a WildLands game, the local demo session and the
// fishing overlay. Used by the playground field lab and the dev-only WildLands
// demo, so both surfaces behave identically.

import { ref, shallowRef, watch } from 'vue'
import type { Area } from '../../wildlands/engine/area'
import type { WorldObjectTarget } from '../../wildlands/engine/game'
import type { RodTier } from '../art/fishingItems'
import { createSeededRandom } from '../domain/rng'
import { demoAffinity, demoTool, demoWorker, inspectDemoNode, type DemoGatherOutcome, type DemoNodeTarget } from '../demo/demoSession'
import type { ProfessionDemoSession } from '../demo/useProfessionDemo'
import { outcomeRarity } from '../mining/miningRarity'
import type { MiningGamePort } from '../mining/useMiningController'
import type { TilePoint } from '../overworld/workerPresence'
import { resolveNodeStatus } from '../ui/nodeStatus'
import { canCastFrom } from './fishingApproach'
import { FishingOverlay } from './fishingOverlay'
import { planCast, type ReelGrade } from './fishingTimeline'

export interface FishingSelection {
  readonly target: DemoNodeTarget
  /** Spot tile: the bank (shore) or the reef itself. */
  readonly tx: number
  readonly ty: number
  /** Water the spot marks and the line lands on. */
  readonly water: TilePoint
  /** Kept so casting can read water and solidity without another engine call. */
  readonly area: Area
}

export type FishingPhase = 'idle' | 'casting' | 'result'

export interface FishingOutcome {
  readonly grade: ReelGrade
  readonly gather: DemoGatherOutcome | null
}

/** Same engine surface the mining controller needs. */
export type FishingGamePort = MiningGamePort

export function useFishingController(session: ProfessionDemoSession, game: () => FishingGamePort | null, detectionOverride: () => number | null = () => null) {
  const selection = shallowRef<FishingSelection | null>(null)
  const phase = ref<FishingPhase>('idle')
  const outcome = shallowRef<FishingOutcome | null>(null)
  /** Seeded like every other demo roll, so a run can be replayed. */
  let casts = 0
  /** True while the fish is hooked, so the card can shout "reel now". */
  const biting = ref(false)

  const overlay = new FishingOverlay({
    state: () => session.state.value,
    player: () => game()?.playerSnapshot() ?? null,
    detection: () => detectionOverride() ?? demoAffinity(session.state.value, 'fishing')?.bonuses.detection ?? 0,
    targetId: () => selection.value?.target.nodeId ?? null,
  })

  watch(() => demoWorker(session.state.value, 'fishing')?.speciesId ?? null, speciesId => {
    if (speciesId !== null) overlay.preloadWorker(speciesId)
  }, { immediate: true })

  const attach = () => game()?.setSceneOverlay(overlay)
  const detach = () => {
    overlay.cancel()
    game()?.setSceneOverlay(null)
    game()?.setInputLocked(false)
  }

  /** Side-effect-free probe for the engine navigator. */
  const isSpot = (hit: WorldObjectTarget) => overlay.spotAt(hit.area, hit.tx, hit.ty) !== null

  const probeOf = (area: Area) => ({
    isWater: (tx: number, ty: number) => area.isWater(tx, ty),
    isSolid: (tx: number, ty: number) => area.isSolid(tx, ty),
  })

  function inspect(hit: WorldObjectTarget): boolean {
    // Tapping the ripples in the water selects the spot on the bank beside them.
    const found = overlay.spotAt(hit.area, hit.tx, hit.ty)
    if (!found) return false
    if (phase.value === 'casting') return true
    selection.value = {
      target: found.target, tx: found.tx, ty: found.ty,
      water: overlay.waterOf(hit.area, found.tx, found.ty), area: hit.area,
    }
    outcome.value = null
    phase.value = 'idle'
    return true
  }

  function close(): void {
    if (phase.value === 'casting') return
    selection.value = null
    outcome.value = null
    phase.value = 'idle'
  }

  /** Casts the line; false when the player is not on the bank or the spot is blocked. */
  function cast(): boolean {
    const current = selection.value
    if (!current || phase.value === 'casting') return false
    const player = game()?.playerSnapshot()
    // You cast standing next to the water the spot marks, from dry land when there is any.
    if (player && !canCastFrom(probeOf(current.area), player, current.water)) {
      close()
      return false
    }

    session.sync()
    const state = session.state.value
    const inspection = inspectDemoNode(state, current.target)
    if (resolveNodeStatus({ ...inspection, phase: 'idle' }) !== 'available' || !inspection.check.ok) return false

    phase.value = 'casting'
    outcome.value = null
    biting.value = false
    game()?.setInputLocked(true)
    overlay.start({
      target: current.target, tx: current.tx, ty: current.ty, water: current.water,
      plan: planCast(createSeededRandom(state.rngSeed * 97 + casts++)),
      tier: (demoTool(state, 'fishing')?.definition.tier ?? 1) as RodTier,
      workerSpeciesId: demoWorker(state, 'fishing')?.speciesId ?? null,
      // Only a real catch costs energy and wear: a missed window costs time.
      onResult: grade => {
        const result = session.gather(current.target)
        outcome.value = { grade, gather: result }
        if (!result.ok) return null
        return { stacks: [...result.result.drops, ...result.result.rareDrops], xp: result.result.xp, rarity: outcomeRarity(result.result) }
      },
      onDone: grade => {
        if (!outcome.value) outcome.value = { grade, gather: null }
        phase.value = 'result'
        biting.value = false
        game()?.setInputLocked(false)
      },
    })
    return true
  }

  /** Pulls the line; returns how good the reaction was. */
  function reel(): ReelGrade | null {
    const grade = overlay.reel()
    if (grade) biting.value = false
    return grade
  }

  /** Called on a timer by the host view so the card lights up on the bite. */
  function syncBite(): void {
    biting.value = overlay.biting
  }

  return { selection, phase, outcome, biting, overlay, attach, detach, isSpot, inspect, close, cast, reel, syncBite }
}

export type FishingController = ReturnType<typeof useFishingController>
