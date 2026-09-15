// Vue wrapper around the local demo reducer. One instance per prototype
// surface (playground, WildLands demo); state lives only in memory.

import { shallowRef, type ShallowRef } from 'vue'
import type { ProfessionId } from '../domain/types'
import {
  craftDemo, createDemoState, gatherDemo, repairDemoTool, syncDemoClock,
  type DemoCraftOutcome, type DemoGatherOutcome, type DemoNodeTarget, type DemoRepairOutcome, type DemoState,
} from './demoSession'

export interface ProfessionDemoSession {
  readonly state: Readonly<ShallowRef<DemoState>>
  /** Brings the demo clock to now (regenerates energy, expires depletion). */
  sync(): void
  gather(target: DemoNodeTarget): DemoGatherOutcome
  craft(recipeId: string, quantity: number): DemoCraftOutcome
  repair(profession: ProfessionId): DemoRepairOutcome
  update(change: (state: DemoState) => DemoState): void
  /** Playground time travel. */
  advance(ms: number): void
  reset(): void
}

export function useProfessionDemo(): ProfessionDemoSession {
  let offset = 0
  const now = () => Date.now() + offset
  const state = shallowRef(createDemoState(now()))

  const current = (): DemoState => {
    const synced = syncDemoClock(state.value, now())
    if (synced !== state.value) state.value = synced
    return synced
  }
  const run = <T extends { state: DemoState }>(action: (value: DemoState) => T): T => {
    const outcome = action(current())
    state.value = outcome.state
    return outcome
  }

  return {
    state,
    sync: () => { current() },
    gather: target => run(value => gatherDemo(value, target)),
    craft: (recipeId, quantity) => run(value => craftDemo(value, recipeId, quantity)),
    repair: profession => run(value => repairDemoTool(value, profession)),
    update: change => { state.value = change(current()) },
    advance: ms => { offset += ms; current() },
    reset: () => { offset = 0; state.value = createDemoState(now()) },
  }
}
