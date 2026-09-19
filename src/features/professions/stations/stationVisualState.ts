// Process state → visual state (R33).
//
// The renderer must not know what a recipe is, how much ore a job committed or
// whether the player can afford another one. It draws one of four pictures.
// This module is the whole translation, and it is deliberately the only place
// the two vocabularies meet.
//
// The mapping is one to one, which is the point: the approved art
// (`art/stationVisuals.ts`) was designed against these four situations, so
// there is nothing to interpret.
//
//   no process  → idle      cold and empty
//   ready       → ready     charged, not lit
//   working     → working   running; the only animated state
//   done        → done      finished, something to take
//
// `ready` is **world** state, not hover state: a station is ready because a
// process is holding its inputs, not because the player happens to be carrying
// the right ore (§11).

import type { StationState } from '../art/stationVisuals'
import type { PlacedStation } from './stationInstance'
import { stationPhase, type StationPhase, type StationProcessState } from './stationProcess'

export type { StationState }

const BY_PHASE: Readonly<Record<StationPhase, StationState>> = {
  idle: 'idle',
  ready: 'ready',
  working: 'working',
  done: 'done',
}

export const visualStateForPhase = (phase: StationPhase): StationState => BY_PHASE[phase]

export const visualStateForProcess = (process: StationProcessState | null): StationState =>
  visualStateForPhase(stationPhase(process))

export const stationVisualState = (station: PlacedStation): StationState => visualStateForProcess(station.process)
