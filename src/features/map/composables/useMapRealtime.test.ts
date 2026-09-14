import { mount } from '@vue/test-utils'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { defineComponent, h } from 'vue'

type Handler = (payload: Record<string, unknown>) => void
type StatusCb = (status: string) => void

const channels = new Map<string, { handler?: Handler; status?: StatusCb }>()
const removeChannel = vi.fn()

vi.mock('../../../shared/api/supabase', () => ({
  supabase: {
    channel: (name: string) => {
      const entry: { handler?: Handler; status?: StatusCb } = {}
      channels.set(name, entry)
      const api = {
        on: (_type: string, _filter: unknown, handler: Handler) => { entry.handler = handler; return api },
        subscribe: (status?: StatusCb) => { entry.status = status; return { name } },
      }
      return api
    },
    removeChannel: (...a: unknown[]) => removeChannel(...a),
  },
}))

import { useMapRealtime, type MapRealtimeOptions } from './useMapRealtime'

/** The latest channel whose name starts with `prefix` (names carry a per-instance suffix). */
function channel(prefix: string) {
  const name = [...channels.keys()].reverse().find(n => n.startsWith(`${prefix}-`))
  return channels.get(name!)!
}

function host(onPatch = vi.fn(), options?: MapRealtimeOptions) {
  let api!: ReturnType<typeof useMapRealtime>
  const wrapper = mount(defineComponent({
    setup() {
      api = useMapRealtime(onPatch, options)
      return () => h('div')
    },
  }))
  return { wrapper, api: () => api, onPatch }
}

beforeEach(() => {
  channels.clear()
  removeChannel.mockClear()
})

describe('useMapRealtime', () => {
  it('names channels with the given prefix and removes them on unmount', () => {
    const { wrapper } = host(vi.fn(), { channel: 'plaza' })
    const names = [...channels.keys()]
    expect(names).toHaveLength(2)
    expect(names[0]).toMatch(/^plaza-slots-\d+$/)
    expect(names[1]).toMatch(/^plaza-activity-\d+$/)
    wrapper.unmount()
    expect(removeChannel).toHaveBeenCalledTimes(2)
  })

  it('never reuses a topic, so a quick remount cannot get the old subscribed channel', () => {
    host()
    host()
    const slots = [...channels.keys()].filter(n => n.startsWith('map-slots-'))
    expect(slots).toHaveLength(2)
    expect(new Set(slots).size).toBe(2)
  })

  it('forwards valid slot rows and ignores malformed ones', () => {
    const { onPatch } = host()
    const slots = channel('map-slots').handler!
    slots({ eventType: 'UPDATE', new: { pokemon_id: 3, owner_id: 'u', owner_username: 'ash', current_price: 10 } })
    slots({ eventType: 'UPDATE', new: { pokemon_id: 'bad' } })
    slots({ eventType: 'DELETE', new: {}, old: { pokemon_id: 4 } })
    expect(onPatch).toHaveBeenCalledTimes(2)
    expect(onPatch.mock.calls[0][0]).toMatchObject({ pokemon_id: 3, owner_username: 'ash' })
    expect(onPatch.mock.calls[1][0]).toMatchObject({ pokemon_id: 4, owner_id: null })
  })

  it('reports reconnects only after a first successful subscription', () => {
    const onReconnect = vi.fn()
    const { api } = host(vi.fn(), { onReconnect })
    const status = channel('map-slots').status!
    status('SUBSCRIBED')
    expect(onReconnect).not.toHaveBeenCalled()
    expect(api().connected.value).toBe(true)
    status('CHANNEL_ERROR')
    expect(api().connected.value).toBe(false)
    status('SUBSCRIBED')
    expect(onReconnect).toHaveBeenCalledOnce()
  })

  it('prepends new activity, notifies and skips malformed rows', () => {
    const onActivity = vi.fn()
    const { api } = host(vi.fn(), { onActivity })
    const activity = channel('map-activity').handler!
    activity({ new: { id: 'a1', type: 'claim', pokemon_id: 25 } })
    activity({ new: { nope: true } })
    expect(api().recentActivity.value.map(e => e.id)).toEqual(['a1'])
    expect(onActivity).toHaveBeenCalledOnce()
  })
})
