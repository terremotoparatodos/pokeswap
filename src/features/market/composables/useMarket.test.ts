import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useMarket, _resetMarketState } from './useMarket'

const mockList   = vi.fn()
const mockBuy    = vi.fn()
const mockCancel = vi.fn()

vi.mock('../api/marketApi', () => ({
  listActiveListings: (...a: unknown[]) => mockList(...a),
  buy:                (...a: unknown[]) => mockBuy(...a),
  cancel:             (...a: unknown[]) => mockCancel(...a),
}))

const LISTING = {
  id: 'l1', pokemon_id: 25, seller_id: 'u1', seller_username: 'ash',
  price_tokens: 500, is_purchased: false, purchased_by: null, purchased_at: null,
  expires_at: '2099-01-01T00:00:00Z', created_at: null,
}

beforeEach(() => {
  _resetMarketState()
  vi.clearAllMocks()
  mockList.mockResolvedValue([LISTING])
  mockBuy.mockResolvedValue(undefined)
  mockCancel.mockResolvedValue(undefined)
})

describe('useMarket', () => {
  it('starts empty', () => {
    const { listings, isLoading, error } = useMarket()
    expect(listings.value).toEqual([])
    expect(isLoading.value).toBe(false)
    expect(error.value).toBeNull()
  })

  it('load() populates listings', async () => {
    const { listings, load } = useMarket()
    await load()
    expect(listings.value).toHaveLength(1)
    expect(listings.value[0].id).toBe('l1')
  })

  it('load() sets isLoading during fetch', async () => {
    let sawLoading = false
    mockList.mockImplementation(async () => {
      sawLoading = useMarket().isLoading.value
      return [LISTING]
    })
    await useMarket().load()
    expect(sawLoading).toBe(true)
  })

  it('load() sets error on failure', async () => {
    mockList.mockRejectedValue(new Error('DB error'))
    const { load, error } = useMarket()
    await load()
    expect(error.value).toContain('DB error')
  })

  it('buy() calls apiBuy then reloads', async () => {
    const { buy } = useMarket()
    await buy('l1')
    expect(mockBuy).toHaveBeenCalledWith('l1')
    expect(mockList).toHaveBeenCalledOnce()
  })

  it('cancel() calls apiCancel then reloads', async () => {
    const { cancel } = useMarket()
    await cancel('l1')
    expect(mockCancel).toHaveBeenCalledWith('l1')
    expect(mockList).toHaveBeenCalledOnce()
  })

  it('buy() propagates error', async () => {
    mockBuy.mockRejectedValue(new Error('Insufficient funds'))
    const { buy } = useMarket()
    await expect(buy('l1')).rejects.toThrow('Insufficient funds')
  })

  it('cancel() propagates error', async () => {
    mockCancel.mockRejectedValue(new Error('Not owner'))
    const { cancel } = useMarket()
    await expect(cancel('l1')).rejects.toThrow('Not owner')
  })
})
