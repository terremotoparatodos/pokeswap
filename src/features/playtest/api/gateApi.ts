// Reads the remote kill switch.
//
// One row, public-read, no write from the browser ever. The operator flips it
// from the Supabase SQL editor and every open client notices within a poll.
//
// Every failure path lands on the build default rather than throwing: the table
// not existing yet, RLS refusing, the network being down and a malformed row
// all mean "keep whatever the build shipped with". A kill switch that takes the
// playtest down because Supabase hiccuped would be worse than no kill switch.

import { supabase } from '../../../shared/api/supabase'
import { parseGateConfig, type PlaytestGateConfig } from '../domain/playtestGate'
import { buildDefaultGate } from '../playtestBuild'

/** The row this build looks at. Bumping the playtest means bumping this id. */
export const GATE_ID = 'community-0.1'

/** How often an open client re-reads the gate, so CLOSED lands within a minute. */
export const GATE_POLL_MS = 45_000

export async function fetchGateConfig(): Promise<PlaytestGateConfig> {
  const fallback = buildDefaultGate()
  try {
    const { data, error } = await supabase
      .from('playtest_gate')
      .select('state, message, access_code')
      .eq('id', GATE_ID)
      .maybeSingle()
    if (error || !data) return fallback
    return parseGateConfig(data, fallback)
  } catch {
    return fallback
  }
}
