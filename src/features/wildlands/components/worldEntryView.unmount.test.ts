import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, ref } from 'vue'

// PRESENCE UX-1 R3: WildlandsView unmounted while a measurement build is still
// loading its capture module (the one await between building the engine and
// opening the online entry). Once that import resolves, nothing may start:
// no entry controller, no socket, no timer, no listener, no state change.
// The view is mounted for real; only its data sources and the SDK are fakes.

const hold = vi.hoisted(() => {
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  return { gate, release: () => release(), requested: false, attach: vi.fn(), controllers: 0, clients: 0 }
})

vi.mock('../perf/usePerfCapture', async () => {
  hold.requested = true
  await hold.gate
  return {
    usePerfCapture: () => ({ attach: hold.attach, detach: vi.fn(), port: (target: unknown) => target, measureHud: (run: () => void) => run(), session: null }),
  }
})
vi.mock('../multiplayer/state/worldEntryController', async importOriginal => {
  const original = await importOriginal<typeof import('../multiplayer/state/worldEntryController')>()
  class CountedController extends original.WorldEntryController {
    constructor(...args: ConstructorParameters<typeof original.WorldEntryController>) {
      hold.controllers++
      super(...args)
    }
  }
  return { ...original, WorldEntryController: CountedController }
})
vi.mock('@colyseus/sdk', () => ({
  Client: class { constructor() { hold.clients++ } async joinOrCreate() { return new Promise(() => undefined) } },
}))
vi.mock('../../../shared/api/supabase', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) } },
}))
vi.mock('../../auth/composables/useAuth', () => ({ useAuth: () => ({ user: ref(null), profile: ref(null), isLoading: ref(false) }) }))
vi.mock('../identity/usePlayerIdentity', () => ({
  usePlayerIdentity: () => ({
    waitUntilReady: async () => undefined, initialTownPosition: () => null, recordTownPosition: () => undefined,
    visualIdentity: ref(null), refreshOwnership: async () => undefined,
  }),
}))
vi.mock('../lobby/useLobbyPanel', () => ({
  useLobbyPanel: () => ({ feature: ref(null), access: ref('closed'), title: ref(''), open: vi.fn(), close: vi.fn() }),
}))
vi.mock('vue-router', () => ({
  useRoute: () => ({ query: {}, params: {}, path: '/mundo' }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  RouterView: { render: () => null },
}))
vi.mock('../../pokemon/api/pokemonApi', () => ({ listPokemon: async () => [] }))
vi.mock('../lobby/preloadLobbyArt', () => ({ preloadLobbyArt: async () => undefined }))
// The async children, as the smallest components that satisfy the view: the
// professions layer is a world probe provider, so it answers like an empty one.
const empty = (exposed: Record<string, unknown> = {}) => ({
  __esModule: true,
  default: defineComponent({ setup(_props, { expose }) { expose(exposed); return () => null } }),
})
vi.mock('../../skills/components/SkillsWorldLayer.vue', () => empty({
  placedObjects: () => [], inspect: () => false, isWorldObject: () => false, overlay: undefined,
  closeTransient() {}, toggleInventory() {}, closeSkills() {}, closeBag() {}, hint: null, actionOpen: false,
}))
vi.mock('../../chat/components/ChatPanel.vue', () => empty({ close() {} }))
vi.mock('../../playtest/components/PlaytestPerformanceHud.vue', () => empty())
vi.mock('./DevHelp.vue', () => empty())
vi.mock('../../chat/state/useChat', () => ({ useChat: () => ({ subscribe: () => () => undefined, attach: vi.fn(), sink: null }) }))

// jsdom has no 2D canvas or matchMedia: inert stand-ins are enough to build the engine.
function stubContext(): CanvasRenderingContext2D {
  const imageData = (a?: unknown, b?: number, c?: number, d?: number) => {
    const w = typeof a === 'number' ? (d ? c! : a) : 1
    const h = typeof a === 'number' ? (d ? d : b!) : 1
    return { width: w, height: h, data: new Uint8ClampedArray(Math.max(1, w * h * 4)) }
  }
  return new Proxy({}, {
    get: (_target, key) => {
      if (key === 'canvas') return { width: 320, height: 240 }
      if (key === 'measureText') return () => ({ width: 1 })
      if (key === 'getImageData' || key === 'createImageData') return imageData
      if (key === 'createLinearGradient' || key === 'createRadialGradient' || key === 'createPattern') return () => ({ addColorStop() {}, setTransform() {} })
      return () => undefined
    },
    set: () => true,
  }) as CanvasRenderingContext2D
}

type View = typeof import('./WildlandsView.vue').default
let WildlandsView: View

beforeAll(async () => {
  vi.stubEnv('VITE_PERF', 'on')
  vi.stubEnv('VITE_REALTIME_URL', 'ws://realtime.test')
  vi.resetModules()
  WildlandsView = (await import('./WildlandsView.vue')).default
})

const frames: FrameRequestCallback[] = []
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(stubContext() as never)
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback))
  vi.stubGlobal('cancelAnimationFrame', () => undefined)
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }))
  if (!('DOMMatrix' in globalThis)) {
    class Matrix { e = 0; f = 0; translateSelf() { return this } translate() { return new Matrix() } multiply() { return new Matrix() } }
    vi.stubGlobal('DOMMatrix', Matrix)
  }
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('WildlandsView unmounted during the capture import (PRESENCE UX-1 R3)', () => {
  it('starts nothing once the held import resolves after the unmount', async () => {
    const wrapper = mount(WildlandsView, {
      attachTo: document.body,
      // The static children are not under test; the async ones are the mocks above.
      global: { stubs: { LobbyHud: true, RunToggle: true, LobbyPlaza: true, LobbyMenu: true, LobbyPanel: true, WorldHintTray: true, AuthModal: true, RouterView: true } },
    })
    const setup = (wrapper.vm.$ as unknown as { setupState: { entry: { phase: string }; loading: boolean; game: unknown; perfCapture: unknown } }).setupState
    for (let i = 0; i < 50 && !hold.requested; i++) await flushPromises()
    expect(hold.requested).toBe(true)
    // The engine exists and the view is parked on the import.
    expect(setup.game).not.toBeNull()
    expect(setup.entry.phase).toBe('connecting')

    wrapper.unmount()
    const timers = vi.getTimerCount()
    const framesQueued = frames.length
    const listeners = vi.spyOn(window, 'addEventListener')
    const documentListeners = vi.spyOn(document, 'addEventListener')

    hold.release()
    for (let i = 0; i < 20; i++) await flushPromises()
    await vi.advanceTimersByTimeAsync(30_000)

    expect(hold.controllers).toBe(0)
    expect(hold.clients).toBe(0)
    expect(hold.attach).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(timers)
    expect(frames.length).toBe(framesQueued)
    expect(listeners).not.toHaveBeenCalled()
    expect(documentListeners).not.toHaveBeenCalled()
    expect(setup.entry.phase).toBe('connecting')
    expect(setup.loading).toBe(true)
    expect(setup.perfCapture).toBeNull()
  })
})
