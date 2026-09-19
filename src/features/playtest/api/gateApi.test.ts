// Every way the gate row can fail to arrive answers null — never an open default.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const maybeSingle = vi.fn()

vi.mock('../../../shared/api/supabase', () => ({
  supabase: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }) },
}))

const { fetchGateConfig } = await import('./gateApi')

describe('fetchGateConfig', () => {
  beforeEach(() => { maybeSingle.mockReset() })

  it('reads the row', async () => {
    maybeSingle.mockResolvedValue({ data: { state: 'closed', message: 'chau', access_code: null }, error: null })
    expect(await fetchGateConfig()).toEqual({ state: 'closed', message: 'chau', accessCode: null })
  })

  it.each([
    ['an error', { data: null, error: { message: 'RLS' } }],
    ['a missing row', { data: null, error: null }],
    ['an unknown state', { data: { state: 'banana', message: null, access_code: null }, error: null }],
  ])('answers null on %s', async (_label, result) => {
    maybeSingle.mockResolvedValue(result)
    expect(await fetchGateConfig()).toBeNull()
  })

  it('answers null when the network throws', async () => {
    maybeSingle.mockImplementation(() => { throw new TypeError('Failed to fetch') })
    expect(await fetchGateConfig()).toBeNull()
  })
})
