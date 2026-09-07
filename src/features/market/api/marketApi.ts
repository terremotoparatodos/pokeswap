// Market API — R06 service layer.
//
// Gap operations (V-04, V-05) must NOT fall back to direct client writes.
// Per TRUST_BOUNDARY.md §7, new code must call the server-side function even
// before it exists. publish() and cancel() call the respective Edge Functions
// and will return a clear error until those functions are deployed (R09).

import { supabase } from '../../../shared/api/supabase'
import type { MarketListing } from '../../../shared/types/database'

export async function listActiveListings(): Promise<MarketListing[]> {
  const { data, error } = await supabase
    .from('market_listings')
    .select('*')
    .eq('is_purchased', false)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
  if (error) throw error
  return data
}

export async function getListing(listingId: string): Promise<MarketListing> {
  const { data, error } = await supabase
    .from('market_listings')
    .select('*')
    .eq('id', listingId)
    .single()
  if (error) throw error
  return data
}

// Gap V-04 — `market-publish` Edge Function does not yet exist.
// This stub enforces the trust boundary: no component may INSERT into
// market_listings directly. The function will be implemented in R09.
export async function publish(pokemonId: number, priceTokens: number): Promise<void> {
  const { error } = await supabase.functions.invoke('market-publish', {
    body: { pokemon_id: pokemonId, price_tokens: priceTokens },
  })
  if (error) throw error
}

// Gap V-05 — `market-cancel` Edge Function does not yet exist.
// This stub enforces the trust boundary: no component may DELETE from
// market_listings directly. The function will be implemented in R09.
export async function cancel(listingId: string): Promise<void> {
  const { error } = await supabase.functions.invoke('market-cancel', {
    body: { listing_id: listingId },
  })
  if (error) throw error
}

// Server-authoritative — `market-buy` Edge Function exists (R02 §6.3).
export async function buy(listingId: string): Promise<void> {
  const { error } = await supabase.functions.invoke('market-buy', {
    body: { listing_id: listingId },
  })
  if (error) throw error
}
