// PRESENCE UX-1: how WildlandsView enters the world. The engine and the
// controller are exercised end to end in multiplayer/state/worldEntry.e2e.test.ts;
// this pins the view's own wiring, which those tests reproduce.

import { describe, expect, it } from 'vitest'

const view = import.meta.glob<string>('./WildlandsView.vue', { query: '?raw', import: 'default', eager: true })['./WildlandsView.vue']
const script = view.slice(view.indexOf('<script setup'))
const mounted = script.slice(script.indexOf('onMounted(async'), script.indexOf('onMounted(() =>'))
const online = mounted.slice(mounted.indexOf('if (online) {'), mounted.indexOf('} else {', mounted.indexOf('if (online) {')))
const offline = mounted.slice(mounted.indexOf('} else {', mounted.indexOf('if (online) {')))

describe('WildlandsView world entry', () => {
  it('shows the town’s arrival text only in the offline world', () => {
    expect(view.match(/Llegando a Ciudad Corazón…/g)).toHaveLength(1)
    expect(view).toMatch(/<div v-if="loading && entry\.phase === 'offline'" class="wl-loading">Llegando a Ciudad Corazón…<\/div>/)
    expect(view).toMatch(/<WorldEntryOverlay :state="entry" @retry="entryController\?\.retry\(\)" \/>/)
  })

  it('decides online from the realtime configuration, not from the session', () => {
    expect(script).toMatch(/const online = REALTIME_CONFIGURED/)
    expect(script).toMatch(/initialWorldEntry\(REALTIME_CONFIGURED\)/)
  })

  it('online, neither the URL nor the saved town tile nor a feature door places the player', () => {
    expect(mounted).toMatch(/const querySpawn = !online && /)
    expect(mounted).toMatch(/const startArea = !online && /)
    expect(mounted).toMatch(/const savedSpawn = !online && /)
    expect(mounted).toMatch(/if \(!online && panel\.feature\.value && !querySpawn\) created\.placeAtDoor/)
  })

  it('online, the scene is held before the frame loop starts and nothing is prepared before the snapshot', () => {
    expect(online).toMatch(/new WorldEntryController\(/)
    expect(online).toMatch(/scene: created/)
    expect(online).not.toMatch(/prepare\(\)/)
    expect(mounted.indexOf('entryController.start()')).toBeGreaterThan(-1)
    expect(mounted.indexOf('entryController.start()')).toBeLessThan(mounted.indexOf('created.start()'))
    // Every socket the controller opens reports to it.
    expect(online).toMatch(/connectPresence\(created, status\)/)
  })

  it('offline keeps the pre-UX-1 sequence: prepare, pending access, one socket, connect', () => {
    const order = ['await created.prepare()', 'if (disposed) return', "created.setPresenceAccess('pending')", 'presence = connectPresence(created)', 'void presence.connect(']
    const at = order.map(step => offline.indexOf(step))
    expect(at.every(index => index > -1)).toBe(true)
    expect([...at].sort((a, b) => a - b)).toEqual(at)
  })

  it('a session change renews the controller’s socket online and never opens a second one', () => {
    const watcher = script.slice(script.indexOf('watch(user'))
    expect(watcher).toMatch(/if \(REALTIME_CONFIGURED\) \{ entryController\?\.renew\(\); return \}/)
    expect(watcher.indexOf('entryController?.renew()')).toBeLessThan(watcher.indexOf('connectPresence(game.value)'))
  })

  it('unmounting disposes the controller (its timers and socket)', () => {
    expect(script.slice(script.indexOf('onUnmounted(')).split('\n').slice(0, 12).join('\n')).toMatch(/entryController\?\.dispose\(\)/)
  })
})
