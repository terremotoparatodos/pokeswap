-- DGN-2: consume_dungeon_energy RPC (R15)
-- Closes INV-DGN-5: energy deduction on dungeon entry must be server-side,
-- non-refundable, and the first persistent action of the dungeon flow.
--
-- Energy model (legacy constants preserved):
--   ENERGY_MAX          = 100
--   ENERGY_REGEN_PER_H  = 10   (one unit every 6 minutes)
--   DUNGEON_ENERGY_COST = 30   (fixed cost on entry regardless of session length)
--
-- The function computes current energy from stored (energy, energy_updated_at)
-- including regeneration that has accrued since the last write, then deducts
-- the entry cost atomically. The client must never write slots.energy directly.

CREATE OR REPLACE FUNCTION consume_dungeon_energy(
  p_pokemon_id integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_caller           uuid    := auth.uid();
  v_slot             record;
  v_now              timestamptz := now();
  v_hours_elapsed    numeric;
  v_current_energy   numeric;
  v_new_energy       integer;
  v_energy_max       constant integer := 100;
  v_regen_per_hour   constant integer := 10;
  v_entry_cost       constant integer := 30;
BEGIN
  -- Verify ownership and fetch slot state (lock for update)
  SELECT energy, energy_updated_at, is_locked
  INTO v_slot
  FROM slots
  WHERE pokemon_id = p_pokemon_id AND owner_id = v_caller
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_owner';
  END IF;

  -- Reject if pokemon is in an active market listing (INV-OWN-3 / INV-DGN-4)
  IF v_slot.is_locked THEN
    RAISE EXCEPTION 'pokemon_locked';
  END IF;

  -- Compute regenerated energy since last write
  IF v_slot.energy_updated_at IS NOT NULL THEN
    v_hours_elapsed := EXTRACT(EPOCH FROM (v_now - v_slot.energy_updated_at)) / 3600.0;
  ELSE
    v_hours_elapsed := 0;
  END IF;

  v_current_energy := LEAST(
    v_energy_max,
    COALESCE(v_slot.energy, v_energy_max) + v_hours_elapsed * v_regen_per_hour
  );

  -- Enforce minimum energy for entry
  IF v_current_energy < v_entry_cost THEN
    RAISE EXCEPTION 'insufficient_energy';
  END IF;

  -- Deduct cost and persist; energy_updated_at records the moment of deduction
  v_new_energy := GREATEST(0, FLOOR(v_current_energy) - v_entry_cost);

  UPDATE slots
  SET energy            = v_new_energy,
      energy_updated_at = v_now
  WHERE pokemon_id = p_pokemon_id AND owner_id = v_caller;

  RETURN jsonb_build_object(
    'remaining_energy', v_new_energy
  );
END;
$$;

GRANT EXECUTE ON FUNCTION consume_dungeon_energy(integer) TO authenticated;
