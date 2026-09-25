// Reads the remote kill switch.
//
// One row, public-read, no write from the browser ever. The operator flips it
// from the Supabase SQL editor and every open client notices within a poll.
//
// Every failure path — the network down, RLS refusing, the row missing or
// malformed — answers null, never a default: "no answer" is not "open". The
// composable keeps the last state it did read (so a known CLOSED stays closed),
// and a tab that never got an answer stays on the gate screen.

import { supabase } from '../../../shared/api/supabase'
import { parseGateConfig, type PlaytestGateConfig } from '../domain/playtestGate'

/**
 * The row this build looks at. Playtest 0.2 deliberately keeps the 0.1 row:
 * the operator's open/closed switch and access code live there, and a new id
 * without its row would leave every player on the gate screen.
 */
export const GATE_ID = 'community-0.1'

/** How often an open client re-reads the gate, so CLOSED lands within a minute. */
export const GATE_POLL_MS = 45_000

/** The row as the operator wrote it, or null when it could not be read. */
export async function fetchGateConfig(): Promise<PlaytestGateConfig | null> {
  try {
    const { data, error } = await supabase
      .from('playtest_gate')
      .select('state, message, access_code')
      .eq('id', GATE_ID)
      .maybeSingle()
    if (error || !data || (data.state !== 'open' && data.state !== 'closed')) return null
    return parseGateConfig(data)
  } catch {
    return null
  }
}
