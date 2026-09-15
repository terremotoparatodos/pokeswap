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
