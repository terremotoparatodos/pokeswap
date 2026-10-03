import { describe, expect, it } from 'vitest'
import { LOBBY_ID } from '../../areas/atlas'
// @ts-expect-error -- the server's wire module ships no declaration file; this test reads one constant from it.
import { AREA as WIRE_AREA } from '../../../../../services/realtime/src/protocol/messages.js'

const AREA = WIRE_AREA as { readonly TOWN: string }

// PRESENCE UX-1: a guest's snapshot carries no area. The presence service
// starts every new observer in `AREA.TOWN` (PresenceRoom.onJoin, pinned by
// PresenceRoom.test.js), and the client shows its default area, `LOBBY_ID`,
// once that snapshot arrives (worldEntry.e2e.test.ts). Both sides only agree
// while these two names are the same area. Test-only import: the server's
// wire module never reaches the client bundle through this file.
describe('guest area contract', () => {
  it('the client default area is the server’s observer start area', () => {
    expect(LOBBY_ID).toBe(AREA.TOWN)
  })
})
