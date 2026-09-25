// Types for the browser-side acceptance tests; the service itself is plain JS.
export interface WorldSocket { send(type: string, payload: unknown): void }
export interface WorldViewer { id?: string; areaId: string; tx: number; ty: number }
export declare class WorldRoom {
  constructor(options: {
    skills: unknown
    ownership: unknown
    lookupActor(id: string): WorldViewer | null
    clientForPlayer(id: string): WorldSocket | null
    now?: () => number
  })
  join(client: WorldSocket, options: unknown, auth: { kind: string; userId?: string; token?: string | null }): void
  leave(client: WorldSocket): void
  snapshot(client: WorldSocket, viewer: WorldViewer): void
  viewerMoved(client: WorldSocket, viewer: WorldViewer): void
  work(actor: WorldViewer, payload: unknown): Promise<unknown>
  cancel(actor: WorldViewer, payload: unknown): void
  tick(now?: number): void
  flush(): void
  stats(): Record<string, unknown>
}
