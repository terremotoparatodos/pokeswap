-- PLAYTEST-ONLY: the remote kill switch for Community Playtest 0.1.
--
-- One row, read by everyone, written by nobody with a browser. The operator
-- flips `state` from the SQL editor and every open client closes within one
-- poll (~45 s) with no redeploy.
--
-- This table holds no player data. Dropping it after the playtest is safe and
-- leaves the client on its build-time default (see the shutdown procedure in
-- docs/playtest/COMMUNITY_PLAYTEST_0_1.md).

CREATE TABLE IF NOT EXISTS playtest_gate (
  id          text PRIMARY KEY,
  state       text NOT NULL DEFAULT 'closed' CHECK (state IN ('open', 'closed')),
  message     text,
  access_code text,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE playtest_gate ENABLE ROW LEVEL SECURITY;

-- Read-only to the world. The access code is published by design: it is a
-- speed bump so a stray link does not wander in, never an authorization
-- boundary. Nothing behind the gate reaches persistent state.
DROP POLICY IF EXISTS playtest_gate_public_read ON playtest_gate;
CREATE POLICY playtest_gate_public_read
  ON playtest_gate FOR SELECT
  TO anon, authenticated
  USING (true);

-- No INSERT/UPDATE/DELETE policy exists on purpose: with RLS enabled and no
-- policy, anon and authenticated cannot write. Only the service role (the SQL
-- editor, the dashboard) can, which is exactly who should own a kill switch.

-- Ships CLOSED. Opening the playtest is a deliberate act, never a default.
INSERT INTO playtest_gate (id, state, message, access_code)
VALUES ('community-0.1', 'closed', NULL, NULL)
ON CONFLICT (id) DO NOTHING;
