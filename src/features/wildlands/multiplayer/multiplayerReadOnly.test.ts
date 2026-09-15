import { describe, expect, it } from 'vitest'

const SOURCES = import.meta.glob<string>(['./api/colyseusPresence.ts', './domain/presence.ts'], {
  query: '?raw', import: 'default', eager: true,
})

describe('R30 trust boundary', () => {
  it('contains no database mutations, polling or unsafe DOM rendering', () => {
    const source = SOURCES['./api/colyseusPresence.ts']
    expect(source).not.toMatch(/\.from\(|\.insert\(|\.update\(\s*\{|\.delete\(\s*\)|\.upsert\(|\.rpc\(/)
    // A bounded reconnect delay is event-driven lifecycle recovery, not polling.
    expect(source).not.toMatch(/setInterval|innerHTML|v-html|localStorage/)
    expect(source).toMatch(/code === REPLACED_SESSION_CODE/)
    expect(source).toMatch(/room\.reconnection\.enabled = false/)
    expect(source).toMatch(/room\.onDrop\(/)
    expect(source).toMatch(/room\.onError\(recoverTransport\)/)
  })

  it('keeps the game independent from Colyseus and Supabase', () => {
    const source = import.meta.glob<string>('../engine/game.ts', { query: '?raw', import: 'default', eager: true })['../engine/game.ts']
    expect(source).not.toMatch(/colyseus|supabase/i)
  })

  it('forwards running state and sequence to the local presence port', () => {
    const source = import.meta.glob<string>('../components/WildlandsView.vue', { query: '?raw', import: 'default', eager: true })['../components/WildlandsView.vue']
    expect(source).toMatch(/move:\s*\(direction, running, sequence\)\s*=>\s*presence\?\.move\(direction, running, sequence\)/)
  })

  it('installs presence receivers before requesting the authoritative spawn', () => {
    const source = SOURCES['./api/colyseusPresence.ts']
    const selfReceiver = source.indexOf("room.onMessage<RemotePresenceActor>(SELF")
    const ready = source.indexOf("room.send('presence:ready')")
    expect(selfReceiver).toBeGreaterThan(-1)
    expect(ready).toBeGreaterThan(selfReceiver)
  })

  it('takes actor access from the server snapshot instead of assuming browser auth', () => {
    const source = SOURCES['./api/colyseusPresence.ts']
    expect(source).toMatch(/setPresenceAccess\(snapshot\.access\)/)
    expect(source).toMatch(/setPresenceAccess\('pending'\)/)
  })
})
