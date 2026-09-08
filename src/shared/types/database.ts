// TypeScript types derived from BACKEND_INVENTORY.md (R02).
// Keep in sync with the live Supabase schema; do not invent columns.

export interface Profile {
  id: string
  username: string
  avatar_url: string | null
  display_name: string | null
  tokens: number | null
  free_claims_remaining: number | null
  free_claim_last_reset: string | null
  total_spent: number | null
  lang: 'es' | 'en' | 'pt' | 'fr' | null
  swap_cooldown_until: string | null
  token_multiplier: number | null
  dungeon_tokens_today: number | null
  dungeon_tokens_reset_at: string | null
  passive_tokens_collected_at: string | null
  twitch_id: string | null
  twitch_username: string | null
  twitch_sub_verified_at: string | null
  youtube_channel_id: string | null
  youtube_member_verified_at: string | null
  created_at: string | null
  updated_at: string | null
}

export interface Pokemon {
  id: number
  name_es: string
  name_en: string
  name_pt: string
  name_fr: string
  type1: string
  type2: string | null
  region: string
  is_legendary: boolean | null
  is_popular: boolean | null
  base_price: number | null
  sprite_url: string | null
  locked: boolean | null
  generation: number | null
  base_aura: number | null
  created_at: string | null
}

export interface Slot {
  pokemon_id: number
  owner_id: string | null
  owner_username: string | null
  current_price: number
  claim_count: number | null
  is_locked: boolean | null
  last_claimed_at: string | null
  aura: number | null
  aura_updated_at: string | null
  owned_since: string | null
  first_owner_id: string | null
  first_owner_username: string | null
  energy: number | null
  energy_updated_at: string | null
  link_url: string | null
  link_text: string | null
  created_at: string | null
  updated_at: string | null
}

export interface MarketListing {
  id: string
  pokemon_id: number
  seller_id: string
  seller_username: string
  price_tokens: number
  is_purchased: boolean | null
  purchased_by: string | null
  purchased_at: string | null
  expires_at: string | null
  created_at: string | null
}

export interface Transaction {
  id: string
  pokemon_id: number
  buyer_id: string
  buyer_username: string
  seller_id: string | null
  seller_username: string | null
  price: number
  was_free_claim: boolean | null
  tokens_refunded: number | null
  payment_provider: string | null
  payment_id: string | null
  payment_status: 'pending' | 'confirmed' | 'failed' | 'refunded' | null
  created_at: string | null
}

export interface TokenLedgerEntry {
  id: string
  user_id: string
  amount: number
  reason: string
  related_transaction_id: string | null
  pokemon_id: number | null
  created_at: string | null
}

export interface SwapHistoryEntry {
  id: string
  user_id: string | null
  pokemon_given_id: number | null
  pokemon_received_id: number | null
  was_shiny: boolean | null
  rarity: string | null
  created_at: string | null
}

export interface PokemonXp {
  user_id: string
  pokemon_id: number
  xp: number
  level: number
  moves: Record<string, unknown> | null
  last_updated_at: string | null
}

export interface PokedexEntry {
  user_id: string
  pokemon_id: number
}

export interface ActivityFeedEntry {
  id: string
  type: 'claim' | 'steal' | 'unlock_region' | 'unlock_legendary' | 'free_claim'
  user_id: string | null
  pokemon_id: number | null
  created_at: string | null
}
