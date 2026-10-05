import type { Dir } from '../../engine/characters'

export type PresenceAreaId = 'ciudad-corazon' | 'pradera' | 'cueva-inicial'

/** One shared town, one shared wild zone and (CAVES-3) one shared cave interior; no product instances. */
export function isPresenceAreaId(areaId: string): areaId is PresenceAreaId {
  return areaId === 'ciudad-corazon' || areaId === 'pradera' || areaId === 'cueva-inicial'
}
export interface RemotePresenceActor {
  id: string
  areaId: PresenceAreaId
  tx: number
  ty: number
  username: string
  characterId: string
  companionId: number | null
  dir: Dir
  speed: number
  moveSequence: number
}
export interface RemoteActorsPort {
  /** Reconciles the occasional authoritative snapshot without recreating unchanged actors. */
  replaceRemoteActors(actors: readonly RemotePresenceActor[]): void
  /** Applies one socket delta; this is the hot path while players are moving. */
  upsertRemoteActor(actor: RemotePresenceActor): void
  removeRemoteActor(id: string): void
  /** `self` acks describe one move; `snapshot` answers join/ready and area requests. */
  setAuthoritativeActor(actor: RemotePresenceActor | null, source?: 'snapshot' | 'self'): void
  setPresenceAccess(access: 'pending' | 'player' | 'guest'): void
  /** Optional: an intent the service refused, by its public reason text. Diagnostics only. */
  presenceRejected?(reason: string): void
}
/**
 * PRESENCE UX-1: how far one socket got, for the world-entry controller.
 * Events only, no positions: the area itself reaches the engine through
 * `RemoteActorsPort.setAuthoritativeActor` before `snapshot` is reported.
 */
export interface PresenceConnectionStatus {
  /** A snapshot of this socket's room was applied (join, ready and every area change). */
  snapshot(access: 'player' | 'guest'): void
  /** The room was lost; the adapter retries on its own. */
  lost(): void
  /** Another tab or device owns the account's session (4409, or 4001 read as one): the adapter stopped for good. */
  replaced(): void
  /**
   * CLOUD READINESS-3: the server that held the session did not answer after bounded retries; the
   * adapter stopped. Only «Jugar acá» (a fresh join with takeover) continues. Optional: an older
   * status sink without it keeps the adapter retrying as on any drain.
   */
  held?(): void
}
export interface LocalPresencePort {
  move(direction: Dir, running: boolean, sequence: number): void
  changeArea(areaId: string): void
  observe(areaId: string, tx: number, ty: number): void
}

/**
 * Where chat traffic goes, when there is any.
 *
 * Declared here, as a shape rather than an import, so the socket adapter can
 * carry chat without the multiplayer feature depending on the chat feature.
 * Community Playtest 0.1 passes one in; a normal build passes nothing and the
 * adapter simply never routes those messages.
 */
export interface ChatTransportPort {
  /** One line from the room, unvalidated: the receiver parses it. */
  line(raw: unknown): void
  /** The recent history of an area, on join and on every area change. */
  history(areaId: string, raw: unknown): void
  setAccess(access: 'connecting' | 'player' | 'guest'): void
  /** The socket is gone; nothing can be sent until a new one attaches. */
  detach(): void
}
