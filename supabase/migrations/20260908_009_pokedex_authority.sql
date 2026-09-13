-- R13: Make pokedex_entries server-authoritative
--
-- TRUST_BOUNDARY.md §5 classified the direct client INSERT/UPDATE on pokedex_entries
-- as "Acceptable until R13". This migration closes that gap.
--
-- Three SECURITY DEFINER RPCs replace the direct client writes:
--   record_pokemon_seen(p_pokemon_id)     — marks one Pokémon as seen
--   bulk_record_pokemon_seen(p_pokemon_ids) — batch version for localStorage migration
--   register_pokemon(p_pokemon_id)        — adds registered_at = now() (server timestamp)
--
-- After this migration, authenticated clients may only SELECT pokedex_entries.
-- Direct INSERT/UPDATE/DELETE are rejected by column privilege (REVOKE below).

-- ─── RPCs ─────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION record_pokemon_seen(p_pokemon_id integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pokemon WHERE id = p_pokemon_id) THEN
    RAISE EXCEPTION 'pokemon_not_found';
  END IF;

  INSERT INTO pokedex_entries (user_id, pokemon_id)
  VALUES (auth.uid(), p_pokemon_id)
  ON CONFLICT (user_id, pokemon_id) DO NOTHING;
END;
$$;

-- Batch version: filters out invalid pokemon_ids silently (same as the legacy
-- localStorage migration path which inserted whatever IDs were cached locally).
CREATE OR REPLACE FUNCTION bulk_record_pokemon_seen(p_pokemon_ids integer[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO pokedex_entries (user_id, pokemon_id)
  SELECT auth.uid(), p.id
  FROM unnest(p_pokemon_ids) AS t(id)
  JOIN pokemon p ON p.id = t.id
  ON CONFLICT (user_id, pokemon_id) DO NOTHING;
END;
$$;

-- register_pokemon: marks the entry as registered (owned at some point).
-- Always upserts the seen row first so a single call is enough.
-- registered_at is set to now() — clients cannot supply a past timestamp.
CREATE OR REPLACE FUNCTION register_pokemon(p_pokemon_id integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pokemon WHERE id = p_pokemon_id) THEN
    RAISE EXCEPTION 'pokemon_not_found';
  END IF;

  INSERT INTO pokedex_entries (user_id, pokemon_id, registered_at)
  VALUES (auth.uid(), p_pokemon_id, now())
  ON CONFLICT (user_id, pokemon_id) DO UPDATE
    SET registered_at = COALESCE(pokedex_entries.registered_at, EXCLUDED.registered_at);
END;
$$;

-- ─── Revoke direct client writes ──────────────────────────────────────────────

REVOKE INSERT, UPDATE, DELETE ON TABLE pokedex_entries FROM authenticated;

-- ─── Grant RPC execution ──────────────────────────────────────────────────────

GRANT EXECUTE ON FUNCTION record_pokemon_seen(integer)    TO authenticated;
GRANT EXECUTE ON FUNCTION bulk_record_pokemon_seen(integer[]) TO authenticated;
GRANT EXECUTE ON FUNCTION register_pokemon(integer)       TO authenticated;
