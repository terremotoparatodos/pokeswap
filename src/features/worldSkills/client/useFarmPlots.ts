// Agricultura in the shared world: selecting a plot and asking the server to
// plant, tend or harvest it (INTEGRATION-1). Vue state only; the server
// validates (WORLD: the plot, whose it is, the stage; SKILLS: the crop, the
// level, the aptitude) and persists. What the card shows comes from there.

import { computed, ref, shallowRef } from 'vue'
import { PLOTS, plotStageAt, type PlotDef } from '../../../../services/realtime/src/world/plots.js'
import type { FarmAction } from '../../skills/domain/farming'
import type { SkillsSession } from '../../skills/ui/skillsSession'
import type { SettleResult } from '../../skills/service/skillsService'
import type { WorkerRef } from '../../skills/ui/workerRef'
import type { PlotStageName } from '../../skills/ui/farmView'
import type { SkillsGamePort, WorldHit } from '../../skills/ui/useSkillsLayer'
import type { SharedWorld } from '../../world/state/sharedWorld'

export interface PlotView {
  readonly plot: PlotDef
  readonly stage: PlotStageName
  readonly cropId: string | null
  readonly mine: boolean
  readonly tended: boolean
  readonly readyInMs: number
  /** What this player may do here now, or null (someone else's crop, or growing and tended). */
  readonly action: FarmAction | null
}

export function useFarmPlots(game: () => SkillsGamePort | null, session: SkillsSession, world: SharedWorld) {
  const version = ref(0)
  const touch = () => { version.value++ }
  const selection = shallowRef<PlotDef | null>(null)
  const phase = ref<'idle' | 'working' | 'result'>('idle')
  const run = shallowRef<{ actionId: string; workerName: string; durationMs: number } | null>(null)
  const result = shallowRef<SettleResult | null>(null)
  const refusal = ref<string | null>(null)
  const lastWorker = ref<string | null>(null)

  const unsubscribe = session.subscribe(() => {
    touch()
    const current = run.value
    if (!current) return
    const settled = session.result(current.actionId)
    if (settled === undefined) return
    result.value = settled
    phase.value = settled ? 'result' : 'idle'
    run.value = null
    game()?.setInputLocked(false)
  })

  const plotAt = (hit: WorldHit): PlotDef | null =>
    PLOTS.find(plot => plot.areaId === hit.area.id && plot.tx === hit.tx && plot.ty === hit.ty) ?? null

  /** Re-read every half second while open, so "Creciendo" becomes "¡Lista!" on its own. */
  const tick = ref(0)
  const timer = setInterval(() => { if (selection.value) tick.value++ }, 500)

  const view = computed<PlotView | null>(() => {
    void version.value; void tick.value
    const plot = selection.value
    if (!plot) return null
    const node = world.resources.node(plot.id)
    const now = world.serverNow() ?? Date.now()
    const me = world.playerData?.playerId ?? null
    const data = node?.plot ?? null
    const stage: PlotStageName = node?.actionId ? 'working' : plotStageAt(data, now)
    const mine = !!data && data.ownerId === me
    const action: FarmAction | null = stage === 'empty' ? 'plant'
      : !mine ? null
        : stage === 'ready' ? 'harvest'
          : (stage === 'planted' || stage === 'growing') && !data?.tended ? 'tend' : null
    return { plot, stage, cropId: data?.cropId ?? null, mine, tended: data?.tended ?? false, readyInMs: data ? data.readyAt - now : 0, action }
  })

  function inspect(hit: WorldHit): boolean {
    const plot = plotAt(hit)
    if (!plot) return false
    if (phase.value === 'working') return true
    selection.value = plot
    phase.value = 'idle'
    result.value = null
    refusal.value = null
    touch()
    return true
  }

  function close(): void {
    if (phase.value === 'working') return
    selection.value = null
    phase.value = 'idle'
    result.value = null
    refusal.value = null
  }

  async function work(worker: WorkerRef, workerName: string, cropId: string | null): Promise<void> {
    const plot = selection.value
    if (!plot || phase.value === 'working') return
    phase.value = 'working'
    refusal.value = null
    result.value = null
    game()?.setInputLocked(true)
    const begin = await session.begin(plot.id, worker, cropId)
    if (!begin.allowed) {
      phase.value = 'idle'
      refusal.value = begin.message
      game()?.setInputLocked(false)
      return
    }
    lastWorker.value = worker.instanceId
    run.value = { actionId: begin.actionId, workerName, durationMs: begin.durationMs }
    // The result arrives with world:work:done (see the subscription above).
  }

  function detach(): void {
    clearInterval(timer)
    if (run.value) session.cancel(run.value.actionId)
    unsubscribe()
  }

  const open = computed(() => selection.value !== null)
  return { selection, view, phase, run, result, refusal, lastWorker, open, isWorldObject: (hit: WorldHit) => plotAt(hit) !== null, inspect, close, work, detach }
}
