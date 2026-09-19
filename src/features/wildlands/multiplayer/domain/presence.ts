import type { Dir } from '../../engine/characters'

export type PresenceAreaId = 'ciudad-corazon' | 'pradera'

/** R30 has one shared town and one shared wild zone; no product instances. */
export function isPresenceAreaId(areaId: string): areaId is PresenceAreaId {
  return areaId === 'ciudad-corazon' || areaId === 'pradera'
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
  setRemoteActors(actors: readonly RemotePresenceActor[]): void
  setAuthoritativeActor(actor: RemotePresenceActor | null): void
  setPresenceAccess(access: 'pending' | 'player' | 'guest'): void
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
