import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'

type Handler = (payload: Record<string, unknown>) => void
type Status = (value: string) => void
const channels = new Map<string, { handler?: Handler; status?: Status }>()
const removeChannel = vi.fn()

vi.mock('../../../shared/api/supabase', () => ({
  supabase: {
    channel: (name: string) => {
      const entry: { handler?: Handler; status?: Status } = {}
      channels.set(name, entry)
      const api = {
        on: (_kind: string, _filter: unknown, handler: Handler) => { entry.handler = handler; return api },
        subscribe: (status?: Status) => { entry.status = status; return { name } },
      }
      return api
    },
    removeChannel: (...args: unknown[]) => removeChannel(...args),
  },
}))

import { usePlazaRealtime } from './usePlazaRealtime'

function host(onPatch = vi.fn()) {
  let api!: ReturnType<typeof usePlazaRealtime>
  const wrapper = mount(defineComponent({ setup: () => { api = usePlazaRealtime(onPatch); return () => h('div') } }))
  return { wrapper, api: () => api, onPatch }
}

beforeEach(() => { channels.clear(); removeChannel.mockClear() })

describe('usePlazaRealtime', () => {
  it('uses unique topics and removes both channels on unmount', () => {
    const first = host()
    host()
    const slots = [...channels.keys()].filter(name => name.startsWith('plaza-slots-'))
    expect(new Set(slots).size).toBe(2)
    first.wrapper.unmount()
    expect(removeChannel).toHaveBeenCalledTimes(2)
  })

  it('forwards only valid server rows', () => {
    const { onPatch } = host()
    const entry = [...channels.entries()].find(([name]) => name.startsWith('plaza-slots-'))![1]
    entry.handler!({ eventType: 'UPDATE', new: { pokemon_id: 7, owner_id: 'u', current_price: 2 } })
    entry.handler!({ eventType: 'UPDATE', new: { pokemon_id: 'bad' } })
    expect(onPatch).toHaveBeenCalledOnce()
  })
})
