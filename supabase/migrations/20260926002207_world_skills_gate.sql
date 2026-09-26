-- RC-0.3 dark launch: the WORLD × SKILLS feature gate.
--
--   world_skills_gate     one row, 'world-skills'. enabled = false: closed to
--                         everyone except the testers below. true: open to all.
--   world_skills_testers  user ids allowed while the gate is closed. Data, not
--                         code: added and removed with SQL by the operator.
--   world_skills_access() 'open' | 'tester' | 'closed' for one user.
--
-- Enforced where the data is: the `world-authority` Edge Function asks
-- world_skills_access() and, for a closed user, reports no workable Pokémon and
-- refuses to settle completed work. Nothing here is visible to clients: no
-- policies, no grants to anon/authenticated. It is independent of the
-- Community Playtest gate (`playtest_gate`, row 'community-0.1').
--
-- Fail closed: a missing gate row means closed.
--
-- Disable (instant, no deploy):
--   UPDATE public.world_skills_gate SET enabled = false, updated_at = now() WHERE id = 'world-skills';
--   DELETE FROM public.world_skills_testers;

CREATE TABLE IF NOT EXISTS public.world_skills_gate (
  id         text        PRIMARY KEY CHECK (id = 'world-skills'),
  enabled    boolean     NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.world_skills_gate (id, enabled) VALUES ('world-skills', false)
  ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.world_skills_testers (
  user_id  uuid        PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  note     text        NULL CHECK (note IS NULL OR char_length(note) <= 80),
  added_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.world_skills_gate    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.world_skills_testers ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.world_skills_gate    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.world_skills_testers FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.world_skills_gate    TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.world_skills_testers TO service_role;

CREATE OR REPLACE FUNCTION public.world_skills_access(p_user_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT CASE
    WHEN COALESCE((SELECT enabled FROM public.world_skills_gate WHERE id = 'world-skills'), false) THEN 'open'
    WHEN EXISTS (SELECT 1 FROM public.world_skills_testers WHERE user_id = p_user_id) THEN 'tester'
    ELSE 'closed'
  END;
$$;

REVOKE ALL ON FUNCTION public.world_skills_access(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.world_skills_access(uuid) TO service_role;
