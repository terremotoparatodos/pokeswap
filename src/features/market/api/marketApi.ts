// Market API — R06 service layer.
//
// All three operations (publish, cancel, buy) are server-authoritative
// via Edge Functions deployed in R09. Direct client writes to market_listings
// are blocked by RLS (V-04 and V-05 closed).

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

// Server-authoritative — `market-publish` Edge Function (R09).
export async function publish(pokemonId: number, priceTokens: number): Promise<void> {
  const { error } = await supabase.functions.invoke('market-publish', {
    body: { pokemon_id: pokemonId, price_tokens: priceTokens },
  })
  if (error) throw error
}

// Server-authoritative — `market-cancel` Edge Function (R09).
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
