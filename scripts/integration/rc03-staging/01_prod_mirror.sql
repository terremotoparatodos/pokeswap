-- RC-0.3 staging: a SCHEMA-ONLY mirror of the production objects that decide
-- Pokémon ownership, read from the production catalog on 2026-09-25 (read-only).
-- No production data. Placeholder Pokémon rows only, for foreign keys.
-- Local staging only; never applied anywhere remote.

CREATE TABLE public.pokemon (id integer NOT NULL, name_es text NOT NULL, name_en text NOT NULL, name_pt text NOT NULL, name_fr text NOT NULL, type1 text NOT NULL, type2 text, region text NOT NULL, is_legendary boolean DEFAULT false, is_popular boolean DEFAULT false, base_price numeric(10,2) DEFAULT 1, sprite_url text, created_at timestamp with time zone DEFAULT now(), locked boolean DEFAULT false, generation integer, base_aura integer DEFAULT 100);
CREATE TABLE public.profiles (id uuid NOT NULL, username text NOT NULL, avatar_url text, display_name text, tokens numeric(10,2) DEFAULT 0, free_claims_remaining integer DEFAULT 1, free_claim_last_reset date DEFAULT CURRENT_DATE, total_spent numeric(10,2) DEFAULT 0, lang text DEFAULT 'es'::text, created_at timestamp with time zone DEFAULT now(), updated_at timestamp with time zone DEFAULT now(), swap_cooldown_until timestamp with time zone, twitch_id text, twitch_username text, twitch_sub_verified_at timestamp with time zone, youtube_channel_id text, youtube_member_verified_at timestamp with time zone, token_multiplier numeric DEFAULT 1.0, dungeon_tokens_today integer DEFAULT 0, dungeon_tokens_reset_at timestamp with time zone DEFAULT now(), passive_tokens_collected_at timestamp with time zone DEFAULT now());
CREATE TABLE public.slots (pokemon_id integer NOT NULL, owner_id uuid, owner_username text, current_price numeric(10,2) DEFAULT 1 NOT NULL, claim_count integer DEFAULT 0, is_locked boolean DEFAULT false, last_claimed_at timestamp with time zone DEFAULT now(), link_url text, link_text text, created_at timestamp with time zone DEFAULT now(), updated_at timestamp with time zone DEFAULT now(), aura integer DEFAULT 0, aura_updated_at timestamp with time zone DEFAULT now(), owned_since timestamp with time zone DEFAULT now(), first_owner_id uuid, first_owner_username text, energy integer DEFAULT 100, energy_updated_at timestamp with time zone DEFAULT now());
CREATE TABLE public.market_listings (id uuid DEFAULT gen_random_uuid() NOT NULL, pokemon_id integer NOT NULL, seller_id uuid NOT NULL, seller_username text NOT NULL, price_tokens integer NOT NULL, is_purchased boolean DEFAULT false, purchased_by uuid, purchased_at timestamp with time zone, created_at timestamp with time zone DEFAULT now(), expires_at timestamp with time zone DEFAULT (now() + '7 days'::interval));
CREATE TABLE public.transactions (id uuid DEFAULT gen_random_uuid() NOT NULL, pokemon_id integer NOT NULL, buyer_id uuid NOT NULL, buyer_username text NOT NULL, seller_id uuid, seller_username text, price numeric(10,2) NOT NULL, was_free_claim boolean DEFAULT false, tokens_refunded numeric(10,2) DEFAULT 0, payment_provider text, payment_id text, payment_status text DEFAULT 'pending'::text, created_at timestamp with time zone DEFAULT now());
CREATE TABLE public.token_ledger (id uuid DEFAULT gen_random_uuid() NOT NULL, user_id uuid NOT NULL, amount numeric(10,2) NOT NULL, reason text NOT NULL, related_transaction_id uuid, pokemon_id integer, created_at timestamp with time zone DEFAULT now());
CREATE TABLE public.activity_feed (id uuid DEFAULT gen_random_uuid() NOT NULL, type text NOT NULL, pokemon_id integer, actor_username text NOT NULL, target_username text, price numeric(10,2), metadata jsonb DEFAULT '{}'::jsonb, created_at timestamp with time zone DEFAULT now());

ALTER TABLE public.pokemon ADD CONSTRAINT pokemon_pkey PRIMARY KEY (id);
-- (pokemon_region_fkey → regions omitted: regions is irrelevant to ownership)
ALTER TABLE public.profiles ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);
ALTER TABLE public.profiles ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_lang_check CHECK ((lang = ANY (ARRAY['es'::text, 'en'::text, 'pt'::text, 'fr'::text])));
ALTER TABLE public.profiles ADD CONSTRAINT profiles_tokens_check CHECK ((tokens >= (0)::numeric));
ALTER TABLE public.profiles ADD CONSTRAINT profiles_username_key UNIQUE (username);
ALTER TABLE public.profiles ADD CONSTRAINT profiles_username_min_length CHECK ((length(TRIM(BOTH FROM username)) >= 3));
ALTER TABLE public.slots ADD CONSTRAINT slots_pkey PRIMARY KEY (pokemon_id);
ALTER TABLE public.slots ADD CONSTRAINT slots_first_owner_id_fkey FOREIGN KEY (first_owner_id) REFERENCES profiles(id);
ALTER TABLE public.slots ADD CONSTRAINT slots_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES profiles(id);
ALTER TABLE public.slots ADD CONSTRAINT slots_pokemon_id_fkey FOREIGN KEY (pokemon_id) REFERENCES pokemon(id);
ALTER TABLE public.market_listings ADD CONSTRAINT market_listings_pkey PRIMARY KEY (id);
ALTER TABLE public.market_listings ADD CONSTRAINT market_listings_pokemon_id_fkey FOREIGN KEY (pokemon_id) REFERENCES pokemon(id);
ALTER TABLE public.market_listings ADD CONSTRAINT market_listings_price_tokens_check CHECK ((price_tokens > 0));
ALTER TABLE public.market_listings ADD CONSTRAINT market_listings_purchased_by_fkey FOREIGN KEY (purchased_by) REFERENCES profiles(id);
ALTER TABLE public.market_listings ADD CONSTRAINT market_listings_seller_id_fkey FOREIGN KEY (seller_id) REFERENCES profiles(id);
ALTER TABLE public.transactions ADD CONSTRAINT transactions_pkey PRIMARY KEY (id);
ALTER TABLE public.transactions ADD CONSTRAINT transactions_buyer_id_fkey FOREIGN KEY (buyer_id) REFERENCES profiles(id);
ALTER TABLE public.transactions ADD CONSTRAINT transactions_payment_status_check CHECK ((payment_status = ANY (ARRAY['pending'::text, 'confirmed'::text, 'failed'::text, 'refunded'::text])));
ALTER TABLE public.transactions ADD CONSTRAINT transactions_pokemon_id_fkey FOREIGN KEY (pokemon_id) REFERENCES pokemon(id);
ALTER TABLE public.transactions ADD CONSTRAINT transactions_seller_id_fkey FOREIGN KEY (seller_id) REFERENCES profiles(id);
ALTER TABLE public.token_ledger ADD CONSTRAINT token_ledger_pkey PRIMARY KEY (id);
ALTER TABLE public.token_ledger ADD CONSTRAINT token_ledger_pokemon_id_fkey FOREIGN KEY (pokemon_id) REFERENCES pokemon(id);
ALTER TABLE public.token_ledger ADD CONSTRAINT token_ledger_related_transaction_id_fkey FOREIGN KEY (related_transaction_id) REFERENCES transactions(id);
ALTER TABLE public.token_ledger ADD CONSTRAINT token_ledger_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id);
ALTER TABLE public.activity_feed ADD CONSTRAINT activity_feed_pkey PRIMARY KEY (id);
ALTER TABLE public.activity_feed ADD CONSTRAINT activity_feed_pokemon_id_fkey FOREIGN KEY (pokemon_id) REFERENCES pokemon(id);
ALTER TABLE public.activity_feed ADD CONSTRAINT activity_feed_type_check CHECK ((type = ANY (ARRAY['claim'::text, 'steal'::text, 'unlock_region'::text, 'unlock_legendary'::text, 'free_claim'::text])));

-- RLS and policies exactly as in production.
ALTER TABLE public.pokemon ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.token_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_feed ENABLE ROW LEVEL SECURITY;
CREATE POLICY pokemon_read ON public.pokemon FOR SELECT USING (true);
CREATE POLICY profiles_read ON public.profiles FOR SELECT USING (true);
CREATE POLICY profiles_update ON public.profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY slots_read ON public.slots FOR SELECT USING (true);
CREATE POLICY "anyone can view active listings" ON public.market_listings FOR SELECT USING ((NOT is_purchased) AND (expires_at > now()));
CREATE POLICY transactions_own ON public.transactions FOR SELECT USING ((auth.uid() = buyer_id) OR (auth.uid() = seller_id));
CREATE POLICY tokens_own ON public.token_ledger FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY activity_read ON public.activity_feed FOR SELECT USING (true);

-- Table ACLs: Supabase's default privileges already give anon/authenticated
-- arwdDxtm on new public tables, which is what production shows for every table
-- here except profiles (SEC-1: no table-level INSERT/UPDATE, column grants only).
GRANT ALL ON public.pokemon, public.slots, public.market_listings, public.transactions, public.token_ledger, public.activity_feed TO anon, authenticated, service_role;
GRANT ALL ON public.profiles TO service_role;
REVOKE ALL ON public.profiles FROM anon, authenticated;
GRANT SELECT, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public.profiles TO anon, authenticated;
GRANT INSERT (id, username) ON public.profiles TO authenticated;
GRANT UPDATE (id, username, avatar_url, display_name, lang) ON public.profiles TO authenticated;

