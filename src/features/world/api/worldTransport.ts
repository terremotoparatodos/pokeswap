// World transport port (WORLD-1).
//
// The world rides the presence socket: `ColyseusPresence` owns the room and
// hands world traffic to this sink, the way it already does for chat. Without
// a sink the adapter never declares `worldProtocol`, so the server sends no
// world messages at all.

import type { WildRoster, WorkDone, WorkResult, WorldBatch, WorldSnapshot } from '../../../../services/realtime/src/world/worldProtocol.js'

export type WorldSend = (type: string, payload: unknown) => void

export interface WorldTransportSink {
  /** The socket is ready: intents may be sent through `send` from now on. */
  attach(send: WorldSend): void
  /** The socket is gone: forget everything; a snapshot follows the next join. */
  detach(): void
  snapshot(snapshot: WorldSnapshot): void
  batch(batch: WorldBatch): void
  workResult(result: WorkResult): void
  workDone(done: WorkDone): void
  /** A new hour's wild roster for the viewer's area. */
  wild(message: { now: number; wild: WildRoster }): void
}
