// useMarket — R22
//
// Reactive state for the public market listing. All mutations (buy, cancel,
// publish) are server-authoritative via Edge Functions (R09). This composable
// owns loading and error state; it never writes market_listings directly.

import { ref, readonly } from 'vue'
import { listActiveListings, buy as apiBuy, cancel as apiCancel } from '../api/marketApi'
import type { MarketListing } from '../../../shared/types/database'

const _listings = ref<MarketListing[]>([])
const _loading  = ref(false)
const _error    = ref<string | null>(null)

export function useMarket() {
  async function load(): Promise<void> {
    _loading.value = true
    _error.value   = null
    try {
      _listings.value = await listActiveListings()
    } catch (e) {
      _error.value = e instanceof Error ? e.message : 'Error al cargar el mercado'
    } finally {
      _loading.value = false
    }
  }

  // Server-authoritative — market-buy Edge Function (R09).
  async function buy(listingId: string): Promise<void> {
    await apiBuy(listingId)
    await load()
  }

  // Server-authoritative — market-cancel Edge Function (R09).
  async function cancel(listingId: string): Promise<void> {
    await apiCancel(listingId)
    await load()
  }

  return {
    listings: readonly(_listings),
    isLoading: readonly(_loading),
    error:     readonly(_error),
    load,
    buy,
    cancel,
  }
}

export function _resetMarketState(): void {
  _listings.value = []
  _loading.value  = false
  _error.value    = null
}
